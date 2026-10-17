import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeFileAtomic } from '../atomic-file';
import { cliVersion } from '../cli-version';
import { sameExistingPath } from '../paths';
import type { RunOutput } from '../../commands/sensors/types';
import { MAX_SENSOR_NAME, isCommitId, isOverall, isSensorName, isSensorStatus, type Overall, type SensorStatus } from './types';
import { esc, isCanonicalIso, isSingleLine } from './text-safety';
import { REASON_GIT_FAILED, REASON_NOT_REPO, gitState } from './worktree';

export interface SensorReceipt {
    schema: 1;
    commit: string;
    ranAt: string;
    cliVersion: string;
    overall: Overall;
    sensors: Record<string, SensorStatus>;
    digest: string;
}

const RECEIPT_KEYS = ['schema', 'commit', 'ranAt', 'cliVersion', 'overall', 'sensors', 'digest'];
const MAX_RECEIPT_BYTES = 1024 * 1024;
export interface SelectionOpts { fast?: boolean; slow?: boolean; all?: boolean; changed?: boolean }

/** True when the run covers every sensor: `--changed` never does, `--all` always does, `--fast` xor `--slow` is partial. */
export function isFullSelection(opts: SelectionOpts): boolean {
    if (opts === null || typeof opts !== 'object') return false;
    if (opts.changed) return false;
    if (opts.all) return true;
    return Boolean(opts.fast) === Boolean(opts.slow);
}

function sortedSensors(sensors: Record<string, SensorStatus>): Record<string, SensorStatus> {
    return Object.fromEntries(Object.keys(sensors).sort().map((k) => [k, sensors[k]]));
}

export function computeReceiptDigest(body: Omit<SensorReceipt, 'digest'>): string {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error(esc('invalid receipt: digest body must be an object'));
    if (body.sensors === null || typeof body.sensors !== 'object' || Array.isArray(body.sensors)) throw new Error(esc('invalid receipt: digest body sensors must be an object'));
    const canonical = JSON.stringify({
        schema: body.schema, commit: body.commit, ranAt: body.ranAt, cliVersion: body.cliVersion,
        overall: body.overall, sensors: sortedSensors(body.sensors),
    });
    return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * The ONE receipt shape check, shared by build, write and read so that nothing is written that cannot be read back.
 * Returns a static description of the first problem (never echoes the offending value), or null when the receipt is pristine.
 */
function receiptProblem(x: unknown): string | null {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return 'receipt must be an object';
    const r = x as Record<string, unknown>;
    const keys = Object.keys(r);
    if (keys.length !== RECEIPT_KEYS.length || !RECEIPT_KEYS.every((k) => k in r)) return 'receipt must have exactly the schema keys';
    if (r.schema !== 1) return 'schema must be 1';
    if (!isCommitId(r.commit)) return 'commit must be 40 or 64 lowercase hex characters';
    if (!isCanonicalIso(r.ranAt)) return 'ranAt must be a canonical ISO timestamp';
    if (!isSingleLine(r.cliVersion)) return 'cliVersion must be a single line';
    if (!isOverall(r.overall)) return 'overall is not a known verdict';
    const sensors = r.sensors;
    if (sensors === null || typeof sensors !== 'object' || Array.isArray(sensors)) return 'sensors must be an object';
    for (const [name, status] of Object.entries(sensors)) {
        if (!isSensorName(name)) return `sensor names must be a single line of 1 to ${MAX_SENSOR_NAME} characters`;
        if (!isSensorStatus(status)) return 'a sensor status is not a known status';
    }
    if (typeof r.digest !== 'string') return 'digest must be a string';
    const { digest, ...body } = r as unknown as SensorReceipt;
    if (computeReceiptDigest(body) !== digest) return 'digest does not match the content';
    return null;
}

/** Builds a receipt and fails closed: throws an Error naming the problem when the result is not one `readReceipt` would accept. */
export function buildReceipt(input: { commit: string; ranAt: string; cliVersion: string; output: Pick<RunOutput, 'overall' | 'sensors'> }): SensorReceipt {
    const out = input === null || typeof input !== 'object' ? undefined : input.output;
    if (out === null || typeof out !== 'object' || !Array.isArray(out.sensors) || out.sensors.some((s) => s === null || typeof s !== 'object')) {
        throw new Error('invalid receipt: run output must carry a sensors array');
    }
    const sensors = sortedSensors(Object.fromEntries(out.sensors.map((s) => [s.name, s.status])) as Record<string, SensorStatus>);
    const body = { schema: 1 as const, commit: input.commit, ranAt: input.ranAt, cliVersion: input.cliVersion, overall: out.overall as Overall, sensors };
    const receipt = { ...body, digest: computeReceiptDigest(body) };
    const problem = receiptProblem(receipt);
    if (problem !== null) throw new Error(`invalid receipt: ${problem}`);
    return receipt;
}

function runsDir(root: string): string {
    return path.join(root, '.awm', 'sensors', 'runs');
}

const RUNS_IGNORE_FILE = '.gitignore';
const RUNS_IGNORE_CONTENT = '*\n';

/**
 * R2.2b: receipts are local and never versioned, so the directory ignores itself (`*` also covers this file): `git add -A` in a
 * repository that does not ignore `.awm` can then never commit them. Idempotent; a link at the target is refused (writeFileAtomic).
 */
function ensureRunsIgnore(root: string): void {
    const file = path.join(runsDir(root), RUNS_IGNORE_FILE);
    try {
        const stat = fs.lstatSync(file);
        if (stat.isFile() && fs.readFileSync(file, 'utf8') === RUNS_IGNORE_CONTENT) return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    writeFileAtomic(file, RUNS_IGNORE_CONTENT, 0o644);
}

function assertNoSymlinkChain(root: string): void {
    let current = root;
    for (const segment of ['.awm', 'sensors', 'runs']) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing to use symlinked path ${esc(current)}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
    }
}

/** Writes a receipt. Validates with the same check `readReceipt` applies BEFORE touching the filesystem; throws an Error (never a raw TypeError). */
export function writeReceipt(root: string, receipt: SensorReceipt): string {
    if (typeof root !== 'string' || root.length === 0) throw new Error('receipt root must be a non-empty string');
    const problem = receiptProblem(receipt);
    if (problem !== null) throw new Error(`invalid receipt: ${problem}`);
    const content = JSON.stringify(receipt, null, 2) + '\n';
    if (Buffer.byteLength(content) > MAX_RECEIPT_BYTES) throw new Error('invalid receipt: larger than the size readReceipt accepts');
    assertNoSymlinkChain(root);
    fs.mkdirSync(runsDir(root), { recursive: true, mode: 0o700 });
    assertNoSymlinkChain(root);
    ensureRunsIgnore(root);
    const file = path.join(runsDir(root), `${receipt.commit}.json`);
    writeFileAtomic(file, content, 0o600);
    // writeFileAtomic keeps the mode of a file it replaces; a receipt is always owner-only.
    fs.chmodSync(file, 0o600);
    return file;
}

export type ReadReceipt = { ok: true; receipt: SensorReceipt } | { ok: false; code: 'receipt-missing' | 'receipt-invalid' };

const INVALID: ReadReceipt = { ok: false, code: 'receipt-invalid' };

/** Reads and verifies a receipt. Anything that is not a pristine, digest-matching receipt for `commit` reads as invalid (or missing). */
export function readReceipt(root: string, commit: string): ReadReceipt {
    if (typeof root !== 'string' || root.length === 0 || !isCommitId(commit)) return INVALID;
    let raw: string;
    try {
        assertNoSymlinkChain(root);
        const file = path.join(runsDir(root), `${commit}.json`);
        const stat = fs.lstatSync(file);
        // lstat does not follow links, so a symlink is simply "not a file".
        if (!stat.isFile() || stat.size > MAX_RECEIPT_BYTES) return INVALID;
        raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: false, code: 'receipt-missing' } : INVALID;
    }
    let x: Record<string, unknown>;
    try { x = JSON.parse(raw); } catch { return INVALID; }
    if (receiptProblem(x) !== null || x.commit !== commit) return INVALID;
    const receipt = x as unknown as SensorReceipt;
    return { ok: true, receipt };
}

export type Precondition = { eligible: true; root: string; commit: string } | { eligible: false; reason: string };

/** Measured BEFORE the run: a receipt certifies a commit only when the tree equals it. */
export function captureReceiptPrecondition(cwd: string): Precondition {
    if (typeof cwd !== 'string' || cwd.length === 0) return { eligible: false, reason: 'cwd must be a non-empty string' };
    const state = gitState(cwd, true);
    if (state.kind === 'not-repo') return { eligible: false, reason: REASON_NOT_REPO };
    if (state.kind === 'failed') return { eligible: false, reason: REASON_GIT_FAILED };
    if (state.dirty) return { eligible: false, reason: 'working tree has uncommitted changes (commit them first)' };
    if (!isCommitId(state.commit)) return { eligible: false, reason: 'HEAD is not a full commit id' };
    return { eligible: true, root: state.root, commit: state.commit };
}

/** Returns '' on success, or one stderr line explaining why no receipt was written. Never throws. */
export function finalizeReceipt(pre: Precondition, output: Pick<RunOutput, 'overall' | 'sensors'>, deps: { now?: () => Date; version?: () => string } = {}): string {
    try {
        if (pre === null || typeof pre !== 'object') return 'no sensor receipt written: precondition was not captured\n';
        if (!pre.eligible) return `no sensor receipt written: ${esc(pre.reason)}\n`;
        const after = gitState(pre.root, false);
        if (after.kind === 'failed') return `no sensor receipt written: ${REASON_GIT_FAILED}\n`;
        if (after.kind === 'not-repo') return `no sensor receipt written: ${REASON_NOT_REPO}\n`;
        if (after.commit !== pre.commit || after.dirty) return 'no sensor receipt written: HEAD or tracked files changed during the run\n';
        writeReceipt(pre.root, buildReceipt({ commit: pre.commit, ranAt: (deps.now ?? (() => new Date()))().toISOString(), cliVersion: (deps.version ?? cliVersion)(), output }));
        return '';
    } catch (error) {
        return `no sensor receipt written: ${esc(error instanceof Error ? error.message : String(error))}\n`;
    }
}

/** True when `manifestPath` is the repository root's `.awm/sensors.json` (identity through realpath.native, see sameExistingPath; a missing file is not it). */
export function isRootManifest(root: string, manifestPath: unknown): boolean {
    if (typeof root !== 'string' || root.length === 0 || typeof manifestPath !== 'string' || manifestPath.length === 0) return false;
    return sameExistingPath(path.join(root, '.awm', 'sensors.json'), manifestPath);
}

/**
 * R2.2b/R2.2c: the receipt of a `sensors run`. On top of finalizeReceipt, a receipt certifies the WHOLE declared sensor set or
 * nothing: none is written when no sensor ran (an empty list), when the run dropped part of the manifest (schema-invalid entries,
 * pack drift), when the verdict is `not_certified`, nor when the manifest that ran is not the repository root's (a receipt is
 * keyed by commit only, so the manifests of a monorepo's packages would overwrite each other). Returns '' on success, or one
 * stderr line that says which case applies. Never throws.
 */
export function finalizeRunReceipt(pre: Precondition, output: Pick<RunOutput, 'overall' | 'sensors' | 'manifestPath' | 'invalidEntries' | 'packDrift'>, deps: { now?: () => Date; version?: () => string } = {}): string {
    try {
        if (pre === null || typeof pre !== 'object' || !pre.eligible) return finalizeReceipt(pre, output, deps);
        const withheld = (why: string): string => `no sensor receipt written: ${why}\n`;
        if (output === null || typeof output !== 'object' || !Array.isArray(output.sensors) || output.sensors.length === 0) return withheld('no sensor ran, so there is nothing to certify');
        if (Array.isArray(output.invalidEntries) && output.invalidEntries.length > 0) return withheld('some sensor entries of the manifest were invalid and skipped, so the verdict does not cover it');
        if (output.packDrift !== undefined && output.packDrift !== null) return withheld('the manifest is on the generic fallback while the tree has real stack indicators (pack drift)');
        if (output.overall === 'not_certified') return withheld('the verdict was not certified (not_certified)');
        if (!isRootManifest(pre.root, output.manifestPath)) return withheld("the manifest that ran is not the repository root's .awm/sensors.json (a receipt certifies a whole commit)");
        return finalizeReceipt(pre, output, deps);
    } catch (error) {
        return `no sensor receipt written: ${esc(error instanceof Error ? error.message : String(error))}\n`;
    }
}
