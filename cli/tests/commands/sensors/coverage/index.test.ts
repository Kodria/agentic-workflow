import { runCoverage } from '../../../../src/commands/sensors/coverage';

test('not configured is explicit, actionable and exit-0 data', async () => {
    await expect(runCoverage('/fixture', { resolve: () => ({ kind: 'not_configured' }), scan: () => ({
        entries: [], sources: { activeFiles: 0, archivedFiles: 0, validEntries: 0, validFindings: 0, skippedFindings: 0, skippedByReason: {} }, omittedEvidenceRefs: 0,
    }) })).resolves.toEqual({
        schemaVersion: 2, pack: null, registry: null, overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'not_configured', classes: [] },
        empirical: expect.objectContaining({ status: 'no-evidence' }),
    });
});

test('unavailable static contracts make empirical findings coverage-unverifiable', async () => {
    const scan = {
        entries: [{ entry: { ts: 'x', branch: 'main', phase: 'qa', source_skill: 'test', polarity: 'finding' as const,
            class: 'structural' as const, signature: 'private', severity: 'minor' as const, desc: 'secret', defectClass: 'lint-errors' }, source: '.awm/ledger/main.jsonl:1', evidenceRef: '.awm/ledger/main.jsonl:1' }],
        sources: { activeFiles: 1, archivedFiles: 0, validEntries: 1, validFindings: 1, skippedFindings: 0, skippedByReason: {} }, omittedEvidenceRefs: 0,
    };

    const notConfigured = await runCoverage('/fixture', { resolve: () => ({ kind: 'not_configured' }), scan: () => scan });
    expect(notConfigured.empirical?.classes[0].outcome).toBe('coverage-unverifiable');

    const manifest = { kind: 'legacy' as const, pack: { pack: 'legacy', sensors: {}, compatibility: {
        state: 'compatible-unverified' as const, reason: 'legacy', variantId: null, toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [],
    } } };
    const noReference = await runCoverage('/fixture', { resolve: () => ({ kind: 'no_reference' as const, projectRoot: '/fixture', pack: 'legacy', registry: 'baseline', manifest }), scan: () => scan });
    expect(noReference.empirical?.classes[0].outcome).toBe('coverage-unverifiable');
});

test('old pack is no_reference and preserves pack and registry', async () => {
    const manifest = { kind: 'legacy' as const, pack: { pack: 'legacy', sensors: {}, compatibility: {
        state: 'compatible-unverified' as const, reason: 'legacy', variantId: null, toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [],
    } } };
    await expect(runCoverage('/fixture', { resolve: () => ({ kind: 'no_reference', projectRoot: '/fixture', pack: 'legacy', registry: 'baseline', manifest }), scan: () => ({
        entries: [{ entry: { ts: 'x', branch: 'main', phase: 'qa', source_skill: 'test', polarity: 'finding', class: 'structural', signature: 'private', severity: 'minor', desc: 'secret', defectClass: 'lint-errors' }, source: '.awm/ledger/main.jsonl:1', evidenceRef: '.awm/ledger/main.jsonl:1' }],
        sources: { activeFiles: 1, archivedFiles: 0, validEntries: 1, validFindings: 1, skippedFindings: 0, skippedByReason: {} }, omittedEvidenceRefs: 0,
    }) }))
        .resolves.toEqual({ schemaVersion: 2, pack: 'legacy', registry: 'baseline', overall: 'inconclusive',
            static: { status: 'inconclusive', reason: 'no_reference', classes: [] },
            empirical: expect.objectContaining({ status: 'evidence', classes: [expect.objectContaining({ outcome: 'coverage-unverifiable' })] }) });
});

test('ready input observes every declared detector and evaluates once', async () => {
    const manifest = { kind: 'legacy' as const, pack: { pack: 'js-ts', sensors: { lint: { cmd: 'eslint .' }, format: { cmd: 'prettier --check .' } }, compatibility: {
        state: 'compatible-unverified' as const, reason: 'legacy', variantId: null, toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [],
    } } };
    const contract = { schemaVersion: 1 as const, classes: {
        formatting: { description: 'Formatting', detectors: [{ sensor: 'format' }], remedy: { summary: 'Add format', command: 'npm i -D prettier' } },
        linting: { description: 'Linting', detectors: [{ sensor: 'lint' }], remedy: { summary: 'Add lint', command: 'npm i -D eslint' } },
    } };
    const observe = jest.fn((_root, classId, detectorIndex, detector) => ({
        classId, detectorIndex, sensor: detector.sensor, status: 'covered' as const, evidence: [],
    }));
    const out = await runCoverage('/fixture', { resolve: () => ({ kind: 'ready', projectRoot: '/fixture', pack: 'js-ts', registry: 'baseline', manifest, contract }), observe, scan: () => ({
        entries: [], sources: { activeFiles: 0, archivedFiles: 0, validEntries: 0, validFindings: 0, skippedFindings: 0, skippedByReason: {} }, omittedEvidenceRefs: 0,
    }) });
    expect(observe.mock.calls.map((call) => [call[1], call[2]])).toEqual([['formatting', 0], ['linting', 0]]);
    expect(out.static.classes.map((item) => item.id)).toEqual(['formatting', 'linting']);
    expect(out.overall).toBe('inconclusive');
    expect(out.empirical).toMatchObject({ status: 'no-evidence' });
});
