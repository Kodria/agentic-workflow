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

test('human output never renders raw detector commands, markers, or file contents', () => {
    const unsafeReport = {
        ...report,
        static: {
            ...report.static,
            classes: [{ ...report.static.classes[0], detectors: [{
                sensor: 'format', status: 'missing' as const,
                evidence: [{ kind: 'marker' as const, path: '.prettierrc', ordinal: 1, status: 'missing' as const,
                    command: 'prettier --token TOP_SECRET_TOKEN', marker: 'TOP_SECRET_TOKEN', content: 'TOP_SECRET_TOKEN' }],
            }] }],
        },
    };
    const human = renderCoverageHuman(unsafeReport);
    expect(human).not.toContain('TOP_SECRET_TOKEN');
    expect(human).not.toContain('prettier --token');
    expect(human).not.toContain('marker:');
});
