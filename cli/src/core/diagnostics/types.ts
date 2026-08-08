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
    /** `applicable: false` = este provider NO tiene mecanismo de hooks
     *  (opencode, antigravity, cursor, copilot). Distinto de "lo tiene y falta":
     *  sin esta distincion, el check emitia `missing` para los 4, con un remedio
     *  (`awm init`) que jamas podia satisfacerlo — y `awm init` salia con exit 1
     *  en una corrida donde no fallo nada, abortando cualquier script bajo
     *  `set -e`. El paso de init y el reporte de doctor ya distinguian bien; el
     *  check era el tercer lector, y el unico equivocado. */
    hook: { present: boolean; degraded?: boolean; applicable: boolean };
    devCore: { present: boolean; brokenLinks: string[] };
    ambient: { wanted: string[]; installed: string[] };
    contextInjection: { agent: AgentTarget; state: InjectionState }[];
    globalSkills: { valid: string[]; repairable: string[]; dead: string[] };
}

export interface ProjectFacts {
    root: string;
    profile: { present: boolean; extensions: string[] };
    activeBundles: { expected: string[]; linked: string[]; broken: string[] };
    /** Symlinks colgantes en el dir de skills DEL PROYECTO que ya no corresponden a
     *  ninguna extension del profile — huerfanos. `activeBundles.broken` solo mira lo
     *  que el profile espera, asi que un link cuya extension se retiro no aparecia en
     *  ninguna superficie. `repairable` los puede recuperar el registry; `dead` no. */
    orphanLinks: { repairable: string[]; dead: string[] };
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

// --- Task 4.4: capability tier ---------------------------------------------
//
// Structural classification of how strongly a provider delivers AWM context,
// derived from its ProviderConfig shape (see `providerTier` in
// `provider-checks.ts`) — not from any live check result:
//   - 'hooks-native': has a `hooks` config (session-start hook re-anchors
//     state every session — the strongest capability level). Today:
//     claude-code, codex.
//   - 'agents-md-managed': no `hooks`, but delivers context via the
//     `managed-agents-md` convention (a single-block AGENTS.md the agent is
//     expected to read on its own trigger, no active re-anchor). Today:
//     cursor, copilot.
//   - 'config-managed': no `hooks`, delivers context by writing into the
//     agent's own config file (`injection.type === 'config-instructions'`) —
//     same "no active re-anchor" reliability as agents-md-managed, but a
//     materially different delivery mechanism (a JSON config field, not a
//     markdown file convention), so it gets its own tier rather than being
//     folded into 'agents-md-managed'. Today: opencode.
//   - 'context-only': neither `hooks` nor `injection` — no automated context
//     delivery mechanism at all. Today: antigravity.
export type ProviderTier = 'hooks-native' | 'agents-md-managed' | 'config-managed' | 'context-only';

export type ProviderFacts = {
    id: AgentTarget;
    label: string;
    tier: ProviderTier;
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
