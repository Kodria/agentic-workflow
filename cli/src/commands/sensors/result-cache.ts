import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../core/atomic-file';
import { esc, isSingleLine } from '../../core/changes/text-safety';
import type { SensorError, SensorResult } from './types';

const MAX_CACHE_BYTES = 1024 * 1024;
const CACHE_SCHEMA = 1 as const;

export type ResultCacheRaw = {
    name: string;
    status: 'pass' | 'fail';
    errors: SensorError[];
    failureKind?: 'findings' | 'missing-binary' | 'exit-code';
    incomplete?: string;
    certification?: SensorResult['certification'];
    skipReason?: string;
};

export type ResultCacheRecord = {
    schema: typeof CACHE_SCHEMA;
    sensorId: string;
    projectKey: string;
    sensorFingerprint: string;
    inputDigest: string;
    originCommit: string | null;
    originDirty: boolean;
    raw: ResultCacheRaw;
};

export type ResultCacheLookup = {
    sensorId: string;
    projectKey: string;
    sensorFingerprint: string;
    inputDigest: string;
};

function runsDir(root: string): string {
    return path.join(root, '.awm', 'sensors', 'runs');
}

function assertNoSymlinkChain(root: string): void {
    let current = root;
    for (const segment of ['.awm', 'sensors', 'runs']) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing to use symlinked path ${esc(current)}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
    }
}

function ensureRunsIgnore(root: string): void {
    const file = path.join(runsDir(root), '.gitignore');
    try {
        const stat = fs.lstatSync(file);
        if (stat.isFile() && fs.readFileSync(file, 'utf8') === '*\n') return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    writeFileAtomic(file, '*\n', 0o644);
}

function cacheKeyHash(lookup: ResultCacheLookup): string {
    return crypto.createHash('sha256')
        .update([lookup.projectKey, lookup.sensorId, lookup.sensorFingerprint, lookup.inputDigest].join('\0'))
        .digest('hex');
}

export function cacheFileName(lookup: ResultCacheLookup): string {
    return `cache-${cacheKeyHash(lookup)}.json`;
}

/** RF-2.4: store only clean pass, or fail+findings with errors.length > 0 (and not incomplete). */
export function canCacheRawResult(result: SensorResult): boolean {
    if (!result || typeof result !== 'object') return false;
    if (result.incomplete) return false;
    if (!Array.isArray(result.errors)) return false;
    if (result.status === 'pass') {
        // Planted pass+errors / pass+failureKind must never cache (or read as a hit).
        return result.errors.length === 0 && result.failureKind === undefined;
    }
    if (result.status !== 'fail') return false;
    if (result.failureKind !== 'findings') return false;
    return result.errors.length > 0;
}

export function computeSensorFingerprint(parts: {
    variantId: string | null;
    command: unknown;
    changedCommand?: unknown;
    cliVersion: string;
    inputs: string[];
    toolVersion: string | null | undefined;
    runtimeVersion: string | null | undefined;
}, opts?: { allowMissingLiveVersions?: boolean }): string | null {
    if (!parts || typeof parts !== 'object') throw new Error('fingerprint parts must be an object');
    if (typeof parts.cliVersion !== 'string' || parts.cliVersion.length === 0) throw new Error('cliVersion must be a nonempty string');
    if (!Array.isArray(parts.inputs) || parts.inputs.some((g) => typeof g !== 'string')) throw new Error('inputs must be string[]');
    const allowMissing = opts?.allowMissingLiveVersions === true;
    const toolOk = typeof parts.toolVersion === 'string' && parts.toolVersion.length > 0;
    const runtimeOk = typeof parts.runtimeVersion === 'string' && parts.runtimeVersion.length > 0;
    if (!allowMissing && (!toolOk || !runtimeOk)) return null;
    const canonical = JSON.stringify({
        variantId: parts.variantId,
        command: parts.command,
        changedCommand: parts.changedCommand ?? null,
        cliVersion: parts.cliVersion,
        inputs: [...parts.inputs].sort(),
        toolVersion: toolOk ? parts.toolVersion : null,
        runtimeVersion: runtimeOk ? parts.runtimeVersion : null,
    });
    return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

function isSensorError(value: unknown): value is SensorError {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const e = value as Record<string, unknown>;
    if (typeof e.message !== 'string' || !isSingleLine(e.message)) return false;
    if (e.file !== undefined && (typeof e.file !== 'string' || !isSingleLine(e.file))) return false;
    if (e.line !== undefined && (!Number.isSafeInteger(e.line) || (e.line as number) < 0)) return false;
    if (e.column !== undefined && (!Number.isSafeInteger(e.column) || (e.column as number) < 0)) return false;
    if (e.rule !== undefined && typeof e.rule !== 'string') return false;
    return true;
}

function validateRaw(raw: unknown): string | null {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return 'raw must be an object';
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || r.name.length === 0) return 'raw.name invalid';
    if (r.status !== 'pass' && r.status !== 'fail') return 'raw.status invalid';
    if (!Array.isArray(r.errors) || !r.errors.every(isSensorError)) return 'raw.errors invalid';
    if (r.failureKind !== undefined
        && r.failureKind !== 'findings'
        && r.failureKind !== 'missing-binary'
        && r.failureKind !== 'exit-code') return 'raw.failureKind invalid';
    if (r.status === 'pass') {
        if (r.errors.length !== 0) return 'raw.pass must have errors.length===0';
        if (r.failureKind !== undefined) return 'raw.pass must not carry failureKind';
    }
    if (r.incomplete !== undefined && typeof r.incomplete !== 'string') return 'raw.incomplete invalid';
    if (r.skipReason !== undefined && typeof r.skipReason !== 'string') return 'raw.skipReason invalid';
    if (r.certification !== undefined
        && r.certification !== 'certified'
        && r.certification !== 'operational-unverified'
        && r.certification !== 'project-declared') return 'raw.certification invalid';
    return null;
}

function cacheProblem(x: unknown): string | null {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return 'cache must be an object';
    const r = x as Record<string, unknown>;
    if (r.schema !== CACHE_SCHEMA) return 'schema must be 1';
    if (typeof r.sensorId !== 'string' || r.sensorId.length === 0) return 'sensorId invalid';
    if (typeof r.projectKey !== 'string' || r.projectKey.length === 0) return 'projectKey invalid';
    if (typeof r.sensorFingerprint !== 'string' || !r.sensorFingerprint.startsWith('sha256:')) return 'sensorFingerprint invalid';
    if (typeof r.inputDigest !== 'string' || !r.inputDigest.startsWith('sha256:')) return 'inputDigest invalid';
    if (r.originCommit !== null && (typeof r.originCommit !== 'string' || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(r.originCommit))) {
        return 'originCommit invalid';
    }
    if (typeof r.originDirty !== 'boolean') return 'originDirty invalid';
    return validateRaw(r.raw);
}

export function toCacheRaw(result: SensorResult): ResultCacheRaw {
    if (!result || typeof result !== 'object') throw new Error('cache raw requires a sensor result');
    if (result.status !== 'pass' && result.status !== 'fail') {
        throw new Error(`toCacheRaw refuses non-pass/fail status (${result.status}); only pass|fail may be cached`);
    }
    if (!canCacheRawResult(result)) {
        throw new Error('toCacheRaw refuses uncacheable raw (RF-2.4)');
    }
    return {
        name: result.name,
        status: result.status,
        errors: result.errors,
        ...(result.failureKind ? { failureKind: result.failureKind } : {}),
        ...(result.incomplete ? { incomplete: result.incomplete } : {}),
        ...(result.certification ? { certification: result.certification } : {}),
        ...(result.skipReason ? { skipReason: result.skipReason } : {}),
    };
}

export function writeResultCache(gitRoot: string, record: ResultCacheRecord): string {
    if (typeof gitRoot !== 'string' || gitRoot.length === 0) throw new Error('cache root must be a nonempty string');
    const problem = cacheProblem(record);
    if (problem !== null) throw new Error(`invalid result cache: ${problem}`);
    if (record.raw.name !== record.sensorId) {
        throw new Error('refusing to write result cache: raw.name must match sensorId');
    }
    const asResult: SensorResult = {
        name: record.raw.name,
        status: record.raw.status,
        errors: record.raw.errors,
        ...(record.raw.failureKind ? { failureKind: record.raw.failureKind } : {}),
        ...(record.raw.incomplete ? { incomplete: record.raw.incomplete } : {}),
        ...(record.raw.certification ? { certification: record.raw.certification } : {}),
        ...(record.raw.skipReason ? { skipReason: record.raw.skipReason } : {}),
    };
    if (!canCacheRawResult(asResult)) {
        throw new Error('refusing to write uncacheable result cache entry (RF-2.4)');
    }
    const lookup: ResultCacheLookup = {
        sensorId: record.sensorId,
        projectKey: record.projectKey,
        sensorFingerprint: record.sensorFingerprint,
        inputDigest: record.inputDigest,
    };
    const content = JSON.stringify(record, null, 2) + '\n';
    if (Buffer.byteLength(content) > MAX_CACHE_BYTES) throw new Error('invalid result cache: larger than the size read accepts');
    assertNoSymlinkChain(gitRoot);
    fs.mkdirSync(runsDir(gitRoot), { recursive: true, mode: 0o700 });
    assertNoSymlinkChain(gitRoot);
    ensureRunsIgnore(gitRoot);
    const file = path.join(runsDir(gitRoot), cacheFileName(lookup));
    writeFileAtomic(file, content, 0o600);
    fs.chmodSync(file, 0o600);
    return file;
}

/** Validated cache read (RF-2.15). Any invalid/tampered entry is a miss. */
export function readResultCache(gitRoot: string, lookup: ResultCacheLookup): ResultCacheRecord | null {
    if (typeof gitRoot !== 'string' || gitRoot.length === 0) return null;
    if (!lookup || typeof lookup !== 'object') return null;
    if (typeof lookup.sensorId !== 'string' || typeof lookup.projectKey !== 'string') return null;
    if (typeof lookup.sensorFingerprint !== 'string' || typeof lookup.inputDigest !== 'string') return null;
    let raw: string;
    try {
        assertNoSymlinkChain(gitRoot);
        const file = path.join(runsDir(gitRoot), cacheFileName(lookup));
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) return null;
        raw = fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (cacheProblem(parsed) !== null) return null;
    const record = parsed as ResultCacheRecord;
    if (record.sensorId !== lookup.sensorId
        || record.projectKey !== lookup.projectKey
        || record.sensorFingerprint !== lookup.sensorFingerprint
        || record.inputDigest !== lookup.inputDigest) return null;
    if (record.raw.name !== record.sensorId || record.raw.name !== lookup.sensorId) return null;
    // RF-2.15/2.4: structural validity is not enough — reject uncacheable raw payloads.
    const asResult: SensorResult = {
        name: record.raw.name,
        status: record.raw.status,
        errors: record.raw.errors,
        ...(record.raw.failureKind ? { failureKind: record.raw.failureKind } : {}),
        ...(record.raw.incomplete ? { incomplete: record.raw.incomplete } : {}),
        ...(record.raw.certification ? { certification: record.raw.certification } : {}),
        ...(record.raw.skipReason ? { skipReason: record.raw.skipReason } : {}),
    };
    if (!canCacheRawResult(asResult)) return null;
    return record;
}
