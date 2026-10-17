import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { writeFileAtomic } from '../atomic-file';
import { cliVersion } from '../cli-version';
import type { RunOutput } from '../../commands/sensors/types';
import type { Overall, SensorStatus } from './types';
import { esc, isSingleLine } from './text-safety';

export interface SensorReceipt {
    schema: 1;
    commit: string;
    ranAt: string;
    cliVersion: string;
    overall: Overall;
    sensors: Record<string, SensorStatus>;
    digest: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const OVERALL = ['pass', 'fail', 'skipped', 'not_certified'];
const STATUS = ['pass', 'fail', 'inconclusive', 'skipped'];
const RECEIPT_KEYS = ['schema', 'commit', 'ranAt', 'cliVersion', 'overall', 'sensors', 'digest'];
const MAX_RECEIPT_BYTES = 1024 * 1024;
/** Local runtime state that never counts as a working-tree change. Everything else under `.awm/` (e.g. `.awm/sensors.json`) does. */
export const RUNTIME_STATE_EXCLUDES: readonly string[] = ['.awm/sensors/runs', '.awm/journal', '.awm/ledger', '.awm/evidence', '.awm/track.json'];
const GIT_OPTS = { encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'], timeout: 15000 };

export interface SelectionOpts { fast?: boolean; slow?: boolean; all?: boolean; changed?: boolean }

/** True when the run covers every sensor: `--changed` never does, `--all` always does, `--fast` xor `--slow` is partial. */
export function isFullSelection(opts: SelectionOpts): boolean {
    if (opts === null || typeof opts !== 'object') return false;
    if (opts.changed) return false;
    if (opts.all) return true;
    return Boolean(opts.fast) === Boolean(opts.slow);
}

function sortedSensors(sensors: Record<string, SensorStatus>): Record<string, SensorStatus> {
    if (sensors === null || typeof sensors !== 'object') return {};
    return Object.fromEntries(Object.keys(sensors).sort().map((k) => [k, sensors[k]]));
}

export function computeReceiptDigest(body: Omit<SensorReceipt, 'digest'>): string {
    const canonical = JSON.stringify({
        schema: body.schema, commit: body.commit, ranAt: body.ranAt, cliVersion: body.cliVersion,
        overall: body.overall, sensors: sortedSensors(body.sensors),
    });
    return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
}

export function buildReceipt(input: { commit: string; ranAt: string; cliVersion: string; output: Pick<RunOutput, 'overall' | 'sensors'> }): SensorReceipt {
    if (typeof input.commit !== 'string' || !SHA_RE.test(input.commit)) throw new Error('receipt commit must be 40 lowercase hex characters');
    const sensors = sortedSensors(Object.fromEntries(input.output.sensors.map((s) => [s.name, s.status])) as Record<string, SensorStatus>);
    const body = { schema: 1 as const, commit: input.commit, ranAt: input.ranAt, cliVersion: input.cliVersion, overall: input.output.overall as Overall, sensors };
    return { ...body, digest: computeReceiptDigest(body) };
}

function runsDir(root: string): string {
    return path.join(root, '.awm', 'sensors', 'runs');
}

function assertNoSymlinkChain(root: string): void {
    let current = root;
    for (const segment of ['.awm', 'sensors', 'runs']) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing to use symlinked path ${current}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }
    }
}

export function writeReceipt(root: string, receipt: SensorReceipt): string {
    assertNoSymlinkChain(root);
    fs.mkdirSync(runsDir(root), { recursive: true, mode: 0o700 });
    assertNoSymlinkChain(root);
    const file = path.join(runsDir(root), `${receipt.commit}.json`);
    writeFileAtomic(file, JSON.stringify(receipt, null, 2) + '\n', 0o600);
    // writeFileAtomic keeps the mode of a file it replaces; a receipt is always owner-only.
    fs.chmodSync(file, 0o600);
    return file;
}

export type ReadReceipt = { ok: true; receipt: SensorReceipt } | { ok: false; code: 'receipt-missing' | 'receipt-invalid' };

const INVALID: ReadReceipt = { ok: false, code: 'receipt-invalid' };

function isCanonicalIso(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const time = new Date(value).getTime();
    return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

/** Reads and verifies a receipt. Anything that is not a pristine, digest-matching receipt for `commit` reads as invalid (or missing). */
export function readReceipt(root: string, commit: string): ReadReceipt {
    if (typeof root !== 'string' || root.length === 0 || typeof commit !== 'string' || !SHA_RE.test(commit)) return INVALID;
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
    if (x === null || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).length !== RECEIPT_KEYS.length || !RECEIPT_KEYS.every((k) => k in x)) return INVALID;
    const sensors = x.sensors as Record<string, unknown>;
    const shapeOk = x.schema === 1 && x.commit === commit && isCanonicalIso(x.ranAt)
        && isSingleLine(x.cliVersion) && OVERALL.includes(x.overall as string)
        && sensors !== null && typeof sensors === 'object' && !Array.isArray(sensors)
        && Object.entries(sensors).every(([name, status]) => isSingleLine(name) && STATUS.includes(status as string))
        && typeof x.digest === 'string';
    if (!shapeOk) return INVALID;
    const receipt = x as unknown as SensorReceipt;
    const { digest, ...body } = receipt;
    if (computeReceiptDigest(body) !== digest) return INVALID;
    return { ok: true, receipt };
}

export type Precondition = { eligible: true; root: string; commit: string } | { eligible: false; reason: string };

/** `dirty` counts untracked files only when `untracked` is true (the pre-run measure); the post-run recheck ignores them. */
function gitState(cwd: string, untracked: boolean): { root: string; commit: string; dirty: boolean } | null {
    try {
        const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { ...GIT_OPTS, cwd }).trim();
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { ...GIT_OPTS, cwd: root }).trim();
        const args = ['status', '--porcelain', ...(untracked ? [] : ['--untracked-files=no']), '--', '.', ...RUNTIME_STATE_EXCLUDES.map((p) => `:(exclude)${p}`)];
        const status = execFileSync('git', args, { ...GIT_OPTS, cwd: root });
        return { root, commit, dirty: status.trim().length > 0 };
    } catch {
        return null;
    }
}

/** Measured BEFORE the run: a receipt certifies a commit only when the tree equals it. */
export function captureReceiptPrecondition(cwd: string): Precondition {
    if (typeof cwd !== 'string' || cwd.length === 0) return { eligible: false, reason: 'cwd must be a non-empty string' };
    const state = gitState(cwd, true);
    if (!state) return { eligible: false, reason: 'not inside a git repository with a commit' };
    if (state.dirty) return { eligible: false, reason: 'working tree has uncommitted changes (commit them first)' };
    if (!SHA_RE.test(state.commit)) return { eligible: false, reason: 'HEAD is not a 40-hex commit' };
    return { eligible: true, root: state.root, commit: state.commit };
}

/** Returns '' on success, or one stderr line explaining why no receipt was written. Never throws. */
export function finalizeReceipt(pre: Precondition, output: Pick<RunOutput, 'overall' | 'sensors'>, deps: { now?: () => Date; version?: () => string } = {}): string {
    try {
        if (pre === null || typeof pre !== 'object') return 'no sensor receipt written: precondition was not captured\n';
        if (!pre.eligible) return `no sensor receipt written: ${esc(pre.reason)}\n`;
        const after = gitState(pre.root, false);
        if (!after || after.commit !== pre.commit || after.dirty) return 'no sensor receipt written: HEAD or tracked files changed during the run\n';
        writeReceipt(pre.root, buildReceipt({ commit: pre.commit, ranAt: (deps.now ?? (() => new Date()))().toISOString(), cliVersion: (deps.version ?? cliVersion)(), output }));
        return '';
    } catch (error) {
        return `no sensor receipt written: ${esc(error instanceof Error ? error.message : String(error))}\n`;
    }
}
