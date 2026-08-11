import { evaluateCoverage, type IndexedDetectorObservation } from '../../../../src/commands/sensors/coverage/evaluate';
import type { CoverageContract } from '../../../../src/commands/sensors/coverage/contract';

const contract: CoverageContract = {
    schemaVersion: 1,
    classes: {
        alpha: {
            description: 'Alpha',
            detectors: [{ sensor: 'one' }, { sensor: 'two' }],
            remedy: { summary: 'Fix alpha', command: 'fix alpha' },
        },
        zeta: {
            description: 'Zeta',
            detectors: [{ sensor: 'three' }],
            remedy: { summary: 'Fix zeta', command: 'fix zeta' },
        },
    },
};

const observation = (
    classId: string,
    detectorIndex: number,
    sensor: string,
    status: IndexedDetectorObservation['status'],
): IndexedDetectorObservation => ({ classId, detectorIndex, sensor, status, evidence: [] });

describe('coverage evaluation', () => {
    test.each([
        [[observation('alpha', 0, 'one', 'covered'), observation('alpha', 1, 'two', 'missing')], 'covered'],
        [[observation('alpha', 0, 'one', 'missing'), observation('alpha', 1, 'two', 'disabled')], 'missing'],
        [[observation('alpha', 0, 'one', 'ineffective'), observation('alpha', 1, 'two', 'missing')], 'missing'],
        [[observation('alpha', 0, 'one', 'unverifiable'), observation('alpha', 1, 'two', 'missing')], 'unverifiable'],
    ] as const)('reduces detector alternatives %j to %s', (alpha, expected) => {
        const result = evaluateCoverage(contract, [...alpha, observation('zeta', 0, 'three', 'covered')]);

        expect(result.classes.find((item) => item.id === 'alpha')?.status).toBe(expected);
    });

    it('makes global gaps outrank unverifiable while preserving both classes', () => {
        const result = evaluateCoverage(contract, [
            observation('alpha', 0, 'one', 'unverifiable'),
            observation('alpha', 1, 'two', 'missing'),
            observation('zeta', 0, 'three', 'missing'),
        ]);

        expect(result.overall).toBe('gaps');
        expect(result.classes.map((item) => [item.id, item.status])).toEqual([
            ['alpha', 'unverifiable'],
            ['zeta', 'missing'],
        ]);
    });

    it('sorts classes by stable ID and is deterministic under reordered observations', () => {
        const result = evaluateCoverage(contract, [
            observation('zeta', 0, 'three', 'covered'),
            observation('alpha', 1, 'two', 'missing'),
            observation('alpha', 0, 'one', 'covered'),
        ]);

        expect(result.classes.map((item) => item.id)).toEqual(['alpha', 'zeta']);
        expect(evaluateCoverage(contract, [
            observation('alpha', 0, 'one', 'covered'),
            observation('zeta', 0, 'three', 'covered'),
            observation('alpha', 1, 'two', 'missing'),
        ])).toEqual(result);
    });

    it('fails loudly when an observation is missing or duplicated', () => {
        expect(() => evaluateCoverage(contract, [])).toThrow(/missing observation.*one/);
        expect(() => evaluateCoverage(contract, [
            observation('alpha', 0, 'one', 'covered'),
            observation('alpha', 0, 'one', 'covered'),
            observation('alpha', 1, 'two', 'covered'),
            observation('zeta', 0, 'three', 'covered'),
        ])).toThrow(/duplicate observation.*alpha:0/);
    });

    it('keeps alternatives with the same sensor independent by detector index', () => {
        const sameSensor: CoverageContract = {
            schemaVersion: 1,
            classes: {
                config: {
                    description: 'Project configuration',
                    detectors: [{ sensor: 'lint' }, { sensor: 'lint' }],
                    remedy: { summary: 'Add config', command: 'touch eslint.config.js' },
                },
            },
        };

        const result = evaluateCoverage(sameSensor, [
            observation('config', 0, 'lint', 'ineffective'),
            observation('config', 1, 'lint', 'covered'),
        ]);

        expect(result.classes[0].status).toBe('covered');
        expect(result.classes[0].detectors).toHaveLength(2);
    });
});
