import path from 'path';
import { execGit, execGitBytes } from './git-env';
import { isSafeRelativePath, isSingleLine } from './text-safety';
import { COMMIT_ID } from './types';
import { gitState } from './worktree';

// Every function here takes values that may be influenced by a user or by repository content (refs, paths, remote URLs).
// None of them throws: git failures and invalid input come back as null / false / true (fail closed) so that callers
// decide how to report them. Git runs without a shell, and a revision never reaches it unless it passed a whitelist.

const MAX_OUTPUT = 16 * 1024 * 1024;
const SAFE_REF = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;
const MAX_REF = 255;
const MAX_IDENTITY = 300;
const MAX_REMOTE_URL = 2048;

/**
 * Every `git log` whose output is parsed must start with these. User and repository config would otherwise change that
 * output: `log.showSignature` prints verification text before each signed commit's formatted output, and
 * `i18n.logOutputEncoding` re-encodes it. (`log.decorate`, `log.mailmap`, notes and colour only affect placeholders or
 * default formats we do not use.)
 */
export const LOG_SAFETY_ARGS: readonly string[] = ['--no-show-signature', '--encoding=UTF-8'];

/** Runs git without a shell and returns its stdout, or null when it fails, times out, overflows or the input is invalid. */
export function runGit(cwd: string, args: string[]): string | null {
    if (typeof cwd !== 'string' || cwd.length === 0 || cwd.includes('\0')) return null;
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && !a.includes('\0'))) return null;
    try {
        return execGit(cwd, args, { maxBuffer: MAX_OUTPUT });
    } catch {
        return null;
    }
}

/** Like runGit, but returns the raw bytes of stdout (for content that must be decoded strictly); null on the same failures. */
export function runGitBytes(cwd: string, args: string[]): Buffer | null {
    if (typeof cwd !== 'string' || cwd.length === 0 || cwd.includes('\0')) return null;
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && !a.includes('\0'))) return null;
    try {
        return execGitBytes(cwd, args, { maxBuffer: MAX_OUTPUT });
    } catch {
        return null;
    }
}

/** A ref name that cannot be read as an option, a range, a revision expression or a path. */
export function isSafeRef(ref: unknown): ref is string {
    return typeof ref === 'string' && ref.length <= MAX_REF && SAFE_REF.test(ref) && !ref.includes('..');
}

/** A safe ref, or `a..b` / `a...b` made of two safe refs. */
export function isSafeRevision(rev: unknown): rev is string {
    if (typeof rev !== 'string') return false;
    if (rev.length > 2 * MAX_REF + 3) return false;
    const parts = rev.split(/\.\.\.?/);
    return parts.length <= 2 && parts.every(isSafeRef);
}

/**
 * R3.1: --base, then origin/HEAD, then main, then master: the first that names a commit, with that commit's id. Null when none
 * does (or the explicit base is unsafe). One `rev-parse` per candidate.
 */
export function resolveBaseCommit(root: string, explicit?: string): { base: string; sha: string } | null {
    for (const candidate of explicit !== undefined ? [explicit] : ['refs/remotes/origin/HEAD', 'main', 'master']) {
        const sha = commitSha(root, candidate);
        if (sha !== null) return { base: candidate, sha };
    }
    return null;
}

/** R3.1: the base ref (see resolveBaseCommit). Returns null when none resolves (or the explicit base is unsafe). */
export function resolveBase(root: string, explicit?: string): string | null {
    return resolveBaseCommit(root, explicit)?.base ?? null;
}

/** Full id of the common ancestor of `base` and HEAD; null when there is none or the input is invalid. */
export function mergeBase(root: string, base: string): string | null {
    if (!isSafeRef(base)) return null;
    const out = runGit(root, ['merge-base', '--end-of-options', base, 'HEAD'])?.trim();
    return out !== undefined && COMMIT_ID.test(out) ? out : null;
}

export function isAncestor(root: string, ancestor: string, descendant: string): boolean {
    if (!isSafeRef(ancestor) || !isSafeRef(descendant)) return false;
    return runGit(root, ['merge-base', '--is-ancestor', '--end-of-options', ancestor, descendant]) !== null;
}

/** Paths differing between two revisions, renames reported as delete + add, verbatim (untrusted). Null on failure. */
export function changedFiles(root: string, from: string, to = 'HEAD'): string[] | null {
    if (!isSafeRef(from) || !isSafeRef(to)) return null;
    // --no-renames: diff.renames would report a rename as one path. -c diff.relative=false: diff.relative would make paths relative to
    // the cwd and drop those outside it (the config form, unlike --no-relative, also works on git < 2.28). --ignore-submodules=none: diff.ignoreSubmodules / .gitmodules `ignore` would hide a
    // submodule bump. -z: core.quotePath never applies. diff.noprefix and colour do not affect --name-only.
    const out = runGit(root, ['-c', 'diff.relative=false', 'diff', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', '--end-of-options', from, to, '--']);
    return out === null ? null : out.split('\0').filter(Boolean);
}

/**
 * Files ADDED (not modified, not renamed-into: renames are off) between two revisions under the repo-relative directory `dir`,
 * verbatim (untrusted). Same safety flags as changedFiles. Null on failure or invalid input.
 */
export function addedFilesUnder(root: string, from: string, to: string, dir: string): string[] | null {
    if (!isSafeRef(from) || !isSafeRef(to) || !isSafeRelativePath(dir)) return null;
    const out = runGit(root, ['-c', 'diff.relative=false', 'diff', '--no-renames', '--ignore-submodules=none', '--diff-filter=A', '--name-only', '-z', '--end-of-options', from, to, '--', `:(top,literal)${dir}`]);
    return out === null ? null : out.split('\0').filter(Boolean);
}

/**
 * True when the tracked file `rel` (repo-relative, matched literally, from any directory) equals HEAD in both the index and the
 * working tree; false when it differs; null when that cannot be told (unsafe path, git failure). Untracked files are not looked at.
 * `--no-optional-locks`: `status` would otherwise refresh the index, and a read-only caller must not write it.
 */
export function isCommittedClean(root: string, rel: string): boolean | null {
    if (!isSafeRelativePath(rel)) return null;
    const out = runGit(root, ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=no', '--ignore-submodules=none', '--', `:(top,literal)${rel}`]);
    return out === null ? null : out.length === 0;
}

/**
 * Whether the tree differs from HEAD outside RUNTIME_STATE_EXCLUDES and `extraExcludes` (untracked files count).
 * Unknown state, or an unsafe exclusion, counts as dirty: an unreadable repository must never look clean.
 */
export function isDirtyOutside(root: string, extraExcludes: string[]): boolean {
    const state = gitState(root, true, extraExcludes);
    return state.kind !== 'ok' || state.dirty;
}

/** Repository root with native separators; null outside a repository. Only `rev-parse`: never a (slow, refreshing) `status`. */
export function repoRoot(cwd: string): string | null {
    const out = runGit(cwd, ['rev-parse', '--show-toplevel'])?.trim();
    return out ? path.resolve(out) : null;
}

/** Full id of the commit a safe ref names; null for an unsafe ref, no such commit or a git failure. Only `rev-parse`. */
export function commitSha(root: string, ref: string): string | null {
    if (!isSafeRef(ref)) return null;
    const out = runGit(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])?.trim();
    return out !== undefined && COMMIT_ID.test(out) ? out : null;
}

/** Full id of HEAD; null when there is no commit or git fails. Only `rev-parse`: never a `status`. */
export function headSha(root: string): string | null {
    return commitSha(root, 'HEAD');
}

/** Removes any run of `/` from the start and the end of `s` (index scan: linear, unlike /\/+$/). */
function trimSlashes(s: string): string {
    let start = 0; let end = s.length;
    while (start < end && s[start] === '/') start++;
    while (end > start && s[end - 1] === '/') end--;
    return s.slice(start, end);
}

/** `name` without one trailing `.git`. */
const withoutDotGit = (s: string): string => (s.endsWith('.git') ? s.slice(0, -4) : s);

/** `user@host:path` (scp-style); null when the text is not of that form. The host is lowercased like in the URL form. */
function scpIdentity(url: string): string | null {
    const at = url.indexOf('@');
    if (at < 1 || url.slice(0, at).includes('/')) return null;
    const colon = url.indexOf(':', at + 1);
    if (colon < 0) return null;
    const host = url.slice(at + 1, colon);
    if (host === '' || host.includes('/')) return null;
    const repo = withoutDotGit(trimSlashes(url.slice(colon + 1)));
    return repo === '' ? null : `${host.toLowerCase()}/${repo}`;
}

/** `host/owner/name` from remote.origin.url with credentials stripped; null when absent, unparseable, too long or not single-line. */
export function repoIdentity(root: string): string | null {
    const url = runGit(root, ['config', '--get', 'remote.origin.url'])?.trim();
    if (!url || url.length > MAX_REMOTE_URL) return null;
    let identity = scpIdentity(url);
    if (identity === null) {
        try {
            const u = new URL(url);
            const p = withoutDotGit(trimSlashes(u.pathname));
            identity = u.hostname && p ? `${u.hostname}/${p}` : null;
        } catch {
            identity = null;
        }
    }
    return identity !== null && isSingleLine(identity) && identity.length <= MAX_IDENTITY ? identity : null;
}
