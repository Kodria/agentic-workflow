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

export type ProtocolObservation =
    | { kind: 'effect-applied'; effect: ProtocolEffect }
    | { kind: 'effect-failed'; trackId?: string; effect: ProtocolEffect['kind']; detail: string }
    | { kind: 'prepare-failed'; trackId: string; detail: string }
    | { kind: 'worktree-observed'; trackId: string; owned: boolean }
    | { kind: 'supervisor-observed'; trackId: string; identity: 'expected' | 'other' | 'absent'; readinessNonce?: string }
    | { kind: 'join-requested'; trackId: string }
    | { kind: 'freeze-observation'; trackId: string; frozenHeadSha: string }
    | { kind: 'join-observation'; trackId: string; mergeHead: string | null; planHead: string; trackIsAncestor?: boolean }
    | { kind: 'track-removed'; trackId: string }
    | { kind: 'teardown-blocked'; trackId: string; detail: string }
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
