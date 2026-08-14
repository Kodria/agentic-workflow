import type { CoverageEnvelope } from '.';
import type { CompatibilityEvidence } from '../compatibility/types';

const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
const OVERALL = ['covered', 'gaps', 'inconclusive'];
const CLASS_STATUS = ['covered', 'missing', 'unverifiable', 'not-applicable'];
const DETECTOR_STATUS = ['covered', 'missing', 'disabled', 'ineffective', 'unverifiable'];
const COMPATIBILITY_STATE = ['certified', 'compatible-unverified', 'incompatible', 'missing-tool', 'unverifiable', 'not-applicable'];
const REASON = ['not_configured', 'no_reference'];
const COMMAND_EVIDENCE_STATUS = ['matched', 'custom', 'missing'];
const FILE_EVIDENCE_STATUS = ['matched', 'missing', 'unverifiable'];
const EMPIRICAL_STATUS = ['no-evidence', 'evidence', 'partial', 'inconclusive'];
const EMPIRICAL_OUTCOME = ['covered-by-sensor', 'gap', 'coverage-unverifiable', 'applicability-contradiction', 'unmapped-class'];
const SEVERITY = ['blocker', 'important', 'minor', 'info'];
const SAFE_REF = /^(?:PR #[1-9][0-9]*|[a-f0-9]{7,64}|(?!\/)(?!.*(?:^|\/)\.\.?\/)[A-Za-z0-9._@+~=-]+(?:\/[A-Za-z0-9._@+~=-]+)*:[1-9][0-9]*)$/i;

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

function assertCompatibility(value: unknown, renderer: string): asserts value is CompatibilityEvidence {
    if (!isRecord(value) || !hasExactFields(value, ['state', 'reason', 'variantId', 'toolVersion', 'runtimeVersion', 'certifiedRange', 'evidence'])
        || !isOneOf(value.state, COMPATIBILITY_STATE) || !isNonBlankString(value.reason)
        || !(value.variantId === null || isNonBlankString(value.variantId))
        || !(value.toolVersion === null || isNonBlankString(value.toolVersion))
        || !(value.runtimeVersion === null || isNonBlankString(value.runtimeVersion))
        || !(value.certifiedRange === null || isNonBlankString(value.certifiedRange))
        || !Array.isArray(value.evidence)) invalidReport(renderer);
    for (const evidence of value.evidence) {
        if (!isRecord(evidence) || !hasExactFields(evidence, 'path' in evidence ? ['kind', 'status', 'path'] : ['kind', 'status'])
            || !isNonBlankString(evidence.kind) || !isNonBlankString(evidence.status)
            || ('path' in evidence && !isNonBlankString(evidence.path))) invalidReport(renderer);
    }
}

function assertCount(value: unknown, renderer: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalidReport(renderer);
}

function assertRefs(value: unknown, renderer: string): void {
    if (!Array.isArray(value) || value.some((ref) => !isNonBlankString(ref) || ref.length > 256 || /[\u0000-\u001F\u007F-\u009F]/.test(ref) || !SAFE_REF.test(ref))) invalidReport(renderer);
    for (let index = 1; index < value.length; index += 1) if (value[index - 1] >= value[index]) invalidReport(renderer);
}

function assertEmpirical(value: unknown, renderer: string): void {
    if (!isRecord(value) || !hasExactFields(value, ['recurrenceThreshold', 'status', 'classes', 'unclassified', 'sources', 'omittedEvidenceRefs'])
        || !isOneOf(value.status, EMPIRICAL_STATUS) || !Array.isArray(value.classes) || !isRecord(value.unclassified)
        || !isRecord(value.sources)) invalidReport(renderer);
    assertCount(value.omittedEvidenceRefs, renderer);
    if (typeof value.recurrenceThreshold !== 'number' || !Number.isSafeInteger(value.recurrenceThreshold) || value.recurrenceThreshold < 1) invalidReport(renderer);
    let previous = '';
    let occurrenceCount = 0;
    for (const item of value.classes) {
        if (!isRecord(item) || !hasExactFields(item, ['defectClass', 'occurrences', 'recurrent', 'severity', 'outcome', 'evidenceRefs', 'omittedEvidenceRefs'])
            || !isNonBlankString(item.defectClass) || !isOneOf(item.severity, SEVERITY) || !isOneOf(item.outcome, EMPIRICAL_OUTCOME)
            || typeof item.recurrent !== 'boolean') invalidReport(renderer);
        assertCount(item.occurrences, renderer); assertCount(item.omittedEvidenceRefs, renderer); assertRefs(item.evidenceRefs, renderer);
        if (item.occurrences < 1 || previous > item.defectClass) invalidReport(renderer);
        previous = item.defectClass; occurrenceCount += item.occurrences;
    }
    if (!hasExactFields(value.unclassified, ['occurrences', 'evidenceRefs', 'omittedEvidenceRefs'])) invalidReport(renderer);
    assertCount(value.unclassified.occurrences, renderer); assertCount(value.unclassified.omittedEvidenceRefs, renderer); assertRefs(value.unclassified.evidenceRefs, renderer);
    if (!hasExactFields(value.sources, ['activeFiles', 'archivedFiles', 'validEntries', 'validFindings', 'skippedFindings', 'skippedByReason']) || !isRecord(value.sources.skippedByReason)) invalidReport(renderer);
    for (const key of ['activeFiles', 'archivedFiles', 'validEntries', 'validFindings', 'skippedFindings']) assertCount(value.sources[key], renderer);
    for (const count of Object.values(value.sources.skippedByReason)) assertCount(count, renderer);
    const validFindings = value.sources.validFindings as number;
    const validEntries = value.sources.validEntries as number;
    const skippedFindings = value.sources.skippedFindings as number;
    const unclassifiedOccurrences = value.unclassified.occurrences as number;
    const omitted = value.omittedEvidenceRefs as number;
    if (validFindings !== occurrenceCount + unclassifiedOccurrences || validEntries < validFindings) invalidReport(renderer);
    const hasSkips = skippedFindings > 0 || omitted > 0 || unclassifiedOccurrences > 0;
    if (value.status === 'no-evidence' && (validFindings !== 0 || hasSkips || value.classes.length !== 0)) invalidReport(renderer);
    if (value.status === 'evidence' && (validFindings === 0 || hasSkips)) invalidReport(renderer);
    if (value.status === 'partial' && (validFindings === 0 || !hasSkips)) invalidReport(renderer);
    if (value.status === 'inconclusive' && (validFindings !== 0 || !hasSkips || value.classes.length !== 0 || unclassifiedOccurrences !== 0)) invalidReport(renderer);
}

function assertCoverageEnvelope(report: unknown, renderer: string): asserts report is CoverageEnvelope {
    if (!isRecord(report) || !hasExactFields(report, 'empirical' in report
        ? ['schemaVersion', 'pack', 'registry', 'overall', 'static', 'empirical']
        : ['schemaVersion', 'pack', 'registry', 'overall', 'static']) || report.schemaVersion !== 2
        || !(report.pack === null || isNonBlankString(report.pack))
        || !(report.registry === null || isNonBlankString(report.registry))
        || !isOneOf(report.overall, OVERALL) || !isRecord(report.static)) {
        invalidReport(renderer);
    }

    const staticReport = report.static;
    if (!hasExactFields(staticReport, ['status', 'reason', 'classes']) || staticReport.status !== report.overall
        || !isOneOf(staticReport.status, OVERALL)
        || !(staticReport.reason === null || isOneOf(staticReport.reason, REASON))
        || !Array.isArray(staticReport.classes)) {
        invalidReport(renderer);
    }

    if (staticReport.reason === 'not_configured') {
        if (report.overall !== 'inconclusive' || report.pack !== null || report.registry !== null || staticReport.classes.length !== 0) {
            invalidReport(renderer);
        }
        if (report.empirical !== undefined) assertEmpirical(report.empirical, renderer); return;
    }
    if (staticReport.reason === 'no_reference') {
        if (report.overall !== 'inconclusive' || !isNonBlankString(report.pack) || !isNonBlankString(report.registry)
            || staticReport.classes.length !== 0) {
            invalidReport(renderer);
        }
        if (report.empirical !== undefined) assertEmpirical(report.empirical, renderer); return;
    }
    if (!isNonBlankString(report.pack) || !isNonBlankString(report.registry) || staticReport.classes.length === 0) {
        invalidReport(renderer);
    }

    let previousId: string | undefined;
    let hasMissingClass = false;
    let hasUnverifiableClass = false;
    for (const coverageClass of staticReport.classes) {
        if (!isRecord(coverageClass) || !hasExactFields(coverageClass, ['id', 'description', 'status', 'detectors', 'remedy'])
            || !isNonBlankString(coverageClass.id) || !isNonBlankString(coverageClass.description)
            || !isOneOf(coverageClass.status, CLASS_STATUS) || !Array.isArray(coverageClass.detectors) || coverageClass.detectors.length === 0
            || !isRecord(coverageClass.remedy)) {
            invalidReport(renderer);
        }
        if (previousId !== undefined && previousId >= coverageClass.id) invalidReport(renderer);
        previousId = coverageClass.id;
        if (!hasExactFields(coverageClass.remedy, ['summary', 'command'])) invalidReport(renderer);
        if (!isNonBlankString(coverageClass.remedy.summary) || !isNonBlankString(coverageClass.remedy.command)) invalidReport(renderer);
        let classStatus: 'covered' | 'missing' | 'unverifiable' | 'not-applicable' | undefined;
        for (const detector of coverageClass.detectors) {
            if (!isRecord(detector) || !hasExactFields(detector, ['sensor', 'status', 'evidence', 'compatibility'])
                || !isNonBlankString(detector.sensor) || !isOneOf(detector.status, DETECTOR_STATUS)) {
                invalidReport(renderer);
            }
            assertEvidence(detector.evidence, renderer);
            assertCompatibility(detector.compatibility, renderer);
            const state = detector.compatibility.state;
            const detectorStatus = state === 'not-applicable' ? 'not-applicable'
                : state === 'compatible-unverified' || state === 'unverifiable' || detector.status === 'unverifiable' ? 'unverifiable'
                : state === 'incompatible' || state === 'missing-tool' || detector.status !== 'covered' ? 'missing'
                : 'covered';
            const rank = { covered: 4, unverifiable: 3, missing: 2, 'not-applicable': 1 } as const;
            if (classStatus === undefined || rank[detectorStatus] > rank[classStatus]) classStatus = detectorStatus;
        }
        const expectedClassStatus = classStatus!;
        if (coverageClass.status !== expectedClassStatus) invalidReport(renderer);
        hasMissingClass ||= expectedClassStatus === 'missing';
        hasUnverifiableClass ||= expectedClassStatus === 'unverifiable';
    }
    const applicableClasses = staticReport.classes.filter((entry) => entry.status !== 'not-applicable');
    const expectedOverall = hasMissingClass ? 'gaps' : hasUnverifiableClass ? 'inconclusive'
        : applicableClasses.some((entry) => entry.status === 'covered') ? 'covered' : 'inconclusive';
    if (report.overall !== expectedOverall) invalidReport(renderer);
    if (report.empirical !== undefined) assertEmpirical(report.empirical, renderer);
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
        return ['Sensor coverage', 'Overall: inconclusive', 'Reason: sensors are not configured', 'Run: awm sensors init', ...(report.empirical ? [empiricalHuman(report)] : []), ''].join('\n');
    }
    if (report.static.reason === 'no_reference') {
        return ['Sensor coverage', `Pack: ${safeHumanText(report.pack ?? 'unknown')}`, `Registry: ${safeHumanText(report.registry ?? 'unknown')}`,
            'Overall: inconclusive', `No coverage reference for pack '${safeHumanText(report.pack ?? 'unknown')}'`, ...(report.empirical ? [empiricalHuman(report)] : []), ''].join('\n');
    }

    const lines = ['Sensor coverage', `Pack: ${safeHumanText(report.pack ?? 'unknown')}`, `Registry: ${safeHumanText(report.registry ?? 'unknown')}`,
        `Overall: ${report.overall}`, ''];
    for (const item of report.static.classes.filter((entry) => entry.status !== 'covered' && entry.status !== 'not-applicable')) {
        lines.push(`${item.status} ${safeHumanText(item.id)} — ${safeHumanText(item.description)}`);
        item.detectors.forEach((detector) => {
            const compatibility = detector.compatibility;
            if (!compatibility) invalidReport('renderCoverageHuman');
            lines.push(
                `  detector: ${safeHumanText(detector.sensor)} (${detector.status})`,
                `  compatibility: ${safeHumanText(compatibility.state)} — ${safeHumanText(compatibility.reason)}`,
            );
        });
        lines.push(`  remedy: ${safeHumanText(item.remedy.summary)}`, `  command: ${safeHumanText(item.remedy.command)}`);
    }
    const count = (status: 'covered' | 'missing' | 'unverifiable' | 'not-applicable') => report.static.classes.filter((item) => item.status === status).length;
    lines.push('', `Summary: ${count('covered')} covered, ${count('missing')} missing, ${count('unverifiable')} unverifiable, ${count('not-applicable')} not applicable`);
    if (report.empirical) lines.push(empiricalHuman(report));
    lines.push('');
    return lines.join('\n');
}

function empiricalHuman(report: CoverageEnvelope): string {
    const empirical = report.empirical;
    if (!empirical) return '';
    const lines = [`Empirical coverage: ${empirical.status}`];
    for (const item of empirical.classes) {
        const recurrence = item.recurrent
            ? `recurrent at threshold ${empirical.recurrenceThreshold}`
            : `below recurrence threshold (${empirical.recurrenceThreshold})`;
        lines.push(`${item.outcome} ${safeHumanText(item.defectClass)} — ${item.occurrences} occurrence${item.occurrences === 1 ? '' : 's'} (${item.severity}; ${recurrence})`);
        if (item.evidenceRefs.length > 0) lines.push(`  evidence: ${item.evidenceRefs.map(safeHumanText).join(', ')}`);
    }
    if (empirical.unclassified.occurrences > 0) lines.push(`unclassified findings: ${empirical.unclassified.occurrences}`);
    if (empirical.omittedEvidenceRefs > 0) lines.push(`omitted evidence refs: ${empirical.omittedEvidenceRefs}`);
    return lines.join('\n');
}
