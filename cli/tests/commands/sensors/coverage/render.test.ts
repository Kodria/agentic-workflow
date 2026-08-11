import { renderCoverageHuman, renderCoverageJson } from '../../../../src/commands/sensors/coverage/render';

const report = {
    schemaVersion: 1 as const, pack: 'js-ts', registry: 'baseline', overall: 'gaps' as const,
    static: { status: 'gaps' as const, reason: null, classes: [
        { id: 'formatting', description: 'Formatting', status: 'missing' as const,
            detectors: [{ sensor: 'format', status: 'missing' as const, evidence: [] }],
            remedy: { summary: 'Add formatter', command: 'npm i -D prettier' } },
        { id: 'style', description: 'Style', status: 'unverifiable' as const,
            detectors: [{ sensor: 'lint', status: 'unverifiable' as const, evidence: [{ kind: 'command' as const, status: 'custom' as const }] }],
            remedy: { summary: 'Declare evidence', command: 'awm sensors init' } },
    ] },
};

test('human output shows every non-green class, remedy and totals without raw evidence (R2.8)', () => {
    const human = renderCoverageHuman(report);
    expect(human).toBe([
        'Sensor coverage', 'Pack: js-ts', 'Registry: baseline', 'Overall: gaps', '',
        'missing formatting — Formatting', '  detector: format (missing)', '  remedy: Add formatter', '  command: npm i -D prettier',
        'unverifiable style — Style', '  detector: lint (unverifiable)', '  remedy: Declare evidence', '  command: awm sensors init', '',
        'Summary: 0 covered, 1 missing, 1 unverifiable', '',
    ].join('\n'));
    expect(human).not.toContain('commandIncludes');
    expect(human).not.toContain('custom');
});

test('json is the exact versioned envelope and ends in newline (R2.8, R2.14)', () => {
    expect(renderCoverageJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
});

test('keeps the R2 static shape when an optional empirical section is added (R2.14)', () => {
    const extended = { ...report, empirical: { status: 'no_evidence' } };
    const parsed = JSON.parse(renderCoverageJson(extended));
    expect(parsed.static).toEqual(report.static);
    expect(parsed.empirical).toEqual({ status: 'no_evidence' });
    expect(parsed.schemaVersion).toBe(1);
});

test('not_configured names the remedy and no_reference stays distinct (R2.6)', () => {
    const notConfigured = { schemaVersion: 1 as const, pack: null, registry: null, overall: 'inconclusive' as const,
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
            }],
        },
    };

    const human = renderCoverageHuman(hostile);
    expect(human).toContain('missing formatting — Formatting');
    expect(human).toContain('  remedy: Add formatter');
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
