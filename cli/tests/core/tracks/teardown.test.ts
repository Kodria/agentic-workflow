// Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): matriz PURA de `decideTeardown` —
// mismo criterio que `join-reconcile.test.ts` (T11): importa el re-export de
// `teardown.ts`, así que cualquier fix que esta matriz descubra vive en
// `protocol.ts` (autoridad única) y `protocol.test.ts` vuelve a correr su
// exploración en el mismo commit.
import { decideTeardown } from '../../../src/core/tracks/teardown';
import type { TeardownDecision, TeardownObservation, TrackPhase, TrackProtocolState } from '../../../src/core/tracks/types';

const phase = (p: TrackPhase): TrackProtocolState => ({
    trackId: 'a', phase: p, fencingToken: 'f'.repeat(32), readinessNonce: 'r'.repeat(32),
});
const observed = (o: TeardownObservation = {}): TeardownObservation => o;

describe('decideTeardown — Task 13 (R4.2/R4.3/R4.6/R4.10, C2/C9): matriz pura', () => {
    const cases: Array<[string, TrackProtocolState, TeardownObservation, TeardownDecision]> = [
        ['request sin intent', phase('TEARDOWN_REQUESTED'), observed(), 'persist-intent'],
        ['supervisor propio vivo', phase('TEARDOWN_INTENT'), observed({ ownSupervisorAlive: true }), 'stop-own-supervisor'],
        ['identidad ajena', phase('TEARDOWN_INTENT'), observed({ foreignSupervisor: true }), 'block-foreign'],
        ['supervisor ausente', phase('TEARDOWN_INTENT'), observed({ ownSupervisorAlive: false }), 'accept-supervisor-stopped'],
        ['worktree propio', phase('SUPERVISOR_STOPPED'), observed({ ownedWorktreeExists: true }), 'remove-owned-worktree'],
        ['worktree ajeno', phase('SUPERVISOR_STOPPED'), observed({ foreignWorktree: true }), 'block-foreign'],
        ['branch propia', phase('WORKTREE_REMOVED'), observed({ ownedBranchExists: true }), 'remove-owned-branch'],
        ['todo ausente', phase('BRANCH_REMOVED'), observed(), 'mark-removed'],
    ];

    test.each(cases)('%s (R4.3, C9)', (_name, ref, observation, action) => {
        expect(decideTeardown(ref, observation)).toBe(action);
    });

    // Cobertura complementaria (no listada en el snippet del plan, pero
    // exigida por "identidad ajena SIEMPRE gana primero, sin importar la
    // fase" del comentario de `decideTeardown`): `foreignSupervisor`/
    // `foreignWorktree` bloquean sin importar en qué paso del teardown esté
    // el track — nunca se toca algo ajeno solo porque la fase "no le toca".
    test('ajeno gana primero sin importar la fase (R4.6, C9)', () => {
        expect(decideTeardown(phase('SUPERVISOR_STOPPED'), { foreignSupervisor: true })).toBe('block-foreign');
        expect(decideTeardown(phase('WORKTREE_REMOVED'), { foreignWorktree: true })).toBe('block-foreign');
    });

    test('sin worktree ni branch propios, SUPERVISOR_STOPPED avanza directo a remove-owned-branch (mecánico, C9)', () => {
        expect(decideTeardown(phase('SUPERVISOR_STOPPED'), {})).toBe('remove-owned-branch');
    });

    test('WORKTREE_REMOVED sin branch propia marca removed (mecánico, C9)', () => {
        expect(decideTeardown(phase('WORKTREE_REMOVED'), {})).toBe('mark-removed');
    });

    // R4.6/C9: BLOCKED es un dead end DELIBERADO — ninguna fase alcanzable
    // por `nextProtocolEffect` para `begin-teardown` es BLOCKED (se filtra
    // antes, ver `protocol.ts`), así que `decideTeardown` jamás la resuelve
    // sola: lanza fail-closed en vez de inventar una salida automática. Salir
    // de BLOCKED es siempre un acto explícito del operador (volver a
    // TEARDOWN_REQUESTED), nunca algo que esta función decida por sí misma.
    test('BLOCKED nunca es una fase de entrada válida (R4.6, C9): fail-closed', () => {
        expect(() => decideTeardown(phase('BLOCKED'), {})).toThrow(/teardown no válido desde BLOCKED/);
    });

    test('fase de trabajo normal (nunca en teardown) también fail-closed', () => {
        expect(() => decideTeardown(phase('ACTIVE'), {})).toThrow(/teardown no válido desde ACTIVE/);
    });

    test('la matriz cubre las 7 decisiones posibles', () => {
        const seen = new Set(cases.map(([, , , decision]) => decision));
        seen.add(decideTeardown(phase('SUPERVISOR_STOPPED'), {})); // remove-owned-branch (variante mecánica)
        expect([...seen].sort()).toEqual([
            'accept-supervisor-stopped', 'block-foreign', 'mark-removed',
            'persist-intent', 'remove-owned-branch', 'remove-owned-worktree', 'stop-own-supervisor',
        ].sort());
    });
});
