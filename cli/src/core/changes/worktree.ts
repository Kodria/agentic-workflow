import path from 'path';
import { execGit } from './git-env';
import { isSafeRelativePath } from './text-safety';

/** Local runtime state that never counts as a working-tree change. Everything else under `.awm/` (e.g. `.awm/sensors.json`) does. */
export const RUNTIME_STATE_EXCLUDES: readonly string[] = ['.awm/sensors/runs', '.awm/journal', '.awm/ledger', '.awm/evidence', '.awm/track.json'];

export const REASON_NOT_REPO = 'not inside a git repository with a commit';
export const REASON_GIT_FAILED = 'git command failed or timed out';

const MAX_EXTRA_EXCLUDES = 64;
const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

export type GitState =
    | { kind: 'ok'; root: string; commit: string; dirty: boolean }
    | { kind: 'not-repo' }
    | { kind: 'failed' };

/** A git that ran and exited non-zero (no repo, no commit) is `not-repo`; one that could not run, timed out or overflowed is `failed`. */
function gitFailure(error: unknown): GitState {
    return typeof (error as { status?: unknown }).status === 'number' ? { kind: 'not-repo' } : { kind: 'failed' };
}

/**
 * Repository root, HEAD and whether the tree differs from it, excluding RUNTIME_STATE_EXCLUDES.
 * `untracked` selects the pre-run measure (untracked files count, forced past any `status.showUntrackedFiles` config)
 * or the post-run recheck (tracked changes only). `extraExcludes` (default none) are repo-relative paths ignored in addition
 * to RUNTIME_STATE_EXCLUDES; any that is not a safe relative path makes the result `failed`. The root is returned with native
 * separators: git prints forward slashes on Windows. Never throws.
 */
export function gitState(cwd: string, untracked: boolean, extraExcludes: readonly string[] = []): GitState {
    if (typeof cwd !== 'string' || cwd.length === 0) return { kind: 'failed' };
    if (!Array.isArray(extraExcludes) || extraExcludes.length > MAX_EXTRA_EXCLUDES || !extraExcludes.every(isSafeRelativePath)) return { kind: 'failed' };
    let root: string; let commit: string;
    try {
        root = path.resolve(execGit(cwd, ['rev-parse', '--show-toplevel'], { stderr: 'ignore' }).trim());
        commit = execGit(root, ['rev-parse', 'HEAD'], { stderr: 'ignore' }).trim();
    } catch (error) {
        return gitFailure(error);
    }
    const dirty = treeDirty(root, untracked, extraExcludes);
    return dirty === null ? { kind: 'failed' } : { kind: 'ok', root, commit, dirty };
}

/**
 * Only the dirty measure of `gitState`, for a caller that already knows the repository root and does not need HEAD: one
 * `status` instead of three git processes. Null when git fails or an exclusion is unsafe (the caller fails closed). Never throws.
 */
export function treeDirty(root: string, untracked: boolean, extraExcludes: readonly string[] = []): boolean | null {
    if (typeof root !== 'string' || root.length === 0) return null;
    if (!Array.isArray(extraExcludes) || extraExcludes.length > MAX_EXTRA_EXCLUDES || !extraExcludes.every(isSafeRelativePath)) return null;
    try {
        // Submodules are never hidden by config (`.gitmodules` ignore=all, diff.ignoreSubmodules). The pre-run measure counts everything
        // (`none`); the post-run recheck is about tracked files only, so it also ignores untracked content inside a submodule
        // (sensor build/coverage output) while still seeing a moved checkout or modified tracked content (`untracked`).
        const args = ['status', '--porcelain', untracked ? '--untracked-files=normal' : '--untracked-files=no', untracked ? '--ignore-submodules=none' : '--ignore-submodules=untracked', '--', '.', ...RUNTIME_STATE_EXCLUDES.map((p) => `:(exclude)${p}`), ...extraExcludes.map((p) => `:(exclude,literal)${p}`)];
        return execGit(root, args, { stderr: 'ignore', maxBuffer: MAX_GIT_OUTPUT }).trim().length > 0;
    } catch {
        return null;
    }
}
