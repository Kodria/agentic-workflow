import type { CoverageContract } from './contract';

export type DetectorStatus = 'covered' | 'missing' | 'disabled' | 'ineffective' | 'unverifiable';

export type CoverageEvidenceResult =
    | { kind: 'command'; status: 'matched' | 'custom' | 'missing' }
    | { kind: 'file'; path: string; status: 'matched' | 'missing' | 'unverifiable' }
    | { kind: 'marker'; path: string; ordinal: number; status: 'matched' | 'missing' | 'unverifiable' };

export type DetectorObservation = {
    sensor: string;
    status: DetectorStatus;
    evidence: CoverageEvidenceResult[];
};

export type IndexedDetectorObservation = DetectorObservation & {
    classId: string;
    detectorIndex: number;
};

export type CoverageClassResult = {
    id: string;
    description: string;
    status: 'covered' | 'missing' | 'unverifiable';
    detectors: DetectorObservation[];
    remedy: { summary: string; command: string };
};

export type StaticCoverageResult = {
    overall: 'covered' | 'gaps' | 'inconclusive';
    classes: CoverageClassResult[];
};

const detectorStatuses: readonly DetectorStatus[] = ['covered', 'missing', 'disabled', 'ineffective', 'unverifiable'];
const commandStatuses = ['matched', 'custom', 'missing'];
const fileStatuses = ['matched', 'missing', 'unverifiable'];

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
        && detectorStatuses.includes(item.status as DetectorStatus) && validateEvidence(item.evidence);
}

function copyEvidence(evidence: CoverageEvidenceResult[]): CoverageEvidenceResult[] {
    return evidence.map((item) => ({ ...item } as CoverageEvidenceResult));
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
            return { sensor: found.sensor, status: found.status, evidence: copyEvidence(found.evidence) };
        });
        const status = detectors.some((item) => item.status === 'covered') ? 'covered'
            : detectors.some((item) => item.status === 'unverifiable') ? 'unverifiable'
            : 'missing';
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

    const overall = classes.some((item) => item.status === 'missing') ? 'gaps'
        : classes.some((item) => item.status === 'unverifiable') ? 'inconclusive'
        : 'covered';
    return { overall, classes };
}
