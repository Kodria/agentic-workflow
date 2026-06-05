// cli/src/core/context/orchestrator.ts
import { AgentTarget, Scope, ProviderConfig, PROVIDERS, getInjection } from '../../providers';
import { InjectionStrategy } from './strategies/strategy';
import { HookMergeStrategy } from './strategies/hook-merge';
import { ConfigInstructionsStrategy } from './strategies/config-instructions';
import { buildContext } from './provider';
import { materialize, globalContextPath } from './materializer';
import { InjectionInput, InjectionState, MaterializedRef } from './types';

export type ContextOp = {
    agent: AgentTarget;
    scope: Scope;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
    profileExtensions: string[];
};

type Overrides = { providerOverride?: ProviderConfig; contextPathOverride?: string };

export class InjectionOrchestrator {
    constructor(private overrides: Overrides = {}) {}

    private provider(agent: AgentTarget): ProviderConfig {
        return this.overrides.providerOverride ?? PROVIDERS[agent];
    }

    private strategy(agent: AgentTarget): InjectionStrategy {
        const inj = this.overrides.providerOverride?.injection ?? getInjection(agent);
        if (!inj) throw new Error(`agent '${agent}' has no injection mechanism configured`);
        switch (inj.type) {
            case 'cc-settings-merge': return new HookMergeStrategy();
            case 'config-instructions': return new ConfigInstructionsStrategy();
        }
    }

    /** Full input: builds context from registry and materializes to disk. Used by installContext only. */
    private inputFor(op: ContextOp): InjectionInput {
        const ctx = buildContext({ registryRoot: op.registryRoot, profileExtensions: op.profileExtensions });
        const absPath = this.overrides.contextPathOverride ?? globalContextPath();
        const ref = materialize(ctx, absPath, op.scope);
        return { ref, registryRoot: op.registryRoot, installMethod: op.installMethod, agent: op.agent, scope: op.scope };
    }

    /** Path-only input: no buildContext, no materialize. Safe for remove() which never reads contentHash. */
    private pathInputFor(op: ContextOp): InjectionInput {
        const absPath = this.overrides.contextPathOverride ?? globalContextPath();
        const ref: MaterializedRef = { absPath, scope: op.scope, contentHash: '' };
        return { ref, registryRoot: op.registryRoot, installMethod: op.installMethod, agent: op.agent, scope: op.scope };
    }

    /**
     * Status input: builds context from registry (to get expected hash) but does NOT materialize.
     * Avoids silently correcting a stale file before the strategy can observe it.
     */
    private statusInputFor(op: ContextOp): InjectionInput {
        const absPath = this.overrides.contextPathOverride ?? globalContextPath();
        let contentHash = '';
        try {
            const ctx = buildContext({ registryRoot: op.registryRoot, profileExtensions: op.profileExtensions });
            contentHash = ctx.contentHash;
        } catch {
            // Registry missing — fall back to empty hash; strategy handles absent file independently.
        }
        const ref: MaterializedRef = { absPath, scope: op.scope, contentHash };
        return { ref, registryRoot: op.registryRoot, installMethod: op.installMethod, agent: op.agent, scope: op.scope };
    }

    installContext(op: ContextOp): void {
        const provider = this.provider(op.agent);
        this.strategy(op.agent).inject(this.inputFor(op), provider);
    }

    uninstallContext(op: ContextOp): void {
        const provider = this.provider(op.agent);
        this.strategy(op.agent).remove(this.pathInputFor(op), provider);
    }

    contextStatus(op: ContextOp): InjectionState {
        const provider = this.provider(op.agent);
        return this.strategy(op.agent).status(this.statusInputFor(op), provider);
    }
}
