import {
    assertProtocolInvariants, initialCohort, nextProtocolEffect,
    observeProtocolEffect, reconcileProtocol,
} from '../../../src/core/tracks/protocol';
import type { CohortProtocol, ProtocolEffect, ProtocolObservation } from '../../../src/core/tracks/types';

const ids = ['cli', 'docs'];

describe('parallel-track protocol model', () => {
    test('no activa parcialmente: todos deben estar ARMED (R4.4, C1)', () => {
        let s = initialCohort('journal-1', ids);
        s.tracks.cli.phase = 'ARMED';
        expect(nextProtocolEffect(s)).not.toEqual({ kind: 'activate-cohort' });
        s.tracks.docs.phase = 'ARMED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'activate-cohort' });
    });

    test('un fallo pre-ACTIVE entra a teardown y solo luego a serial (R4.5, C2)', () => {
        let s = initialCohort('journal-1', ids);
        s.tracks.cli.phase = 'WORKTREE_CREATED';
        s.tracks.docs.phase = 'WORKTREE_CREATED';
        s = reconcileProtocol(s, { kind: 'prepare-failed', trackId: 'docs', detail: 'disk full' });
        expect(s.cohortPhase).toBe('FALLBACK_PENDING');
        expect(s.tracks.docs.phase).toBe('TEARDOWN_REQUESTED'); // no BLOCKED: el fallo es demostrable
        expect(nextProtocolEffect(s)).toEqual({ kind: 'begin-teardown', trackId: 'cli' });
        s.tracks.cli.phase = 'REMOVED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'begin-teardown', trackId: 'docs' });
        s.tracks.docs.phase = 'REMOVED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'enter-serial', reason: 'prepare-failed:docs' });
    });

    test('un track BLOCKED nunca habilita serial (R4.6, C2)', () => {
        let s = initialCohort('journal-1', ids);
        s.tracks.cli.phase = 'REMOVED';
        s.tracks.docs.phase = 'BLOCKED';
        s.cohortPhase = 'FALLBACK_PENDING';
        s.fallbackReason = 'prepare-failed:cli';
        // Propiedad indemostrable: la cohorte se detiene, no serializa con recursos vivos.
        expect(nextProtocolEffect(s)).toBeNull();
        expect(() => observeProtocolEffect(s, { kind: 'enter-serial', reason: 'x' }, { kind: 'effect-applied', effect: { kind: 'enter-serial', reason: 'x' } }))
            .toThrow(/SERIAL prohíbe recursos paralelos activos/);
    });

    test('ningún merge empieza antes de que todos los tracks estén FROZEN (C3)', () => {
        const s = initialCohort('journal-1', ids);
        s.cohortPhase = 'JOINING';
        s.planHeadSha = 'plan-head';
        s.tracks.cli.phase = 'FROZEN';
        s.tracks.cli.frozenHeadSha = 'cli-head';
        s.tracks.docs.phase = 'ACTIVE';
        expect(nextProtocolEffect(s)).toBeNull(); // docs todavía trabaja: no se persiste join intent
        s.tracks.docs.phase = 'JOIN_REQUESTED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'freeze-track', trackId: 'docs' });
    });

    test('los joins son serie estricta: un solo JOIN_INTENT vivo (R6.3, C7)', () => {
        const s = initialCohort('journal-1', ids);
        s.cohortPhase = 'JOINING';
        s.planHeadSha = 'plan-head';
        for (const t of Object.values(s.tracks)) { t.phase = 'FROZEN'; t.frozenHeadSha = `${t.trackId}-head`; }
        const first = nextProtocolEffect(s)!;
        expect(first).toEqual({
            kind: 'persist-join-intent', trackId: 'cli',
            expectedPlanHeadSha: 'plan-head', expectedTrackHeadSha: 'cli-head',
        });
        const armed = observeProtocolEffect(s, first, { kind: 'effect-applied', effect: first });
        expect(nextProtocolEffect(armed)).toMatchObject({ kind: 'merge-track', trackId: 'cli' });
        expect(() => assertProtocolInvariants({
            ...armed, tracks: { ...armed.tracks, docs: { ...armed.tracks.docs, phase: 'JOIN_INTENT' } },
        })).toThrow(/un solo JOIN_INTENT/);
    });

    test('el orden final no produce evidencia antes del HEAD final (R7.7, C3)', () => {
        const s = initialCohort('journal-1', ids);
        s.cohortPhase = 'JOINING';
        s.planHeadSha = 'plan-head';
        s.tracks.cli.phase = 'MERGED_UNVERIFIED';
        s.tracks.cli.frozenHeadSha = 'cli-head';
        s.tracks.docs.phase = 'FROZEN';
        s.tracks.docs.frozenHeadSha = 'docs-head';
        expect(nextProtocolEffect(s)).not.toMatchObject({ kind: 'request-global-qa' });
        s.tracks.docs.phase = 'MERGED_UNVERIFIED';
        expect(nextProtocolEffect(s)).toEqual({ kind: 'request-global-qa' });
    });

    test('una observación indemostrable bloquea sin efecto destructivo (R6.9, C11)', () => {
        const s = initialCohort('journal-1', ids);
        s.cohortPhase = 'JOINING';
        s.planHeadSha = 'plan-head';
        for (const t of Object.values(s.tracks)) { t.phase = 'FROZEN'; t.frozenHeadSha = `${t.trackId}-head`; }
        s.tracks.cli.phase = 'JOIN_INTENT';
        s.tracks.cli.expectedPlanHeadSha = 'plan-head';
        s.tracks.cli.expectedTrackHeadSha = 'cli-head';
        const out = reconcileProtocol(s, { kind: 'join-observation', trackId: 'cli', mergeHead: 'other', planHead: 'other' });
        expect(out.tracks.cli.phase).toBe('BLOCKED');
        expect(out.cohortPhase).toBe('BLOCKED');
        expect(nextProtocolEffect(out)).toBeNull();
    });

    test('ningún estado alcanzable viola invariantes al crashear entre fronteras (R4.2, R6.8, C9, C11)', () => {
        const { states } = exploreCohort(ids);
        for (const state of states) expect(() => assertProtocolInvariants(state)).not.toThrow();
        expect(states.length).toBeGreaterThan(50);
    });

    test('SERIAL solo es alcanzable con la cohorte desmantelada (R4.5, C2)', () => {
        const serial = exploreCohort(ids).states.filter((s) => s.cohortPhase === 'SERIAL');
        expect(serial.length).toBeGreaterThan(0);
        for (const s of serial) {
            expect(Object.values(s.tracks).every((t) => ['REMOVED', 'DECLARED'].includes(t.phase))).toBe(true);
        }
    });

    test('Step 6: el recorrido cubre las 14 fronteras', () => {
        expect([...exploreCohort(ids).effects].sort()).toEqual([
            'activate-cohort', 'activate-track', 'begin-teardown', 'create-track-journal', 'create-worktree',
            'enter-serial', 'freeze-track', 'merge-track', 'persist-join-intent',
            'persist-prepare-intent', 'request-final-integration', 'request-global-qa',
            'run-final-interlock', 'spawn-track-supervisor',
        ].sort());
    });
});

/** Recorrido acotado del espacio de estados con crash inyectado en cada frontera. */
function exploreCohort(ids: string[]): { states: CohortProtocol[]; effects: Set<ProtocolEffect['kind']> } {
    const queue: CohortProtocol[] = [{ ...initialCohort('journal-1', ids), planHeadSha: 'plan-head' }];
    const seen = new Map<string, CohortProtocol>();
    const effects = new Set<ProtocolEffect['kind']>();
    while (queue.length > 0 && seen.size < 20000) {
        const state = queue.shift()!;
        const key = JSON.stringify(state);
        if (seen.has(key)) continue;
        seen.set(key, state);
        const effect = nextProtocolEffect(state);
        if (effect === null) {
            // Quiescencia: solo avanza si llega un request externo (un track pide unirse).
            for (const observation of externalObservationsFor(state)) {
                queue.push(reconcileProtocol(structuredClone(state), observation));
            }
            continue;
        }
        effects.add(effect.kind);
        for (const observation of observationsFor(effect)) {
            queue.push(observeProtocolEffect(structuredClone(state), effect, observation));
            queue.push(reconcileProtocol(structuredClone(state), observation)); // crash antes de result
        }
    }
    return { states: [...seen.values()], effects };
}

/** Requests que nacen fuera del reducer y por eso no son consecuencia de ningún effect. */
function externalObservationsFor(state: CohortProtocol): ProtocolObservation[] {
    return Object.values(state.tracks)
        .filter((t) => t.phase === 'ACTIVE')
        .map((t): ProtocolObservation => ({ kind: 'join-requested', trackId: t.trackId }));
}

function observationsFor(effect: ReturnType<typeof nextProtocolEffect>): ProtocolObservation[] {
    if (effect === null) return [];
    switch (effect.kind) {
        case 'create-worktree': return [
            { kind: 'effect-applied', effect },
            { kind: 'worktree-observed', trackId: effect.trackId, owned: true },
            { kind: 'worktree-observed', trackId: effect.trackId, owned: false },
            { kind: 'effect-failed', trackId: effect.trackId, effect: effect.kind, detail: 'injected' },
        ];
        case 'merge-track': return [
            { kind: 'join-observation', trackId: effect.trackId, mergeHead: null, planHead: 'merged', trackIsAncestor: true },
            { kind: 'join-observation', trackId: effect.trackId, mergeHead: effect.expectedTrackHeadSha, planHead: effect.expectedPlanHeadSha },
        ];
        case 'freeze-track': return [
            { kind: 'effect-applied', effect },
            { kind: 'freeze-observation', trackId: effect.trackId, frozenHeadSha: `${effect.trackId}-head` },
        ];
        case 'spawn-track-supervisor': return [
            { kind: 'effect-applied', effect },
            { kind: 'supervisor-observed', trackId: effect.trackId, identity: 'expected', readinessNonce: effect.readinessNonce },
            { kind: 'supervisor-observed', trackId: effect.trackId, identity: 'expected', readinessNonce: 'nonce-ajeno' },
            { kind: 'supervisor-observed', trackId: effect.trackId, identity: 'other' },
        ];
        case 'begin-teardown': return [
            { kind: 'effect-applied', effect },
            { kind: 'track-removed', trackId: effect.trackId },
            { kind: 'teardown-blocked', trackId: effect.trackId, detail: 'identidad ajena' },
        ];
        case 'request-global-qa': return [{ kind: 'global-qa-pass', headSha: 'H-qa', clean: true }];
        case 'request-final-integration': return [{ kind: 'integration-pass', jobId: 'job-1', headSha: 'H-qa' }];
        case 'run-final-interlock': return [{ kind: 'interlock-pass', headSha: 'H-qa' }];
        default: return [{ kind: 'effect-applied', effect }];
    }
}
