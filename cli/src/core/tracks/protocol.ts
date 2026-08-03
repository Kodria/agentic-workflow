import crypto from 'crypto';
import { JOIN_STRATEGY_NO_FF } from './types';
import type {
    CohortProtocol, JoinDecision, JoinIntent, JoinObservation,
    ProtocolEffect, ProtocolObservation, TrackPhase,
} from './types';

/** Fases en las que un track de una cohorte activa puede estar. */
const WORKING: readonly TrackPhase[] = [
    'ARMED', 'ACTIVE', 'FREEZE_REQUESTED', 'FROZEN',
    'JOIN_REQUESTED', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED',
];
/** Fases que ya fijaron un SHA congelado y no pueden volver a mutar el worktree. */
const FROZEN_OR_LATER: readonly TrackPhase[] = ['FROZEN', 'JOIN_INTENT', 'MERGED_UNVERIFIED', 'JOINED'];
/** Efecto aplicado exitosamente → fase resultante del track, para las transiciones puramente mecánicas. */
const EFFECT_APPLIED_PHASE: Partial<Record<ProtocolEffect['kind'], TrackPhase>> = {
    'persist-prepare-intent': 'PREPARE_INTENT', 'create-worktree': 'WORKTREE_CREATED',
    'create-track-journal': 'JOURNAL_CREATED', 'spawn-track-supervisor': 'SUPERVISOR_STARTING',
    'activate-track': 'ACTIVE',
    'freeze-track': 'FREEZE_REQUESTED', 'persist-join-intent': 'JOIN_INTENT',
    'begin-teardown': 'TEARDOWN_INTENT',
};

const token = (journalId: string, trackId: string, purpose: string): string =>
    crypto.createHash('sha256').update(`${journalId}\0${trackId}\0${purpose}`).digest('hex').slice(0, 32);

const required = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new Error(`invariante rota: falta ${name}`);
    return value;
};

/** C2: un fallo demostrable no bloquea, entra al teardown probatorio de C9 — salvo que ya sea terminal o BLOCKED. */
const markTeardownRequested = (tracks: CohortProtocol['tracks'], trackId: string | undefined): void => {
    const failed = trackId === undefined ? undefined : tracks[trackId];
    if (failed !== undefined && !['DECLARED', 'REMOVED', 'BLOCKED'].includes(failed.phase)) {
        failed.phase = 'TEARDOWN_REQUESTED';
    }
};

/** Autoridad única de reconciliación de join; T11 agrega su matriz de tests sobre esta función. */
export function decideJoinReconciliation(intent: JoinIntent, o: JoinObservation): JoinDecision {
    if (o.mergeHead === null && o.planHead === intent.expectedPlanHeadSha && !o.trackIsAncestor) return { action: 'retry-merge' };
    if (o.mergeHead === intent.expectedTrackHeadSha && o.planHead === intent.expectedPlanHeadSha) return { action: 'abort-own-merge' };
    if (o.mergeHead === null && o.trackIsAncestor === true) return { action: 'accept-merge', joinedCommitSha: o.planHead };
    if (o.mergeHead !== null && o.mergeHead !== intent.expectedTrackHeadSha) return { action: 'block', reason: 'MERGE_HEAD ajeno' };
    return { action: 'block', reason: 'estado de join indemostrable' };
}

export function initialCohort(planJournalId: string, trackIds: string[], maxParallel = trackIds.length): CohortProtocol {
    if (planJournalId.length === 0 || trackIds.length < 2 || new Set(trackIds).size !== trackIds.length
        || !Number.isInteger(maxParallel) || maxParallel < 1) {
        throw new Error('initialCohort requiere journalId y al menos dos trackIds únicos');
    }
    return {
        planJournalId, cohortPhase: 'PREPARING', maxParallel,
        tracks: Object.fromEntries(trackIds.map((trackId) => [trackId, {
            trackId, phase: 'DECLARED',
            fencingToken: token(planJournalId, trackId, 'fence'),
            readinessNonce: token(planJournalId, trackId, 'readiness'),
        }])),
    };
}

export function assertProtocolInvariants(s: CohortProtocol): void {
    const tracks = Object.values(s.tracks);
    if (tracks.length < 2) throw new Error('cohorte paralela requiere al menos dos tracks');
    if ((s.cohortPhase === 'ACTIVE' || s.cohortPhase === 'JOINING') && tracks.some((t) => !WORKING.includes(t.phase))) {
        throw new Error('ACTIVE prohíbe tracks sin armar');
    }
    if (tracks.filter((t) => t.phase === 'ACTIVE').length > s.maxParallel) throw new Error('tracks ACTIVE exceden maxParallel');
    if (tracks.filter((t) => t.phase === 'JOIN_INTENT').length > 1) {
        throw new Error('un solo JOIN_INTENT vivo por cohorte'); // C7: los merges son serie estricta
    }
    if (tracks.some((t) => FROZEN_OR_LATER.includes(t.phase) && t.frozenHeadSha === undefined)) {
        throw new Error('un track congelado exige frozenHeadSha');
    }
    // C2: SERIAL solo con la cohorte demostrablemente desmantelada. BLOCKED nunca cuenta como limpio.
    if (s.cohortPhase === 'SERIAL' && tracks.some((t) => !['REMOVED', 'DECLARED'].includes(t.phase))) {
        throw new Error('SERIAL prohíbe recursos paralelos activos');
    }
    if (s.finalIntegrationJobId !== undefined && tracks.some((t) => !['MERGED_UNVERIFIED', 'JOINED'].includes(t.phase))) {
        throw new Error('integración final exige todos los tracks mergeados');
    }
    if (s.cohortPhase === 'COMPLETE' && tracks.some((t) => t.phase !== 'JOINED')) {
        throw new Error('COMPLETE exige todos los tracks JOINED');
    }
}

export function nextProtocolEffect(s: CohortProtocol): ProtocolEffect | null {
    assertProtocolInvariants(s);
    const tracks = Object.values(s.tracks).sort((a, b) => a.trackId.localeCompare(b.trackId));
    if (s.cohortPhase === 'BLOCKED' || s.cohortPhase === 'SERIAL' || s.cohortPhase === 'COMPLETE') return null;
    if (s.cohortPhase === 'FALLBACK_PENDING') {
        // C2: propiedad indemostrable detiene la cohorte; nunca se serializa con recursos posiblemente vivos.
        if (tracks.some((t) => t.phase === 'BLOCKED')) return null;
        const owned = tracks.find((t) => !['DECLARED', 'REMOVED'].includes(t.phase));
        return owned !== undefined
            ? { kind: 'begin-teardown', trackId: owned.trackId }
            : { kind: 'enter-serial', reason: s.fallbackReason ?? 'prepare-failed' };
    }
    if (s.cohortPhase === 'PREPARING') {
        const t = tracks.find((x) => x.phase !== 'ARMED' && x.phase !== 'BLOCKED');
        if (t === undefined) return tracks.every((x) => x.phase === 'ARMED') ? { kind: 'activate-cohort' } : null;
        if (t.phase === 'DECLARED') return { kind: 'persist-prepare-intent', trackId: t.trackId };
        if (t.phase === 'PREPARE_INTENT') return { kind: 'create-worktree', trackId: t.trackId };
        if (t.phase === 'WORKTREE_CREATED') return { kind: 'create-track-journal', trackId: t.trackId };
        if (t.phase === 'JOURNAL_CREATED' || t.phase === 'SUPERVISOR_STARTING') {
            return { kind: 'spawn-track-supervisor', trackId: t.trackId, readinessNonce: t.readinessNonce };
        }
    }
    if (s.cohortPhase === 'ACTIVE' || s.cohortPhase === 'JOINING') {
        if (s.cohortPhase === 'ACTIVE') {
            const active = tracks.filter((t) => t.phase === 'ACTIVE').length;
            const waiting = tracks.find((t) => t.phase === 'ARMED');
            if (waiting !== undefined && active < s.maxParallel) return { kind: 'activate-track', trackId: waiting.trackId };
        }
        const requested = tracks.find((t) => t.phase === 'JOIN_REQUESTED');
        if (requested !== undefined) return { kind: 'freeze-track', trackId: requested.trackId };
        // C3: ningún merge empieza hasta que la cohorte entera esté congelada.
        if (tracks.every((t) => FROZEN_OR_LATER.includes(t.phase))) {
            const open = tracks.find((t) => t.phase === 'JOIN_INTENT');
            if (open !== undefined) {
                return {
                    kind: 'merge-track', trackId: open.trackId,
                    expectedPlanHeadSha: required(open.expectedPlanHeadSha, 'expectedPlanHeadSha'),
                    expectedTrackHeadSha: required(open.expectedTrackHeadSha, 'expectedTrackHeadSha'),
                };
            }
            const next = tracks.find((t) => t.phase === 'FROZEN');
            if (next !== undefined) {
                return {
                    kind: 'persist-join-intent', trackId: next.trackId,
                    expectedPlanHeadSha: required(s.planHeadSha, 'planHeadSha'),
                    expectedTrackHeadSha: required(next.frozenHeadSha, 'frozenHeadSha'),
                };
            }
        }
    }
    if (tracks.every((t) => t.phase === 'MERGED_UNVERIFIED') && s.globalQaHeadSha === undefined) return { kind: 'request-global-qa' };
    if (s.globalQaHeadSha !== undefined && s.finalIntegrationJobId === undefined) return { kind: 'request-final-integration' };
    if (s.finalIntegrationJobId !== undefined && s.cohortPhase === 'FINAL_INTERLOCK') return { kind: 'run-final-interlock' };
    return null;
}

export function reconcileProtocol(s: CohortProtocol, observation: ProtocolObservation): CohortProtocol {
    const out = structuredClone(s);
    if (observation.kind === 'prepare-failed') {
        out.cohortPhase = 'FALLBACK_PENDING';
        out.fallbackReason = `prepare-failed:${observation.trackId}`;
        markTeardownRequested(out.tracks, observation.trackId);
    } else if (observation.kind === 'effect-failed') {
        if (out.cohortPhase === 'PREPARING') {
            out.cohortPhase = 'FALLBACK_PENDING';
            out.fallbackReason = `effect-failed:${observation.effect}`;
            markTeardownRequested(out.tracks, observation.trackId);
        }
        // effect-failed fuera de PREPARING: sin transición definida todavía (no ejercitado por T1).
    } else if (observation.kind === 'worktree-observed') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        // R4.6: un worktree que no es demostrablemente nuestro nunca se adopta ni se borra.
        if (observation.owned) t.phase = 'WORKTREE_CREATED';
        else {
            t.phase = 'BLOCKED';
            t.blockedReason = 'worktree preexistente ajeno';
        }
    } else if (observation.kind === 'supervisor-observed') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        if (observation.identity === 'other') {
            t.phase = 'BLOCKED';
            t.blockedReason = 'identidad de supervisor ajena';
        } else if (observation.identity === 'expected') {
            // C8: el readiness solo se acredita con el nonce que emitió el supervisor del plan.
            if (observation.readinessNonce === t.readinessNonce) t.phase = 'ARMED';
            else {
                t.phase = 'BLOCKED';
                t.blockedReason = 'readinessNonce no coincide';
            }
        }
        // 'absent' no mueve fase: el mismo supervisorIntent se reintenta (C11).
    } else if (observation.kind === 'join-requested') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        if (t.phase === 'ACTIVE') t.phase = 'JOIN_REQUESTED';
    } else if (observation.kind === 'track-removed') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        t.phase = 'REMOVED'; // T13 refina los pasos intermedios; acá importa el resultado probado
    } else if (observation.kind === 'teardown-blocked') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        t.phase = 'BLOCKED';
        t.blockedReason = observation.detail;
    } else if (observation.kind === 'freeze-observation') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        t.frozenHeadSha = observation.frozenHeadSha;
        t.phase = 'FROZEN';
        out.cohortPhase = 'JOINING';
    } else if (observation.kind === 'join-observation') {
        const t = out.tracks[observation.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${observation.trackId}`);
        // Autoridad única: la misma función que T11 prueba con su matriz completa.
        const decision = decideJoinReconciliation({
            expectedPlanHeadSha: required(t.expectedPlanHeadSha, 'expectedPlanHeadSha'),
            expectedTrackHeadSha: required(t.expectedTrackHeadSha, 'expectedTrackHeadSha'),
            strategy: JOIN_STRATEGY_NO_FF,
        }, observation);
        if (decision.action === 'accept-merge') {
            t.phase = 'MERGED_UNVERIFIED';
            t.joinedCommitSha = decision.joinedCommitSha;
            out.planHeadSha = decision.joinedCommitSha;
        } else if (decision.action === 'block') {
            t.phase = 'BLOCKED';
            t.blockedReason = decision.reason;
            out.cohortPhase = 'BLOCKED';
        }
        // 'retry-merge' y 'abort-own-merge' no mueven fase: el próximo tick reintenta el mismo intent.
    } else if (observation.kind === 'global-qa-pass') {
        if (!observation.clean) throw new Error('QA global no puede cerrar con worktree sucio');
        out.globalQaHeadSha = observation.headSha;
        out.cohortPhase = 'FINAL_INTEGRATION';
    } else if (observation.kind === 'integration-pass') {
        if (out.globalQaHeadSha !== observation.headSha) throw new Error('integración no corresponde al HEAD de QA');
        out.finalIntegrationJobId = observation.jobId;
        out.cohortPhase = 'FINAL_INTERLOCK';
    } else if (observation.kind === 'interlock-pass') {
        if (out.globalQaHeadSha !== observation.headSha) throw new Error('interlock stale');
        for (const t of Object.values(out.tracks)) t.phase = 'JOINED';
        out.cohortPhase = 'COMPLETE';
    } else if (observation.kind !== 'effect-applied') {
        const unhandled: never = observation; // el compilador exige una rama por variante
        throw new Error(`observación no manejada: ${JSON.stringify(unhandled)}`);
    }
    assertProtocolInvariants(out);
    return out;
}

export function observeProtocolEffect(s: CohortProtocol, effect: ProtocolEffect, observation: ProtocolObservation): CohortProtocol {
    if (observation.kind === 'effect-failed' || observation.kind === 'prepare-failed' || observation.kind === 'join-observation'
        || observation.kind === 'freeze-observation' || observation.kind === 'join-requested'
        || observation.kind === 'supervisor-observed' || observation.kind === 'worktree-observed'
        || observation.kind === 'track-removed' || observation.kind === 'teardown-blocked'
        || observation.kind === 'global-qa-pass'
        || observation.kind === 'integration-pass' || observation.kind === 'interlock-pass') {
        // reconcileProtocol clona internamente: pasar `s` sin clonar acá evita un structuredClone redundante.
        return reconcileProtocol(s, observation);
    }
    const out = structuredClone(s);
    if (observation.kind !== 'effect-applied') return out;
    const e = effect;
    if ('trackId' in e) {
        const t = out.tracks[e.trackId];
        if (t === undefined) throw new Error(`track desconocido: ${e.trackId}`);
        const phase = EFFECT_APPLIED_PHASE[e.kind];
        if (phase !== undefined) t.phase = phase;
        if (e.kind === 'persist-join-intent') {
            t.expectedPlanHeadSha = e.expectedPlanHeadSha;
            t.expectedTrackHeadSha = e.expectedTrackHeadSha;
        }
    }
    if (e.kind === 'activate-cohort') {
        out.cohortPhase = 'ACTIVE';
    }
    if (e.kind === 'enter-serial') out.cohortPhase = 'SERIAL';
    assertProtocolInvariants(out);
    return out;
}
