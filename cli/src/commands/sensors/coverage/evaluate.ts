import type { CoverageContract } from './contract';
import type { CompatibilityEvidence, CompatibilityState } from '../compatibility/types';

export type DetectorStatus = 'covered' | 'missing' | 'disabled' | 'ineffective' | 'unverifiable';

export type CoverageEvidenceResult =
    | { kind: 'command'; status: 'matched' | 'custom' | 'missing' }
    | { kind: 'file'; path: string; status: 'matched' | 'missing' | 'unverifiable' }
    | { kind: 'marker'; path: string; ordinal: number; status: 'matched' | 'missing' | 'unverifiable' };

export type DetectorObservation = {
    sensor: string;
    status: DetectorStatus;
    evidence: CoverageEvidenceResult[];
    /** Live, sanitized resolver result. Omitted only for the retained R2 unit API. */
    compatibility?: CompatibilityEvidence;
};

export type IndexedDetectorObservation = DetectorObservation & {
    classId: string;
    detectorIndex: number;
};

export type CoverageClassResult = {
    id: string;
    description: string;
    status: CoverageClassStatus;
    detectors: DetectorObservation[];
    remedy: { summary: string; command: string };
};

export type StaticCoverageResult = {
    overall: 'covered' | 'gaps' | 'inconclusive';
    classes: CoverageClassResult[];
};

export type CoverageClassStatus = 'covered' | 'missing' | 'unverifiable' | 'not-applicable';

const detectorStatuses: readonly DetectorStatus[] = ['covered', 'missing', 'disabled', 'ineffective', 'unverifiable'];
const commandStatuses = ['matched', 'custom', 'missing'];
const fileStatuses = ['matched', 'missing', 'unverifiable'];
const compatibilityStates: readonly CompatibilityState[] = [
    'certified', 'compatible-unverified', 'incompatible', 'missing-tool', 'unverifiable', 'not-applicable',
];

function keyFor(classId: string, detectorIndex: number): string {
    return `${classId}:${detectorIndex}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function validateEvidence(evidence: unknown): evidence is CoverageEvidenceResult[] {
    if (!Array.isArray(evidence)) return false;
    return evidence.every((item) => {
        if (!isRecord(item) || typeof item.kind !== 'string' || typeof item.status !== 'string') return false;
        if (item.kind === 'command') return commandStatuses.includes(item.status) && Object.keys(item).every((key) => key === 'kind' || key === 'status');
        if (item.kind === 'file') return fileStatuses.includes(item.status) && isNonEmptyString(item.path)
            && Object.keys(item).every((key) => key === 'kind' || key === 'path' || key === 'status');
        if (item.kind === 'marker') return fileStatuses.includes(item.status) && isNonEmptyString(item.path)
            && typeof item.ordinal === 'number' && Number.isSafeInteger(item.ordinal) && item.ordinal > 0
            && Object.keys(item).every((key) => key === 'kind' || key === 'path' || key === 'ordinal' || key === 'status');
        return false;
    });
}

function validateCompatibility(value: unknown): value is CompatibilityEvidence {
    if (!isRecord(value) || !compatibilityStates.includes(value.state as CompatibilityState)
        || !isNonEmptyString(value.reason)
        || !(value.variantId === null || isNonEmptyString(value.variantId))
        || !(value.toolVersion === null || isNonEmptyString(value.toolVersion))
        || !(value.runtimeVersion === null || isNonEmptyString(value.runtimeVersion))
        || !(value.certifiedRange === null || isNonEmptyString(value.certifiedRange))
        || !Array.isArray(value.evidence)) return false;
    return value.evidence.every((item) => isRecord(item)
        && isNonEmptyString(item.kind) && isNonEmptyString(item.status)
        && (!('path' in item) || isNonEmptyString(item.path))
        && Object.keys(item).every((key) => key === 'kind' || key === 'status' || key === 'path'));
}

function validateContract(contract: unknown): asserts contract is CoverageContract {
    if (!isRecord(contract) || contract.schemaVersion !== 1 || !isRecord(contract.classes) || Object.keys(contract.classes).length === 0) {
        throw new Error('evaluateCoverage: invalid coverage contract');
    }
    for (const [classId, coverageClass] of Object.entries(contract.classes)) {
        if (!isNonEmptyString(classId) || !isRecord(coverageClass) || !isNonEmptyString(coverageClass.description)
            || !Array.isArray(coverageClass.detectors) || coverageClass.detectors.length === 0
            || !isRecord(coverageClass.remedy) || !isNonEmptyString(coverageClass.remedy.summary)
            || !isNonEmptyString(coverageClass.remedy.command)) {
            throw new Error(`evaluateCoverage: invalid coverage contract class '${classId}'`);
        }
        for (const detector of coverageClass.detectors) {
            if (!isRecord(detector) || !isNonEmptyString(detector.sensor)) {
                throw new Error(`evaluateCoverage: invalid coverage contract detector for '${classId}'`);
            }
        }
    }
}

function validateObservation(item: unknown): item is IndexedDetectorObservation {
    return isRecord(item) && isNonEmptyString(item.classId) && typeof item.detectorIndex === 'number' && Number.isSafeInteger(item.detectorIndex)
        && item.detectorIndex >= 0 && isNonEmptyString(item.sensor) && typeof item.status === 'string'
        && detectorStatuses.includes(item.status as DetectorStatus) && validateEvidence(item.evidence)
        && (!('compatibility' in item) || validateCompatibility(item.compatibility));
}

function copyEvidence(evidence: CoverageEvidenceResult[]): CoverageEvidenceResult[] {
    return evidence.map((item) => ({ ...item } as CoverageEvidenceResult));
}

function copyCompatibility(value: CompatibilityEvidence | undefined): CompatibilityEvidence | undefined {
    return value === undefined ? undefined : {
        ...value,
        evidence: value.evidence.map((item) => ({ ...item })),
    };
}

/** Map a detector's live compatibility plus its R2 structural evidence to a
 * deterministic class alternative. A missing compatibility field is the R2
 * compatibility path retained for direct callers while legacy/v2 coverage
 * collection always supplies an explicit live resolution. */
export function toClassStatus(detector: DetectorObservation): CoverageClassStatus {
    if (!detector || typeof detector !== 'object' || !detectorStatuses.includes(detector.status)
        || !validateEvidence(detector.evidence)) throw new Error('toClassStatus: malformed detector observation');
    const state = detector.compatibility?.state;
    if (state === 'not-applicable') return 'not-applicable';
    if (state === 'compatible-unverified' || state === 'unverifiable') return 'unverifiable';
    if (state === 'incompatible' || state === 'missing-tool') return 'missing';
    if (detector.status === 'unverifiable') return 'unverifiable';
    if (detector.status === 'covered') return 'covered';
    return 'missing';
}

const rank: Readonly<Record<CoverageClassStatus, number>> = {
    covered: 4,
    unverifiable: 3,
    missing: 2,
    'not-applicable': 1,
};

export function reduceClassStatus(detectors: DetectorObservation[]): CoverageClassStatus {
    if (!Array.isArray(detectors) || detectors.length === 0) throw new Error('coverage class requires detectors');
    const statuses = detectors.map(toClassStatus);
    return statuses.reduce((best, current) => rank[current] > rank[best] ? current : best);
}

/** Shared static/empirical vocabulary. The empirical analyzer supplies the
 * occurrence boolean in T6; keeping the contradiction decision here prevents
 * a second interpretation of applicability in that later layer. */
export function crossEmpiricalOutcome(status: CoverageClassStatus, hasEvidence: boolean):
    'covered-by-sensor' | 'gap' | 'coverage-unverifiable' | 'applicability-contradiction' {
    if (typeof hasEvidence !== 'boolean' || !['covered', 'missing', 'unverifiable', 'not-applicable'].includes(status)) {
        throw new Error('crossEmpiricalOutcome: invalid static status or evidence flag');
    }
    if (status === 'not-applicable' && hasEvidence) return 'applicability-contradiction';
    if (status === 'covered') return 'covered-by-sensor';
    return status === 'missing' ? 'gap' : 'coverage-unverifiable';
}

export function evaluateCoverage(contract: CoverageContract, observations: IndexedDetectorObservation[]): StaticCoverageResult {
    validateContract(contract);
    if (!Array.isArray(observations)) throw new Error('evaluateCoverage: observations must be an array');

    const indexed = new Map<string, IndexedDetectorObservation>();
    for (const item of observations) {
        if (!validateObservation(item)) throw new Error('evaluateCoverage: malformed observation');
        const key = keyFor(item.classId, item.detectorIndex);
        if (indexed.has(key)) throw new Error(`evaluateCoverage: duplicate observation for '${key}' (${item.sensor})`);
        indexed.set(key, item);
    }

    const classes = Object.keys(contract.classes).sort().map((id): CoverageClassResult => {
        const expected = contract.classes[id];
        const detectors = expected.detectors.map((detector, detectorIndex): DetectorObservation => {
            const identity = keyFor(id, detectorIndex);
            const found = indexed.get(identity);
            if (!found) throw new Error(`evaluateCoverage: missing observation for '${identity}' (${detector.sensor})`);
            if (found.sensor !== detector.sensor) {
                throw new Error(`evaluateCoverage: observation for '${identity}' must use sensor '${detector.sensor}'`);
            }
            return {
                sensor: found.sensor,
                status: found.status,
                evidence: copyEvidence(found.evidence),
                ...(found.compatibility === undefined ? {} : { compatibility: copyCompatibility(found.compatibility) }),
            };
        });
        const status = reduceClassStatus(detectors);
        return {
            id,
            description: expected.description,
            status,
            detectors,
            remedy: { ...expected.remedy },
        };
    });

    if (indexed.size !== classes.reduce((count, coverageClass) => count + coverageClass.detectors.length, 0)) {
        for (const [identity, observation] of indexed) {
            const expected = contract.classes[observation.classId]?.detectors[observation.detectorIndex];
            if (!expected) throw new Error(`evaluateCoverage: unexpected observation for '${identity}' (${observation.sensor})`);
        }
    }

    const applicable = classes.filter((item) => item.status !== 'not-applicable');
    const overall = applicable.some((item) => item.status === 'missing') ? 'gaps'
        : classes.some((item) => item.status === 'unverifiable') ? 'inconclusive'
        : applicable.some((item) => item.status === 'covered') ? 'covered'
        : 'inconclusive';
    return { overall, classes };
}
