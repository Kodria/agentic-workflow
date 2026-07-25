// src/core/diagnostics/types.ts
import { AgentTarget } from '../../providers';
import { InjectionState } from '../context/types';

export type CheckLevel = 'machine' | 'project';
export type CheckStatus = 'ok' | 'warn' | 'missing'; // ✔ / ⚠ / ✖
export type GitState = 'clean' | 'behind' | 'dirty' | 'unknown';

// Frontera CLI↔agente codificada en los datos.
export type Remedy =
    | { kind: 'command'; value: string }   // accionable por init (1d)
    | { kind: 'skill'; value: string }     // lo redacta el agente
    | { kind: 'none' };                    // ok, sin acción

export interface CheckResult {
    id: string;            // estable: 'machine.hook', 'project.constitution', …
    level: CheckLevel;
    label: string;
    status: CheckStatus;
    detail?: string;
    remedy: Remedy;
}

export interface MachineFacts {
    registryCache: { present: boolean; gitState?: GitState };
    hook: { present: boolean; degraded?: boolean };
    devCore: { present: boolean; brokenLinks: string[] };
    ambient: { wanted: string[]; installed: string[] };
    contextInjection: { agent: AgentTarget; state: InjectionState }[];
    globalSkills: { valid: string[]; repairable: string[]; dead: string[] };
}

export interface ProjectFacts {
    root: string;
    profile: { present: boolean; extensions: string[] };
    activeBundles: { expected: string[]; linked: string[]; broken: string[] };
    sensors: { present: boolean };
    constitution: { present: boolean };
    context: { present: boolean; file?: 'CLAUDE.md' | 'AGENTS.md' };
}

// --- Task 9: per-provider diagnostic matrix -------------------------------
//
// This is a SEPARATE reporting layer from MachineFacts/CheckReport above,
// additive to HarnessContext rather than replacing it. `init/steps.ts`
// (Task 8, rollback-safe) reads `HarnessContext.machine` directly and must
// keep working unmodified — see CLAUDE.md's ban on casual restructuring of
// already-reviewed code. `doctor` is the only consumer of `.providers`.
//
// Naming note: `ProviderFacts` here is UNRELATED to the same-named type in
// `core/init/provider-facts.ts` (baseline-hash snapshots for rollback
// safety). They live in different modules; if a file ever needs both, alias
// one on import (e.g. `import { ProviderFacts as InitProviderFacts }`).

export type ProviderCheckState =
    | 'supported' | 'unsupported' | 'missing'
    | 'healthy' | 'broken' | 'shared' | 'stale'
    | 'absent' | 'conflict' | 'pending-trust'
    | 'delivered' | 'pending';

export type ProviderCheck = {
    id: 'binary.version' | 'skills.global' | 'agents.native' |
        'context.global' | 'hook.trust' | 'guidance.project' | 'constitution.delivery';
    state: ProviderCheckState;
    target?: string;
    owners?: AgentTarget[];
    remediationCode?: string;
    detail?: string;
};

export type ProviderFacts = {
    id: AgentTarget;
    label: string;
    checks: ProviderCheck[];
};

/** JSON/text report doctor renders — kept separate from CheckReport (init-facing). */
export interface ProviderDiagnosticReport {
    providers: ProviderFacts[];
    overall: 'healthy' | 'degraded';
}

export interface HarnessContext {
    machine: MachineFacts;
    project: ProjectFacts | null;
    /** Populated by `gatherContext` for whichever `agents` it was asked about. Optional
     *  so pre-existing test fixtures that construct HarnessContext by hand (machine/project
     *  only) keep type-checking without churn. */
    providers?: ProviderFacts[];
}

export interface CheckReport {
    results: CheckResult[];
    overall: 'healthy' | 'degraded';
    hasProject: boolean;
    projectName?: string;
}
