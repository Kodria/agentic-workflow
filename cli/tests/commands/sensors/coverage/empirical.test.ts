import { evaluateEmpiricalCoverage, outcomeFor } from '../../../../src/commands/sensors/coverage/empirical';
import type { LedgerScanResult } from '../../../../src/core/ledger/scan';

const finding = (defectClass: string | undefined, signature: string, ref: string, severity: 'blocker' | 'important' | 'minor' | 'info' = 'minor') => ({
    entry: { ts: '2026-08-14', branch: 'main', phase: 'qa', source_skill: 'test', polarity: 'finding' as const,
        class: 'structural' as const, signature, severity, desc: 'private ledger description', ...(defectClass ? { defectClass } : {}) },
    source: ref,
    evidenceRef: ref,
});

const scanOf = (entries: ReturnType<typeof finding>[]) => ({
    entries,
    sources: { activeFiles: 1, archivedFiles: 0, validEntries: entries.length, validFindings: entries.length, skippedFindings: 0, skippedByReason: {} },
    omittedEvidenceRefs: 0,
});

test('distinguishes evidence, partial, no-evidence and inconclusive ledger states (R5.11)', () => {
    const valid = scanOf([finding('lint-errors', 'valid', 'src/a.ts:1')]);
    expect(evaluateEmpiricalCoverage(valid, { 'lint-errors': 'covered' }, 2).status).toBe('evidence');
    expect(evaluateEmpiricalCoverage({ ...valid, sources: { ...valid.sources, skippedFindings: 1, skippedByReason: { 'invalid-json': 1 } } }, { 'lint-errors': 'covered' }, 2).status).toBe('partial');
    expect(evaluateEmpiricalCoverage(scanOf([]), {}, 2).status).toBe('no-evidence');
    expect(evaluateEmpiricalCoverage({ ...scanOf([]), sources: { activeFiles: 1, archivedFiles: 0, validEntries: 0, validFindings: 0, skippedFindings: 1, skippedByReason: { 'invalid-json': 1 } } }, {}, 2).status).toBe('inconclusive');
});

test('clusters only inside defectClass and keeps singles below min (R5.4, R5.6)', () => {
    const report = evaluateEmpiricalCoverage(scanOf([
        finding('lint-errors', 'same-signature', 'a.ts:1'),
        finding('static-type-errors', 'same-signature', 'b.ts:1'),
    ]), { 'lint-errors': 'covered', 'static-type-errors': 'covered' }, 2);
    expect(report.classes).toHaveLength(2);
    expect(report.classes.every((item) => item.occurrences === 1 && item.recurrent === false)).toBe(true);
});

test.each([
    ['covered', 'covered-by-sensor'], ['missing', 'gap'], ['incompatible', 'gap'],
    ['missing-tool', 'gap'], ['unverifiable', 'coverage-unverifiable'],
    ['compatible-unverified', 'coverage-unverifiable'], ['not-applicable', 'applicability-contradiction'],
] as const)('crosses %s to %s (R5.9)', (staticState, outcome) => {
    expect(outcomeFor(staticState, true)).toBe(outcome);
});

test('maps a valid defect class absent from the static contract to unmapped-class (R5.12)', () => {
    expect(outcomeFor(undefined, true)).toBe('unmapped-class');
    expect(evaluateEmpiricalCoverage(scanOf([finding('legacy-lint', 'legacy', 'src/a.ts:1')]), {}, 2).classes[0].outcome)
        .toBe('unmapped-class');
});

test('changes recurrence emphasis and stable ordering when --min changes (R5.13)', () => {
    const entries = scanOf([
        { ...finding('lint-errors', 'solo-orange', 'src/a.ts:1'), entry: { ...finding('lint-errors', 'solo-orange', 'src/a.ts:1').entry, desc: 'orchard fruit gamma' } },
        { ...finding('lint-errors', 'repeat-protocol', 'src/b.ts:1'), entry: { ...finding('lint-errors', 'repeat-protocol', 'src/b.ts:1').entry, desc: 'network handshake delta' } },
        { ...finding('lint-errors', 'repeat-protocol', 'src/b.ts:2'), entry: { ...finding('lint-errors', 'repeat-protocol', 'src/b.ts:2').entry, desc: 'network handshake delta' } },
    ]);
    const minTwo = evaluateEmpiricalCoverage(entries, { 'lint-errors': 'covered' }, 2);
    const minThree = evaluateEmpiricalCoverage(entries, { 'lint-errors': 'covered' }, 3);
    expect(minTwo.recurrenceThreshold).toBe(2);
    expect(minTwo.classes.map((item) => [item.occurrences, item.recurrent])).toEqual([[2, true], [1, false]]);
    expect(minThree.recurrenceThreshold).toBe(3);
    expect(minThree.classes.map((item) => [item.occurrences, item.recurrent])).toEqual([[2, false], [1, false]]);
    expect(JSON.stringify(minTwo)).not.toEqual(JSON.stringify(minThree));
});

test('does not infer a missing class from text and never emits description or signature (R5.3, R5.10)', () => {
    const report = evaluateEmpiricalCoverage(scanOf([finding(undefined, 'secret-signature', 'src/a.ts:2')]), { 'lint-errors': 'covered' }, 2);
    expect(report.unclassified.occurrences).toBe(1);
    expect(report.classes).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('private ledger description');
    expect(JSON.stringify(report)).not.toContain('secret-signature');
});

test('sanitizes, deduplicates and bounds allowed evidence refs (R5.7, R5.8)', () => {
    const report = evaluateEmpiricalCoverage(scanOf([
        finding('lint-errors', 'a', '\u001b]8;;https://evil\u0007src/z.ts:8'),
        finding('lint-errors', 'b', 'PR #12', 'blocker'),
        finding('lint-errors', 'c', 'PR #12'),
        finding('lint-errors', 'd', 'not an allowed ref'),
    ]), { 'lint-errors': 'missing' }, 1);
    expect(report.classes[0]).toMatchObject({ outcome: 'gap', severity: 'blocker', evidenceRefs: ['PR #12', 'src/z.ts:8'], omittedEvidenceRefs: 1 });
    expect(JSON.stringify(report)).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
});

test('does not double-count scanner-truncated evidence refs', () => {
    const scan = { ...scanOf([finding('lint-errors', 'a', 'src/a.ts:1')]),
        entries: [{ ...finding('lint-errors', 'a', 'src/a.ts:1'), evidenceRef: null }], omittedEvidenceRefs: 1 } as LedgerScanResult;
    const report = evaluateEmpiricalCoverage(scan, { 'lint-errors': 'covered' }, 2);
    expect(report.omittedEvidenceRefs).toBe(1);
});
