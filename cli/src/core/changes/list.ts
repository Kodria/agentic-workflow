import path from 'path';
import { LOG_SAFETY_ARGS, addedFilesUnder, repoIdentity, runGit, runGitBytes } from './git';
import { isRecordPath } from './parse';
import { resolveBaseRef, type Failure } from './range';
import { esc, escapeBidi, isObj } from './text-safety';
import { cleanLine, parsePr } from './list-parse';
import { hasOptOut } from './trailers';
import { COMMIT_ID, MAX_RECORD_BYTES, RECORD_DIR, type ChangeRecord, type Diagnostic } from './types';
import { validateRecordShape } from './validate-shape';

// `awm changes list` (R5): the first-parent history of the base ref, classified commit by commit. Everything here is read-only
// and reads git history only: never the working tree, never HEAD. Nothing throws: failures come back as a value. Everything git
// prints (commit ids, dates, subjects, paths, tag names, record contents) is untrusted: it is validated before it is used and
// escaped before it is returned. The base is pinned to one commit id, so every later call describes the same history.

export const DEFAULT_LIMIT = 200;
export const MAX_RECORDS_PER_ENTRY = 50;
export const MAX_RECORDS_PER_RUN = 500;
export const MAX_SUBJECT = 1024;
/** The first-parent history is read in pages of at most this many commits, so no git output approaches the 16 MiB bound. */
export const PAGE_SIZE = 10_000;
const MAX_TAG_NAME = 255;
const MAX_IDENTITY = 300;
/** The largest instant a Date can hold, in seconds. */
const MAX_EPOCH_SECONDS = 8.64e12;
/**
 * Columns of the subject that git is asked to print (`%<(N,trunc)`): enough for MAX_SUBJECT code units even when every character
 * is two columns wide, and it bounds the output however long a subject is. Shorter subjects come back padded with spaces.
 */
const SUBJECT_COLUMNS = 2100;
const SUBJECT_UNAVAILABLE = '<subject unavailable>';
/** Columns of the END of the subject that git is asked to print: the trailing `(#<n>)` is found there, however long the subject is. */
const TAIL_COLUMNS = 64;

export type Classification = 'recorded' | 'invalid-record' | 'exempt' | 'missing';

/** A record read from history: the path and the whole frontmatter when it is valid, the path and its diagnostics when it is not. */
export type ListedRecord = ({ path: string } & ChangeRecord) | { path: string; diagnostics: Diagnostic[] };

export interface ListedChange {
    sha: string;
    /** Escaped and clipped to MAX_SUBJECT. */
    subject: string;
    classification: Classification;
    /** The committer date as a UTC instant; null when it is empty, negative, not a number or not representable. */
    merged_at: string | null;
    pr: number | null;
    release: string | null;
    records: ListedRecord[];
}

export interface ListResult {
    repo: string | null;
    base: string;
    since: string;
    adopted: boolean;
    truncated: boolean;
    omitted: number;
    changes: ListedChange[];
}

export interface ListOptions {
    /** Explicit base ref; omitted, R3.1 picks origin/HEAD, main or master. */
    base?: string;
    since: Date;
    /** Entries listed, 1..200 (more is capped at 200). */
    limit?: number;
    maxRecordsPerEntry?: number;
    maxRecords?: number;
    /** Commits per page of the first-parent scan (at most PAGE_SIZE); tests use a small one. */
    pageSize?: number;
}

export type ListOutcome = { ok: true; result: ListResult } | { ok: false; failure: Failure };

const fail = (code: string, message: string, remedy?: string): ListOutcome => ({ ok: false, failure: remedy === undefined ? { code, message } : { code, message, remedy } });

// ---- Text ----

/** A value read from a valid record with bidi marks escaped in every string and key (the shape was validated, so it is shallow). */
function cleanValue(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return escapeBidi(value);
    if (depth > 8) return null;
    if (Array.isArray(value)) return value.map((v) => cleanValue(v, depth + 1));
    // fromEntries defines own properties: a key named __proto__ stays a key.
    if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [escapeBidi(k), cleanValue(v, depth + 1)]));
    return value;
}

const cleanDiagnostics = (list: Diagnostic[]): Diagnostic[] => list.map((d) => ({ ...d, message: escapeBidi(d.message), ...(d.field === undefined ? {} : { field: escapeBidi(d.field) }) }));

// ---- Git reading ----

/** What a git read gave: a value (null for "none"), or that git could not tell. A falsy check can never mistake the second for the first. */
type Read<T> = { ok: true; value: T } | { ok: false };
const UNREADABLE: { ok: false } = { ok: false };

const RECORD_PATHSPEC = `:(top,literal)${RECORD_DIR}`;
/** Files directly in docs/changes whose name looks like a record's date prefix (`*` does not cross `/` in a glob pathspec). Narrows R5.4's search; the exact R1.1 shape is checked per commit. */
const RECORD_SHAPED_PATHSPEC = `:(top,glob)${RECORD_DIR}/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md`;
const SEP = '\x1f';
const GIT_FAILED_RECORD: ListedRecord = { path: RECORD_DIR, diagnostics: [{ code: 'git-failed', message: 'git could not list the records added by this commit' }] };

/** Files added by a root commit under the record directory (the two-tree form of addedFilesUnder needs a parent). */
function addedByRoot(root: string, sha: string): string[] | null {
    const out = runGit(root, ['-c', 'diff.relative=false', 'diff-tree', '--root', '-r', '--no-renames', '--ignore-submodules=none', '--diff-filter=A', '--name-only', '-z', '--no-commit-id', '--end-of-options', sha, '--', RECORD_PATHSPEC]);
    return out === null ? null : out.split('\0').filter(Boolean);
}

/** `text` without the spaces `%<(N,trunc)` pads a short subject with (a subject has no meaningful trailing blanks). */
function trimPadding(text: string): string {
    let end = text.length;
    while (end > 0 && text[end - 1] === ' ') end--;
    return text.slice(0, end);
}

/** `<sha> SEP <field>` for the given commits in one call (`field` is a bounded git placeholder); null when git fails. */
function readFormatted(root: string, shas: string[], field: string): Map<string, string> | null {
    const out = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--no-walk=unsorted', '-z', `--format=%H%x1f${field}`, '--end-of-options', ...shas, '--']);
    if (out === null) return null;
    const values = new Map<string, string>();
    for (const entry of out.split('\0')) {
        if (entry === '') continue;
        const at = entry.indexOf(SEP);
        const sha = at < 0 ? '' : entry.slice(0, at);
        if (!COMMIT_ID.test(sha)) return null;
        values.set(sha, trimPadding(entry.slice(at + 1)));
    }
    return values;
}

/**
 * A bounded placeholder of every commit, asked from git in one call. When the batch fails (a value that still outgrows git's
 * output bound, for instance one made of zero-width characters, which the column bound does not count) it is halved until the
 * commit at fault is alone; that one gets `fallback`: a subject never makes the run fail.
 */
function readBounded(root: string, shas: string[], field: string, fallback: string): Map<string, string> {
    const values = new Map<string, string>();
    // A failing batch is halved until the commit that breaks it is alone: one bad commit among N costs about 2 log2(N) calls.
    const fill = (part: string[]): void => {
        if (part.length === 0) return;
        const batch = readFormatted(root, part, field);
        if (batch !== null && part.every((s) => batch.has(s))) {
            for (const sha of part) values.set(sha, batch.get(sha) as string);
        } else if (part.length === 1) {
            values.set(part[0], fallback);
        } else {
            const middle = part.length >> 1;
            fill(part.slice(0, middle));
            fill(part.slice(middle));
        }
    };
    fill(shas);
    return values;
}

/**
 * R5.5: the earliest-created tag that contains `sha`, annotated tags first (their creation time is the tagger date); a lightweight
 * tag (git records only the commit date for it) is chosen only when no annotated tag contains the commit. Ties go by name ascending.
 * `{ ok: false }` when git fails.
 */
function earliestTag(root: string, sha: string): Read<string | null> {
    // For-each-ref sorts by the LAST --sort first: creation date, then name.
    const out = runGit(root, ['for-each-ref', '--contains', sha, '--sort=refname', '--sort=creatordate', '--format=%(objecttype) %(refname)', 'refs/tags/']);
    if (out === null) return UNREADABLE;
    const rows = out.split('\n').filter((row) => row !== '');
    if (rows.length === 0) return { ok: true, value: null };
    const pick = rows.find((row) => row.startsWith('tag ')) ?? rows[0];
    const ref = pick.slice(pick.indexOf(' ') + 1);
    const name = ref.slice('refs/tags/'.length);
    // A name longer than the cap is clipped, never an error.
    return ref.startsWith('refs/tags/') && name !== '' ? { ok: true, value: cleanLine(name, MAX_TAG_NAME) } : UNREADABLE;
}

interface TreeEntry { mode: string; type: string; oid: string; size: number }

/** Mode, type, object id and size of exactly the given paths in the commit's tree, in ONE call. Null when git fails. */
function readTreeEntries(root: string, sha: string, names: string[]): Map<string, TreeEntry> | null {
    const out = runGit(root, ['ls-tree', '-l', '-z', '--full-tree', '--end-of-options', sha, '--', ...names]);
    if (out === null) return null;
    const entries = new Map<string, TreeEntry>();
    for (const line of out.split('\0')) {
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        const [mode, type, oid, size] = line.slice(0, tab).split(' ').filter(Boolean);
        if (mode === undefined || type === undefined || oid === undefined || size === undefined) continue;
        if (!COMMIT_ID.test(oid) || !/^\d{1,15}$/.test(size)) { entries.set(line.slice(tab + 1), { mode, type: 'unknown', oid, size: 0 }); continue; }
        entries.set(line.slice(tab + 1), { mode, type, oid, size: Number(size) });
    }
    return entries;
}

const invalid = (rel: string, code: string, message: string): ListedRecord => ({ path: rel, diagnostics: [{ code, message }] });

/** One record of a commit: size and kind are checked BEFORE the blob is read; the shape is validated without the working tree. */
function readOne(root: string, rel: string, info: TreeEntry | undefined): ListedRecord {
    if (info === undefined) return invalid(rel, 'record-invalid', 'the record is not in the commit');
    if (info.type !== 'blob' || (info.mode !== '100644' && info.mode !== '100755')) return invalid(rel, 'record-invalid', 'the record is not a regular file');
    if (info.size > MAX_RECORD_BYTES) return invalid(rel, 'record-too-large', `record exceeds ${MAX_RECORD_BYTES} bytes`);
    const bytes = runGitBytes(root, ['show', '--no-textconv', '--end-of-options', info.oid]);
    if (bytes === null) return invalid(rel, 'git-failed', 'git could not read the record');
    // Strict, as validate reads a record (record-io.ts): a lossy decode would turn bad bytes into U+FFFD and report the record valid.
    // `ignoreBOM: true` keeps a leading BOM, so the record then fails as invalid in both.
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return invalid(rel, 'record-invalid', `${esc(path.posix.basename(rel))} is not valid UTF-8`); }
    const shape = validateRecordShape(path.posix.basename(rel), text);
    if (shape.record) return { path: rel, ...(cleanValue(shape.record) as ChangeRecord) };
    return { path: rel, diagnostics: cleanDiagnostics(shape.diagnostics) };
}

interface Budget { entry: number; run: number }

/**
 * The records a commit added. A commit with more records than the per-commit bound, or than what is left of the per-run budget, is
 * not read at all: one `too-many-records` diagnostic stands for it. The budget is spent only on records actually read.
 */
function readRecords(root: string, sha: string, names: string[], budget: Budget): ListedRecord[] {
    if (names.length > budget.entry || names.length > budget.run) {
        return [invalid(RECORD_DIR, 'too-many-records', `${names.length} records were added; more than the read limit allows, none was read`)];
    }
    budget.run -= names.length;
    const tree = readTreeEntries(root, sha, names);
    return names.map((rel) => (tree === null ? invalid(rel, 'git-failed', 'git could not read the record') : readOne(root, rel, tree.get(rel))));
}

const isInvalid = (r: ListedRecord): boolean => 'diagnostics' in r;

interface Entry {
    sha: string;
    /** The committer date in ms; null when it cannot be one (such a commit is always in the window). */
    ms: number | null;
    parents: string[];
}

/** First-parent commits, newest first, with committer date and parents. Null when git prints something unexpected. */
function parseScan(out: string): Entry[] | null {
    const entries: Entry[] = [];
    for (const row of out.split('\0')) {
        if (row === '') continue;
        const [sha, seconds, parentText, ...rest] = row.split(SEP);
        if (rest.length > 0 || sha === undefined || seconds === undefined || parentText === undefined || !COMMIT_ID.test(sha)) return null;
        const parents = parentText.split(' ').filter(Boolean);
        if (!parents.every((p) => COMMIT_ID.test(p))) return null;
        // An empty, negative, non-numeric or out-of-range committer date is a date that cannot be shown to be outside any window.
        const valid = seconds.length > 0 && seconds.length <= 13 && /^\d+$/.test(seconds) && Number(seconds) <= MAX_EPOCH_SECONDS;
        entries.push({ sha, ms: valid ? Number(seconds) * 1000 : null, parents });
    }
    return entries;
}

/** True/false whether `sha` added a record-shaped file (R1.1) under docs/changes; null when git cannot tell. */
function addsRecordShapedFile(root: string, sha: string, firstParent: string | undefined): boolean | null {
    const added = firstParent === undefined ? addedByRoot(root, sha) : addedFilesUnder(root, firstParent, sha, RECORD_DIR);
    return added === null ? null : added.some(isRecordPath);
}

/**
 * R5.4: the oldest first-parent commit that added a record-shaped file (R1.1) under `docs/changes`; a README or any other file
 * there does not count. The history is read in pages of `pageSize` commits that touch a file with a record-like name (each page
 * continues from the first parent of the previous page's last commit), then the candidates are checked from the oldest up: the
 * first that really added a record-shaped file is the adoption. `{ ok: true, value: null }` when there is none, `{ ok: false }`
 * when git fails.
 */
function findAdoption(root: string, pinned: string, pageSize: number): Read<string | null> {
    let start = pinned;
    const candidates: Array<{ sha: string; firstParent: string | undefined }> = [];
    for (;;) {
        const out = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--first-parent', `--max-count=${pageSize}`, '-s', '-z', '--format=%H%x1f%P', '--end-of-options', start, '--', RECORD_SHAPED_PATHSPEC]);
        if (out === null) return UNREADABLE;
        const rows = out.split('\0').filter(Boolean).map((row) => row.split(SEP));
        if (!rows.every(([sha, parents, ...rest]) => rest.length === 0 && COMMIT_ID.test(sha) && parents !== undefined)) return UNREADABLE;
        for (const [sha, parents] of rows) candidates.push({ sha, firstParent: parents.split(' ').filter(Boolean)[0] });
        const next = rows.length === 0 ? undefined : candidates[candidates.length - 1].firstParent;
        if (rows.length < pageSize || next === undefined || !COMMIT_ID.test(next)) break;
        start = next;
    }
    for (let i = candidates.length - 1; i >= 0; i--) {
        const adds = addsRecordShapedFile(root, candidates[i].sha, candidates[i].firstParent);
        if (adds === null) return UNREADABLE;
        if (adds) return { ok: true, value: candidates[i].sha };
    }
    return { ok: true, value: null };
}

interface Window { selected: Entry[]; total: number }

/**
 * R5.7: the first-parent commits from `pinned` down to the adopting commit, in pages of `pageSize`, each starting at the first
 * parent of the previous page's last commit. Every commit is tested individually against the window; the first `cap` that are
 * in it are kept and all of them are counted. The scan stops at the adoption point (the walk ends there) or at the first page
 * with no commit in the window: dates are assumed not to decrease along the chain, so a commit dated inside the window beyond
 * such a page is not listed. Null when git fails or prints something unexpected.
 */
function scanWindow(root: string, pinned: string, adoption: string, sinceMs: number, pageSize: number, cap: number): Window | null {
    const window: Window = { selected: [], total: 0 };
    let start = pinned;
    for (;;) {
        const out = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--first-parent', `--max-count=${pageSize}`, '-z', '--format=%H%x1f%ct%x1f%P', '--end-of-options', start, `^${adoption}^@`, '--']);
        const page = out === null ? null : parseScan(out);
        if (page === null) return null;
        const inside = page.filter((e) => e.ms === null || e.ms >= sinceMs);
        if (inside.length === 0) return window;
        for (const entry of inside) if (window.selected.length < cap) window.selected.push(entry);
        window.total += inside.length;
        const last = page[page.length - 1];
        const next = last.parents[0];
        if (page.length < pageSize || last.sha === adoption || next === undefined) return window;
        start = next;
    }
}

function classifyEntry(root: string, entry: Entry, subject: string, tail: string, budget: Budget): ListedChange | null {
    const [first] = entry.parents;
    const added = first === undefined ? addedByRoot(root, entry.sha) : addedFilesUnder(root, first, entry.sha, RECORD_DIR);
    const names = added === null ? null : added.filter(isRecordPath);
    let records: ListedRecord[];
    let classification: Classification;
    if (names === null) {
        records = [GIT_FAILED_RECORD];
        classification = 'invalid-record';
    } else if (names.length > 0) {
        records = readRecords(root, entry.sha, names, budget);
        classification = records.some(isInvalid) ? 'invalid-record' : 'recorded';
        // An invalid-record commit lists EVERY added record: the valid ones with no diagnostics.
        if (classification === 'invalid-record') records = records.map((r) => (isInvalid(r) ? r : { path: r.path, diagnostics: [] }));
    } else {
        records = [];
        // The commits of a change: the commit itself, plus for a merge commit everything it brought in.
        const revArgs = entry.parents.length > 1 ? [`${first}..${entry.sha}`] : ['-1', entry.sha];
        classification = hasOptOut(root, revArgs) ? 'exempt' : 'missing';
    }
    const release = earliestTag(root, entry.sha);
    if (!release.ok) return null;
    return {
        sha: entry.sha,
        subject: cleanLine(subject, MAX_SUBJECT),
        classification,
        merged_at: entry.ms === null ? null : new Date(entry.ms).toISOString(),
        pr: parsePr(tail),
        release: release.value,
        records,
    };
}

const optionalCount = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1);

/** The repository identity, or null when the remote is absent or unusable (a host that still carries a user part is not trusted). */
function safeRepo(root: string): string | null {
    const identity = repoIdentity(root);
    if (identity === null || identity.split('/')[0].includes('@')) return null;
    return cleanLine(identity, MAX_IDENTITY);
}

function listUnsafe(root: unknown, opts: unknown): ListOutcome {
    if (typeof root !== 'string' || root.length === 0 || root.includes('\0')) return fail('invalid-input', 'the repository root must be a non-empty string');
    if (!isObj(opts)) return fail('invalid-input', 'the options must be an object');
    const { base: explicit, since, limit, maxRecordsPerEntry, maxRecords, pageSize } = opts;
    if (!(since instanceof Date) || Number.isNaN(since.getTime())) return fail('invalid-input', 'the window start must be a valid date');
    if (!optionalCount(limit) || !optionalCount(maxRecordsPerEntry) || !optionalCount(maxRecords) || !optionalCount(pageSize)) return fail('invalid-input', 'limits must be positive integers');

    // R3.1/R3.2/R3.5, as `change new`; then the base is pinned to one commit id: history cannot move under the run.
    const resolved = resolveBaseRef(root, explicit as string | undefined);
    if (!resolved.ok) return { ok: false, failure: resolved.failure };
    const { base, sha: pinned } = resolved;

    // R5.1: at a shallow boundary a commit looks like a root commit, so a shallow history cannot be classified.
    const shallow = runGit(root, ['rev-parse', '--is-shallow-repository'])?.trim();
    if (shallow === 'true') return fail('shallow-history', 'this repository is a shallow clone; its oldest commits cannot be told from root commits', 'git fetch --unshallow');
    if (shallow !== 'false') return fail('git-failed', 'git could not tell whether the repository is shallow');

    const page = Math.min((pageSize as number | undefined) ?? PAGE_SIZE, PAGE_SIZE);
    // R5.4: the first commit, in first-parent order, that touched docs/changes.
    const adopting = findAdoption(root, pinned, page);
    if (!adopting.ok) return fail('git-failed', 'git could not read the history');
    const adoption = adopting.value;
    const result: ListResult = { repo: safeRepo(root), base: cleanLine(base, MAX_TAG_NAME), since: since.toISOString(), adopted: false, truncated: false, omitted: 0, changes: [] };
    if (adoption === null) return { ok: true, result };
    result.adopted = true;

    const cap = Math.min((limit as number | undefined) ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    const window = scanWindow(root, pinned, adoption, since.getTime(), page, cap);
    if (window === null) return fail('git-failed', 'git could not read the history');
    const selected = window.selected;
    result.truncated = window.total > selected.length;
    result.omitted = window.total - selected.length;

    const shas = selected.map((e) => e.sha);
    const subjects = readBounded(root, shas, `%<(${SUBJECT_COLUMNS},trunc)%s`, SUBJECT_UNAVAILABLE);
    const tails = readBounded(root, shas, `%<(${TAIL_COLUMNS},ltrunc)%s`, '');
    const run = (maxRecords as number | undefined) ?? MAX_RECORDS_PER_RUN;
    const budget: Budget = { entry: (maxRecordsPerEntry as number | undefined) ?? MAX_RECORDS_PER_ENTRY, run };
    for (const entry of selected) {
        const change = classifyEntry(root, entry, subjects.get(entry.sha) as string, tails.get(entry.sha) as string, budget);
        if (change === null) return fail('git-failed', `git could not tell which tags contain ${entry.sha.slice(0, 12)}`);
        result.changes.push(change);
    }
    return { ok: true, result };
}

/**
 * R5.1-R5.5, R5.7: the first-parent history of the base ref, classified. `base` is resolved as in R3.1 (an unsafe one is
 * `invalid-input`, one that does not resolve is `base-unresolved`). Read-only; never throws.
 */
export function listChanges(root: string, opts: ListOptions): ListOutcome {
    try {
        return listUnsafe(root, opts);
    } catch (error) {
        return fail('internal-error', `unexpected failure (${esc(error instanceof Error ? error.name : 'unknown')})`);
    }
}
