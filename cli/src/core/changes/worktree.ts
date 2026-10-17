import path from 'path';
import { execFileSync } from 'child_process';
import { gitSpawnOptions } from './git-env';
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
        root = path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], gitSpawnOptions(cwd, { stderr: 'ignore' })).trim());
        commit = execFileSync('git', ['rev-parse', 'HEAD'], gitSpawnOptions(root, { stderr: 'ignore' })).trim();
    } catch (error) {
        return gitFailure(error);
    }
    try {
        const args = ['status', '--porcelain', untracked ? '--untracked-files=normal' : '--untracked-files=no', '--ignore-submodules=none', '--', '.', ...RUNTIME_STATE_EXCLUDES.map((p) => `:(exclude)${p}`), ...extraExcludes.map((p) => `:(exclude,literal)${p}`)];
        const status = execFileSync('git', args, gitSpawnOptions(root, { stderr: 'ignore', maxBuffer: MAX_GIT_OUTPUT }));
        return { kind: 'ok', root, commit, dirty: status.trim().length > 0 };
    } catch {
        return { kind: 'failed' };
    }
}
