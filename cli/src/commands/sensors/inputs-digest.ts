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
    /** Repo-root-relative package directory (`''` for root, `cli` for monorepo). */
    packageRootRel: string;
};

function posixRel(from: string, to: string): string {
    return path.relative(from, to).split(path.sep).join('/');
}

function joinRepoRel(packageRootRel: string, file: string): string {
    const cleaned = file.replace(/^\/+/, '');
    if (!packageRootRel) return cleaned;
    return `${packageRootRel.replace(/\/+$/, '')}/${cleaned}`;
}

/** Build the always-measured path set for the *cache* digest (RF-2.12). Never includes baseline.json. */
export function buildAlwaysMeasuredPaths(input: AlwaysMeasuredInput): string[] {
    if (!input || typeof input !== 'object') throw new Error('always-measured input must be an object');
    if (typeof input.sensorsJsonRel !== 'string' || input.sensorsJsonRel.length === 0) {
        throw new Error('sensorsJsonRel must be a nonempty string');
    }
    if (!Array.isArray(input.assetRels) || !Array.isArray(input.configFileRels)) {
        throw new Error('assetRels and configFileRels must be arrays');
    }
    if (typeof input.includePackageJson !== 'boolean') throw new Error('includePackageJson must be a boolean');
    if (typeof input.packageRootRel !== 'string') throw new Error('packageRootRel must be a string');

    const out = new Set<string>();
    out.add(input.sensorsJsonRel.split(path.sep).join('/'));
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

function hashContribution(gitRoot: string, repoRel: string): DigestContribution {
    const abs = path.join(gitRoot, ...repoRel.split('/'));
    let st: fs.Stats;
    try {
        st = fs.lstatSync(abs);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return {
                path: repoRel,
                kind: 'absent',
                marker: ABSENT_MARKER,
                hash: crypto.createHash('sha256').update(`ABSENT:${repoRel}`).digest('hex'),
            };
        }
        throw error;
    }
    if (st.isSymbolicLink()) {
        const target = fs.readlinkSync(abs);
        return {
            path: repoRel,
            kind: 'symlink',
            hash: crypto.createHash('sha256').update(`symlink:${target}`).digest('hex'),
        };
    }
    if (!st.isFile()) {
        return {
            path: repoRel,
            kind: 'absent',
            marker: ABSENT_MARKER,
            hash: crypto.createHash('sha256').update(`ABSENT:${repoRel}`).digest('hex'),
        };
    }
    const content = fs.readFileSync(abs);
    return {
        path: repoRel,
        kind: 'file',
        hash: crypto.createHash('sha256').update(content).digest('hex'),
    };
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

    const gitRoot = path.resolve(opts.gitRoot);
    const packageRoot = path.resolve(opts.packageRoot);
    const packageRootRel = posixRel(gitRoot, packageRoot);
    if (packageRootRel.startsWith('..')) throw new Error('packageRoot must be inside gitRoot');

    const listed = listGitFiles(gitRoot);
    if (listed === null) return { ok: false, reason: 'git-failed' };

    const matchers = opts.inputGlobs.map((glob) => picomatch(glob, { ...PICOMATCH_DIGEST_OPTIONS }));
    const matched = new Set<string>();
    for (const repoRel of listed) {
        if (matchGlobs(repoRel, packageRootRel === '' ? '' : packageRootRel, matchers)) matched.add(repoRel);
    }
    for (const always of opts.alwaysMeasuredRepoRels) {
        const norm = always.split(path.sep).join('/');
        if (listed.includes(norm) || fs.existsSync(path.join(gitRoot, ...norm.split('/')))) {
            matched.add(norm);
        } else {
            // Still contribute ABSENT for declared always-measured paths that are missing.
            matched.add(norm);
        }
    }

    const matchedPaths = [...matched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const contributions = matchedPaths.map((p) => hashContribution(gitRoot, p));
    const canonical = contributions.map((c) => `${c.path}\0${c.kind}\0${c.hash}`).join('\n');
    const digest = `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
    return { ok: true, digest, matchedPaths, contributions };
}
