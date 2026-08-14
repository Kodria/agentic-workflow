// src/core/init/types.ts
import type { HarnessContext, CheckReport, ProjectFacts } from '../diagnostics/types';
import type { BundleDefinition } from '../bundles';
import type { AgentTarget, Scope } from '../../providers';
import type { InstallMethod, InstallSummary, SyncResult } from '../bundle-install';
import type { ContextOp } from '../context/orchestrator';
import type { InjectionState } from '../context/types';
import type { ConstitutionInjectResult } from '../context/project-constitution-inject';
import type { RegistrySyncResult } from '../registries';

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
    /** Basename of the backup-session transaction wrapping this run's writes. Set on success. */
    transactionId?: string;
    /** Every target path the backup session snapshotted before this run's writes. Set on success. */
    modifiedFiles?: string[];
}

// Efectos de I/O inyectables — defaultActions delega en las funciones reales;
// los tests pasan espías. Mantiene los steps puros respecto de la UI y testeables.
export interface InitActions {
    /**
     * Returns `syncRegistries()`'s per-registry results so the caller can see
     * WHICH registry failed — that function reports failures as results, never
     * as throws. `void` stays allowed for the many test stubs that only care
     * that a sync was attempted.
     */
    syncCache: () => Promise<RegistrySyncResult[] | void>;
    installHook: (o: { agent: AgentTarget; registryRoot: string; installMethod: InstallMethod }) => { status: string };
    installBundle: (o: {
        bundleName: string; bundles: BundleDefinition[]; agents: AgentTarget[];
        method: InstallMethod; projectRoot: string; contentDir: string;
        /** Fuerza el scope del bundle nombrado. Lo usa `stepDevCore` para un
         *  provider sin directorio global de skills (Copilot), cuyo baseline va
         *  a scope de proyecto. */
        scopeOverride?: Scope;
    }) => InstallSummary;
    syncProfile: (o: {
        projectRoot: string; bundles: BundleDefinition[]; agents: AgentTarget[];
        method: InstallMethod; contentDir: string;
    }) => SyncResult;
    initSensors: (o: { cwd: string; registryRoot: string; configure: boolean }) => Promise<{
        detection: { pack: string };
        /** Set when the registry ships no pack for the detected stack — `stepSensors`
         *  reports it, so `awm init` never hands back a silently empty quality gate. */
        unavailablePack?: string;
        manifest?: { pack: string };
    }>;
    addExtension: (root: string, name: string) => void;
    ensureProfile: (root: string) => void;
    gatherProject: (cwd: string, bundles: BundleDefinition[], agent?: AgentTarget) => ProjectFacts | null;
    contextStatus: (op: ContextOp) => InjectionState;
    installContext: (op: ContextOp) => void;
    repairGlobalSkills: (skillsDir: string, registryContentDirs: string[]) => { relinked: string[]; pruned: string[]; failed: string[] };
    injectProjectConstitution: (o: { projectRoot: string; agent: AgentTarget }) => ConstitutionInjectResult;
}

export interface InitDeps {
    cwd: string;
    ctx: HarnessContext;
    bundles: BundleDefinition[];
    agent: AgentTarget;
    /**
     * Every agent enabled on this machine (preferences.json's `enabledAgents`
     * as of the start of this run — includes `agent` itself). Used by
     * `stepDevCore`/`stepAmbient` to compute the complete shared-skill-target
     * group when auto-installing the baseline/ambient bundles, so a co-owner
     * agent (e.g. OpenCode sharing Codex's `~/.agents/skills`) that's already
     * enabled doesn't trip install-planner.ts's `assertCompleteSharedGroup`
     * (R14) refusal.
     */
    enabledAgents: AgentTarget[];
    installMethod: InstallMethod;
    registryRoot: string;     // content root que provee hooks/ — para installHook
    contentDir: string;       // content root del primer registry — para installBundle/syncProfile
    sensorPacksRoot: string;  // content root que provee sensor-packs/ — para initSensors
    confirmExtensions: (proposed: string[], signals: string[]) => Promise<string[]>;
    /**
     * `awm init --machine-only`. The flag already nulls `ctx.project` so the project
     * steps skip, but that made "the user asked us not to touch the project" and
     * "there is no project here" indistinguishable — and `stepContextInjection`, a
     * MACHINE-level step, treated the second meaning as license to write AGENTS.md
     * and .awm/context/ into cwd under a flag whose entire promise is that it won't.
     */
    machineOnly?: boolean;
    actions: InitActions;
}
