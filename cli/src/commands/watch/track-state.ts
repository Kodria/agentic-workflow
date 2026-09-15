import { readJournal, writeJournal } from '../../core/journal/store';
import { JOIN_STRATEGY_NO_FF } from '../../core/tracks/types';
import type { CohortProtocol, JoinIntent } from '../../core/tracks/types';
import type { JournalState, ProcessRef, TrackContext, TrackRef } from '../../core/journal/types';

export type SupervisorObservation =
    | { kind: 'absent' }
    | { kind: 'claimed' }
    | { kind: 'ready'; readinessNonce: string }
    | { kind: 'foreign' };

export interface TrackRuntime {
    addWorktree(planRoot: string, ref: TrackRef, baseSha: string): void;
    initTrackJournal(ref: TrackRef, context: TrackContext): void;
    spawnSupervisor(ref: TrackRef): ProcessRef | void;
    observeSupervisor(ref: TrackRef): SupervisorObservation;
    // Identity-verified: never kill a raw pid. `true` confirms that the
    // owned supervisor group is absent now or was already absent.
    stopOwnSupervisor(ref: TrackRef): Promise<boolean>;
    // `runBeginTeardown` proves ownership (intent, descriptor, and git
    // worktree listing) before this call; implementations retain their own
    // clean-worktree and checked-out-branch guards (`-d`, never `-D`).
    removeOwnedWorktree(repo: string, ref: TrackRef): void;
    removeOwnedBranch(repo: string, branch: string): void;
    // Durable cross-worktree request consumed by the track's own supervisor;
    // the plan supervisor never writes the track journal directly.
    emitFreezeRequest(ref: TrackRef, generationToken: string): void;
    mergeFrozenTrack(repo: string, intent: JoinIntent): void;
    abortOwnedMerge(repo: string, intent: JoinIntent): void;
    // Acquires the integration lock after pausing the controller generation.
    // It is idempotent per live process: callers distinguish real acquisition
    // from the already-held no-op to preserve one mutable boundary per tick.
    ensureIntegrationLock(planJournalId: string, expectedPlanHeadSha: string): Promise<'acquired' | 'already-held'>;
    pauseControllerGeneration(): Promise<boolean>;
    releaseIntegrationLockIfHeld(): void;
}

export function applyProtocolToState(state: JournalState, protocol: CohortProtocol): JournalState {
    const next = structuredClone(state);
    next.cohortPhase = protocol.cohortPhase;
    if (protocol.planHeadSha !== undefined) next.cohortPlanHeadSha = protocol.planHeadSha;
    if (protocol.cohortPhase === 'FALLBACK_PENDING') {
        next.globalQaHeadSha = undefined;
        next.finalIntegrationJobId = undefined;
        next.qaFinalizeRequested = undefined;
    } else {
        if (protocol.globalQaHeadSha !== undefined) next.globalQaHeadSha = protocol.globalQaHeadSha;
        if (protocol.finalIntegrationJobId !== undefined) next.finalIntegrationJobId = protocol.finalIntegrationJobId;
    }
    if (protocol.fallbackReason !== undefined) next.cohortFallbackReason = protocol.fallbackReason;
    next.tracks = (next.tracks ?? []).map((ref) => {
        const track = protocol.tracks[ref.trackId];
        if (track === undefined) return ref;
        return {
            ...ref,
            phase: track.phase,
            frozenHeadSha: track.frozenHeadSha,
            blockedReason: track.blockedReason,
            joinedCommitSha: track.joinedCommitSha,
            joinIntent: track.expectedPlanHeadSha !== undefined && track.expectedTrackHeadSha !== undefined
                ? { expectedPlanHeadSha: track.expectedPlanHeadSha, expectedTrackHeadSha: track.expectedTrackHeadSha, strategy: JOIN_STRATEGY_NO_FF }
                : ref.joinIntent,
        };
    });
    return next;
}

export function persist(planRoot: string, branch: string, state: JournalState): JournalState {
    writeJournal(planRoot, branch, state);
    const result = readJournal(planRoot, branch);
    if (result.corrupt || result.state === null) throw new Error('journal corrupto tras persistir tracks (R1.6)');
    return result.state;
}

export function refOf(state: JournalState, trackId: string): TrackRef {
    const ref = state.tracks?.find((track) => track.trackId === trackId);
    if (ref === undefined) throw new Error(`invariante rota: TrackRef ausente para ${trackId}`);
    return ref;
}

export function withRef(state: JournalState, trackId: string, patch: Partial<TrackRef>): JournalState {
    return { ...state, tracks: (state.tracks ?? []).map((track) => (track.trackId === trackId ? { ...track, ...patch } : track)) };
}

export interface EffectRunResult { state: JournalState; stop: boolean; executed: string | null; }
