/// <reference path="../../types/picomatch-posix.d.ts" />
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import picomatch from 'picomatch/posix';
import { runGit } from '../../core/changes/git';

/**
 * Picomatch options for sensor input digests (RF-1.5 / RF-1.6).
 * `dot: true` so patterns like `*` match `.env`; `posix: true` enables POSIX
 * character classes. No `nocase` — paths come from `git ls-files` (already
 * normalized). Callers force POSIX path separators via `picomatch/posix`.
 */
export const PICOMATCH_DIGEST_OPTIONS = { dot: true, posix: true } as const;

/** Explicit marker contributed when a listed path is gone (ENOENT on lstat). */
export const ABSENT_MARKER = 'ABSENT';

/** Hard ceiling on file content hashed into a digest contribution (QA-6). */
export const MAX_DIGEST_FILE_BYTES = 1024 * 1024;

// Baseline is re-applied every run (RF-2.13) and must never enter the cache
// digest (RF-2.12), even when authored globs like **/*.json would match it.
/** Repo-root-relative path of the baseline file (never cache-digest measured). */
export const CACHE_DIGEST_BASELINE_REL = '.awm/sensors.baseline.json';

function isExcludedFromCacheDigest(repoRel: string): boolean {
    const norm = repoRel.split(path.sep).join('/');
    return norm === CACHE_DIGEST_BASELINE_REL || norm.endsWith('/' + CACHE_DIGEST_BASELINE_REL);
}

const LOCKFILE_NAMES = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'Pipfile.lock',
    'poetry.lock',
    'uv.lock',
] as const;

export type DigestContribution = {
    path: string;
    kind: 'file' | 'symlink' | 'absent';
    hash: string;
    marker?: typeof ABSENT_MARKER;
};

export type CacheInputDigestOk = {
    ok: true;
    digest: string;
    matchedPaths: string[];
    contributions: DigestContribution[];
};

export type CacheInputDigestResult = CacheInputDigestOk | { ok: false; reason: 'git-failed' };

export type AlwaysMeasuredInput = {
    sensorsJsonRel: string;
    assetRels: string[];
    configFileRels: string[];
    includePackageJson: boolean;
    /** Repo-root-relative package directory (empty string for root, `cli` for monorepo). */
    packageRootRel: string;
};

/**
 * Repo-root-relative path safety (QA-2): nonempty POSIX segments, no `.` / `..`,
 * no absolute / drive / backslash forms.
 */
export function isSafeRepoRel(repoRel: string): boolean {
    if (typeof repoRel !== 'string' || repoRel.length === 0 || repoRel !== repoRel.trim()) return false;
    if (repoRel.includes('\\') || repoRel.startsWith('/') || /^[A-Za-z]:/.test(repoRel)) return false;
    return repoRel.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function requireSafeRepoRel(repoRel: string, label: string): string {
    const norm = repoRel.split(path.sep).join('/');
    if (!isSafeRepoRel(norm)) throw new Error(`${label} must be a safe relative path (no ., .., absolute, or escape)`);
    return norm;
}

function resolveRealPath(p: string): string {
    const resolved = path.resolve(p);
    try {
        return fs.realpathSync.native(resolved);
    } catch {
        try {
            return fs.realpathSync(resolved);
        } catch {
            return resolved;
        }
    }
}

function posixRel(from: string, to: string): string {
    return path.relative(from, to).split(path.sep).join('/');
}

/**
 * Repo-root-relative POSIX path from an absolute (or cwd-relative) path.
 * Realpaths both sides before `path.relative` so Windows drive-letter / casing /
 * separator mismatches (git toplevel vs Node paths) cannot yield an absolute
 * relative string that later fails `isSafeRepoRel`.
 */
export function toSafeRepoRel(gitRoot: string, absolutePath: string, label = 'path'): string {
    if (typeof gitRoot !== 'string' || gitRoot.trim() === '') throw new Error('gitRoot must be a nonempty string');
    if (typeof absolutePath !== 'string' || absolutePath.trim() === '') {
        throw new Error(`${label} must be a nonempty string`);
    }
    const from = resolveRealPath(gitRoot);
    const to = resolveRealPath(absolutePath);
    const rel = posixRel(from, to);
    // Empty means the same path; sensors.json / package roots used here are always nested or equal.
    // Equal packageRoot → '' is allowed only when callers opt in via allowEmpty.
    if (rel === '') return '';
    if (path.win32.isAbsolute(rel) || path.posix.isAbsolute(rel) || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) {
        throw new Error(`${label} must resolve under gitRoot`);
    }
    return requireSafeRepoRel(rel, label);
}

function staysUnderRoot(rootReal: string, candidate: string): boolean {
    const rel = path.relative(rootReal, candidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function joinRepoRel(packageRootRel: string, file: string): string {
    if (typeof packageRootRel !== 'string') throw new Error('packageRootRel must be a string');
    if (typeof file !== 'string' || file.length === 0) throw new Error('file must be a nonempty string');
    const cleaned = requireSafeRepoRel(file.replace(/^\/+/, ''), 'path');
    if (packageRootRel === '') return cleaned;
    const rootRel = requireSafeRepoRel(packageRootRel.replace(/\/+$/, ''), 'packageRootRel');
    return `${rootRel}/${cleaned}`;
}

/** Build the always-measured path set for the *cache* digest (RF-2.12). Never includes baseline.json. */
export function buildAlwaysMeasuredPaths(input: AlwaysMeasuredInput): string[] {
    if (!input || typeof input !== 'object') throw new Error('always-measured input must be an object');
    if (typeof input.includePackageJson !== 'boolean') throw new Error('includePackageJson must be a boolean');
    if (typeof input.packageRootRel !== 'string') throw new Error('packageRootRel must be a string');
    if (!Array.isArray(input.assetRels) || !Array.isArray(input.configFileRels)) {
        throw new Error('assetRels and configFileRels must be arrays');
    }

    const out = new Set<string>();
    out.add(requireSafeRepoRel(input.sensorsJsonRel.split(path.sep).join('/'), 'sensorsJsonRel'));
    for (const asset of input.assetRels) {
        if (typeof asset !== 'string' || asset.length === 0) throw new Error('asset path must be a nonempty string');
        out.add(joinRepoRel(input.packageRootRel, asset));
    }
    for (const config of input.configFileRels) {
        if (typeof config !== 'string' || config.length === 0) throw new Error('configFile path must be a nonempty string');
        out.add(joinRepoRel(input.packageRootRel, config));
    }
    if (input.includePackageJson) {
        out.add(joinRepoRel(input.packageRootRel, 'package.json'));
        for (const lock of LOCKFILE_NAMES) out.add(joinRepoRel(input.packageRootRel, lock));
    } else {
        for (const lock of LOCKFILE_NAMES) out.add(joinRepoRel(input.packageRootRel, lock));
    }
    return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function listGitFiles(gitRoot: string): string[] | null {
    const out = runGit(gitRoot, ['ls-files', '-co', '--exclude-standard', '-z']);
    if (out === null) return null;
    return out.split('\0').filter((p) => p.length > 0);
}

function matchGlobs(repoRel: string, packageRootRel: string, matchers: Array<(p: string) => boolean>): boolean {
    let packageRel = repoRel;
    if (packageRootRel) {
        const prefix = packageRootRel.endsWith('/') ? packageRootRel : `${packageRootRel}/`;
        if (repoRel !== packageRootRel && !repoRel.startsWith(prefix)) return false;
        packageRel = repoRel === packageRootRel ? '' : repoRel.slice(prefix.length);
    }
    if (packageRel.length === 0) return false;
    return matchers.some((m) => m(packageRel));
}

/**
 * Whether a repo-root POSIX path matches authored sensor `inputs` globs under
 * `packageRootRel` (RF-1.5 picomatch options). Used by receipt late-path validate
 * so new files matching inputs count as measured (RF-4.5), not only the frozen list.
 */
export function repoPathMatchesInputGlobs(
    repoRel: string,
    packageRootRel: string,
    inputGlobs: string[],
): boolean {
    if (typeof repoRel !== 'string' || typeof packageRootRel !== 'string') return false;
    if (!Array.isArray(inputGlobs) || inputGlobs.some((g) => typeof g !== 'string')) return false;
    const norm = repoRel.split(path.sep).join('/');
    if (!isSafeRepoRel(norm)) return false;
    if (packageRootRel !== '' && !isSafeRepoRel(packageRootRel)) return false;
    const matchers = inputGlobs.map((glob) => picomatch(glob, { ...PICOMATCH_DIGEST_OPTIONS }));
    return matchGlobs(norm, packageRootRel, matchers);
}

function absentContribution(repoRel: string, reason: string): DigestContribution {
    return {
        path: repoRel,
        kind: 'absent',
        marker: ABSENT_MARKER,
        hash: crypto.createHash('sha256').update(`ABSENT:${reason}:${repoRel}`).digest('hex'),
    };
}

/**
 * Hash one matched path without following intermediate symlinks (QA-1) and
 * without reading files that escape gitRoot or exceed the size cap (QA-2/QA-6).
 */
function hashContribution(gitRootReal: string, repoRel: string): DigestContribution {
    if (!isSafeRepoRel(repoRel)) return absentContribution(repoRel, 'unsafe-rel');

    const segments = repoRel.split('/');
    let current = gitRootReal;
    for (let i = 0; i < segments.length; i++) {
        current = path.join(current, segments[i]!);
        if (!staysUnderRoot(gitRootReal, current)) return absentContribution(repoRel, 'escape');

        let st: fs.Stats;
        try {
            st = fs.lstatSync(current);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return absentContribution(repoRel, 'enoent');
            throw error;
        }

        const isLast = i === segments.length - 1;
        if (st.isSymbolicLink()) {
            // Intermediate symlink → fail closed (never read through redirected parents).
            if (!isLast) return absentContribution(repoRel, 'intermediate-symlink');
            const target = fs.readlinkSync(current);
            return {
                path: repoRel,
                kind: 'symlink',
                hash: crypto.createHash('sha256').update(`symlink:${target}`).digest('hex'),
            };
        }
        if (!isLast) {
            if (!st.isDirectory()) return absentContribution(repoRel, 'not-dir');
            continue;
        }
        if (!st.isFile()) return absentContribution(repoRel, 'not-file');
        if (st.size > MAX_DIGEST_FILE_BYTES) return absentContribution(repoRel, 'oversize');
        const content = fs.readFileSync(current);
        return {
            path: repoRel,
            kind: 'file',
            hash: crypto.createHash('sha256').update(content).digest('hex'),
        };
    }
    return absentContribution(repoRel, 'empty');
}

/**
 * Compute the cache input digest (RF-2.1 / RF-2.12): git enumeration, picomatch
 * filter, symlink readlink / ABSENT / file content hashing. Never follows links.
 */
export function computeCacheInputDigest(opts: {
    gitRoot: string;
    packageRoot: string;
    inputGlobs: string[];
    alwaysMeasuredRepoRels: string[];
}): CacheInputDigestResult {
    if (!opts || typeof opts !== 'object') throw new Error('digest options must be an object');
    if (typeof opts.gitRoot !== 'string' || opts.gitRoot.trim() === '') throw new Error('gitRoot must be a nonempty string');
    if (typeof opts.packageRoot !== 'string' || opts.packageRoot.trim() === '') throw new Error('packageRoot must be a nonempty string');
    if (!Array.isArray(opts.inputGlobs) || opts.inputGlobs.some((g) => typeof g !== 'string')) {
        throw new Error('inputGlobs must be an array of strings');
    }
    if (!Array.isArray(opts.alwaysMeasuredRepoRels) || opts.alwaysMeasuredRepoRels.some((p) => typeof p !== 'string')) {
        throw new Error('alwaysMeasuredRepoRels must be an array of strings');
    }

    let gitRootReal: string;
    try {
        gitRootReal = fs.realpathSync(path.resolve(opts.gitRoot));
    } catch {
        return { ok: false, reason: 'git-failed' };
    }
    const packageRoot = path.resolve(opts.packageRoot);
    let packageRootReal: string;
    try {
        packageRootReal = fs.realpathSync(packageRoot);
    } catch {
        packageRootReal = packageRoot;
    }
    const packageRootRel = posixRel(gitRootReal, packageRootReal);
    if (packageRootRel.startsWith('..') || path.isAbsolute(packageRootRel)) {
        throw new Error('packageRoot must be inside gitRoot');
    }
    if (packageRootRel !== '' && !isSafeRepoRel(packageRootRel)) {
        throw new Error('packageRoot must be a safe relative path under gitRoot');
    }

    const listed = listGitFiles(gitRootReal);
    if (listed === null) return { ok: false, reason: 'git-failed' };

    const matchers = opts.inputGlobs.map((glob) => picomatch(glob, { ...PICOMATCH_DIGEST_OPTIONS }));
    const matched = new Set<string>();
    for (const repoRel of listed) {
        const norm = repoRel.split(path.sep).join('/');
        if (!isSafeRepoRel(norm) || isExcludedFromCacheDigest(norm)) continue;
        if (matchGlobs(norm, packageRootRel === '' ? '' : packageRootRel, matchers)) matched.add(norm);
    }
    for (const always of opts.alwaysMeasuredRepoRels) {
        const norm = always.split(path.sep).join('/');
        if (!isSafeRepoRel(norm)) {
            throw new Error(`alwaysMeasuredRepoRels entry must be a safe relative path (no ., .., absolute, or escape): ${norm}`);
        }
        if (isExcludedFromCacheDigest(norm)) continue;
        matched.add(norm);
    }

    const matchedPaths = [...matched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const contributions = matchedPaths.map((p) => hashContribution(gitRootReal, p));
    const canonical = contributions.map((c) => `${c.path}\0${c.kind}\0${c.hash}`).join('\n');
    const digest = `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
    return { ok: true, digest, matchedPaths, contributions };
}
