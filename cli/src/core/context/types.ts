// cli/src/core/context/types.ts
import { AgentTarget, Scope } from '../../providers';

export type AwmContext = {
    markdown: string;       // payload canónico (using-awm + extensiones activas)
    sourceVersion: string;  // versión del registry que lo generó
    contentHash: string;    // sha256(markdown) — clave de idempotencia
};

export type MaterializedRef = {
    absPath: string;
    scope: Scope;           // 'global' | 'local'
    contentHash: string;    // = AwmContext.contentHash; reescribe solo si cambia
};

export type InjectionState = 'injected' | 'absent' | 'stale';

export type InjectionInput = {
    ref: MaterializedRef;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
    agent: AgentTarget;
    scope: Scope;
    /** Required only when a strategy operates at 'local' scope (e.g. CodexAgentsStrategy for
     *  providers with a null globalPath). HookMergeStrategy/ConfigInstructionsStrategy never need it. */
    projectRoot?: string;
};
