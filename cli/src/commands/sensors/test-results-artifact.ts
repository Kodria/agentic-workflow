import fs from 'fs';
import path from 'path';
import { parseJestJson } from './formatters/test-jest';
import { parseJunitXml } from './formatters/test-junit';
import type { TestParseResult } from './formatters/test-identity';
import { DEFAULT_EXCLUSION_NAMES, isReservedSegment } from './read-only-observation';
import type { PreparedSensorExecution } from './types';

/** Max bytes for a structured test-results artifact (RF-1.3). */
export const TEST_RESULTS_MAX_BYTES = 16 * 1024 * 1024;

const DEFAULT_RESULTS_FILES = [
    'coverage/awm-test-results.json',
    'coverage/awm-test-results.xml',
] as const;

export type ResultFileIdentity = {
    mtimeMs: number;
    size: number;
    ino?: number;
};

/** Candidate relative paths for the test-results artifact (RF-1.2). */
export function candidateResultsPaths(prepared: PreparedSensorExecution): string[] {
    if (typeof prepared.resultsFile === 'string' && prepared.resultsFile.length > 0) {
        return [prepared.resultsFile];
    }
    return [...DEFAULT_RESULTS_FILES];
}

function pathContained(rootReal: string, candidateReal: string): boolean {
    const rel = path.relative(rootReal, candidateReal);
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function pathSegments(rel: string): string[] {
    return rel.split(/[/\\]/).filter(Boolean);
}

function hasReservedSegment(rel: string): boolean {
    return pathSegments(rel).some(isReservedSegment);
}

export function snapshotRegularFile(abs: string): ResultFileIdentity | null {
    try {
        const st = fs.lstatSync(abs);
        if (!st.isFile() || st.isSymbolicLink()) return null;
        return { mtimeMs: st.mtimeMs, size: st.size, ino: Number(st.ino) };
    } catch {
        return null;
    }
}

export function identityChanged(prior: ResultFileIdentity | null | undefined, next: ResultFileIdentity): boolean {
    if (prior == null) return true;
    if (prior.mtimeMs !== next.mtimeMs) return true;
    if (prior.size !== next.size) return true;
    if (prior.ino !== undefined && next.ino !== undefined && prior.ino !== next.ino) return true;
    return false;
}

function exclusionAllowsUnlink(rel: string): boolean {
    return pathSegments(rel).some((seg) => (DEFAULT_EXCLUSION_NAMES as readonly string[]).includes(seg));
}

/**
 * Contained pre-clear of candidate result files (RF-1.9 / RF-1.11).
 * Never unlinks a symlink leaf; refuses when the parent realpath escapes cwd.
 * NEVER unlinks a candidate whose relative path has a reserved `.awm` / `.git` segment.
 * Under readOnly, only unlinks when a path segment is in DEFAULT_EXCLUSION_NAMES.
 */
export function clearTestResultCandidates(
    cwd: string,
    paths: string[],
    opts?: { readOnly?: boolean },
): void {
    let rootReal: string;
    try {
        rootReal = fs.realpathSync(cwd);
    } catch {
        return;
    }
    for (const rel of paths) {
        if (hasReservedSegment(rel)) continue;
        if (opts?.readOnly && !exclusionAllowsUnlink(rel)) continue;
        const abs = path.resolve(cwd, rel);
        const parent = path.dirname(abs);
        let parentReal: string;
        try {
            parentReal = fs.realpathSync(parent);
        } catch {
            continue;
        }
        if (!pathContained(rootReal, parentReal)) continue;
        try {
            const st = fs.lstatSync(abs);
            if (st.isSymbolicLink()) continue;
            if (!st.isFile()) continue;
            fs.unlinkSync(abs);
        } catch {
            // Best-effort; identity snapshot remains authoritative for freshness.
        }
    }
}

export function snapshotTestResultCandidates(
    cwd: string,
    paths: string[],
): Record<string, ResultFileIdentity | null> {
    const out: Record<string, ResultFileIdentity | null> = {};
    for (const rel of paths) {
        out[rel] = snapshotRegularFile(path.resolve(cwd, rel));
    }
    return out;
}

export function readContainedUtf8(cwd: string, rel: string): string | null {
    const abs = path.resolve(cwd, rel);
    let rootReal: string;
    try {
        rootReal = fs.realpathSync(cwd);
    } catch {
        return null;
    }
    let leafStat: fs.Stats;
    try {
        leafStat = fs.lstatSync(abs);
    } catch {
        return null;
    }
    if (!leafStat.isFile() || leafStat.isSymbolicLink()) return null;
    if (leafStat.size > TEST_RESULTS_MAX_BYTES) return null;
    let real: string;
    try {
        real = fs.realpathSync(abs);
    } catch {
        return null;
    }
    if (!pathContained(rootReal, real)) return null;
    try {
        const realStat = fs.lstatSync(real);
        if (!realStat.isFile() || realStat.isSymbolicLink()) return null;
        if (realStat.size > TEST_RESULTS_MAX_BYTES) return null;
    } catch {
        return null;
    }
    let buf: Buffer;
    try {
        buf = fs.readFileSync(real);
    } catch {
        return null;
    }
    if (buf.byteLength > TEST_RESULTS_MAX_BYTES) return null;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return null;
    }
}

function parseSucceeded(parsed: TestParseResult): boolean {
    return parsed.findings.length > 0 || parsed.explainsNonZeroExit;
}

export function parseResultsContent(rel: string, content: string, cwd: string): TestParseResult | null {
    const lower = rel.toLowerCase();
    let parsed: TestParseResult;
    if (lower.endsWith('.json')) parsed = parseJestJson(content, cwd);
    else if (lower.endsWith('.xml')) parsed = parseJunitXml(content, cwd);
    else return null;
    return parseSucceeded(parsed) ? parsed : null;
}

export type UsableArtifact = {
    rel: string;
    parsed: TestParseResult;
};

/**
 * Resolve the first fresh usable results artifact (RF-1.2–1.4 / RF-1.9).
 * Fail-closed when priorIdentities is undefined.
 */
export function resolveUsableArtifact(
    prepared: PreparedSensorExecution,
    cwd: string,
    priorIdentities?: Record<string, ResultFileIdentity | null>,
): UsableArtifact | null {
    if (priorIdentities === undefined) return null;
    for (const rel of candidateResultsPaths(prepared)) {
        const abs = path.resolve(cwd, rel);
        const next = snapshotRegularFile(abs);
        if (!next) continue;
        const prior = priorIdentities[rel] ?? null;
        if (!identityChanged(prior, next)) continue;
        const content = readContainedUtf8(cwd, rel);
        if (content === null) continue;
        const parsed = parseResultsContent(rel, content, cwd);
        if (!parsed) continue;
        return { rel, parsed };
    }
    return null;
}
