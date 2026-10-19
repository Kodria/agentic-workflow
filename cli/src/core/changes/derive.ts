import path from 'path';
import { determineBump, GIT_LOG_FORMAT, parseCommits, RS, US, type Commit } from '../../release/core';
import { LOG_SAFETY_ARGS, changedFiles, headSha, runGit } from './git';
import { esc, clipMessage, isSafeRelativePath, isSingleLine } from './text-safety';
import { COMMIT_ID, RECORD_DIR, type DerivedFields, type Diagnostic, type Semver } from './types';

// Pathspecs relative to the repository top, so the result does not depend on the directory git runs in.
const ALL_FILES = ':/';
const EXCLUDE_RECORDS = `:(top,exclude,literal)${RECORD_DIR}`;
const EXCLUDE_PLANS = ':(top,exclude,literal)docs/plans';
const PARSER_TYPE = /^\w+$/;
const RECORD_TYPE = /^[a-z]+$/;
const MODULE_DEPTH = 3;
// R3.3: the release parser's header regex backtracks quadratically on a long subject with blanks and line terminators, so a
// subject (the text before the first US of a record) over this many UTF-16 units is never handed to it.
const MAX_SUBJECT_UNITS = 1024;

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
 * R3.3 as amended 2026-10-19. `breaking` and `semver` cover every usable commit, with the release parser's exact-type semantics.
 * `type` and `scope` come from the usable `focus` commits (those touching a path outside docs/changes/ and docs/plans/), or from
 * every usable commit when `focus` is omitted or has none. The recorded type is the highest-impact chosen commit's type
 * lowercased, or `other` when that is still not purely letters. Null when no commit is usable.
 */
export function deriveFromCommits(input: Commit[], focusInput?: Commit[]): Omit<DerivedFields, 'modules'> | null {
    const commits = usable(input);
    if (commits.length === 0) return null;
    const focused = usable(focusInput);
    const chooser = focused.length > 0 ? focused : commits;
    const breaking = commits.some((c) => c.breaking);
    const pick = chooser.find((c) => c.breaking) ?? chooser.find((c) => c.type === 'feat') ?? chooser.find((c) => c.type === 'fix')
        ?? chooser.find((c) => c.type === 'perf') ?? chooser[0];
    const counts = new Map<string, number>();
    for (const c of chooser) if (c.scope) counts.set(c.scope, (counts.get(c.scope) ?? 0) + 1);
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

/**
 * The conventional commits of NUL-separated `git log` records. Measured on the raw record, before RS is stripped (the stripped text
 * is never longer): like the release parser, the subject ends at the first US, so only the text before it counts, and a subject over
 * MAX_SUBJECT_UNITS is never handed to the parser.
 */
export function commitsFromRecords(records: string[]): Commit[] {
    return records.flatMap((record) => {
        const end = record.indexOf(US);
        return (end < 0 ? record.length : end) > MAX_SUBJECT_UNITS ? [] : parseCommits(record.split(RS).join(''));
    });
}

export type Derived = { ok: true; fields: DerivedFields } | { ok: false; diagnostic: Diagnostic };

const fail = (code: string, message: string): Derived => ({ ok: false, diagnostic: { code, message: clipMessage(message) } });

/**
 * Derives from the non-merge commits in mergeBaseSha..HEAD, ignoring commits and files that only touch docs/changes/.
 * R3.3 amended: `type` and `scope` come from the commits that also touch a path outside docs/plans/ (all of them when no
 * conventional commit does), while `semver` and `breaking` cover every commit.
 * `mergeBaseSha` must be a full commit id (the output of `mergeBase`); anything else is `invalid-input`.
 */
export function deriveFields(root: string, mergeBaseSha: string | null): Derived {
    if (typeof root !== 'string' || root.length === 0) return fail('invalid-input', 'repository root must be a non-empty string');
    if (typeof mergeBaseSha !== 'string' || !COMMIT_ID.test(mergeBaseSha)) return fail('invalid-input', `merge-base must be a full commit id, got "${esc(mergeBaseSha as string)}"`);
    // HEAD is read once: the log and the diff below both use this sha, so a HEAD that moves meanwhile cannot mix snapshots.
    const head = headSha(root);
    if (head === null) return fail('git-failed', 'git could not read HEAD');
    const range = `${mergeBaseSha}..${head}`;
    // --full-history: with a pathspec git would otherwise prune the side of a merge whose tree equals the other parent
    // (`merge -s ours`), silently dropping real commits from the range.
    // -z ends every commit with NUL, which a message cannot contain: each record is exactly one commit, so a message that
    // embeds the parser's own separator cannot be read as a second commit.
    const logArgs = ['log', ...LOG_SAFETY_ARGS, '--no-merges', '--full-history', '--reverse', '-z', `--format=${GIT_LOG_FORMAT}`, '--end-of-options', range, '--', ALL_FILES, EXCLUDE_RECORDS];
    const raw = runGit(root, logArgs);
    if (raw === null) return fail('git-failed', `git could not read the commits in ${range}`);
    const records = raw.split('\0').filter((record) => record !== '');
    if (records.length === 0) return fail('no-commits', `no non-merge commits outside ${RECORD_DIR}/ in ${range}`);
    const commits = commitsFromRecords(records);
    // R3.3 amended: plan-only commits do not choose type or scope, so a second log over the same range drops docs/plans/.
    const focusRaw = runGit(root, [...logArgs, EXCLUDE_PLANS]);
    if (focusRaw === null) return fail('git-failed', `git could not read the commits in ${range}`);
    const focus = commitsFromRecords(focusRaw.split('\0').filter((record) => record !== ''));
    const derived = deriveFromCommits(commits, focus);
    if (derived === null) return fail('no-conventional-commits', 'no commit in the range uses a conventional-commit subject (type(scope): subject)');
    const files = changedFiles(root, mergeBaseSha, head);
    if (files === null) return fail('git-failed', `git could not list the files changed in ${range}`);
    return { ok: true, fields: { ...derived, modules: deriveModules(files) } };
}
