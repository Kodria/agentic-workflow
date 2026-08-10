// Task 11 (R6.2/R6.3/R6.6-R6.9/C7): matriz completa MERGE_HEAD × HEAD para
// `decideJoinReconciliation`. La función YA vive en `protocol.ts` desde
// Task 1 (`reconcileProtocol` la llama para su handler de `join-observation`)
// — por la regla de autoridad única, este archivo NO reimplementa nada; solo
// importa el re-export de `join.ts` (`export { decideJoinReconciliation }
// from './protocol'`, agregado por esta misma task) y prueba la matriz.
//
// Si esta matriz descubriera un caso que `decideJoinReconciliation` no
// cubre, el fix va EN `protocol.ts` y hay que volver a correr la exploración
// exhaustiva de Task 1 (`tests/core/tracks/protocol.test.ts`) en el mismo
// commit — un fix que solo viviera acá invalidaría la prueba del gate.
import { decideJoinReconciliation } from '../../../src/core/tracks/join';
import { JOIN_STRATEGY_NO_FF } from '../../../src/core/tracks/types';
import type { JoinDecision, JoinIntent, JoinObservation } from '../../../src/core/tracks/types';

/** `expectedPlanHeadSha: 'plan'`, `expectedTrackHeadSha: 'track'` — mismos
 *  literales opacos que usa la matriz del plan (Task 11, Step 1). */
function intent(): JoinIntent {
    return { expectedPlanHeadSha: 'plan', expectedTrackHeadSha: 'track', strategy: JOIN_STRATEGY_NO_FF };
}

/** Helper local pedido por el plan: `obs(mergeHead, planHead, trackIsAncestor)`. */
function obs(mergeHead: string | null, planHead: string, trackIsAncestor: boolean): JoinObservation {
    return { mergeHead, planHead, trackIsAncestor };
}

type JoinCase = { name: string; observation: JoinObservation; expected: JoinDecision };

const cases: JoinCase[] = [
    { name: 'no empezó', observation: obs(null, 'plan', false), expected: { action: 'retry-merge' } },
    { name: 'conflicto propio', observation: obs('track', 'plan', false), expected: { action: 'abort-own-merge' } },
    { name: 'aplicado', observation: obs(null, 'merged', true), expected: { action: 'accept-merge', joinedCommitSha: 'merged' } },
    { name: 'MERGE_HEAD ajeno', observation: obs('other', 'plan', false), expected: { action: 'block', reason: 'MERGE_HEAD ajeno' } },
    { name: 'indemostrable', observation: obs(null, 'other', false), expected: { action: 'block', reason: 'estado de join indemostrable' } },
];

describe('decideJoinReconciliation — matriz MERGE_HEAD × HEAD (R6.8, R6.9)', () => {
    test.each(cases)('$name (R6.8, R6.9)', ({ observation, expected }) => {
        expect(decideJoinReconciliation(intent(), observation)).toEqual(expected);
    });

    // Casos límite adicionales, fuera de la matriz literal del plan pero
    // sobre el MISMO vocabulario — documentan por qué cada rama de
    // `decideJoinReconciliation` existe (R6.6/R6.7: HEAD del plan movido).
    test('HEAD del plan movió bajo nuestros pies sin merge en curso: indemostrable, nunca se asume (C7)', () => {
        expect(decideJoinReconciliation(intent(), obs(null, 'otro-plan-head', false)))
            .toEqual({ action: 'block', reason: 'estado de join indemostrable' });
    });

    test('MERGE_HEAD propio pero el plan también se movió: NO se asume conflicto propio a ciegas (R6.6)', () => {
        // `abort-own-merge` exige planHead === expectedPlanHeadSha; si además
        // el HEAD del plan se movió, la ambigüedad (¿conflicto propio o plan
        // movido?) es indemostrable con esta sola observación — bloquea, en
        // vez de abortar un merge asumiendo un plan HEAD que ya no es el
        // esperado. Documentado acá para que un futuro cambio en el orden de
        // las ramas de `decideJoinReconciliation` no lo rompa en silencio.
        expect(decideJoinReconciliation(intent(), obs('track', 'otro-plan-head', false)))
            .toEqual({ action: 'block', reason: 'estado de join indemostrable' });
    });
});
