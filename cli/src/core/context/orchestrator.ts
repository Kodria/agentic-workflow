// cli/src/core/context/orchestrator.ts
import { AgentTarget, Scope, ProviderConfig, getInjection, providerFor } from '../../providers';
import { InjectionStrategy } from './strategies/strategy';
import { HookMergeStrategy } from './strategies/hook-merge';
import { ConfigInstructionsStrategy } from './strategies/config-instructions';
import { CodexAgentsStrategy } from './strategies/codex-agents';
import { buildContext } from './provider';
import { materialize, globalContextPath, projectContextPath } from './materializer';
import { InjectionInput, InjectionState, MaterializedRef } from './types';
import { listRegistries } from '../registries';
import { readDeclaredOrchestrators, DeclaredOrchestrator } from '../orchestrators';

/** Recolecta declaraciones de orquestador de TODOS los registries instalados (no solo
 *  el que se esta operando) y diagnosticos de las que estan rotas. Nunca lanza:
 *  `readDeclaredOrchestrators` ya garantiza eso por-registry (R1.2), asi que un registry
 *  con declaracion rota se omite del resultado sin impedir construir el contexto (R5.1). */
function collectDeclaredOrchestrators(): { declared: DeclaredOrchestrator[]; diagnostics: string[] } {
    const declared: DeclaredOrchestrator[] = [];
    const diagnostics: string[] = [];
    for (const reg of listRegistries()) {
        const r = readDeclaredOrchestrators(reg.contentRoot);
        declared.push(...r.orchestrators);
        diagnostics.push(...r.diagnostics);
    }
    return { declared, diagnostics };
}

/** Recolecta declarados y emite sus diagnosticos como warnings. Punto unico usado por
 *  `inputFor` y `statusInputFor` para que ambos permanezcan sincronizados por construccion
 *  (ver R5.1 y el bug de staleness que motivo esta extraccion). */
function collectAndWarn(): DeclaredOrchestrator[] {
    const { declared, diagnostics } = collectDeclaredOrchestrators();
    for (const d of diagnostics) console.warn(`warning: ${d}`);
    return declared;
}

export type ContextOp = {
    agent: AgentTarget;
    scope: Scope;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
    profileExtensions: string[];
    /** Required when scope === 'local' (e.g. providers with a null injection.globalPath).
     *  Existing global-scope-only callers (opencode's config-instructions regen/diagnostics
     *  paths) never set this. */
    projectRoot?: string;
};

type Overrides = { providerOverride?: ProviderConfig; contextPathOverride?: string };

export class InjectionOrchestrator {
    constructor(private overrides: Overrides = {}) {}

    private provider(agent: AgentTarget): ProviderConfig {
        return this.overrides.providerOverride ?? providerFor(agent);
    }

    private strategy(agent: AgentTarget): InjectionStrategy {
        const inj = this.overrides.providerOverride !== undefined
            ? this.overrides.providerOverride.injection
            : getInjection(agent);
        if (!inj) throw new Error(`agent '${agent}' has no injection mechanism configured`);
        switch (inj.type) {
            case 'cc-settings-merge': return new HookMergeStrategy();
            case 'config-instructions': return new ConfigInstructionsStrategy();
            case 'managed-agents-md': return new CodexAgentsStrategy();
        }
    }

    /** Materialized-source content path for `op.scope` — global under ~/.awm, local under the project. */
    private contextPathFor(op: ContextOp): string {
        if (this.overrides.contextPathOverride) return this.overrides.contextPathOverride;
        if (op.scope === 'local') {
            if (!op.projectRoot) throw new Error('projectRoot is required for local-scope context operations');
            return projectContextPath(op.projectRoot);
        }
        return globalContextPath();
    }

    /** Full input: builds context from registry and materializes to disk. Used by installContext only. */
    private inputFor(op: ContextOp): InjectionInput {
        const ctx = buildContext({
            registryRoot: op.registryRoot,
            profileExtensions: op.profileExtensions,
            declaredOrchestrators: collectAndWarn(),
        });
        const absPath = this.contextPathFor(op);
        const ref = materialize(ctx, absPath, op.scope);
        return {
            ref, registryRoot: op.registryRoot, installMethod: op.installMethod,
            agent: op.agent, scope: op.scope, projectRoot: op.projectRoot,
        };
    }

    /** Path-only input: no buildContext, no materialize. Safe for remove() which never reads contentHash. */
    private pathInputFor(op: ContextOp): InjectionInput {
        const absPath = this.contextPathFor(op);
        const ref: MaterializedRef = { absPath, scope: op.scope, contentHash: '' };
        return {
            ref, registryRoot: op.registryRoot, installMethod: op.installMethod,
            agent: op.agent, scope: op.scope, projectRoot: op.projectRoot,
        };
    }

    /**
     * Status input: builds context from registry (to get expected hash) but does NOT materialize.
     * Avoids silently correcting a stale file before the strategy can observe it.
     */
    private statusInputFor(op: ContextOp): InjectionInput {
        const absPath = this.contextPathFor(op);
        let contentHash = '';
        try {
            // Debe recolectar declarados igual que inputFor: si no, el hash "esperado" aqui
            // diverge del hash realmente materializado por installContext en cuanto algun
            // registry instalado declare un orquestador, y contextStatus reportaria 'stale'
            // de forma permanente incluso justo despues de un install correcto.
            const ctx = buildContext({
                registryRoot: op.registryRoot,
                profileExtensions: op.profileExtensions,
                declaredOrchestrators: collectAndWarn(),
            });
            contentHash = ctx.contentHash;
        } catch (err) {
            // Only suppress "registry not yet initialised" — all other errors propagate.
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('using-awm skill not found')) throw err;
        }
        const ref: MaterializedRef = { absPath, scope: op.scope, contentHash };
        return {
            ref, registryRoot: op.registryRoot, installMethod: op.installMethod,
            agent: op.agent, scope: op.scope, projectRoot: op.projectRoot,
        };
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
