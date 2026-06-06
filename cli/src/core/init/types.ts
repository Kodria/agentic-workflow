// src/core/init/types.ts
import type { HarnessContext, CheckReport, ProjectFacts } from '../diagnostics/types';
import type { BundleDefinition } from '../bundles';
import type { AgentTarget } from '../../providers';
import type { InstallMethod, InstallSummary, SyncResult } from '../bundle-install';
import type { ContextOp } from '../context/orchestrator';
import type { InjectionState } from '../context/types';
import type { ConstitutionInjectResult } from '../context/project-constitution-inject';

export type StepAction = 'applied' | 'skipped' | 'pending' | 'failed';

export interface StepResult {
    id: string;
    level: 'machine' | 'project';
    action: StepAction;
    detail?: string;
    error?: string;
}

export interface InitOutcome {
    steps: StepResult[];
    applied: number;   // pasos que cambiaron algo (excluye pending)
    pending: number;   // señalados (skill)
    failed: number;
    before: CheckReport;
    after: CheckReport;
}

// Efectos de I/O inyectables — defaultActions delega en las funciones reales;
// los tests pasan espías. Mantiene los steps puros respecto de la UI y testeables.
export interface InitActions {
    syncCache: () => Promise<void>;
    installHook: (o: { agent: AgentTarget; registryRoot: string; installMethod: InstallMethod }) => { status: string };
    installBundle: (o: {
        bundleName: string; bundles: BundleDefinition[]; agents: AgentTarget[];
        method: InstallMethod; projectRoot: string; contentDir: string;
    }) => InstallSummary;
    syncProfile: (o: {
        projectRoot: string; bundles: BundleDefinition[]; agents: AgentTarget[];
        method: InstallMethod; contentDir: string;
    }) => SyncResult;
    initSensors: (o: { cwd: string; registryRoot: string; configure: boolean }) => { detection: { pack: string } };
    addExtension: (root: string, name: string) => void;
    gatherProject: (cwd: string, bundles: BundleDefinition[], agent?: AgentTarget) => ProjectFacts | null;
    contextStatus: (op: ContextOp) => InjectionState;
    installContext: (op: ContextOp) => void;
    repairGlobalSkills: (skillsDir: string, registryContentDir: string) => { relinked: string[]; pruned: string[]; failed: string[] };
    injectProjectConstitution: (o: { projectRoot: string; agent: AgentTarget }) => ConstitutionInjectResult;
}

export interface InitDeps {
    cwd: string;
    ctx: HarnessContext;
    bundles: BundleDefinition[];
    agent: AgentTarget;
    installMethod: InstallMethod;
    registryRoot: string;   // cli-source (repo root) — para installHook
    contentDir: string;     // cli-source/registry — para installBundle/initSensors
    confirmExtensions: (proposed: string[], signals: string[]) => Promise<string[]>;
    actions: InitActions;
}
