import path from 'path';
import { execFileSync } from 'child_process';
import { isSingleLine } from './text-safety';
import { RUNTIME_STATE_EXCLUDES, gitState } from './worktree';

// Every function here takes values that may be influenced by a user or by repository content (refs, paths, remote URLs).
// None of them throws: git failures and invalid input come back as null / false / true (fail closed) so that callers
// decide how to report them. Git runs without a shell, and a revision never reaches it unless it passed a whitelist.

const OPTS = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 16 * 1024 * 1024 };
const SAFE_REF = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_REF = 255;
const MAX_EXCLUDES = 64;
const MAX_PATH = 1024;
const MAX_IDENTITY = 300;

/** Runs git without a shell and returns its stdout, or null when it fails, times out, overflows or the input is invalid. */
export function runGit(cwd: string, args: string[]): string | null {
    if (typeof cwd !== 'string' || cwd.length === 0 || cwd.includes('\0')) return null;
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && !a.includes('\0'))) return null;
    try {
        return execFileSync('git', args, { ...OPTS, cwd });
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
    const parts = rev.split(/\.\.\.?/);
    return parts.length <= 2 && parts.every(isSafeRef);
}

/** A repo-relative path a record can hold: single line, no backslash, no empty / `.` / `..` segment, not absolute, not padded. */
export function isSafeRelativePath(p: unknown): p is string {
    if (!isSingleLine(p) || p.length === 0 || p.length > MAX_PATH || p !== p.trim()) return false;
    if (path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.includes('\\')) return false;
    return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

function isCommitRef(root: string, ref: unknown): ref is string {
    return isSafeRef(ref) && runGit(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]) !== null;
}

/** R3.1: --base, then origin/HEAD, then main, then master. Returns null when none resolves (or the explicit base is unsafe). */
export function resolveBase(root: string, explicit?: string): string | null {
    if (explicit !== undefined) return isCommitRef(root, explicit) ? explicit : null;
    for (const candidate of ['refs/remotes/origin/HEAD', 'main', 'master']) if (isCommitRef(root, candidate)) return candidate;
    return null;
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
    const out = runGit(root, ['diff', '--no-renames', '--name-only', '-z', '--end-of-options', from, to, '--']);
    return out === null ? null : out.split('\0').filter(Boolean);
}

function isSafeExcludeList(excludes: unknown): excludes is string[] {
    return Array.isArray(excludes) && excludes.length <= MAX_EXCLUDES && excludes.every(isSafeRelativePath);
}

/**
 * Whether the tree differs from HEAD outside RUNTIME_STATE_EXCLUDES and `extraExcludes` (untracked files count).
 * Unknown state counts as dirty: an unreadable repository must never look clean.
 */
export function isDirtyOutside(root: string, extraExcludes: string[]): boolean {
    if (!isSafeExcludeList(extraExcludes)) return true;
    const state = gitState(root, true);
    if (state.kind !== 'ok') return true;
    if (!state.dirty || extraExcludes.length === 0) return state.dirty;
    // gitState has no parameter for extra exclusions, so the narrowed question is asked with the same exclusion list plus theirs.
    const specs = [...RUNTIME_STATE_EXCLUDES, ...extraExcludes].map((p) => `:(exclude,literal)${p}`);
    const out = runGit(state.root, ['status', '--porcelain', '--untracked-files=normal', '--', '.', ...specs]);
    return out === null || out.trim().length > 0;
}

/** Repository root with native separators; null outside a repository (with a commit). */
export function repoRoot(cwd: string): string | null {
    const state = gitState(cwd, false);
    return state.kind === 'ok' ? state.root : null;
}

export function headSha(root: string): string | null {
    const state = gitState(root, false);
    return state.kind === 'ok' ? state.commit : null;
}

/** `host/owner/name` from remote.origin.url with credentials stripped; null when absent, unparseable or not single-line. */
export function repoIdentity(root: string): string | null {
    const url = runGit(root, ['config', '--get', 'remote.origin.url'])?.trim();
    if (!url) return null;
    let identity: string | null = null;
    const scp = /^[^@/]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(url);
    if (scp) {
        identity = `${scp[1]}/${scp[2]}`;
    } else {
        try {
            const u = new URL(url);
            const p = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
            identity = u.hostname && p ? `${u.hostname}/${p}` : null;
        } catch {
            identity = null;
        }
    }
    return identity !== null && isSingleLine(identity) && identity.length <= MAX_IDENTITY ? identity : null;
}
