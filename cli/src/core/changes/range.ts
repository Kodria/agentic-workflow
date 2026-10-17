import { headSha, isSafeRef, mergeBase, resolveBase } from './git';
import type { RecordDir } from './record-io';
import { esc } from './text-safety';
import { RECORD_DIR } from './types';

// What `awm change new` and `awm change validate` (and the commands after them) share: the commit range of the branch, the check
// that HEAD did not move while it was being examined, and the wording for an unusable `docs/changes/`. Pure data in, plain
// failure values out (a command turns a Failure into its own output); nothing here throws or imports a command.

/** An operational failure: a diagnostic code, one message (untrusted text already escaped) and an optional static remedy. */
export interface Failure { code: string; message: string; remedy?: string }

export const REMEDY_BASE = 'pass --base <ref>';
export const HEAD_MOVED: Failure = { code: 'git-failed', message: 'HEAD moved during derivation' };

export type Range = { ok: true; head: string; mergeBase: string } | { ok: false; failure: Failure };

/**
 * R3.1/R3.2/R3.5: pins HEAD, then resolves the base (explicit `--base`, else origin/HEAD, main, master) and its merge base with HEAD.
 * An explicit base is checked with `isSafeRef` before git sees it.
 */
export function resolveRange(root: string, explicitBase: string | undefined): Range {
    const fail = (code: string, message: string, remedy?: string): Range => ({ ok: false, failure: remedy === undefined ? { code, message } : { code, message, remedy } });
    const head = headSha(root);
    if (head === null) return fail('git-failed', 'git could not read HEAD');
    if (explicitBase !== undefined && !isSafeRef(explicitBase)) return fail('invalid-input', `--base "${esc(explicitBase)}" is not a safe git ref`);
    const base = resolveBase(root, explicitBase);
    if (base === null) return fail('base-unresolved', 'could not resolve a base branch', REMEDY_BASE);
    const mergeBaseSha = mergeBase(root, base);
    if (mergeBaseSha === null) return fail('base-unresolved', `no merge base between "${esc(base)}" and HEAD`, REMEDY_BASE);
    return { ok: true, head, mergeBase: mergeBaseSha };
}

/** `HEAD_MOVED` when HEAD is no longer `head` (or cannot be read), else null: a verdict about a moving target is never given. */
export function headMovedFailure(root: string, head: string): Failure | null {
    return headSha(root) === head ? null : HEAD_MOVED;
}

/**
 * The failure an unusable record directory stands for, or null when it is usable (or, for read and write, absent: the caller
 * decides what absence means). `create` is for the result of a creation attempt, where absent is a failure too.
 */
export function recordDirProblem(dir: RecordDir, purpose: 'read' | 'write' | 'create' | 'inspect'): Failure | null {
    if (dir.kind === 'unsafe') return { code: 'unsafe-path', message: `${RECORD_DIR} or its parent is a symlink or not a directory; refusing to ${purpose === 'read' ? 'read' : 'write'}` };
    if (dir.kind === 'error' || (dir.kind === 'absent' && purpose === 'create')) return { code: 'io-failed', message: `could not ${purpose === 'create' ? 'create' : 'inspect'} ${RECORD_DIR}` };
    return null;
}
