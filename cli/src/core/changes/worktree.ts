import path from 'path';
import { execFileSync } from 'child_process';

/** Local runtime state that never counts as a working-tree change. Everything else under `.awm/` (e.g. `.awm/sensors.json`) does. */
export const RUNTIME_STATE_EXCLUDES: readonly string[] = ['.awm/sensors/runs', '.awm/journal', '.awm/ledger', '.awm/evidence', '.awm/track.json'];

export const REASON_NOT_REPO = 'not inside a git repository with a commit';
export const REASON_GIT_FAILED = 'git command failed or timed out';

const MAX_GIT_OUTPUT = 64 * 1024 * 1024;
const GIT_OPTS = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'], timeout: 15000 };

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
 * or the post-run recheck (tracked changes only). The root is returned with native separators: git prints
 * forward slashes on Windows. Never throws.
 */
export function gitState(cwd: string, untracked: boolean): GitState {
    if (typeof cwd !== 'string' || cwd.length === 0) return { kind: 'failed' };
    let root: string; let commit: string;
    try {
        root = path.resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { ...GIT_OPTS, cwd }).trim());
        commit = execFileSync('git', ['rev-parse', 'HEAD'], { ...GIT_OPTS, cwd: root }).trim();
    } catch (error) {
        return gitFailure(error);
    }
    try {
        const args = ['status', '--porcelain', untracked ? '--untracked-files=normal' : '--untracked-files=no', '--', '.', ...RUNTIME_STATE_EXCLUDES.map((p) => `:(exclude)${p}`)];
        const status = execFileSync('git', args, { ...GIT_OPTS, cwd: root, maxBuffer: MAX_GIT_OUTPUT });
        return { kind: 'ok', root, commit, dirty: status.trim().length > 0 };
    } catch {
        return { kind: 'failed' };
    }
}
