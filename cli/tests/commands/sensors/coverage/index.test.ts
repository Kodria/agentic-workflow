import { runCoverage } from '../../../../src/commands/sensors/coverage';

test('not configured is explicit, actionable and exit-0 data', () => {
    expect(runCoverage('/fixture', { resolve: () => ({ kind: 'not_configured' }) })).toEqual({
        schemaVersion: 1, pack: null, registry: null, overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'not_configured', classes: [] },
    });
});

test('old pack is no_reference and preserves pack and registry', () => {
    const manifest = { pack: 'legacy', sensors: {} };
    expect(runCoverage('/fixture', { resolve: () => ({ kind: 'no_reference', projectRoot: '/fixture', pack: 'legacy', registry: 'baseline', manifest }) }))
        .toEqual({ schemaVersion: 1, pack: 'legacy', registry: 'baseline', overall: 'inconclusive',
            static: { status: 'inconclusive', reason: 'no_reference', classes: [] } });
});

test('ready input observes every declared detector and evaluates once', () => {
    const manifest = { pack: 'js-ts', sensors: { lint: { cmd: 'eslint .' }, format: { cmd: 'prettier --check .' } } };
    const contract = { schemaVersion: 1 as const, classes: {
        formatting: { description: 'Formatting', detectors: [{ sensor: 'format' }], remedy: { summary: 'Add format', command: 'npm i -D prettier' } },
        linting: { description: 'Linting', detectors: [{ sensor: 'lint' }], remedy: { summary: 'Add lint', command: 'npm i -D eslint' } },
    } };
    const observe = jest.fn((_root, classId, detectorIndex, detector) => ({
        classId, detectorIndex, sensor: detector.sensor, status: 'covered' as const, evidence: [],
    }));
    const out = runCoverage('/fixture', { resolve: () => ({ kind: 'ready', projectRoot: '/fixture', pack: 'js-ts', registry: 'baseline', manifest, contract }), observe });
    expect(observe.mock.calls.map((call) => [call[1], call[2]])).toEqual([['formatting', 0], ['linting', 0]]);
    expect(out.static.classes.map((item) => item.id)).toEqual(['formatting', 'linting']);
    expect(out.overall).toBe('covered');
    expect(out).not.toHaveProperty('empirical');
});
