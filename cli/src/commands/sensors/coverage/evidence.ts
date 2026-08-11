import fs from 'fs';
import path from 'path';
import type { SensorConfig } from '../types';
import { MAX_COVERAGE_FILE_BYTES, type CoverageDetectorContract } from './contract';
import type { CoverageEvidenceResult, IndexedDetectorObservation } from './evaluate';

export type EvidenceIo = {
    lstatSync: (file: string) => fs.Stats;
    readFileUtf8: (file: string) => string;
};

const realIo: EvidenceIo = {
    lstatSync: fs.lstatSync,
    readFileUtf8: (file) => fs.readFileSync(file, 'utf8'),
};

type FileInspection = {
    status: 'matched' | 'missing' | 'unverifiable';
    evidence: CoverageEvidenceResult[];
};

function resolvedEvidencePath(root: string, relative: string): string {
    const rootPath = path.resolve(root);
    const absolute = path.resolve(rootPath, relative);
    const fromRoot = path.relative(rootPath, absolute);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
        throw new Error(`evidence path escaped project root: ${relative}`);
    }
    return absolute;
}

function inspectFile(root: string, relative: string, markers: string[], io: EvidenceIo): FileInspection {
    const absolute = resolvedEvidencePath(root, relative);
    let stat: fs.Stats;
    try {
        stat = io.lstatSync(absolute);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { status: 'missing', evidence: [{ kind: 'file', path: relative, status: 'missing' }] };
        }
        return { status: 'unverifiable', evidence: [{ kind: 'file', path: relative, status: 'unverifiable' }] };
    }

    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_COVERAGE_FILE_BYTES) {
        return { status: 'unverifiable', evidence: [{ kind: 'file', path: relative, status: 'unverifiable' }] };
    }

    let content: string;
    try {
        content = io.readFileUtf8(absolute);
    } catch {
        return { status: 'unverifiable', evidence: [{ kind: 'file', path: relative, status: 'unverifiable' }] };
    }

    const evidence: CoverageEvidenceResult[] = [{ kind: 'file', path: relative, status: 'matched' }];
    for (const [index, marker] of markers.entries()) {
        evidence.push({
            kind: 'marker',
            path: relative,
            ordinal: index + 1,
            status: content.includes(marker) ? 'matched' : 'missing',
        });
    }
    return {
        status: evidence.some((item) => item.kind === 'marker' && item.status === 'missing') ? 'missing' : 'matched',
        evidence,
    };
}

export function observeDetector(
    root: unknown,
    classId: unknown,
    detectorIndex: unknown,
    detector: CoverageDetectorContract,
    sensor: SensorConfig | undefined,
    io: EvidenceIo = realIo,
): IndexedDetectorObservation {
    if (typeof root !== 'string' || root.trim().length === 0) throw new Error('observeDetector: root must be a non-empty string');
    if (typeof classId !== 'string' || classId.trim().length === 0) throw new Error('observeDetector: classId must be a non-empty string');
    if (typeof detectorIndex !== 'number' || !Number.isSafeInteger(detectorIndex) || detectorIndex < 0) {
        throw new Error('observeDetector: detectorIndex must be a non-negative integer');
    }

    const base = { classId, detectorIndex, sensor: detector.sensor };
    if (!sensor) return { ...base, status: 'missing', evidence: [] };
    if (sensor.enabled === false) return { ...base, status: 'disabled', evidence: [] };

    const requiredCommand = detector.evidence?.commandIncludes ?? [];
    const command = sensor.cmd;
    if (requiredCommand.length > 0 && typeof command !== 'string') {
        return { ...base, status: 'unverifiable', evidence: [{ kind: 'command', status: 'missing' }] };
    }
    if (requiredCommand.some((fragment) => !command!.includes(fragment))) {
        return { ...base, status: 'unverifiable', evidence: [{ kind: 'command', status: 'custom' }] };
    }

    const evidence: CoverageEvidenceResult[] = requiredCommand.length > 0 ? [{ kind: 'command', status: 'matched' }] : [];
    let ineffective = false;
    let unverifiable = false;
    for (const file of detector.evidence?.files ?? []) {
        const result = inspectFile(root, file.path, file.containsAll, io);
        evidence.push(...result.evidence);
        ineffective ||= result.status === 'missing';
        unverifiable ||= result.status === 'unverifiable';
    }
    return { ...base, status: unverifiable ? 'unverifiable' : ineffective ? 'ineffective' : 'covered', evidence };
}
