import path from 'path';
import { Command } from 'commander';
import { emit, type CommandResult } from '../../core/command-result';
import { readJournal } from '../../core/journal/store';
import { isValidRecordFileName, isValidSlug } from '../../core/changes/parse';
import { headSha, isDirtyOutside, isSafeRef, mergeBase, repoRoot, resolveBase, runGit } from '../../core/changes/git';
import { deriveFields } from '../../core/changes/derive';
import { readReceipt } from '../../core/changes/receipt';
import { refreshDerived, renderSkeleton } from '../../core/changes/render';
import { createExclusive, createRecordDir, inspectRecordDir, isRegularFileInside, readRecord, recordsWithSlug, replaceRecord, unchangedSince, type RecordDir } from '../../core/changes/record-io';
import { clipMessage, cleanText, esc, isHttpsUrl, isObj, isSingleLine, isWellFormed } from '../../core/changes/text-safety';
import { MAX_RECORD_BYTES, RECORD_DIR, type DerivedFields, type Verification } from '../../core/changes/types';
import { validateRecordShape } from '../../core/changes/validate-shape';

export interface ChangeDeps { now?: () => Date }
export interface NewOpts { base?: string; plan?: string; issue?: string; model?: string; session?: string; refresh?: boolean }

const REMEDY_RECEIPT = 'commit your work, then run awm sensors run';
const MAX_PROVENANCE_VALUE = 200;
const MAX_ISSUE_URL = 2048;
const MOVED = 'HEAD moved during derivation';
const CREATION_ONLY_FLAGS = ['plan', 'issue', 'model', 'session'] as const;

/** One line of output: control characters escaped, at most 300 UTF-16 units (an ellipsis replaces the cut), never splitting a surrogate pair. */
const line = (text: string): string => clipMessage(cleanText(text));

/**
 * Exit 2 with `code: message` as ONE clipped line (the code counts), and an optional static remedy as a second clipped line.
 * Untrusted text is escaped by the caller with esc().
 */
const fail = (code: string, message: string, remedy?: string): CommandResult => ({
    code: 2, stdout: '',
    stderr: `${line(`${code}: ${message}`)}\n${remedy ? `${line(`  remedy: ${remedy}`)}\n` : ''}`,
});

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

const isIsoInstant = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

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
        if (isIsoInstant(state?.cycle?.startedAt)) out.started_at = state.cycle.startedAt;
        if (isIsoInstant(state?.cycle?.completedAt)) out.finished_at = state.cycle.completedAt;
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
    const head = headSha(root);
    if (head === null) return fail('git-failed', 'git could not read HEAD');
    if (opts.base !== undefined && !isSafeRef(opts.base)) return fail('invalid-input', `--base "${esc(opts.base)}" is not a safe git ref`);
    const base = resolveBase(root, opts.base);
    if (base === null) return fail('base-unresolved', 'could not resolve a base branch', 'pass --base <ref>');
    const mergeBaseSha = mergeBase(root, base);
    if (mergeBaseSha === null) return fail('base-unresolved', `no merge base between "${esc(base)}" and HEAD`, 'pass --base <ref>');
    const derived = deriveFields(root, mergeBaseSha);
    if (!derived.ok) return fail(derived.diagnostic.code, derived.diagnostic.message);
    if (headSha(root) !== head) return fail('git-failed', MOVED);

    // R3.6: the tree equals HEAD (apart from docs/changes and the runtime state) and a receipt vouches for HEAD.
    if (isDirtyOutside(root, [RECORD_DIR])) return fail('tree-dirty', `working tree has uncommitted changes outside ${RECORD_DIR}/`, REMEDY_RECEIPT);
    const receipt = readReceipt(root, head);
    if (!receipt.ok) return fail(receipt.code, `no valid sensor receipt for HEAD ${head.slice(0, 12)}`, REMEDY_RECEIPT);
    const verification: Verification = { commit: receipt.receipt.commit, overall: receipt.receipt.overall, sensors: receipt.receipt.sensors, receipt_digest: receipt.receipt.digest };

    let dir = inspectRecordDir(root);
    if (dir.kind === 'unsafe') return fail('unsafe-path', `${RECORD_DIR} or its parent is a symlink or not a directory; refusing to write`);
    if (dir.kind === 'error') return fail('io-failed', `could not inspect ${RECORD_DIR}`);
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
    if (headSha(root) !== head) return fail('git-failed', MOVED);

    if (dir.kind === 'absent') dir = createRecordDir(root);
    if (dir.kind === 'unsafe') return fail('unsafe-path', `${RECORD_DIR} or its parent is a symlink or not a directory; refusing to write`);
    if (dir.kind !== 'ok') return fail('io-failed', `could not create ${RECORD_DIR}`);
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
    if (headSha(root) !== head) return fail('git-failed', MOVED);
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

export function registerChangeCommand(program: Command, deps: ChangeDeps = {}): void {
    const change = program.command('change').description('create the Change Record of the current branch');
    change
        .command('new <slug>')
        .description('create docs/changes/YYYY-MM-DD-<slug>.md with derived fields and pending narrative')
        .option('--base <ref>', 'base branch (default: origin/HEAD, main, master)')
        .option('--plan <path>', 'repo-relative plan file to link')
        .option('--issue <url>', 'https issue URL to link')
        .option('--model <model>', 'provenance: model identifier')
        .option('--session <session>', 'provenance: session id or URL (avoid internal URLs in public repos)')
        .option('--refresh', 'recompute only derived fields and verification of the existing record')
        .action((slug: string, opts: NewOpts) => {
            let cwd: string;
            try { cwd = process.cwd(); } catch { emit(fail('not-a-git-repo', 'the working directory is not accessible')); return; }
            emit(runChangeNew(cwd, slug, opts, deps));
        });
}
