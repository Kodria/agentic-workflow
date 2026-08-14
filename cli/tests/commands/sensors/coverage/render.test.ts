import { renderCoverageHuman, renderCoverageJson } from '../../../../src/commands/sensors/coverage/render';
import { evaluateEmpiricalCoverage } from '../../../../src/commands/sensors/coverage/empirical';

const report = {
    schemaVersion: 2 as const, pack: 'js-ts', registry: 'baseline', overall: 'gaps' as const,
    static: { status: 'gaps' as const, reason: null, classes: [
        { id: 'formatting', description: 'Formatting', status: 'missing' as const,
            detectors: [{ sensor: 'format', status: 'missing' as const, evidence: [], compatibility: { state: 'missing-tool' as const, reason: 'fixture', variantId: null, toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [] } }],
            remedy: { summary: 'Add formatter', command: 'npm i -D prettier' } },
        { id: 'style', description: 'Style', status: 'unverifiable' as const,
            detectors: [{ sensor: 'lint', status: 'unverifiable' as const, evidence: [{ kind: 'command' as const, status: 'custom' as const }], compatibility: { state: 'unverifiable' as const, reason: 'fixture', variantId: null, toolVersion: null, runtimeVersion: null, certifiedRange: null, evidence: [] } }],
            remedy: { summary: 'Declare evidence', command: 'awm sensors init' } },
    ] },
};

const empiricalEvidence = {
    recurrenceThreshold: 2, status: 'evidence' as const,
    classes: [{ defectClass: 'lint-errors', occurrences: 1, recurrent: false, severity: 'important' as const, outcome: 'gap' as const, evidenceRefs: ['src/a.ts:1'], omittedEvidenceRefs: 0 }],
    unclassified: { occurrences: 0, evidenceRefs: [], omittedEvidenceRefs: 0 },
    sources: { activeFiles: 1, archivedFiles: 0, validEntries: 1, validFindings: 1, skippedFindings: 0, skippedByReason: {} },
    omittedEvidenceRefs: 0,
};

test('human output shows every non-green class, remedy and totals without raw evidence (R2.8)', () => {
    const human = renderCoverageHuman(report);
    expect(human).toBe([
        'Sensor coverage', 'Pack: js-ts', 'Registry: baseline', 'Overall: gaps', '',
        'missing formatting — Formatting', '  detector: format (missing)', '  compatibility: missing-tool — fixture', '  remedy: Add formatter', '  command: npm i -D prettier',
        'unverifiable style — Style', '  detector: lint (unverifiable)', '  compatibility: unverifiable — fixture', '  remedy: Declare evidence', '  command: awm sensors init', '',
        'Summary: 0 covered, 1 missing, 1 unverifiable, 0 not applicable', '',
    ].join('\n'));
    expect(human).not.toContain('commandIncludes');
    expect(human).not.toContain('custom');
});

test('human output explains an incompatible detector even when its structural evidence is covered (R3.3)', () => {
    const compatibility = {
        state: 'incompatible' as const,
        reason: 'installed eslint version is outside the certified range',
        variantId: 'eslint-v9',
        toolVersion: '10.0.0',
        runtimeVersion: null,
        certifiedRange: '^9.0.0',
        evidence: [],
    };
    const incompatible = {
        ...report,
        static: {
            ...report.static,
            classes: [{
                ...report.static.classes[0],
                detectors: [{
                    ...report.static.classes[0].detectors[0],
                    status: 'covered' as const,
                    compatibility,
                }],
            }],
        },
    };

    const human = renderCoverageHuman(incompatible);

    expect(human).toContain('  detector: format (covered)');
    expect(human).toContain('  compatibility: incompatible — installed eslint version is outside the certified range');
});

test('json is the exact versioned envelope and ends in newline (R2.8, R2.14)', () => {
    expect(renderCoverageJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
});

test('keeps the R2 static shape when an optional empirical section is added (R2.14)', () => {
    const extended = { ...report, empirical: {
        recurrenceThreshold: 2, status: 'partial', classes: [{ defectClass: 'lint-errors', occurrences: 1, recurrent: false, severity: 'important', outcome: 'gap', evidenceRefs: ['src/a.ts:1'], omittedEvidenceRefs: 0 }],
        unclassified: { occurrences: 1, evidenceRefs: [], omittedEvidenceRefs: 1 },
        sources: { activeFiles: 1, archivedFiles: 0, validEntries: 2, validFindings: 2, skippedFindings: 1, skippedByReason: { 'invalid-json': 1 } }, omittedEvidenceRefs: 1,
    } };
    const parsed = JSON.parse(renderCoverageJson(extended));
    expect(parsed.static).toEqual(report.static);
    expect(parsed.empirical).toEqual(extended.empirical);
    expect(parsed.schemaVersion).toBe(2);
});

test('renders sanitized empirical outcomes without ledger descriptions or signatures', () => {
    const empirical = {
        recurrenceThreshold: 2, status: 'partial', classes: [{ defectClass: 'lint-errors', occurrences: 1, recurrent: false, severity: 'important', outcome: 'gap', evidenceRefs: ['PR #2'], omittedEvidenceRefs: 0 }],
        unclassified: { occurrences: 1, evidenceRefs: [], omittedEvidenceRefs: 1 },
        sources: { activeFiles: 1, archivedFiles: 0, validEntries: 2, validFindings: 2, skippedFindings: 1, skippedByReason: { 'invalid-json': 1 } }, omittedEvidenceRefs: 1,
    };
    const human = renderCoverageHuman({ ...report, empirical });
    expect(human).toContain('Empirical coverage: partial');
    expect(human).toContain('gap lint-errors — 1 occurrence');
    expect(human).toContain('below recurrence threshold (2)');
    expect(human).toContain('PR #2');
    expect(human).not.toContain('signature');
    expect(human).not.toContain('desc');
});

test('renders a report generated with both invalid and scanner-omitted evidence refs', () => {
    const empirical = evaluateEmpiricalCoverage({
        entries: [{ entry: { ts: '2026-08-14', branch: 'main', phase: 'qa', source_skill: 'test', polarity: 'finding', class: 'structural', signature: 'private', severity: 'important', desc: 'secret', defectClass: 'lint-errors' }, source: '.awm/ledger/main.jsonl:1', evidenceRef: 'not an allowed ref' }],
        sources: { activeFiles: 1, archivedFiles: 0, validEntries: 1, validFindings: 1, skippedFindings: 3, skippedByReason: { 'evidence-ref-limit': 3 } }, omittedEvidenceRefs: 3,
    }, { 'lint-errors': 'missing' }, 2);

    expect(() => renderCoverageJson({ ...report, empirical })).not.toThrow();
    expect(renderCoverageHuman({ ...report, empirical })).toContain('omitted evidence refs: 4');
});

test('renders recurrence emphasis and rejects the retired complete empirical state', () => {
    const empirical = {
        recurrenceThreshold: 2, status: 'evidence', classes: [{ defectClass: 'lint-errors', occurrences: 2, recurrent: true, severity: 'important', outcome: 'gap', evidenceRefs: [], omittedEvidenceRefs: 0 }],
        unclassified: { occurrences: 0, evidenceRefs: [], omittedEvidenceRefs: 0 },
        sources: { activeFiles: 1, archivedFiles: 0, validEntries: 2, validFindings: 2, skippedFindings: 0, skippedByReason: {} }, omittedEvidenceRefs: 0,
    };
    expect(renderCoverageHuman({ ...report, empirical })).toContain('recurrent at threshold 2');
    expect(() => renderCoverageJson({ ...report, empirical: { ...empirical, status: 'complete' } })).toThrow('invalid report');
});

test.each([
    ['a recurrence flag that disagrees with its threshold', {
        ...empiricalEvidence,
        classes: [{ ...empiricalEvidence.classes[0], recurrent: true }],
    }],
    ['a skipped finding total that disagrees with its reason totals', {
        ...empiricalEvidence,
        status: 'partial' as const,
        sources: { ...empiricalEvidence.sources, skippedFindings: 2, skippedByReason: { 'invalid-json': 1 } },
    }],
    ['an omitted evidence total that disagrees with its component omissions', {
        ...empiricalEvidence,
        status: 'partial' as const,
        sources: { ...empiricalEvidence.sources, skippedFindings: 1, skippedByReason: { 'evidence-ref-limit': 1 } },
    }],
    ['evidence status when findings were skipped', {
        ...empiricalEvidence,
        sources: { ...empiricalEvidence.sources, skippedFindings: 1, skippedByReason: { 'invalid-json': 1 } },
    }],
    ['partial status without any incomplete evidence', {
        ...empiricalEvidence,
        status: 'partial' as const,
    }],
    ['no-evidence status with a valid finding', {
        ...empiricalEvidence,
        status: 'no-evidence' as const,
    }],
    ['inconclusive status with a valid finding', {
        ...empiricalEvidence,
        status: 'inconclusive' as const,
    }],
])('renderers reject an empirical envelope with %s', (_case, empirical) => {
    for (const render of [renderCoverageJson, renderCoverageHuman]) {
        expect(() => render({ ...report, empirical })).toThrow(/^renderCoverage(?:Json|Human): invalid report/);
    }
});

test('not_configured names the remedy and no_reference stays distinct (R2.6)', () => {
    const notConfigured = { schemaVersion: 2 as const, pack: null, registry: null, overall: 'inconclusive' as const,
        static: { status: 'inconclusive' as const, reason: 'not_configured' as const, classes: [] } };
    expect(renderCoverageHuman(notConfigured)).toContain('Run: awm sensors init');
    expect(renderCoverageHuman({ ...notConfigured, pack: 'legacy', registry: 'baseline', static: { ...notConfigured.static, reason: 'no_reference' as const } }))
        .toContain('No coverage reference');
});

test('human output never renders structured detector evidence', () => {
    const evidenceReport = {
        ...report,
        static: {
            ...report.static,
            classes: [{ ...report.static.classes[0], detectors: [{
                sensor: 'format', status: 'missing' as const,
                evidence: [
                    { kind: 'command' as const, status: 'matched' as const },
                    { kind: 'file' as const, path: '.prettierrc', status: 'matched' as const },
                    { kind: 'marker' as const, path: '.prettierrc', ordinal: 1, status: 'missing' as const },
                ],
                compatibility: report.static.classes[0].detectors[0].compatibility,
            }] }],
        },
    };
    const human = renderCoverageHuman(evidenceReport);
    expect(human).not.toContain('.prettierrc');
    expect(human).not.toContain('marker');
    expect(human).not.toContain('matched');
});

test('human output removes OSC controls from pack-provided text while retaining printable text', () => {
    const osc8Open = '\x1B]8;;https://attacker.invalid\x07';
    const osc8Close = '\x1B]8;;\x07';
    const hostile = {
        ...report,
        static: {
            ...report.static,
            classes: [{
                ...report.static.classes[0],
                description: `${osc8Open}Formatting${osc8Close}`,
                remedy: { summary: `Add ${osc8Open}formatter${osc8Close}`, command: 'npm i -D prettier' },
                detectors: [{
                    ...report.static.classes[0].detectors[0],
                    compatibility: {
                        ...report.static.classes[0].detectors[0].compatibility,
                        reason: `tool ${osc8Open}version${osc8Close} is unsupported`,
                    },
                }],
            }],
        },
    };

    const human = renderCoverageHuman(hostile);
    expect(human).toContain('missing formatting — Formatting');
    expect(human).toContain('  remedy: Add formatter');
    expect(human).toContain('  compatibility: missing-tool — tool version is unsupported');
    expect(human.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
});

test.each([
    ['non-string pack', { ...report, pack: 42 }],
    ['malformed class detectors', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], detectors: null }] } }],
    ['unknown static reason', { ...report, static: { ...report.static, reason: 'other' } }],
    ['unknown top-level field', { ...report, extra: true }],
    ['unknown class field', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], extra: true }] } }],
    ['unknown evidence field', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], detectors: [{
        ...report.static.classes[0].detectors[0], evidence: [{ kind: 'command', status: 'matched', command: 'secret' }],
    }] }] } }],
    ['malformed marker evidence', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], detectors: [{
        ...report.static.classes[0].detectors[0], evidence: [{ kind: 'marker', path: '.prettierrc', ordinal: 0, status: 'matched' }],
    }] }] } }],
    ['mismatched static and overall status', { ...report, static: { ...report.static, status: 'covered' } }],
    ['covered class whose detectors are all missing', {
        ...report,
        static: { ...report.static, classes: [{ ...report.static.classes[0], status: 'covered' }] },
    }],
    ['missing class with an unverifiable detector and no covered detector', {
        ...report,
        static: { ...report.static, classes: [{
            ...report.static.classes[0],
            detectors: [{ ...report.static.classes[0].detectors[0], status: 'unverifiable' }],
        }] },
    }],
    ['gaps overall when every class is covered', {
        ...report,
        static: {
            ...report.static,
            classes: report.static.classes.map((coverageClass) => ({
                ...coverageClass,
                status: 'covered' as const,
                detectors: coverageClass.detectors.map((detector) => ({ ...detector, status: 'covered' as const })),
            })),
        },
    }],
    ['not_configured with resolved pack and registry', {
        schemaVersion: 1, pack: 'js-ts', registry: 'baseline', overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'not_configured', classes: [] },
    }],
    ['not_configured with classes', {
        schemaVersion: 1, pack: null, registry: null, overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'not_configured', classes: [report.static.classes[0]] },
    }],
    ['no_reference without resolved registry', {
        schemaVersion: 1, pack: 'js-ts', registry: null, overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'no_reference', classes: [] },
    }],
    ['no_reference with classes', {
        schemaVersion: 1, pack: 'js-ts', registry: 'baseline', overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'no_reference', classes: [report.static.classes[0]] },
    }],
    ['normal coverage without a pack', { ...report, pack: null }],
    ['normal coverage without classes', { ...report, static: { ...report.static, classes: [] } }],
    ['blank pack', { ...report, pack: '  ' }],
    ['blank registry', { ...report, registry: '' }],
    ['blank class id', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], id: ' ' }] } }],
    ['blank class description', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], description: '' }] } }],
    ['blank remedy summary', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], remedy: { ...report.static.classes[0].remedy, summary: ' ' } }] } }],
    ['blank remedy command', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], remedy: { ...report.static.classes[0].remedy, command: '' } }] } }],
    ['empty class detectors', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], detectors: [] }] } }],
    ['blank detector sensor', { ...report, static: { ...report.static, classes: [{ ...report.static.classes[0], detectors: [{ ...report.static.classes[0].detectors[0], sensor: ' ' }] }] } }],
    ['duplicate class ids', { ...report, static: { ...report.static, classes: [report.static.classes[0], { ...report.static.classes[1], id: report.static.classes[0].id }] } }],
    ['unsorted class ids', { ...report, static: { ...report.static, classes: [...report.static.classes].reverse() } }],
])('renderers reject a malformed envelope with %s before emitting or dereferencing fields', (_case, malformed) => {
    for (const render of [renderCoverageJson, renderCoverageHuman]) {
        expect(() => render(malformed as never)).toThrow(/^renderCoverage(?:Json|Human): invalid report/);
    }
});
