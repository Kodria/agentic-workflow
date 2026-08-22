import { classifyPlanState } from '../../../src/core/dashboard/plan-state';

const base = { journal: undefined, markers: { qaComplete: false, retroComplete: false }, tasks: { total: 2, completed: 0 } };

describe('classifyPlanState', () => {
    it('gives blocked journal state highest precedence', () => {
        expect(classifyPlanState({ ...base, journal: { state: 'blocked' }, markers: { qaComplete: true, retroComplete: true }, tasks: { total: 2, completed: 2 } })).toBe('blocked');
    });

    it('gives active journal state precedence over completed markers', () => {
        expect(classifyPlanState({ ...base, journal: { state: 'active' }, markers: { qaComplete: true, retroComplete: true }, tasks: { total: 2, completed: 2 } })).toBe('active');
    });

    it.each([
        [{ ...base, markers: { qaComplete: true, retroComplete: true } }, 'executed'],
        [{ ...base, markers: { qaComplete: true, retroComplete: false } }, 'retro_pending'],
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
