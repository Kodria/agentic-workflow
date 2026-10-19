import { DEFAULT_BASES, baseCandidates, commitSha, headSha, isSafeRef, mergeBase, resolveBaseCommit } from './git';
import type { RecordDir } from './record-io';
import { esc, isObj } from './text-safety';
import { RECORD_DIR } from './types';

// What `awm change new` and `awm change validate` (and the commands after them) share: the commit range of the branch, the check
// that HEAD did not move while it was being examined, and the wording for an unusable `docs/changes/`. Pure data in, plain
// failure values out (a command turns a Failure into its own output); nothing here throws or imports a command.

/** An operational failure: a diagnostic code, one message (untrusted text already escaped) and an optional static remedy. */
export interface Failure { code: string; message: string; remedy?: string }

const REMEDY_BASE = 'pass --base <ref>';
/** R3.1: the `--base` help text of `change new`, `change validate` and `changes list`: `DEFAULT_BASES` (git.ts) in order, remotes without `refs/remotes/`. */
export const BASE_OPTION_HELP = `base branch (default: ${DEFAULT_BASES.map((c) => c.name.replace(/^refs\/remotes\//, '')).join(', ')})`;
export const HEAD_MOVED: Failure = { code: 'head-moved', message: 'HEAD moved during derivation' };

const KINDS: readonly string[] = ['ok', 'absent', 'unsafe', 'error'];

export type Range = { ok: true; head: string; mergeBase: string } | { ok: false; failure: Failure };
/** The base ref and the id of the commit it names. */
export type BaseRef = { ok: true; base: string; sha: string } | { ok: false; failure: Failure };

const failure = (code: string, message: string, remedy?: string): { ok: false; failure: Failure } => ({ ok: false, failure: remedy === undefined ? { code, message } : { code, message, remedy } });
const unsafeBase = (explicitBase: string): { ok: false; failure: Failure } => failure('invalid-input', `--base "${esc(explicitBase)}" is not a safe git ref`);

/**
 * R3.1/R3.2/R3.5, for `changes list`: the base ref: `explicitBase` (checked with `isSafeRef` before git sees it: `invalid-input`),
 * else the first default candidate that names a commit (no merge base is needed); `base-unresolved` when none does. The order of the
 * candidates has one source, `baseCandidates` (git.ts), shared with `resolveRange`.
 */
export function resolveBaseRef(root: string, explicitBase: string | undefined): BaseRef {
    if (explicitBase !== undefined && !isSafeRef(explicitBase)) return unsafeBase(explicitBase);
    const resolved = resolveBaseCommit(root, explicitBase);
    return resolved === null ? failure('base-unresolved', 'could not resolve a base branch', REMEDY_BASE) : { ok: true, ...resolved };
}

/**
 * R3.1/R3.2/R3.5, for `change new` and `change validate`: pins HEAD, then resolves the base and its merge base with HEAD, over the
 * same `baseCandidates` (git.ts) as `resolveBaseRef` but also requiring a merge base. An explicit `--base` (checked with `isSafeRef`
 * before git sees it) is the only candidate. Without it (R3.1 amended, Q7), the first default candidate that names a commit AND has
 * a merge base with HEAD: a shallow remote ref that does not reach HEAD gives way to the next.
 * The merge base is computed from the commit id the candidate resolved to, never from its name read a second time (Q9).
 */
export function resolveRange(root: string, explicitBase: string | undefined): Range {
    const head = headSha(root);
    if (head === null) return failure('git-failed', 'git could not read HEAD');
    if (explicitBase !== undefined && !isSafeRef(explicitBase)) return unsafeBase(explicitBase);
    let named: string | null = null;
    for (const { ref, name } of baseCandidates(root, explicitBase)) {
        const sha = commitSha(root, ref);
        if (sha === null) continue;
        named ??= name;
        const mergeBaseSha = mergeBase(root, sha);
        if (mergeBaseSha !== null) return { ok: true, head, mergeBase: mergeBaseSha };
    }
    if (named === null) return failure('base-unresolved', 'could not resolve a base branch', REMEDY_BASE);
    return failure('base-unresolved', `no merge base between "${esc(named)}" and HEAD`, REMEDY_BASE);
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
