import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import type { CommandResult } from '../../core/command-result';
import { fail, failed, inCwd as inCwdShared, line } from '../../core/changes/command';
import { readJournal } from '../../core/journal/store';
import { isRecordPath, isValidRecordFileName, isValidSlug } from '../../core/changes/parse';
import { addedFilesUnder, changedFiles, isAncestor, isCommittedClean, isDirtyOutside, repoRoot, runGit } from '../../core/changes/git';
import { headMovedFailure, recordDirProblem, resolveRange } from '../../core/changes/range';
import { deriveFields, type Derived } from '../../core/changes/derive';
import { hasOptOut } from '../../core/changes/trailers';
import { readReceipt } from '../../core/changes/receipt';
import { refreshDerived, renderSkeleton } from '../../core/changes/render';
import { isRegularFileInside } from '../../core/changes/fs-safe';
import { createExclusive, createRecordDir, inspectRecordDir, readRecord, recordsWithSlug, replaceRecord, unchangedSince, type RecordDir } from '../../core/changes/record-io';
import { esc, isCanonicalIso, isHttpsUrl, isObj, isSingleLine, isWellFormed, sliceNoSplit } from '../../core/changes/text-safety';
import { DERIVED_KEYS, MAX_RECORD_BYTES, RECORD_DIR, type ChangeRecord, type DerivedFields, type Diagnostic, type Verification } from '../../core/changes/types';
import { validateRecordShape } from '../../core/changes/validate-shape';

export interface ChangeDeps { now?: () => Date }
export interface NewOpts { base?: string; plan?: string; issue?: string; model?: string; session?: string; refresh?: boolean }

const REMEDY_RECEIPT = 'commit your work, then run awm sensors run';
const MAX_PROVENANCE_VALUE = 200;
const MAX_ISSUE_URL = 2048;
const CREATION_ONLY_FLAGS = ['plan', 'issue', 'model', 'session'] as const;

// ---- Flags (R3.11b, R3.12) ----

/** Provenance text: one line, not blank, at most 200 code points, writable as UTF-8. */
function isProvenanceValue(v: string): boolean {
    return isSingleLine(v) && v.trim() !== '' && [...v].length <= MAX_PROVENANCE_VALUE && isWellFormed(v);
}

/** A static description of the first bad flag (never the value), or null. */
function flagProblem(opts: Record<string, unknown>, root: string): string | null {
    for (const key of ['base', 'plan', 'issue', 'model', 'session'] as const) {
        if (opts[key] !== undefined && typeof opts[key] !== 'string') return `--${key} must be a string`;
    }
    if (opts.refresh !== undefined && typeof opts.refresh !== 'boolean') return '--refresh must be a boolean flag';
    if (opts.refresh === true) {
        const clash = CREATION_ONLY_FLAGS.find((key) => opts[key] !== undefined);
        if (clash) return `--refresh cannot be combined with --${clash}: it only applies when a record is created`;
    }
    for (const key of ['model', 'session'] as const) {
        const v = opts[key];
        if (v !== undefined && !isProvenanceValue(v as string)) return `--${key} must be one non-blank line of at most ${MAX_PROVENANCE_VALUE} characters`;
    }
    if (opts.issue !== undefined && !(isWellFormed(opts.issue) && isHttpsUrl(opts.issue, { allowCredentials: false, maxLength: MAX_ISSUE_URL }))) return '--issue must be an https URL without credentials';
    if (opts.plan !== undefined && !isRegularFileInside(root, opts.plan as string)) return '--plan must be an existing regular file inside the repository';
    return null;
}

// ---- Provenance (R3.8) ----

/** Same branch name the journal writers use (detectBranch), read through runGit. A detached HEAD has no journal of its own. */
function currentBranch(root: string): string {
    const name = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim();
    return name && name !== 'HEAD' ? name : '_no-branch';
}

/** Only keys with a source: the journal (when present and readable) and the flags. Never throws; a bad journal contributes nothing. */
function provenance(root: string, opts: NewOpts): Record<string, string> {
    const out: Record<string, string> = {};
    try {
        const state = readJournal(root, currentBranch(root)).state;
        const agent = state?.admissionContext?.provider;
        if (typeof agent === 'string' && isProvenanceValue(agent)) out.agent = agent;
        if (isCanonicalIso(state?.cycle?.startedAt)) out.started_at = state.cycle.startedAt;
        if (isCanonicalIso(state?.cycle?.completedAt)) out.finished_at = state.cycle.completedAt;
    } catch {
        // A damaged or unreadable journal is not an error of this command.
    }
    if (opts.model !== undefined) out.model = opts.model;
    if (opts.session !== undefined) out.session = opts.session;
    return out;
}

// ---- awm change new ----

function utcDate(deps: ChangeDeps): string | null {
    try {
        const moment = (deps.now ?? (() => new Date()))();
        if (!(moment instanceof Date) || Number.isNaN(moment.getTime())) return null;
        const iso = moment.toISOString();
        return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso.slice(0, 10) : null;
    } catch {
        return null;
    }
}

function changeNew(cwd: string, slug: string, rawOpts: unknown, deps: ChangeDeps): CommandResult {
    if (typeof cwd !== 'string' || cwd.length === 0) return fail('invalid-input', 'the working directory must be a non-empty string');
    if (!isValidSlug(slug)) return fail('slug-invalid', `slug "${esc(slug)}" must match [a-z0-9]+(-[a-z0-9]+)* and be at most 64 characters`);
    if (rawOpts !== undefined && !isObj(rawOpts)) return fail('flag-invalid', 'options must be an object');
    const opts = (rawOpts ?? {}) as NewOpts;
    const root = repoRoot(cwd);
    if (root === null) return fail('not-a-git-repo', 'awm change must run inside a git repository');
    const flag = flagProblem(opts as Record<string, unknown>, root);
    if (flag) return fail('flag-invalid', flag);

    // Pin HEAD before anything is derived: the fields, the dirty check and the receipt all describe this one commit.
    const range = resolveRange(root, opts.base);
    if (!range.ok) return failed(range.failure);
    const { head } = range;
    const derived = deriveFields(root, range.mergeBase);
    if (!derived.ok) return fail(derived.diagnostic.code, derived.diagnostic.message);
    const movedAfterDerive = headMovedFailure(root, head);
    if (movedAfterDerive) return failed(movedAfterDerive);

    // R3.6: the tree equals HEAD (apart from docs/changes and the runtime state) and a receipt vouches for HEAD.
    if (isDirtyOutside(root, [RECORD_DIR])) return fail('tree-dirty', `working tree has uncommitted changes outside ${RECORD_DIR}/`, REMEDY_RECEIPT);
    const receipt = readReceipt(root, head);
    if (!receipt.ok) return fail(receipt.code, `no valid sensor receipt for HEAD ${head.slice(0, 12)}`, REMEDY_RECEIPT);
    const verification: Verification = { commit: receipt.receipt.commit, overall: receipt.receipt.overall, sensors: receipt.receipt.sensors, receipt_digest: receipt.receipt.digest };

    let dir = inspectRecordDir(root);
    const dirProblem = recordDirProblem(dir, 'write');
    if (dirProblem) return failed(dirProblem);
    const existing = dir.kind === 'ok' ? recordsWithSlug(dir.dir, slug) : [];
    if (existing === null) return fail('io-failed', `could not list ${RECORD_DIR}`);

    if (opts.refresh === true) return refresh({ dir, existing, slug, fields: derived.fields, verification, head, root });

    if (existing.length > 0) return fail('record-exists', `a record for slug "${slug}" already exists (${existing[0]})`, 'use --refresh to update derived fields');
    const date = utcDate(deps);
    const id = date === null ? null : `${date}-${slug}`;
    if (id === null || !isValidRecordFileName(`${id}.md`)) return fail('date-invalid', 'the clock did not yield a valid calendar date');
    const links: { plan?: string; issue?: string } = {};
    if (opts.plan !== undefined) links.plan = opts.plan;
    if (opts.issue !== undefined) links.issue = opts.issue;
    const content = renderSkeleton({ id, fields: derived.fields, verification, links, provenance: provenance(root, opts) });
    if (content === null) return fail('skeleton-invalid', 'the record skeleton could not be rendered');
    // Backstop: the only thing wrong with a skeleton may be its pending markers.
    const problem = validateRecordShape(`${id}.md`, content, { root }).diagnostics.find((d) => d.code !== 'pending-content');
    if (problem) return fail('skeleton-invalid', `the generated record failed validation: ${esc(problem.code)}${problem.field ? ` (${esc(problem.field)})` : ''}`);
    const movedBeforeWrite = headMovedFailure(root, head);
    if (movedBeforeWrite) return failed(movedBeforeWrite);

    if (dir.kind === 'absent') dir = createRecordDir(root);
    if (dir.kind !== 'ok') return failed(recordDirProblem(dir, 'create'));
    const written = createExclusive(path.join(dir.dir, `${id}.md`), content);
    if (written === 'exists') return fail('record-exists', `${id}.md already exists`, 'use --refresh to update derived fields');
    if (written === 'error') return fail('io-failed', `could not write ${RECORD_DIR}/${id}.md`);
    return { code: 0, stdout: `Created ${RECORD_DIR}/${id}.md\n`, stderr: '' };
}

interface RefreshInput { dir: RecordDir; existing: string[]; slug: string; fields: DerivedFields; verification: Verification; head: string; root: string }

/** R3.11: rewrites only the derived fields and verification of the one existing record. */
function refresh({ dir, existing, slug, fields, verification, head, root }: RefreshInput): CommandResult {
    if (dir.kind !== 'ok' || existing.length === 0) return fail('record-missing', `no record found for slug "${slug}"`, `run awm change new ${slug} to create it`);
    if (existing.length > 1) return fail('record-ambiguous', `${existing.length} records exist for slug "${slug}"; keep one`);
    const name = existing[0];
    const target = path.join(dir.dir, name);
    const current = readRecord(target, name);
    if (!current.ok) return fail(current.code, current.message);
    const next = refreshDerived(current.text, fields, verification);
    if (next === null || Buffer.byteLength(next, 'utf8') > MAX_RECORD_BYTES) return fail('record-invalid', `${esc(name)} has unparseable frontmatter, misses a derived key, or cannot be refreshed safely`);
    const moved = headMovedFailure(root, head);
    if (moved) return failed(moved);
    // Someone else may have edited (or replaced) the record since it was read: their version wins, nothing is written.
    if (!unchangedSince(target, current.snapshot)) return fail('record-changed', `${esc(name)} changed while it was being refreshed; run the command again`);
    const written = replaceRecord(target, next);
    if (!written.ok) return fail('io-failed', `could not write ${esc(name)} (${esc(written.code)})`);
    return { code: 0, stdout: `Refreshed ${RECORD_DIR}/${name}\n`, stderr: '' };
}

/** Never throws: any unexpected failure becomes a diagnostic. */
export function runChangeNew(cwd: string, slug: string, opts: NewOpts, deps: ChangeDeps = {}): CommandResult {
    try {
        return changeNew(cwd, slug, opts, isObj(deps) ? deps : {});
    } catch (error) {
        return fail('internal-error', `unexpected failure (${esc(error instanceof Error ? error.name : 'unknown')})`);
    }
}

// ---- awm change validate (R4) ----

export interface ValidateOpts { base?: string; strict?: boolean; json?: boolean }
interface RecordReport { path: string; state: 'valid' | 'invalid'; diagnostics: Diagnostic[] }
type RunState = 'valid' | 'invalid' | 'exempt';

/** R4.5: diagnostics per record. When more were found the last slot becomes a `diagnostics-truncated` marker. */
const MAX_RECORD_DIAGNOSTICS = 20;
/** Records validated per run; further ones are not read and make the run invalid (`too-many-records`). */
const MAX_RECORDS = 50;
/** Paths listed in a `code-changed-after-verification` message (the message itself is clipped to one line of 300 units). */
const MAX_LATE_PATHS = 20;
/** Each half of a `derived-mismatch` message gets this many UTF-16 units, so the recorded and the derived value are both always visible. */
const MAX_SHOWN_VALUE = 120;

const safeDiagnostic = (d: Diagnostic): Diagnostic => {
    const base: Diagnostic = { code: line(d.code), message: line(d.message) };
    return d.field === undefined ? base : { ...base, field: line(d.field) };
};

/**
 * One record's report: every text field made single-line and bounded, at most 20 diagnostics. `dropped` counts the diagnostics
 * the shape validator's own cap already removed, so the truncation marker counts every omitted diagnostic.
 */
function finish(recordPath: string, list: Diagnostic[], dropped = 0): RecordReport {
    const all = list.map(safeDiagnostic);
    const total = all.length + dropped;
    const kept = total > MAX_RECORD_DIAGNOSTICS
        ? [...all.slice(0, MAX_RECORD_DIAGNOSTICS - 1), { code: 'diagnostics-truncated', message: `${total - (MAX_RECORD_DIAGNOSTICS - 1)} more diagnostics omitted` }]
        : all;
    return { path: line(recordPath), state: kept.length === 0 ? 'valid' : 'invalid', diagnostics: kept };
}

function formatText(state: RunState, records: RecordReport[]): string {
    const lines = [`Change Record validation: ${state}${state === 'exempt' ? ' (Change-Record: none)' : ''}`];
    for (const r of records) {
        lines.push(line(`- ${r.path}: ${r.state}`));
        for (const d of r.diagnostics) lines.push(line(`  - ${d.code}${d.field === undefined ? '' : ` (${d.field})`}: ${d.message}`));
    }
    return `${lines.join('\n')}\n`;
}

/** R4.5: the one place a verdict becomes output: a text report or one JSON line, exit 0 unless invalid. */
function render(json: boolean, state: RunState, records: RecordReport[]): CommandResult {
    return { code: state === 'invalid' ? 2 : 0, stdout: json ? `${JSON.stringify({ state, records })}\n` : formatText(state, records), stderr: '' };
}

/** R4.5: an operational failure. With --json it is the one-line report shape (state invalid, record `docs/changes`), else the stderr form of `change new`. */
function failure(json: boolean, code: string, message: string, remedy?: string): CommandResult {
    if (!json) return fail(code, message, remedy);
    return render(true, 'invalid', [finish(RECORD_DIR, [{ code, message: remedy ? `${message}; ${remedy}` : message }])]);
}

/** What every record of one run is checked against; computed at most once per run (and per verification commit). */
interface ValidateRun {
    root: string; head: string; mergeBaseSha: string; strict: boolean;
    dir: RecordDir;
    derived?: Derived;
    ancestors: Map<string, boolean>;
    /** The files changed since a verification commit, outside docs/changes/: their number and the first MAX_LATE_PATHS (null: git failed). */
    late: Map<string, { count: number; first: string[] } | null>;
}

const deriveOnce = (run: ValidateRun): Derived => (run.derived ??= deriveFields(run.root, run.mergeBaseSha));

function lateFiles(run: ValidateRun, commit: string): { count: number; first: string[] } | null {
    if (!run.late.has(commit)) {
        const files = changedFiles(run.root, commit, run.head)?.filter((f) => !f.startsWith(`${RECORD_DIR}/`));
        run.late.set(commit, files === undefined ? null : { count: files.length, first: files.slice(0, MAX_LATE_PATHS) });
    }
    return run.late.get(commit) ?? null;
}

/** A git failure counts as "not an ancestor": the caller reports `verification-commit-foreign` (fail closed). */
function isAncestorOfHead(run: ValidateRun, commit: string): boolean {
    if (!run.ancestors.has(commit)) run.ancestors.set(commit, isAncestor(run.root, commit, run.head));
    return run.ancestors.get(commit) === true;
}

const sameSensors = (a: Record<string, string>, b: Record<string, string>): boolean => {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
};

/** A derived value for a message: strings escaped inside quotes (esc), lists bracketed, everything else as JSON; at most MAX_SHOWN_VALUE units. */
function show(value: unknown): string {
    const text = showAll(value);
    return text.length > MAX_SHOWN_VALUE ? `${sliceNoSplit(text, MAX_SHOWN_VALUE - 1)}…` : text;
}

function showAll(value: unknown): string {
    if (typeof value === 'string') return `"${esc(value)}"`;
    if (Array.isArray(value)) return `[${value.map(showAll).join(', ')}]`;
    return JSON.stringify(value) ?? 'undefined';
}

/** R4.3: the recomputed derived fields equal the record's, one diagnostic per differing field. */
function checkDerived(run: ValidateRun, record: ChangeRecord, out: Diagnostic[]): void {
    const derived = deriveOnce(run);
    if (!derived.ok) { out.push(derived.diagnostic); return; }
    for (const key of DERIVED_KEYS) {
        if (JSON.stringify(record[key]) !== JSON.stringify(derived.fields[key])) {
            out.push({ code: 'derived-mismatch', field: key, message: `${key} is ${show(record[key])} but git derives ${show(derived.fields[key])}` });
        }
    }
}

/** R4.3: the verified commit is HEAD or an ancestor of it, and nothing outside docs/changes/ changed since. */
function checkVerifiedCommit(run: ValidateRun, commit: string, out: Diagnostic[]): void {
    if (!isAncestorOfHead(run, commit)) {
        out.push({ code: 'verification-commit-foreign', field: 'verification.commit', message: `${commit.slice(0, 12)} is not HEAD or an ancestor of HEAD` });
        return;
    }
    const late = lateFiles(run, commit);
    if (late === null) { out.push({ code: 'git-failed', message: `git could not list the files changed since ${commit.slice(0, 12)}` }); return; }
    if (late.count === 0) return;
    out.push({ code: 'code-changed-after-verification', message: `${late.count} file${late.count === 1 ? '' : 's'} changed after ${commit.slice(0, 12)}: ${late.first.map(esc).join(', ')}${late.count > MAX_LATE_PATHS ? ', …' : ''}` });
}

/** R4.4: the receipt of the verified commit exists, matches the record's verification block, and says pass. */
function checkReceipt(run: ValidateRun, record: ChangeRecord, out: Diagnostic[]): void {
    const { verification } = record;
    const receipt = readReceipt(run.root, verification.commit);
    if (!receipt.ok) {
        out.push({ code: receipt.code, field: 'verification.commit', message: `no valid sensor receipt for ${verification.commit.slice(0, 12)}` });
        return;
    }
    const r = receipt.receipt;
    if (r.digest !== verification.receipt_digest) out.push({ code: 'verification-mismatch', field: 'verification.receipt_digest', message: 'receipt_digest differs from the sensor receipt' });
    if (r.overall !== verification.overall) out.push({ code: 'verification-mismatch', field: 'verification.overall', message: `the record says ${esc(verification.overall)} but the sensor receipt says ${esc(r.overall)}` });
    if (!sameSensors(r.sensors, verification.sensors)) out.push({ code: 'verification-mismatch', field: 'verification.sensors', message: 'the sensors differ from the sensor receipt' });
    if (r.overall !== 'pass') out.push({ code: 'verification-not-passing', field: 'verification.overall', message: `the sensor verdict is ${esc(r.overall)}, not pass` });
}

/** R4.3: without a path the verdict describes the committed record. Git unable to tell fails closed. */
function checkCommitted(root: string, rel: string, out: Diagnostic[]): void {
    const clean = isCommittedClean(root, rel);
    if (clean === true) return;
    out.push({ code: 'record-uncommitted', message: clean === false ? `${esc(rel)} has uncommitted changes; commit it and validate again` : `could not tell whether ${esc(rel)} has uncommitted changes` });
}

/** The records are read from the working tree, through the symlink-safe, size-bounded readers. Never throws. */
function validateOne(run: ValidateRun, rel: string, requireCommitted: boolean): RecordReport {
    const name = path.posix.basename(rel);
    /** A record that cannot even be read: one diagnostic. */
    const single = (code: string, message: string): RecordReport => finish(rel, [{ code, message }]);
    const { dir } = run;
    if (dir.kind !== 'ok') {
        const dirProblem = recordDirProblem(dir, 'read');
        return dirProblem ? single(dirProblem.code, dirProblem.message) : single('record-missing', `${RECORD_DIR}/ does not exist`);
    }
    if (!isRegularFileInside(run.root, rel)) return single('record-missing', `${esc(rel)} is not a regular file in the working tree`);
    const read = readRecord(path.join(dir.dir, name), name);
    if (!read.ok) return single(read.tooLarge === true ? 'record-too-large' : read.code, read.message);

    const diagnostics: Diagnostic[] = [];
    if (requireCommitted) checkCommitted(run.root, rel, diagnostics);
    const shape = validateRecordShape(name, read.text, { root: run.root });
    // The shape validator's own cap ends its list with a marker; finish() writes one marker for the whole record instead.
    const dropped = shape.omitted ?? 0;
    diagnostics.push(...(dropped > 0 ? shape.diagnostics.slice(0, -1) : shape.diagnostics));
    const record = shape.record;
    if (record) {
        checkDerived(run, record, diagnostics);
        checkVerifiedCommit(run, record.verification.commit, diagnostics);
        if (run.strict) checkReceipt(run, record, diagnostics);
    }
    return finish(rel, diagnostics, dropped);
}

/** The repo-relative, `/`-separated path `target` (read from `cwd`) names, or null when it lies outside the repository. */
function repoRelative(root: string, cwd: string, target: string): string | null {
    if (target === '' || target.includes('\0')) return null;
    const real = (p: string): string => { try { return fs.realpathSync.native(p); } catch { return p; } };
    for (const from of new Set([cwd, real(cwd)])) {
        const resolved = path.resolve(from, target);
        for (const full of new Set([resolved, real(resolved)])) {
            for (const base of new Set([root, real(root)])) {
                const rel = path.relative(base, full);
                if (rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
            }
        }
    }
    return null;
}

/** True only for a real `--json` flag; anything else (including a malformed options value) keeps the stderr form. */
function wantsJson(rawOpts: unknown): boolean {
    try { return isObj(rawOpts) && rawOpts.json === true; } catch { return false; }
}

function validateOpts(rawOpts: unknown): ValidateOpts | string {
    if (rawOpts !== undefined && !isObj(rawOpts)) return 'options must be an object';
    const opts = (rawOpts ?? {}) as Record<string, unknown>;
    if (opts.base !== undefined && typeof opts.base !== 'string') return '--base must be a string';
    for (const key of ['strict', 'json'] as const) if (opts[key] !== undefined && typeof opts[key] !== 'boolean') return `--${key} must be a boolean flag`;
    return opts as ValidateOpts;
}

const verdict = (records: RecordReport[]): { state: RunState; records: RecordReport[] } => ({ state: records.every((r) => r.state === 'valid') ? 'valid' : 'invalid', records });

/** The records added in the range, validated; the opt-out trailer exempts a branch that adds none. Null when git cannot list them. */
function branchVerdict(run: ValidateRun): { state: RunState; records: RecordReport[] } | null {
    const added = addedFilesUnder(run.root, run.mergeBaseSha, run.head, RECORD_DIR);
    if (added === null) return null;
    const names = added.filter(isRecordPath);
    if (names.length === 0) {
        if (hasOptOut(run.root, [`${run.mergeBaseSha}..${run.head}`])) return { state: 'exempt', records: [] };
        return verdict([finish(RECORD_DIR, [{ code: 'record-missing', message: 'this branch adds no Change Record and no commit carries Change-Record: none' }])]);
    }
    const records = names.slice(0, MAX_RECORDS).map((name) => validateOne(run, name, true));
    if (names.length > MAX_RECORDS) records.push(finish(RECORD_DIR, [{ code: 'too-many-records', message: `${names.length} records were added; only the first ${MAX_RECORDS} were validated` }]));
    return verdict(records);
}

function changeValidate(cwd: string, target: unknown, rawOpts: unknown): CommandResult {
    const json = wantsJson(rawOpts);
    const bail = (code: string, message: string, remedy?: string): CommandResult => failure(json, code, message, remedy);
    if (typeof cwd !== 'string' || cwd.length === 0) return bail('invalid-input', 'the working directory must be a non-empty string');
    if (target !== undefined && typeof target !== 'string') return bail('path-invalid', 'the path must be a string');
    const opts = validateOpts(rawOpts);
    if (typeof opts === 'string') return bail('flag-invalid', opts);
    const root = repoRoot(cwd);
    if (root === null) return bail('not-a-git-repo', 'awm change must run inside a git repository');

    let rel: string | null = null;
    if (target !== undefined) {
        rel = repoRelative(root, cwd, target);
        if (rel === null || !isRecordPath(rel)) return bail('path-invalid', `"${esc(target)}" must name a file ${RECORD_DIR}/YYYY-MM-DD-<slug>.md of this repository`);
    }
    // Pin HEAD: the range, the ancestry and the late-file checks all describe this one commit.
    const range = resolveRange(root, opts.base);
    if (!range.ok) return bail(range.failure.code, range.failure.message, range.failure.remedy);

    const run: ValidateRun = { root, head: range.head, mergeBaseSha: range.mergeBase, strict: opts.strict === true, dir: inspectRecordDir(root), ancestors: new Map(), late: new Map() };
    const outcome = rel !== null ? verdict([validateOne(run, rel, false)]) : branchVerdict(run);
    if (outcome === null) return bail('git-failed', `git could not list the records added since ${range.mergeBase.slice(0, 12)}`);
    const moved = headMovedFailure(root, range.head);
    if (moved) return bail(moved.code, moved.message);
    return render(json, outcome.state, outcome.records);
}

/** Never throws: any unexpected failure becomes a diagnostic. Read-only (R4.6): nothing here writes a file. */
export function runChangeValidate(cwd: string, target: string | undefined, opts: ValidateOpts): CommandResult {
    try {
        return changeValidate(cwd, target, opts);
    } catch (error) {
        return failure(wantsJson(opts), 'internal-error', `unexpected failure (${esc(error instanceof Error ? error.name : 'unknown')})`);
    }
}

/** The action wrapper: the working directory may be gone, and nothing may throw out of the action. */
function inCwd(command: (cwd: string) => CommandResult, json = false): void {
    inCwdShared(command, () => failure(json, 'not-a-git-repo', 'the working directory is not accessible'));
}

export function registerChangeCommand(program: Command, deps: ChangeDeps = {}): void {
    const change = program.command('change').description('create and validate the Change Record of the current branch');
    change
        .command('new <slug>')
        .description('create docs/changes/YYYY-MM-DD-<slug>.md with derived fields and pending narrative')
        .option('--base <ref>', 'base branch (default: origin/HEAD, main, master)')
        .option('--plan <path>', 'repo-relative plan file to link')
        .option('--issue <url>', 'https issue URL to link')
        .option('--model <model>', 'provenance: model identifier')
        .option('--session <session>', 'provenance: session id or URL (avoid internal URLs in public repos)')
        .option('--refresh', 'recompute only derived fields and verification of the existing record')
        .action((slug: string, opts: NewOpts) => inCwd((cwd) => runChangeNew(cwd, slug, opts, deps)));
    change
        .command('validate [path]')
        .description('validate the Change Record(s) added by this branch, or one record (--strict also checks the sensor receipt)')
        .option('--base <ref>', 'base branch (default: origin/HEAD, main, master)')
        .option('--strict', 'require a matching, passing sensor receipt for verification.commit')
        .option('--json', 'print a single JSON line')
        .action((target: string | undefined, opts: ValidateOpts) => inCwd((cwd) => runChangeValidate(cwd, target, opts), wantsJson(opts)));
}
