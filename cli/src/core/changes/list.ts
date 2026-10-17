import path from 'path';
import { COMMIT_ID, LOG_SAFETY_ARGS, addedFilesUnder, isSafeRef, repoIdentity, resolveBase, runGit } from './git';
import { RECORD_FILE_RE } from './parse';
import { REMEDY_BASE, type Failure } from './range';
import { NON_STRING, cleanText, esc, isObj, sliceNoSplit } from './text-safety';
import { hasOptOut } from './trailers';
import { MAX_RECORD_BYTES, RECORD_DIR, type ChangeRecord, type Diagnostic } from './types';
import { validateRecordShape } from './validate-shape';

// `awm changes list` (R5): the first-parent history of the base ref, classified commit by commit. Everything here is read-only
// and reads git history only: never the working tree, never HEAD. Nothing throws: failures come back as a value. Everything git
// prints (commit ids, dates, subjects, paths, tag names, record contents) is untrusted: it is validated before it is used and
// escaped before it is returned. The base is pinned to one commit id, so every later call describes the same history.

export const DEFAULT_LIMIT = 200;
export const MAX_RECORDS_PER_ENTRY = 50;
export const MAX_RECORDS_PER_RUN = 500;
export const MAX_SUBJECT = 1024;
const MAX_TAG_NAME = 255;
const MAX_IDENTITY = 300;
/** The largest instant a Date can hold, in seconds. */
const MAX_EPOCH_SECONDS = 8.64e12;

export type Classification = 'recorded' | 'invalid-record' | 'exempt' | 'missing';

/** A record read from history: the path and the whole frontmatter when it is valid, the path and its diagnostics when it is not. */
export type ListedRecord = ({ path: string } & ChangeRecord) | { path: string; diagnostics: Diagnostic[] };

export interface ListedChange {
    sha: string;
    /** Escaped and clipped to MAX_SUBJECT. */
    subject: string;
    classification: Classification;
    merged_at: string;
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
}

export type ListOutcome = { ok: true; result: ListResult } | { ok: false; failure: Failure };

const fail = (code: string, message: string, remedy?: string): ListOutcome => ({ ok: false, failure: remedy === undefined ? { code, message } : { code, message, remedy } });

// ---- Text ----

const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
const hex4 = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
/** Bidirectional controls would reorder what a terminal shows around them; they are written as \uXXXX. */
const escapeBidi = (text: string): string => text.replace(BIDI, hex4);

/**
 * Untrusted text as one clean line of at most `max` UTF-16 units: controls, line breaks and bidi marks escaped, an ellipsis
 * where it was cut, a surrogate pair never split. Never throws.
 */
export function cleanLine(text: unknown, max: number): string {
    if (typeof text !== 'string') return NON_STRING;
    const raw = sliceNoSplit(text, max);
    let out = escapeBidi(cleanText(raw));
    if (raw.length < text.length || out.length > max) out = `${out.length > max - 1 ? sliceNoSplit(out, max - 1) : out}…`;
    return out;
}

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

// ---- R5.2 ----

const RELATIVE = /^(\d{1,5})([hd])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SINCE_TEXT = 16;

/** `<n>h`, `<n>d` (1..87600 hours, 1..3650 days) or a calendar date `YYYY-MM-DD`; null for anything else. Never throws. */
export function parseSince(value: unknown, now: unknown): Date | null {
    if (typeof value !== 'string' || value.length > MAX_SINCE_TEXT || !(now instanceof Date)) return null;
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return null;
    const rel = RELATIVE.exec(value);
    if (rel) {
        const n = Number(rel[1]);
        const hours = rel[2] === 'h';
        if (n < 1 || n > (hours ? 87600 : 3650)) return null;
        const since = new Date(nowMs - n * (hours ? 3600e3 : 86400e3));
        return Number.isNaN(since.getTime()) ? null : since;
    }
    if (ISO_DATE.test(value)) {
        const since = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(since.getTime()) && since.toISOString().slice(0, 10) === value ? since : null;
    }
    return null;
}

/** The number of a trailing `(#<n>)`; null when there is none or n is not a safe integer. Index scans only. */
export function parsePr(subject: string): number | null {
    if (typeof subject !== 'string') return null;
    let end = subject.length;
    while (end > 0 && (subject[end - 1] === ' ' || subject[end - 1] === '\t' || subject[end - 1] === '\r' || subject[end - 1] === '\n')) end--;
    if (end < 4 || subject[end - 1] !== ')') return null;
    const open = subject.lastIndexOf('(#', end - 1);
    if (open < 0) return null;
    const digits = subject.slice(open + 2, end - 1);
    if (digits.length === 0 || digits.length > 16) return null;
    for (let i = 0; i < digits.length; i++) if (digits[i] < '0' || digits[i] > '9') return null;
    const n = Number(digits);
    return Number.isSafeInteger(n) ? n : null;
}

// ---- Git reading ----

const isRecordPath = (rel: string): boolean => path.posix.dirname(rel) === RECORD_DIR && RECORD_FILE_RE.test(path.posix.basename(rel));
const RECORD_PATHSPEC = `:(top,literal)${RECORD_DIR}`;
const SEP = '\x1f';
const GIT_FAILED_RECORD: ListedRecord = { path: RECORD_DIR, diagnostics: [{ code: 'git-failed', message: 'git could not list the records added by this commit' }] };

/** Files added by a root commit under the record directory (the two-tree form of addedFilesUnder needs a parent). */
function addedByRoot(root: string, sha: string): string[] | null {
    const out = runGit(root, ['-c', 'diff.relative=false', 'diff-tree', '--root', '-r', '--no-renames', '--ignore-submodules=none', '--diff-filter=A', '--name-only', '-z', '--no-commit-id', '--end-of-options', sha, '--', RECORD_PATHSPEC]);
    return out === null ? null : out.split('\0').filter(Boolean);
}

interface Detail { parents: string[]; subject: string }

/** Parents and subjects of the given commits in ONE call. Null when git fails or prints something unexpected. */
function readDetails(root: string, shas: string[]): Map<string, Detail> | null {
    const details = new Map<string, Detail>();
    if (shas.length === 0) return details;
    const out = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--no-walk=unsorted', '-z', '--format=%H%x1f%P%x1f%s', '--end-of-options', ...shas, '--']);
    if (out === null) return null;
    for (const entry of out.split('\0')) {
        if (entry === '') continue;
        const a = entry.indexOf(SEP);
        const b = a < 0 ? -1 : entry.indexOf(SEP, a + 1);
        if (b < 0) return null;
        const sha = entry.slice(0, a);
        const parents = entry.slice(a + 1, b).split(' ').filter(Boolean);
        if (!COMMIT_ID.test(sha) || !parents.every((p) => COMMIT_ID.test(p))) return null;
        details.set(sha, { parents, subject: entry.slice(b + 1) });
    }
    return shas.every((s) => details.has(s)) ? details : null;
}

/** The tag with the earliest creator date that contains `sha` (ties by name ascending); undefined when git fails. */
function earliestTag(root: string, sha: string): string | null | undefined {
    // For-each-ref sorts by the LAST --sort first: creation date, then name.
    const out = runGit(root, ['for-each-ref', '--contains', sha, '--sort=refname', '--sort=creatordate', '--count=1', '--format=%(refname)', 'refs/tags/']);
    if (out === null) return undefined;
    const ref = out.split('\n')[0];
    if (ref === '') return null;
    const name = ref.slice('refs/tags/'.length);
    return ref.startsWith('refs/tags/') && name !== '' && name.length <= MAX_TAG_NAME ? cleanLine(name, MAX_TAG_NAME) : undefined;
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
    const text = runGit(root, ['show', '--no-textconv', '--end-of-options', info.oid]);
    if (text === null) return invalid(rel, 'git-failed', 'git could not read the record');
    const shape = validateRecordShape(path.posix.basename(rel), text);
    if (shape.record) return { path: rel, ...(cleanValue(shape.record) as ChangeRecord) };
    return { path: rel, diagnostics: cleanDiagnostics(shape.diagnostics) };
}

interface Budget { entry: number; run: number }

/** The records a commit added (at most the per-entry and the remaining per-run budget), and a synthetic record for what was not read. */
function readRecords(root: string, sha: string, names: string[], budget: Budget): ListedRecord[] {
    const allowed = Math.min(names.length, budget.entry, budget.run);
    budget.run -= allowed;
    const records: ListedRecord[] = [];
    if (allowed > 0) {
        const read = names.slice(0, allowed);
        const tree = readTreeEntries(root, sha, read);
        for (const rel of read) records.push(tree === null ? invalid(rel, 'git-failed', 'git could not read the record') : readOne(root, rel, tree.get(rel)));
    }
    if (allowed < names.length) records.push(invalid(RECORD_DIR, 'too-many-records', `${names.length} records were added; only the first ${allowed} were read`));
    return records;
}

const isInvalid = (r: ListedRecord): boolean => 'diagnostics' in r;

interface Entry { sha: string; ms: number }

/** First-parent commits, newest first, with the committer date in ms. Null when git prints something unexpected. */
function parseScan(out: string): Entry[] | null {
    const entries: Entry[] = [];
    for (const row of out.split('\0')) {
        if (row === '') continue;
        const at = row.indexOf(SEP);
        const sha = at < 0 ? '' : row.slice(0, at);
        const seconds = at < 0 ? '' : row.slice(at + 1);
        if (!COMMIT_ID.test(sha) || seconds.length === 0 || seconds.length > 14 || !/^\d+$/.test(seconds)) return null;
        // A date no Date can hold cannot be placed in any window: the commit is left out.
        if (Number(seconds) <= MAX_EPOCH_SECONDS) entries.push({ sha, ms: Number(seconds) * 1000 });
    }
    return entries;
}

function classifyEntry(root: string, entry: Entry, detail: Detail, budget: Budget): ListedChange | null {
    const [first] = detail.parents;
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
    } else {
        records = [];
        // The commits of a change: the commit itself, plus for a merge commit everything it brought in.
        const revArgs = detail.parents.length > 1 ? [`${first}..${entry.sha}`] : ['-1', entry.sha];
        classification = hasOptOut(root, revArgs) ? 'exempt' : 'missing';
    }
    const release = earliestTag(root, entry.sha);
    if (release === undefined) return null;
    return {
        sha: entry.sha,
        subject: cleanLine(detail.subject, MAX_SUBJECT),
        classification,
        merged_at: new Date(entry.ms).toISOString(),
        pr: parsePr(detail.subject),
        release,
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
    const { base: explicit, since, limit, maxRecordsPerEntry, maxRecords } = opts;
    if (!(since instanceof Date) || Number.isNaN(since.getTime())) return fail('invalid-input', 'the window start must be a valid date');
    if (!optionalCount(limit) || !optionalCount(maxRecordsPerEntry) || !optionalCount(maxRecords)) return fail('invalid-input', 'limits must be positive integers');
    if (explicit !== undefined && !isSafeRef(explicit)) return fail('invalid-input', `--base "${esc(explicit as string)}" is not a safe git ref`);

    const base = resolveBase(root, explicit as string | undefined);
    if (base === null) return fail('base-unresolved', 'could not resolve a base branch', REMEDY_BASE);
    const pinned = runGit(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${base}^{commit}`])?.trim();
    if (pinned === undefined || !COMMIT_ID.test(pinned)) return fail('git-failed', `git could not read "${esc(base)}"`);

    // R5.4: the first commit, in first-parent order, that added a file under docs/changes (the last one the log prints).
    const adopting = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--first-parent', '--diff-merges=first-parent', '--root', '--no-renames', '--diff-filter=A', '-s', '-z', '--format=%H', '--end-of-options', pinned, '--', RECORD_PATHSPEC]);
    if (adopting === null) return fail('git-failed', 'git could not read the history');
    const adoption = adopting.split('\0').filter(Boolean).pop();
    const result: ListResult = { repo: safeRepo(root), base: cleanLine(base, MAX_TAG_NAME), since: since.toISOString(), adopted: false, truncated: false, omitted: 0, changes: [] };
    if (adoption === undefined) return { ok: true, result };
    if (!COMMIT_ID.test(adoption)) return fail('git-failed', 'git printed an unexpected commit id');
    result.adopted = true;

    // Everything from the base down to (and including) the adopting commit; the window is applied here, commit by commit.
    const scanned = runGit(root, ['log', ...LOG_SAFETY_ARGS, '--first-parent', '-z', '--format=%H%x1f%ct', '--end-of-options', pinned, `^${adoption}^@`, '--']);
    const entries = scanned === null ? null : parseScan(scanned);
    if (entries === null) return fail('git-failed', 'git could not read the history');
    const inWindow = entries.filter((e) => e.ms >= since.getTime());
    const cap = Math.min((limit as number | undefined) ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    const selected = inWindow.slice(0, cap);
    result.truncated = inWindow.length > selected.length;
    result.omitted = inWindow.length - selected.length;

    const details = readDetails(root, selected.map((e) => e.sha));
    if (details === null) return fail('git-failed', 'git could not read the commits');
    const run = (maxRecords as number | undefined) ?? MAX_RECORDS_PER_RUN;
    const budget: Budget = { entry: (maxRecordsPerEntry as number | undefined) ?? MAX_RECORDS_PER_ENTRY, run };
    for (const entry of selected) {
        const change = classifyEntry(root, entry, details.get(entry.sha) as Detail, budget);
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
