import path from 'path';
import { determineBump, GIT_LOG_FORMAT, parseCommits, RS, type Commit } from '../../release/core';
import { LOG_SAFETY_ARGS, changedFiles, isSafeRelativePath, runGit } from './git';
import { esc, clipMessage, isSingleLine } from './text-safety';
import { RECORD_DIR, type DerivedFields, type Diagnostic, type Semver } from './types';

// Pathspecs relative to the repository top, so the result does not depend on the directory git runs in.
const ALL_FILES = ':/';
const EXCLUDE_RECORDS = `:(top,exclude,literal)${RECORD_DIR}`;
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PARSER_TYPE = /^\w+$/;
const RECORD_TYPE = /^[a-z]+$/;
const MODULE_DEPTH = 3;

/** Keeps the commits the release parser can produce (a `\w+` type, any spelling) with a scope that is usable text; anything else is ignored. */
function usable(commits: unknown): Commit[] {
    if (!Array.isArray(commits)) return [];
    const out: Commit[] = [];
    for (const c of commits as unknown[]) {
        if (typeof c !== 'object' || c === null) continue;
        const { type, scope, breaking, subject } = c as Partial<Commit>;
        if (typeof type !== 'string' || !PARSER_TYPE.test(type)) continue;
        const cleanScope = typeof scope === 'string' && scope.trim() !== '' && isSingleLine(scope) ? scope.trim() : null;
        out.push({ type, scope: cleanScope, breaking: breaking === true, subject: typeof subject === 'string' ? subject : '' });
    }
    return out;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * R3.3. `breaking` and `semver` cover every usable commit, with the release parser's exact-type semantics; the recorded type is
 * the highest-impact commit's type lowercased, or `other` when that is still not purely letters. Null when no commit is usable.
 */
export function deriveFromCommits(input: Commit[]): Omit<DerivedFields, 'modules'> | null {
    const commits = usable(input);
    if (commits.length === 0) return null;
    const breaking = commits.some((c) => c.breaking);
    const pick = commits.find((c) => c.breaking) ?? commits.find((c) => c.type === 'feat') ?? commits.find((c) => c.type === 'fix')
        ?? commits.find((c) => c.type === 'perf') ?? commits[0];
    const counts = new Map<string, number>();
    for (const c of commits) if (c.scope) counts.set(c.scope, (counts.get(c.scope) ?? 0) + 1);
    const scope = [...counts.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))[0]?.[0] ?? null;
    const semver: Semver = determineBump(commits) ?? 'none';
    const type = pick.type.toLowerCase();
    return { type: RECORD_TYPE.test(type) ? type : 'other', scope, semver, breaking };
}

/** R3.4. Directories a record cannot hold (control characters, backslashes, `..` ...) are left out rather than leaked into it. */
export function deriveModules(files: string[]): string[] {
    if (!Array.isArray(files)) return [];
    const modules = new Set<string>();
    for (const f of files as unknown[]) {
        if (typeof f !== 'string' || f.length === 0 || f.startsWith(`${RECORD_DIR}/`)) continue;
        const dir = path.posix.dirname(f);
        const module = dir === '.' ? '.' : dir.split('/').slice(0, MODULE_DEPTH).join('/');
        if (module === '.' || isSafeRelativePath(module)) modules.add(module);
    }
    return [...modules].sort();
}

export type Derived = { ok: true; fields: DerivedFields } | { ok: false; diagnostic: Diagnostic };

const fail = (code: string, message: string): Derived => ({ ok: false, diagnostic: { code, message: clipMessage(message) } });

/**
 * Derives from the non-merge commits in mergeBaseSha..HEAD, ignoring commits and files that only touch docs/changes/.
 * `mergeBaseSha` must be a full commit id (the output of `mergeBase`); anything else is `invalid-input`.
 */
export function deriveFields(root: string, mergeBaseSha: string | null): Derived {
    if (typeof root !== 'string' || root.length === 0) return fail('invalid-input', 'repository root must be a non-empty string');
    if (typeof mergeBaseSha !== 'string' || !COMMIT_ID.test(mergeBaseSha)) return fail('invalid-input', `merge-base must be a full commit id, got "${esc(mergeBaseSha as string)}"`);
    const range = `${mergeBaseSha}..HEAD`;
    const counted = runGit(root, ['rev-list', '--no-merges', '--full-history', '--count', '--end-of-options', range, '--', ALL_FILES, EXCLUDE_RECORDS]);
    const count = counted === null ? NaN : Number(counted.trim());
    if (!Number.isSafeInteger(count)) return fail('git-failed', `git could not list the commits in ${range}`);
    if (count === 0) return fail('no-commits', `no non-merge commits outside ${RECORD_DIR}/ in ${range}`);
    // --full-history: with a pathspec git would otherwise prune the side of a merge whose tree equals the other parent
    // (`merge -s ours`), silently dropping real commits from the range.
    // -z ends every commit with NUL, which a message cannot contain: each record is exactly one commit, so a message that
    // embeds the parser's own separator cannot be read as a second commit.
    const raw = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--no-merges', '--full-history', '--reverse', '-z', `--format=${GIT_LOG_FORMAT}`, '--end-of-options', range, '--', ALL_FILES, EXCLUDE_RECORDS]);
    if (raw === null) return fail('git-failed', `git could not read the commits in ${range}`);
    const commits = raw.split('\0').flatMap((record) => parseCommits(record.split(RS).join('')));
    const derived = deriveFromCommits(commits);
    if (derived === null) return fail('no-conventional-commits', 'no commit in the range uses a conventional-commit subject (type(scope): subject)');
    const files = changedFiles(root, mergeBaseSha, 'HEAD');
    if (files === null) return fail('git-failed', `git could not list the files changed in ${range}`);
    return { ok: true, fields: { ...derived, modules: deriveModules(files) } };
}
