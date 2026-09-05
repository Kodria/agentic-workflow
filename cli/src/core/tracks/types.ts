export const TRACK_PHASES = [
    'DECLARED', 'PREPARE_INTENT', 'WORKTREE_CREATED', 'JOURNAL_CREATED',
    'SUPERVISOR_STARTING', 'ARMED', 'ACTIVE', 'FREEZE_REQUESTED', 'FROZEN',
    'JOIN_REQUESTED', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED',
    'TEARDOWN_REQUESTED', 'TEARDOWN_INTENT', 'SUPERVISOR_STOPPED',
    'WORKTREE_REMOVED', 'BRANCH_REMOVED', 'REMOVED', 'BLOCKED',
] as const;
export type TrackPhase = typeof TRACK_PHASES[number];

export type CohortPhase =
    | 'PREPARING' | 'ACTIVE' | 'JOINING' | 'FINAL_QA'
    | 'FINAL_INTEGRATION' | 'FINAL_INTERLOCK' | 'COMPLETE'
    | 'FALLBACK_PENDING' | 'SERIAL' | 'BLOCKED';

export interface TrackProtocolState {
    trackId: string;
    phase: TrackPhase;
    fencingToken: string;
    readinessNonce: string;
    frozenHeadSha?: string;
    expectedPlanHeadSha?: string;
    expectedTrackHeadSha?: string;
    joinedCommitSha?: string;
    blockedReason?: string;
}

export interface CohortProtocol {
    planJournalId: string;
    cohortPhase: CohortPhase;
    maxParallel: number;
    fallbackReason?: string;
    tracks: Record<string, TrackProtocolState>;
    planHeadSha?: string;
    globalQaHeadSha?: string;
    finalIntegrationJobId?: string;
}

export type ProtocolEffect =
    | { kind: 'persist-prepare-intent'; trackId: string }
    | { kind: 'create-worktree'; trackId: string }
    | { kind: 'create-track-journal'; trackId: string }
    | { kind: 'spawn-track-supervisor'; trackId: string; readinessNonce: string }
    | { kind: 'activate-cohort' }
    | { kind: 'activate-track'; trackId: string }
    | { kind: 'freeze-track'; trackId: string }
    | { kind: 'persist-join-intent'; trackId: string; expectedPlanHeadSha: string; expectedTrackHeadSha: string }
    | { kind: 'merge-track'; trackId: string; expectedPlanHeadSha: string; expectedTrackHeadSha: string }
    | { kind: 'request-global-qa' }
    | { kind: 'request-final-integration' }
    | { kind: 'run-final-interlock' }
    | { kind: 'begin-teardown'; trackId: string }
    | { kind: 'enter-serial'; reason: string };

/** T13 (R4.2/R4.3/R4.6/R4.10/C2/C9): lo que el driver pudo probar del mundo
 *  real, READ-ONLY, sobre UN track en teardown — mismo vocabulario plano que
 *  `PrepareObservation` (campos opcionales, `?` para "todavía no se pudo
 *  determinar"). `foreignSupervisor`/`foreignWorktree` ganan primero en
 *  `decideTeardown` sin importar la fase: identidad/ownership ajena nunca se
 *  toca, sin importar en qué paso del teardown esté el track. */
export interface TeardownObservation {
    /** TEARDOWN_INTENT: el `supervisorProcessRef` propio sigue vivo con
     *  identidad confirmada (`refIsAlive`). */
    ownSupervisorAlive?: boolean;
    /** Cualquier fase: el supervisor observado NO es el que este track
     *  spawneó (defensivo — el driver real no produce este caso hoy, ver
     *  comentario de `decideTeardown`, mismo criterio que `begin-fallback`
     *  en `decidePrepare`). */
    foreignSupervisor?: boolean;
    /** SUPERVISOR_STOPPED: el worktree del track existe y es demostrablemente
     *  nuestro (`teardownIntent` + `.awm/track.json` + `git worktree list`
     *  coinciden). */
    ownedWorktreeExists?: boolean;
    /** SUPERVISOR_STOPPED: el worktree existe pero su ownership es
     *  indemostrable — nunca se adopta ni se borra (R4.6/R4.10). */
    foreignWorktree?: boolean;
    /** WORKTREE_REMOVED: la branch determinista del track sigue existiendo. */
    ownedBranchExists?: boolean;
}

/** T13: decisiones que `decideTeardown` puede tomar frente a un
 *  `TeardownObservation` — `tracks.ts`/`teardown.ts` únicamente traducen cada
 *  una al efecto real (o a la ausencia de efecto) correspondiente, nunca
 *  reimplementan la decisión (regla de autoridad única de `protocol.ts`). */
export type TeardownDecision =
    | 'persist-intent' | 'stop-own-supervisor' | 'accept-supervisor-stopped'
    | 'remove-owned-worktree' | 'remove-owned-branch' | 'mark-removed'
    | 'block-foreign';

export type ProtocolObservation =
    | { kind: 'effect-applied'; effect: ProtocolEffect }
    | { kind: 'effect-failed'; trackId?: string; effect: ProtocolEffect['kind']; detail: string }
    | { kind: 'prepare-failed'; trackId: string; detail: string }
    | { kind: 'worktree-observed'; trackId: string; owned: boolean }
    | { kind: 'supervisor-observed'; trackId: string; identity: 'expected' | 'other' | 'absent'; readinessNonce?: string }
    | { kind: 'join-requested'; trackId: string }
    | { kind: 'teardown-requested'; trackId: string }
    | { kind: 'freeze-observation'; trackId: string; frozenHeadSha: string }
    | { kind: 'join-observation'; trackId: string; mergeHead: string | null; planHead: string; trackIsAncestor?: boolean }
    // T13: reemplaza las observaciones gruesas `track-removed`/`teardown-
    // blocked` de T1 — `reconcileProtocol` recalcula `decideTeardown` sobre
    // ESTA observación para decidir el próximo paso durable (mismo criterio
    // que `join-observation`/`decideJoinReconciliation`, T11).
    | ({ kind: 'teardown-observation'; trackId: string } & TeardownObservation)
    | { kind: 'global-qa-pass'; headSha: string; clean: boolean }
    | { kind: 'integration-pass'; jobId: string; headSha: string }
    | { kind: 'interlock-pass'; headSha: string };

// Única estrategia de merge soportada hoy (R6.x) — constante compartida para
// que `protocol.ts` y `watch/tracks.ts` (el driver) nunca dupliquen el
// literal (post-review, minor finding Task 8).
export const JOIN_STRATEGY_NO_FF = 'no-ff' as const;
export type JoinStrategy = typeof JOIN_STRATEGY_NO_FF;

export interface JoinIntent {
    expectedPlanHeadSha: string;
    expectedTrackHeadSha: string;
    strategy: JoinStrategy;
}

/** `join-observation` sin `trackId`: lo que se observa del repo tras intentar el merge. */
export type JoinObservation = Omit<Extract<ProtocolObservation, { kind: 'join-observation' }>, 'kind' | 'trackId'>;

export type JoinDecision =
    | { action: 'retry-merge' }
    | { action: 'abort-own-merge' }
    | { action: 'accept-merge'; joinedCommitSha: string }
    | { action: 'block'; reason: string };

/** Task 9 (R4.2/R4.6/C11): lo que el driver (`watch/tracks.ts`) pudo observar
 *  del mundo real, READ-ONLY, sobre UN track en curso durante `PREPARING`,
 *  antes de decidir si la próxima llamada mutante a `TrackRuntime` debe
 *  intentarse de nuevo o si un crash previo ya dejó el resultado ahí. Misma
 *  convención que `ProtocolObservation`: campos planos, `?` para lo que
 *  todavía no se pudo determinar. Deliberadamente NO importa nada de
 *  `core/journal/types` (regla de capas de T1) — el vocabulario del wrapper
 *  del supervisor (`SupervisorObservation` en `watch/tracks.ts`) se traduce
 *  acá a un string plano (`supervisorArtifact`), nunca al revés. */
export interface PrepareObservation {
    /** `create-worktree` (fase PREPARE_INTENT): el destino YA es un worktree
     *  real registrado por git en la branch determinista del track — el
     *  único caso legítimo de "destino no vacío pero nuestro". */
    worktreeOwned?: boolean;
    /** `create-worktree`: el destino existe, no está vacío, y no es
     *  demostrablemente nuestro (`worktreeOwned` falso o ausente). */
    worktreeForeignNonEmpty?: boolean;
    /** `spawn-track-supervisor` (fase SUPERVISOR_STARTING, con
     *  `supervisorIntent` ya persistido): mismo vocabulario que
     *  `SupervisorObservation['kind']`, aplanado. */
    supervisorArtifact?: 'absent' | 'claimed' | 'ready' | 'foreign';
}

/** Task 9: decisiones que `decidePrepare` puede tomar frente a un
 *  `PrepareObservation`. `tracks.ts` únicamente traduce cada una a la
 *  llamada de `TrackRuntime` o a la observación de protocolo que ya existen
 *  (`worktree-observed`, `supervisor-observed`, `prepare-failed`) — nunca
 *  reimplementa la decisión. */
export type PrepareDecision =
    | 'retry-worktree' | 'accept-worktree'
    | 'write-descriptor'
    | 'retry-supervisor-same-intent' | 'accept-readiness'
    | 'block-foreign' | 'begin-fallback';
