import {
    assertProtocolInvariants, decidePrepare, decideTeardown, initialCohort, nextProtocolEffect,
    observeProtocolEffect, reconcileProtocol,
} from '../../../src/core/tracks/protocol';
import type {
    CohortProtocol, PrepareDecision, PrepareObservation, ProtocolEffect,
    ProtocolObservation, TeardownDecision, TeardownObservation, TrackProtocolState,
} from '../../../src/core/tracks/types';

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

    test('Step 3 (Task 9): el recorrido también ejercita decidePrepare, no solo nextProtocolEffect', () => {
        // 'begin-fallback' queda deliberadamente afuera: es el fail-closed de
        // una fase que `nextProtocolEffect` nunca selecciona para un efecto de
        // PREPARING (ver el comentario de `decidePrepare`) — por diseño, la
        // exploración (que solo llama `decidePrepare` con la fase que
        // `nextProtocolEffect` ya eligió) jamás la alcanza; la matriz de
        // arriba ('decidePrepare — Task 9') sí la cubre directamente.
        expect([...exploreCohort(ids).prepareDecisions].sort()).toEqual([
            'accept-readiness', 'accept-worktree', 'block-foreign',
            'retry-supervisor-same-intent', 'retry-worktree', 'write-descriptor',
        ].sort());
    });

    test('Step 5 (Task 13): el recorrido también ejercita decideTeardown con las 7 decisiones posibles', () => {
        // Mismo criterio que el test análogo de `prepareDecisions` (Step 3,
        // Task 9): sin esta aserción, una regresión que dejara de alcanzar
        // alguna `TeardownDecision` durante la exploración pasaría
        // desapercibida, aunque el set se siguiera recolectando.
        expect([...exploreCohort(ids).teardownDecisions].sort()).toEqual([
            'accept-supervisor-stopped', 'block-foreign', 'mark-removed', 'persist-intent',
            'remove-owned-branch', 'remove-owned-worktree', 'stop-own-supervisor',
        ].sort());
    });

    describe('decidePrepare — Task 9 (R4.2, R4.6, C11): matriz observable de recuperación de crash', () => {
        const track = (phase: TrackProtocolState['phase']): TrackProtocolState => ({
            trackId: 'a', phase, fencingToken: 'f'.repeat(32), readinessNonce: 'r'.repeat(32),
        });

        const cases: Array<[TrackProtocolState['phase'], PrepareObservation, PrepareDecision]> = [
            // PREPARE_INTENT (create-worktree): ownedWorktreeExists manda por
            // sobre "no vacío" — un destino nuestro nunca se re-crea ni bloquea.
            ['PREPARE_INTENT', {}, 'retry-worktree'],
            ['PREPARE_INTENT', { worktreeOwned: true }, 'accept-worktree'],
            ['PREPARE_INTENT', { worktreeOwned: true, worktreeForeignNonEmpty: true }, 'accept-worktree'],
            ['PREPARE_INTENT', { worktreeForeignNonEmpty: true }, 'block-foreign'],
            ['PREPARE_INTENT', { worktreeOwned: false, worktreeForeignNonEmpty: false }, 'retry-worktree'],
            // WORKTREE_CREATED (create-track-journal): `initTrackJournal` ya es
            // idempotente por construcción (initJournal no pisa un state.json
            // existente, writeDescriptor sobreescribe igual siempre) — una
            // sola decisión alcanza, sin necesitar distinguir "primera vez" de
            // "reintento tras crash".
            ['WORKTREE_CREATED', {}, 'write-descriptor'],
            // SUPERVISOR_STARTING (spawn-track-supervisor, con supervisorIntent
            // ya persistido): 'absent' es el ÚNICO caso seguro para
            // (re)spawnear — cualquier otra cosa es evidencia real de un
            // intento previo (mismo intent) que jamás se debe duplicar.
            ['SUPERVISOR_STARTING', { supervisorArtifact: 'absent' }, 'retry-supervisor-same-intent'],
            ['SUPERVISOR_STARTING', {}, 'retry-supervisor-same-intent'],
            ['SUPERVISOR_STARTING', { supervisorArtifact: 'claimed' }, 'accept-readiness'],
            ['SUPERVISOR_STARTING', { supervisorArtifact: 'ready' }, 'accept-readiness'],
            ['SUPERVISOR_STARTING', { supervisorArtifact: 'foreign' }, 'block-foreign'],
            // Fase inesperada para un efecto de PREPARING: fail-closed a fallback.
            ['ACTIVE', {}, 'begin-fallback'],
        ];

        test.each(cases)('fase %s + observación %j -> %s', (phase, observed, expected) => {
            expect(decidePrepare(track(phase), observed)).toBe(expected);
        });

        test('la matriz cubre las 7 decisiones posibles', () => {
            const seen = new Set(cases.map(([, , decision]) => decision));
            expect([...seen].sort()).toEqual([
                'accept-readiness', 'accept-worktree', 'begin-fallback', 'block-foreign',
                'retry-supervisor-same-intent', 'retry-worktree', 'write-descriptor',
            ].sort());
        });
    });
});

/** Recorrido acotado del espacio de estados con crash inyectado en cada frontera. */
function exploreCohort(ids: string[]): {
    states: CohortProtocol[]; effects: Set<ProtocolEffect['kind']>;
    prepareDecisions: Set<PrepareDecision>; teardownDecisions: Set<TeardownDecision>;
} {
    const queue: CohortProtocol[] = [{ ...initialCohort('journal-1', ids), planHeadSha: 'plan-head' }];
    const seen = new Map<string, CohortProtocol>();
    const effects = new Set<ProtocolEffect['kind']>();
    const prepareDecisions = new Set<PrepareDecision>();
    const teardownDecisions = new Set<TeardownDecision>();
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
        for (const observation of observationsFor(effect, state, prepareDecisions, teardownDecisions)) {
            queue.push(observeProtocolEffect(structuredClone(state), effect, observation));
            queue.push(reconcileProtocol(structuredClone(state), observation)); // crash antes de result
        }
    }
    return { states: [...seen.values()], effects, prepareDecisions, teardownDecisions };
}

/** Requests que nacen fuera del reducer y por eso no son consecuencia de ningún effect. */
function externalObservationsFor(state: CohortProtocol): ProtocolObservation[] {
    return Object.values(state.tracks)
        .filter((t) => t.phase === 'ACTIVE')
        .map((t): ProtocolObservation => ({ kind: 'join-requested', trackId: t.trackId }));
}

/** Los 7 valores que `decidePrepare` puede devolver (mismo catálogo que
 *  `PrepareDecision`) — usado para que la exploración denuncie si algún día
 *  devuelve algo fuera de este conjunto. */
const VALID_PREPARE_DECISIONS: readonly PrepareDecision[] = [
    'retry-worktree', 'accept-worktree', 'write-descriptor',
    'retry-supervisor-same-intent', 'accept-readiness', 'block-foreign', 'begin-fallback',
];

/** Variantes de `PrepareObservation` que un driver real reuniría para
 *  `create-worktree` (fase PREPARE_INTENT) — mismo catálogo que la matriz
 *  `decidePrepare — Task 9` de más abajo. */
const PREPARE_OBSERVATIONS_FOR_WORKTREE: PrepareObservation[] = [
    {}, { worktreeOwned: true }, { worktreeOwned: true, worktreeForeignNonEmpty: true },
    { worktreeForeignNonEmpty: true }, { worktreeOwned: false, worktreeForeignNonEmpty: false },
];

/** Las 7 decisiones que `decideTeardown` puede devolver (Task 13) — usado
 *  para que la exploración denuncie si algún día devuelve algo fuera de este
 *  conjunto, mismo criterio que `VALID_PREPARE_DECISIONS`. */
const VALID_TEARDOWN_DECISIONS: readonly TeardownDecision[] = [
    'persist-intent', 'stop-own-supervisor', 'accept-supervisor-stopped',
    'remove-owned-worktree', 'remove-owned-branch', 'mark-removed', 'block-foreign',
];

/** Variantes de `TeardownObservation` relevantes a CADA fase de teardown —
 *  mismo criterio que `PREPARE_OBSERVATIONS_FOR_WORKTREE`/`_SUPERVISOR`:
 *  cubre lo que `gatherTeardownObservation` (`tracks.ts`) realmente puede
 *  reunir en esa fase, más las variantes "ajeno" defensivas que
 *  `decideTeardown` también contempla (Step 1 del plan T13). */
const TEARDOWN_OBSERVATIONS_BY_PHASE: Partial<Record<TrackProtocolState['phase'], TeardownObservation[]>> = {
    TEARDOWN_REQUESTED: [{}],
    TEARDOWN_INTENT: [{}, { ownSupervisorAlive: true }, { ownSupervisorAlive: false }, { foreignSupervisor: true }],
    SUPERVISOR_STOPPED: [{}, { ownedWorktreeExists: true }, { ownedWorktreeExists: false }, { foreignWorktree: true }],
    WORKTREE_REMOVED: [{}, { ownedBranchExists: true }, { ownedBranchExists: false }],
    BRANCH_REMOVED: [{}],
};

/** Idem para `spawn-track-supervisor` (fase SUPERVISOR_STARTING). */
const PREPARE_OBSERVATIONS_FOR_SUPERVISOR: PrepareObservation[] = [
    {}, { supervisorArtifact: 'absent' }, { supervisorArtifact: 'claimed' },
    { supervisorArtifact: 'ready' }, { supervisorArtifact: 'foreign' },
];

/**
 * Task 9 (Step 3 del plan): llama a `decidePrepare` — la MISMA autoridad que
 * usa `tracks.ts` — para cada `PrepareObservation` relevante a la fase que
 * `nextProtocolEffect` ya eligió, y traduce cada decisión a la
 * `ProtocolObservation` que un driver real produciría con ella (mismo mapeo,
 * letra por letra, que `runCreateWorktree`/`runSpawnTrackSupervisor` en
 * `tracks.ts`). Sin esto, `nextProtocolEffect` (qué efecto sigue) y
 * `decidePrepare` (qué hacer con ESE efecto) podían divergir en silencio —
 * ningún test lo hubiera visto porque la exploración nunca invocaba
 * `decidePrepare`. Las observaciones devueltas se mezclan con las de
 * `observationsFor` y entran al mismo BFS: si alguna hiciera que
 * `reconcileProtocol`/`observeProtocolEffect` tiraran, o llevara a un estado
 * que viola invariantes, el test de exploración ya existente lo denuncia.
 */
function decidePrepareObservationsFor(
    effect: Exclude<ReturnType<typeof nextProtocolEffect>, null>, state: CohortProtocol, prepareDecisions: Set<PrepareDecision>,
): ProtocolObservation[] {
    if (effect.kind !== 'create-worktree' && effect.kind !== 'create-track-journal' && effect.kind !== 'spawn-track-supervisor') {
        return [];
    }
    const track = state.tracks[effect.trackId];
    // `spawn-track-supervisor` cubre DOS fases (JOURNAL_CREATED |
    // SUPERVISOR_STARTING, ver `nextProtocolEffect`), pero `tracks.ts`
    // (`runSpawnTrackSupervisor`) solo invoca `decidePrepare` en la SEGUNDA
    // — la primera vez (JOURNAL_CREATED, `ref.supervisorIntent === undefined`)
    // persiste el intent y retorna ANTES de siquiera considerar `decidePrepare`,
    // porque el protocolo puro no distingue "intent ya persistido" (eso vive
    // solo en `TrackRef.supervisorIntent`, un dato del journal — regla de
    // capas de T1, `protocol.ts` no lo conoce). Llamar `decidePrepare` acá con
    // JOURNAL_CREATED probaría un caso que el driver real NUNCA ejercita
    // (decidePrepare cae a 'begin-fallback' porque no tiene rama para esa
    // fase) — se salta, fiel al comportamiento real, no a lo que `protocol.ts`
    // podría en teoría hacer con ella.
    if (effect.kind === 'spawn-track-supervisor' && track.phase !== 'SUPERVISOR_STARTING') return [];
    const variants: PrepareObservation[] = effect.kind === 'create-worktree' ? PREPARE_OBSERVATIONS_FOR_WORKTREE
        : effect.kind === 'spawn-track-supervisor' ? PREPARE_OBSERVATIONS_FOR_SUPERVISOR
            : [{}];
    const out: ProtocolObservation[] = [];
    for (const observed of variants) {
        const decision = decidePrepare(track, observed);
        expect(VALID_PREPARE_DECISIONS).toContain(decision);
        prepareDecisions.add(decision);
        if (effect.kind === 'create-worktree') {
            if (decision === 'accept-worktree') out.push({ kind: 'worktree-observed', trackId: effect.trackId, owned: true });
            else if (decision === 'block-foreign') out.push({ kind: 'worktree-observed', trackId: effect.trackId, owned: false });
            // 'retry-worktree': recién ahí `tracks.ts` toca `runtime` de
            // verdad — su resultado real (éxito u `effect-failed`) ya está
            // en el `case 'create-worktree'` de `observationsFor`.
        } else if (effect.kind === 'spawn-track-supervisor') {
            if (decision === 'block-foreign') out.push({ kind: 'supervisor-observed', trackId: effect.trackId, identity: 'other' });
            else if (decision === 'accept-readiness' && observed.supervisorArtifact === 'ready') {
                out.push({ kind: 'supervisor-observed', trackId: effect.trackId, identity: 'expected', readinessNonce: effect.readinessNonce });
            }
            // 'retry-supervisor-same-intent' y 'accept-readiness' con
            // 'claimed': ningún tick produce todavía una observación de
            // protocolo (esperan al próximo, o recién ahí tocan `runtime`).
        } else {
            // create-track-journal: `write-descriptor` es la única decisión
            // posible en WORKTREE_CREATED (initTrackJournal ya es idempotente
            // por construcción) — su resultado ya lo cubre el `default` de
            // `observationsFor`.
            expect(decision).toBe('write-descriptor');
        }
    }
    return out;
}

/**
 * Task 13 (mismo criterio que `decidePrepareObservationsFor`, Task 9): llama
 * a `decideTeardown` — la MISMA autoridad que usa `runBeginTeardown` — para
 * cada `TeardownObservation` relevante a la fase ACTUAL del track en
 * `begin-teardown`, y traduce cada decisión "ya resuelta" (`block-foreign`,
 * `accept-supervisor-stopped`, `remove-owned-branch` desde SUPERVISOR_STOPPED,
 * `mark-removed`) a la `teardown-observation` que un driver real produciría
 * con ella (mismo mapeo que `runBeginTeardown` en `tracks.ts`). Las
 * decisiones "falta trabajo real" (`stop-own-supervisor`,
 * `remove-owned-worktree`, `remove-owned-branch` desde WORKTREE_REMOVED,
 * `persist-intent`) no producen observación acá — su resultado real (éxito
 * u `effect-failed`) ya lo cubre el `case 'begin-teardown'` de
 * `observationsFor`.
 */
function decideTeardownObservationsFor(
    effect: Exclude<ReturnType<typeof nextProtocolEffect>, null>, state: CohortProtocol, teardownDecisions: Set<TeardownDecision>,
): ProtocolObservation[] {
    if (effect.kind !== 'begin-teardown') return [];
    const track = state.tracks[effect.trackId];
    const variants = TEARDOWN_OBSERVATIONS_BY_PHASE[track.phase] ?? [{}];
    const out: ProtocolObservation[] = [];
    for (const observed of variants) {
        const decision = decideTeardown(track, observed);
        expect(VALID_TEARDOWN_DECISIONS).toContain(decision);
        teardownDecisions.add(decision);
        if (decision === 'block-foreign' || decision === 'accept-supervisor-stopped' || decision === 'mark-removed'
            || (decision === 'remove-owned-branch' && track.phase === 'SUPERVISOR_STOPPED')) {
            out.push({ kind: 'teardown-observation', trackId: effect.trackId, ...observed });
        }
        // 'persist-intent' / 'stop-own-supervisor' / 'remove-owned-worktree'
        // / 'remove-owned-branch' (desde WORKTREE_REMOVED, branch real por
        // remover): el driver TODAVÍA no completó el efecto real acá.
    }
    return out;
}

function observationsFor(
    effect: ReturnType<typeof nextProtocolEffect>, state: CohortProtocol, prepareDecisions: Set<PrepareDecision>,
    teardownDecisions: Set<TeardownDecision>,
): ProtocolObservation[] {
    if (effect === null) return [];
    const base = ((): ProtocolObservation[] => {
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
            // T13: reemplaza las observaciones gruesas `track-removed`/
            // `teardown-blocked` por el vocabulario fino de
            // `TeardownObservation` — `decideTeardownObservationsFor` abajo
            // agrega, además, las variantes específicas de la fase actual
            // (mismo criterio que `decidePrepareObservationsFor`).
            case 'begin-teardown': return [
                { kind: 'effect-applied', effect },
                { kind: 'effect-failed', trackId: effect.trackId, effect: effect.kind, detail: 'worktree sucio: x' },
            ];
            case 'request-global-qa': return [{ kind: 'global-qa-pass', headSha: 'H-qa', clean: true }];
            case 'request-final-integration': return [{ kind: 'integration-pass', jobId: 'job-1', headSha: 'H-qa' }];
            case 'run-final-interlock': return [{ kind: 'interlock-pass', headSha: 'H-qa' }];
            default: return [{ kind: 'effect-applied', effect }];
        }
    })();
    // Task 9 (Step 3): agrega las observaciones que `decidePrepare` ejercita
    // para las 3 fronteras de PREPARING que gobierna, deduplicando contra las
    // que este mismo `switch` ya listaba a mano.
    const seen = new Set(base.map((o) => JSON.stringify(o)));
    for (const observation of decidePrepareObservationsFor(effect, state, prepareDecisions)) {
        const key = JSON.stringify(observation);
        if (!seen.has(key)) { base.push(observation); seen.add(key); }
    }
    for (const observation of decideTeardownObservationsFor(effect, state, teardownDecisions)) {
        const key = JSON.stringify(observation);
        if (!seen.has(key)) { base.push(observation); seen.add(key); }
    }
    return base;
}
