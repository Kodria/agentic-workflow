import type { CoverageEnvelope } from '.';

const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
const OVERALL = ['covered', 'gaps', 'inconclusive'];
const CLASS_STATUS = ['covered', 'missing', 'unverifiable'];
const DETECTOR_STATUS = ['covered', 'missing', 'disabled', 'ineffective', 'unverifiable'];
const REASON = ['not_configured', 'no_reference'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf(value: unknown, options: readonly string[]): boolean {
    return typeof value === 'string' && options.includes(value);
}

function invalidReport(renderer: string): never {
    throw new Error(`${renderer}: invalid report`);
}

function assertString(value: unknown, renderer: string): asserts value is string {
    if (typeof value !== 'string') invalidReport(renderer);
}

function assertCoverageEnvelope(report: unknown, renderer: string): asserts report is CoverageEnvelope {
    if (!isRecord(report) || report.schemaVersion !== 1
        || !(report.pack === null || typeof report.pack === 'string')
        || !(report.registry === null || typeof report.registry === 'string')
        || !isOneOf(report.overall, OVERALL) || !isRecord(report.static)) {
        invalidReport(renderer);
    }

    const staticReport = report.static;
    if (!isOneOf(staticReport.status, OVERALL)
        || !(staticReport.reason === null || isOneOf(staticReport.reason, REASON))
        || !Array.isArray(staticReport.classes)) {
        invalidReport(renderer);
    }

    for (const coverageClass of staticReport.classes) {
        if (!isRecord(coverageClass) || !isOneOf(coverageClass.status, CLASS_STATUS) || !Array.isArray(coverageClass.detectors)
            || !isRecord(coverageClass.remedy)) {
            invalidReport(renderer);
        }
        assertString(coverageClass.id, renderer);
        assertString(coverageClass.description, renderer);
        assertString(coverageClass.remedy.summary, renderer);
        assertString(coverageClass.remedy.command, renderer);
        for (const detector of coverageClass.detectors) {
            if (!isRecord(detector) || !isOneOf(detector.status, DETECTOR_STATUS) || !Array.isArray(detector.evidence)) {
                invalidReport(renderer);
            }
            assertString(detector.sensor, renderer);
        }
    }
}

function safeHumanText(value: string): string {
    return value.replace(OSC, '').replace(ANSI, '').replace(CONTROLS, ' ');
}

export function renderCoverageJson(report: unknown): string {
    assertCoverageEnvelope(report, 'renderCoverageJson');
    return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderCoverageHuman(report: unknown): string {
    assertCoverageEnvelope(report, 'renderCoverageHuman');
    if (report.static.reason === 'not_configured') {
        return ['Sensor coverage', 'Overall: inconclusive', 'Reason: sensors are not configured', 'Run: awm sensors init', ''].join('\n');
    }
    if (report.static.reason === 'no_reference') {
        return ['Sensor coverage', `Pack: ${safeHumanText(report.pack ?? 'unknown')}`, `Registry: ${safeHumanText(report.registry ?? 'unknown')}`,
            'Overall: inconclusive', `No coverage reference for pack '${safeHumanText(report.pack ?? 'unknown')}'`, ''].join('\n');
    }

    const lines = ['Sensor coverage', `Pack: ${safeHumanText(report.pack ?? 'unknown')}`, `Registry: ${safeHumanText(report.registry ?? 'unknown')}`,
        `Overall: ${report.overall}`, ''];
    for (const item of report.static.classes.filter((entry) => entry.status !== 'covered')) {
        lines.push(`${item.status} ${safeHumanText(item.id)} — ${safeHumanText(item.description)}`);
        item.detectors.forEach((detector) => lines.push(`  detector: ${safeHumanText(detector.sensor)} (${detector.status})`));
        lines.push(`  remedy: ${safeHumanText(item.remedy.summary)}`, `  command: ${safeHumanText(item.remedy.command)}`);
    }
    const count = (status: 'covered' | 'missing' | 'unverifiable') => report.static.classes.filter((item) => item.status === status).length;
    lines.push('', `Summary: ${count('covered')} covered, ${count('missing')} missing, ${count('unverifiable')} unverifiable`, '');
    return lines.join('\n');
}
