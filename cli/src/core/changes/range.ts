import { headSha, isSafeRef, mergeBase, resolveBaseCommit } from './git';
import type { RecordDir } from './record-io';
import { esc, isObj } from './text-safety';
import { RECORD_DIR } from './types';

// What `awm change new` and `awm change validate` (and the commands after them) share: the commit range of the branch, the check
// that HEAD did not move while it was being examined, and the wording for an unusable `docs/changes/`. Pure data in, plain
// failure values out (a command turns a Failure into its own output); nothing here throws or imports a command.

/** An operational failure: a diagnostic code, one message (untrusted text already escaped) and an optional static remedy. */
export interface Failure { code: string; message: string; remedy?: string }

const REMEDY_BASE = 'pass --base <ref>';
export const HEAD_MOVED: Failure = { code: 'head-moved', message: 'HEAD moved during derivation' };

const KINDS: readonly string[] = ['ok', 'absent', 'unsafe', 'error'];

export type Range = { ok: true; head: string; mergeBase: string } | { ok: false; failure: Failure };
/** The base ref and the id of the commit it names. */
export type BaseRef = { ok: true; base: string; sha: string } | { ok: false; failure: Failure };

const failure = (code: string, message: string, remedy?: string): { ok: false; failure: Failure } => ({ ok: false, failure: remedy === undefined ? { code, message } : { code, message, remedy } });

/**
 * R3.1/R3.2/R3.5: the base ref: `explicitBase` (checked with `isSafeRef` before git sees it: `invalid-input`), else origin/HEAD,
 * origin/main, origin/master, main, master; `base-unresolved` when none resolves. The one place that decides it, for `change new`, `change validate` and `changes list`.
 */
export function resolveBaseRef(root: string, explicitBase: string | undefined): BaseRef {
    if (explicitBase !== undefined && !isSafeRef(explicitBase)) return failure('invalid-input', `--base "${esc(explicitBase)}" is not a safe git ref`);
    const resolved = resolveBaseCommit(root, explicitBase);
    return resolved === null ? failure('base-unresolved', 'could not resolve a base branch', REMEDY_BASE) : { ok: true, ...resolved };
}

/**
 * R3.1/R3.2/R3.5: pins HEAD, then resolves the base (explicit `--base`, else origin/HEAD, origin/main, origin/master, main, master) and its merge base with HEAD.
 * An explicit base is checked with `isSafeRef` before git sees it.
 */
export function resolveRange(root: string, explicitBase: string | undefined): Range {
    const head = headSha(root);
    if (head === null) return failure('git-failed', 'git could not read HEAD');
    const resolved = resolveBaseRef(root, explicitBase);
    if (!resolved.ok) return resolved;
    const mergeBaseSha = mergeBase(root, resolved.base);
    if (mergeBaseSha === null) return failure('base-unresolved', `no merge base between "${esc(resolved.base)}" and HEAD`, REMEDY_BASE);
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
export function recordDirProblem(dir: Exclude<RecordDir, { kind: 'ok' }>, purpose: 'create'): Failure;
export function recordDirProblem(dir: RecordDir, purpose: 'read' | 'write'): Failure | null;
export function recordDirProblem(dir: RecordDir, purpose: 'read' | 'write' | 'create'): Failure | null {
    if (!isObj(dir) || !KINDS.includes(dir.kind)) return { code: 'invalid-input', message: 'the record directory state is not valid' };
    if (dir.kind === 'unsafe') return { code: 'unsafe-path', message: `${RECORD_DIR} or its parent is a symlink or not a directory; refusing to ${purpose === 'read' ? 'read' : 'write'}` };
    if (dir.kind === 'error' || (dir.kind === 'absent' && purpose === 'create')) return { code: 'io-failed', message: `could not ${purpose === 'create' ? 'create' : 'inspect'} ${RECORD_DIR}` };
    return null;
}
