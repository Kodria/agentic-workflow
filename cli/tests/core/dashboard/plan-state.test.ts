import { classifyPlanState } from '../../../src/core/dashboard/plan-state';

const base = { journal: undefined, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total: 2, completed: 0 } };

describe('classifyPlanState', () => {
    it('gives blocked journal state highest precedence', () => {
        expect(classifyPlanState({ ...base, journal: { state: 'blocked' }, markers: { qaComplete: true, docsComplete: true, retroComplete: true }, tasks: { total: 2, completed: 2 } })).toBe('blocked');
    });

    it('gives active journal state precedence over completed markers', () => {
        expect(classifyPlanState({ ...base, journal: { state: 'active' }, markers: { qaComplete: true, docsComplete: true, retroComplete: true }, tasks: { total: 2, completed: 2 } })).toBe('active');
    });

    it.each([
        [{ ...base, markers: { qaComplete: true, docsComplete: true, retroComplete: true } }, 'executed'],
        [{ ...base, markers: { qaComplete: true, docsComplete: true, retroComplete: false } }, 'retro_pending'],
        [{ ...base, tasks: { total: 2, completed: 2 } }, 'qa_pending'],
        [base, 'legacy_unverifiable'],
    ] as const)('classifies lifecycle state %s', (input, expected) => {
        expect(classifyPlanState(input)).toBe(expected);
    });

    it.each([
        [null, /input/i],
        [{ markers: null, tasks: base.tasks }, /markers/i],
        [{ markers: base.markers, tasks: null }, /task/i],
        [{ ...base, journal: null }, /journal/i],
        [{ ...base, journal: { state: 'invented' } }, /journal/i],
        [{ ...base, markers: { qaComplete: 'yes', retroComplete: false } }, /markers/i],
        [{ ...base, tasks: { total: 1, completed: 2 } }, /counts/i],
        [{ ...base, tasks: { total: Number.NaN, completed: 0 } }, /counts/i],
    ] as const)('rejects invalid public input %p', (input, error) => {
        expect(() => classifyPlanState(input as never)).toThrow(error);
    });
});

describe('fase de documentacion', () => {
    it('clasifica docs_pending con QA hecha y documentacion pendiente', () => {   // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: true, docsComplete: false, retroComplete: false },
            tasks: { total: 3, completed: 3 },
        })).toBe('docs_pending');
    });

    it('vuelve a retro_pending cuando la documentacion esta hecha', () => {       // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: true, docsComplete: true, retroComplete: false },
            tasks: { total: 3, completed: 3 },
        })).toBe('retro_pending');
    });

    it('conserva executed con retro hecho — el significado no cambia', () => {    // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: true, docsComplete: true, retroComplete: true },
            tasks: { total: 3, completed: 3 },
        })).toBe('executed');
    });

    it('rechaza un marker desconocido', () => {                                   // verifies R6.3
        expect(() => classifyPlanState({
            markers: { qaComplete: true, docsComplete: false, retroComplete: false, bogusComplete: true },
            tasks: { total: 1, completed: 1 },
        })).toThrow(/unsupported fields/);
    });

    it('rechaza docsComplete no booleano', () => {                                // verifies R6.3
        expect(() => classifyPlanState({
            markers: { qaComplete: true, docsComplete: 'yes', retroComplete: false },
            tasks: { total: 1, completed: 1 },
        })).toThrow(/must be boolean/);
    });

    it('docsComplete solo, sin qaComplete, ya alcanza retro_pending — el orden de la cadena no exige qaComplete primero', () => {  // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: false, docsComplete: true, retroComplete: false },
            tasks: { total: 3, completed: 3 },
        })).toBe('retro_pending');
    });
});
