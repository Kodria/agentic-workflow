import type { CoverageEnvelope } from '.';

const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
const OVERALL = ['covered', 'gaps', 'inconclusive'];
const CLASS_STATUS = ['covered', 'missing', 'unverifiable'];
const DETECTOR_STATUS = ['covered', 'missing', 'disabled', 'ineffective', 'unverifiable'];
const REASON = ['not_configured', 'no_reference'];
const COMMAND_EVIDENCE_STATUS = ['matched', 'custom', 'missing'];
const FILE_EVIDENCE_STATUS = ['matched', 'missing', 'unverifiable'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf(value: unknown, options: readonly string[]): boolean {
    return typeof value === 'string' && options.includes(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
    const keys = Object.keys(value);
    return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function invalidReport(renderer: string): never {
    throw new Error(`${renderer}: invalid report`);
}

function assertString(value: unknown, renderer: string): asserts value is string {
    if (typeof value !== 'string') invalidReport(renderer);
}

function assertEvidence(evidence: unknown, renderer: string): void {
    if (!Array.isArray(evidence)) invalidReport(renderer);
    for (const item of evidence) {
        if (!isRecord(item)) invalidReport(renderer);
        if (item.kind === 'command') {
            if (!hasExactFields(item, ['kind', 'status']) || !isOneOf(item.status, COMMAND_EVIDENCE_STATUS)) invalidReport(renderer);
        } else if (item.kind === 'file') {
            if (!hasExactFields(item, ['kind', 'path', 'status']) || !isNonBlankString(item.path)
                || !isOneOf(item.status, FILE_EVIDENCE_STATUS)) invalidReport(renderer);
        } else if (item.kind === 'marker') {
            if (!hasExactFields(item, ['kind', 'path', 'ordinal', 'status']) || !isNonBlankString(item.path)
                || typeof item.ordinal !== 'number' || !Number.isSafeInteger(item.ordinal) || item.ordinal <= 0
                || !isOneOf(item.status, FILE_EVIDENCE_STATUS)) invalidReport(renderer);
        } else {
            invalidReport(renderer);
        }
    }
}

function assertCoverageEnvelope(report: unknown, renderer: string): asserts report is CoverageEnvelope {
    if (!isRecord(report) || !hasExactFields(report, 'empirical' in report
        ? ['schemaVersion', 'pack', 'registry', 'overall', 'static', 'empirical']
        : ['schemaVersion', 'pack', 'registry', 'overall', 'static']) || report.schemaVersion !== 1
        || !(report.pack === null || typeof report.pack === 'string')
        || !(report.registry === null || typeof report.registry === 'string')
        || !isOneOf(report.overall, OVERALL) || !isRecord(report.static)) {
        invalidReport(renderer);
    }

    const staticReport = report.static;
    if (!hasExactFields(staticReport, ['status', 'reason', 'classes']) || !isOneOf(staticReport.status, OVERALL)
        || !(staticReport.reason === null || isOneOf(staticReport.reason, REASON))
        || !Array.isArray(staticReport.classes)) {
        invalidReport(renderer);
    }

    for (const coverageClass of staticReport.classes) {
        if (!isRecord(coverageClass) || !hasExactFields(coverageClass, ['id', 'description', 'status', 'detectors', 'remedy'])
            || !isOneOf(coverageClass.status, CLASS_STATUS) || !Array.isArray(coverageClass.detectors)
            || !isRecord(coverageClass.remedy)) {
            invalidReport(renderer);
        }
        assertString(coverageClass.id, renderer);
        assertString(coverageClass.description, renderer);
        if (!hasExactFields(coverageClass.remedy, ['summary', 'command'])) invalidReport(renderer);
        assertString(coverageClass.remedy.summary, renderer);
        assertString(coverageClass.remedy.command, renderer);
        for (const detector of coverageClass.detectors) {
            if (!isRecord(detector) || !hasExactFields(detector, ['sensor', 'status', 'evidence'])
                || !isOneOf(detector.status, DETECTOR_STATUS)) {
                invalidReport(renderer);
            }
            assertString(detector.sensor, renderer);
            assertEvidence(detector.evidence, renderer);
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
