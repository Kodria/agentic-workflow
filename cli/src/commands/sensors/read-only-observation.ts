import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { ReadOnlyCandidateRejection, ReadOnlyObservation } from './types';

/**
 * Admission's read-only observation (issue #215). `runSensors({ readOnly })` hashes
 * the project tree before and after the sensors run; any difference means the
 * evidence is not read-only. Generated output (node_modules, .next, …) can push that
 * walk past its limits, so a directory that git ignores and that holds no tracked
 * file may be skipped. Source files, `.gitignore`, and `.awm/` stay observed.
 */

export const READ_ONLY_MAX_ENTRIES = 250_000;
export const READ_ONLY_MAX_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_EXCLUSION_NAMES: readonly string[] = Object.freeze(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']);

const ADMISSION_CONFIG_LABEL = '.awm/admission.json';
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_FIELD_LABEL = 64;
const RESERVED_NAMES = new Set(['.git', '.awm']);

export type ExclusionRule = { kind: 'name'; name: string } | { kind: 'path'; path: string };
export type AdmissionConfig = { defaults: boolean; rules: ExclusionRule[] };
export type AdmissionConfigResult = { ok: true; config: AdmissionConfig } | { ok: false; field: string; message: string };
export type CandidateVerdict = 'excluded' | ReadOnlyCandidateRejection['reason'];
export type CandidateVerifier = (relativePath: string) => CandidateVerdict;
export type ExclusionPolicy = { isExcluded(relativePath: string, name: string): boolean; evidence(): ReadOnlyObservation };
export type SnapshotFailure = 'limit-entries' | 'limit-bytes' | 'unreadable';
export type SnapshotResult = { ok: true; digest: string } | { ok: false; failure: SnapshotFailure };
export type SnapshotLimits = { maxEntries: number; maxBytes: number };

const DEFAULT_LIMITS: SnapshotLimits = { maxEntries: READ_ONLY_MAX_ENTRIES, maxBytes: READ_ONLY_MAX_BYTES };

function requireRoot(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Unknown keys come from the project file: bound them and strip control characters. */
function fieldLabel(key: string): string {
    const clean = key.replace(/[\u0000-\u001f\u007f]/g, '?');
    return clean.length <= MAX_FIELD_LABEL ? clean : `${clean.slice(0, MAX_FIELD_LABEL - 1)}…`;
}

function defaultRules(): ExclusionRule[] {
    return DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name' as const, name }));
}

/** Exact, case-insensitive match: `my.awm` and `.gitignore-dir` are not reserved. */
function isReservedSegment(segment: string): boolean {
    return RESERVED_NAMES.has(segment.toLowerCase());
}

function entryProblem(entry: string): string | null {
    if (entry === '') return 'must not be empty';
    if (/[\0\r\n\\*?[]/.test(entry)) return 'must not contain a backslash, wildcard, NUL or line break';
    if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return 'must be relative to the project root';
    if (entry.endsWith('/')) return 'must not end with "/"';
    const segments = entry.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return 'must not contain an empty, "." or ".." segment';
    if (segments.some(isReservedSegment)) return 'must not exclude .git or .awm';
    return null;
}

/** Strict parser for the optional `.awm/admission.json`; absent means AWM defaults. */
export function loadAdmissionConfig(projectRoot: string): AdmissionConfigResult {
    const root = requireRoot(projectRoot, 'admission config projectRoot');
    const invalid = (field: string, message: string): AdmissionConfigResult => ({ ok: false, field, message });
    let raw: string;
    try {
        raw = fs.readFileSync(path.join(root, '.awm', 'admission.json'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, config: { defaults: true, rules: defaultRules() } };
        return invalid('(file)', 'could not be read');
    }
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return invalid('(file)', 'is not valid JSON'); }
    if (!isRecord(value)) return invalid('(root)', 'must be a JSON object');
    const unknownRoot = Object.keys(value).find(key => key !== 'schemaVersion' && key !== 'readOnlyObservation');
    if (unknownRoot !== undefined) return invalid(fieldLabel(unknownRoot), 'is not a known field');
    if (value.schemaVersion !== 1) return invalid('schemaVersion', 'must be 1');
    const observation = 'readOnlyObservation' in value ? value.readOnlyObservation : {};
    if (!isRecord(observation)) return invalid('readOnlyObservation', 'must be an object');
    const unknownObservation = Object.keys(observation).find(key => key !== 'defaults' && key !== 'exclude');
    if (unknownObservation !== undefined) return invalid(`readOnlyObservation.${fieldLabel(unknownObservation)}`, 'is not a known field');
    const defaults = 'defaults' in observation ? observation.defaults : true;
    if (typeof defaults !== 'boolean') return invalid('readOnlyObservation.defaults', 'must be a boolean');
    const exclude = 'exclude' in observation ? observation.exclude : [];
    if (!Array.isArray(exclude)) return invalid('readOnlyObservation.exclude', 'must be an array of strings');
    const rules = defaults ? defaultRules() : [];
    for (const [index, entry] of exclude.entries()) {
        const field = `readOnlyObservation.exclude[${index}]`;
        if (typeof entry !== 'string') return invalid(field, 'must be a string');
        const problem = entryProblem(entry);
        if (problem) return invalid(field, problem);
        rules.push(entry.includes('/') ? { kind: 'path', path: entry } : { kind: 'name', name: entry });
    }
    return { ok: true, config: { defaults, rules } };
}

/**
 * Rule matching plus cached verdicts. The same policy instance serves the before and
 * after snapshots, so a candidate is verified once and both passes agree.
 */
export function createExclusionPolicy(config: AdmissionConfig, verifier: CandidateVerifier): ExclusionPolicy {
    if (!config || !Array.isArray(config.rules) || typeof config.defaults !== 'boolean') throw new Error('exclusion policy requires a validated admission config');
    if (typeof verifier !== 'function') throw new Error('exclusion policy requires a candidate verifier');
    const names = new Set(config.rules.flatMap(rule => (rule.kind === 'name' ? [rule.name] : [])));
    const paths = new Set(config.rules.flatMap(rule => (rule.kind === 'path' ? [rule.path] : [])));
    const verdicts = new Map<string, CandidateVerdict>();
    return {
        isExcluded(relativePath, name) {
            // .git and .awm are never excluded, at any depth, nor anything inside them (B-R5).
            if (relativePath.split('/').some(isReservedSegment)) return false;
            if (!names.has(name) && !paths.has(relativePath)) return false;
            let verdict = verdicts.get(relativePath);
            if (verdict === undefined) {
                verdict = verifier(relativePath);
                verdicts.set(relativePath, verdict);
            }
            return verdict === 'excluded';
        },
        evidence() {
            const excluded: string[] = [];
            const rejected: ReadOnlyCandidateRejection[] = [];
            const sorted = [...verdicts.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
            for (const [candidate, verdict] of sorted) {
                if (verdict === 'excluded') excluded.push(candidate);
                else rejected.push({ path: candidate, reason: verdict });
            }
            return { defaults: config.defaults, excluded, rejected };
        },
    };
}

/** Git decides: no tracked file inside (checked first) and ignored. Any doubt observes. */
export function gitVerifier(projectRoot: string, env: NodeJS.ProcessEnv = process.env): CandidateVerifier {
    const cwd = requireRoot(projectRoot, 'git verifier projectRoot');
    const git = (args: string[]) => spawnSync('git', args, {
        cwd,
        env,
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    return relativePath => {
        // Git reads magic prefixes (":(top)", ":/") even after "--"; a leading "./"
        // makes the candidate an ordinary relative pathspec, so a directory that is
        // literally named like magic is never mistaken for a different path.
        const pathspec = `./${relativePath}`;
        // Tracked first: git already reports a directory holding a force-added file
        // as not ignored, which would hide the more precise reason.
        const tracked = git(['ls-files', '-z', '--', pathspec]);
        if ((tracked.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS') return 'contains-tracked';
        if (tracked.error || tracked.status !== 0) return 'git-unavailable';
        if (tracked.stdout !== '') return 'contains-tracked';
        const ignored = git(['check-ignore', '-q', '--', pathspec]);
        if (ignored.error) return 'git-unavailable';
        if (ignored.status === 0) return 'excluded';
        return ignored.status === 1 ? 'not-ignored' : 'git-unavailable';
    };
}

class SnapshotLimitError extends Error {
    constructor(readonly failure: 'limit-entries' | 'limit-bytes') {
        super(failure);
    }
}

/**
 * A git status only sees tracked and non-ignored paths, while a sensor can mutate
 * ignored runtime files (notably `.awm/`) just as easily, so the actual tree is
 * hashed. The walk is bounded: inability to observe the whole declared project means
 * no admission certificate. Excluded directories contribute nothing; observed
 * directories are hashed without their size, which changes as entries come and go
 * and is already covered by their children.
 */
export function filesystemSnapshot(root: string, policy?: ExclusionPolicy, limits: SnapshotLimits = DEFAULT_LIMITS): SnapshotResult {
    requireRoot(root, 'snapshot root');
    if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1 || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
        throw new Error('snapshot limits must be positive integers');
    }
    try {
        const digest = crypto.createHash('sha256');
        let entriesSeen = 0;
        let bytesSeen = 0;
        const visit = (directory: string, relative: string): void => {
            const entries = fs.readdirSync(directory, { withFileTypes: true })
                .sort((left, right) => left.name.localeCompare(right.name));
            for (const entry of entries) {
                // Git's internal bookkeeping changes as a consequence of normal
                // observation, not project sensor execution.
                if (relative === '' && entry.name === '.git') continue;
                const child = path.join(directory, entry.name);
                const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
                const stat = fs.lstatSync(child);
                if (stat.isDirectory() && policy?.isExcluded(childRelative, entry.name)) continue;
                if (++entriesSeen > limits.maxEntries) throw new SnapshotLimitError('limit-entries');
                if (stat.isDirectory()) {
                    digest.update(`${childRelative}\0${stat.mode}\0directory\0`);
                    visit(child, childRelative);
                    continue;
                }
                digest.update(`${childRelative}\0${stat.mode}\0${stat.size}\0`);
                if (stat.isFile()) {
                    if ((bytesSeen += stat.size) > limits.maxBytes) throw new SnapshotLimitError('limit-bytes');
                    digest.update('file\0');
                    digest.update(fs.readFileSync(child));
                } else if (stat.isSymbolicLink()) {
                    digest.update(`symlink\0${fs.readlinkSync(child)}\0`);
                } else {
                    digest.update(`special\0${stat.rdev}\0`);
                }
            }
        };
        visit(root, '');
        return { ok: true, digest: digest.digest('hex') };
    } catch (error) {
        return { ok: false, failure: error instanceof SnapshotLimitError ? error.failure : 'unreadable' };
    }
}

export function snapshotUnavailableRemedy(failure: SnapshotFailure): string {
    if (failure === 'unreadable') return 'run admission from a readable git worktree';
    const limit = failure === 'limit-bytes' ? `${READ_ONLY_MAX_BYTES / 1024 ** 3} GiB of observed file content` : `${READ_ONLY_MAX_ENTRIES} observed entries`;
    return `the project tree exceeds the read-only observation limit of ${limit}; git-ignore heavy generated directories `
        + `(ignored ${DEFAULT_EXCLUSION_NAMES.join(', ')} are skipped by default) or declare them in ${ADMISSION_CONFIG_LABEL} readOnlyObservation.exclude`;
}

export function admissionConfigRemedy(problem: { field: string; message: string }): string {
    return `repair ${ADMISSION_CONFIG_LABEL}: ${problem.field} ${problem.message}`;
}
