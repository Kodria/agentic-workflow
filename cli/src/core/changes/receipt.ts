import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { writeFileAtomic } from '../atomic-file';
import { cliVersion } from '../cli-version';
import { sameExistingPath } from '../paths';
import type { RunOutput, SensorResult } from '../../commands/sensors/types';
import { MAX_SENSOR_NAME, isCommitId, isOverall, isSensorName, isSensorStatus, type Overall, type SensorStatus } from './types';
import { esc, isCanonicalIso, isSingleLine } from './text-safety';
import { REASON_GIT_FAILED, REASON_NOT_REPO, RUNTIME_STATE_EXCLUDES, gitState } from './worktree';
import { CACHE_DIGEST_BASELINE_REL, isSafeRepoRel, repoPathMatchesInputGlobs } from '../../commands/sensors/inputs-digest';

/** Per-sensor measurement recorded on a schema-2 receipt (RF-4.3). */
export interface SensorReceiptMeasurement {
    /** Effective authored input globs at certification (nonempty), relative to `packageRootRel`. */
    inputs: string[];
    /**
     * Repo-root-relative package root at certification (`''` for repository root).
     * Lets validate rematch `inputs` against late paths that were not yet on disk (RF-4.5).
     */
    packageRootRel: string;
    inputDigest: string;
    sensorFingerprint: string;
    /** Repo-root POSIX paths that participated in the input digest. */
    measuredPaths: string[];
}

interface SensorReceiptCommon {
    commit: string;
    ranAt: string;
    cliVersion: string;
    overall: Overall;
    sensors: Record<string, SensorStatus>;
    digest: string;
}

export interface SensorReceiptV1 extends SensorReceiptCommon {
    schema: 1;
}

export interface SensorReceiptV2 extends SensorReceiptCommon {
    schema: 2;
    /**
     * Per sensor that had authored inputs at certification.
     * A sensor listed in `sensors` but missing here had no authored inputs (RF-4.6).
     */
    measurements: Record<string, SensorReceiptMeasurement>;
    /**
     * Validate always-measured paths (RF-2.12 validate set), repo-root POSIX,
     * including `.awm/sensors.baseline.json`.
     */
    alwaysMeasuredPaths: string[];
}

export type SensorReceipt = SensorReceiptV1 | SensorReceiptV2;

const RECEIPT_KEYS_V1 = ['schema', 'commit', 'ranAt', 'cliVersion', 'overall', 'sensors', 'digest'] as const;
const RECEIPT_KEYS_V2 = [...RECEIPT_KEYS_V1, 'measurements', 'alwaysMeasuredPaths'] as const;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_MEASURED_PATHS = 50_000;
export interface SelectionOpts { fast?: boolean; slow?: boolean; all?: boolean; changed?: boolean; slice?: boolean }

/** True when the run covers every sensor: `--changed`/`--slice` never do, `--all` always does, `--fast` xor `--slow` is partial. */
export function isFullSelection(opts: SelectionOpts): boolean {
    if (opts === null || typeof opts !== 'object') return false;
    if (opts.changed) return false;
    if (opts.slice) return false;
    if (opts.all) return true;
    return Boolean(opts.fast) === Boolean(opts.slow);
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The sensors of a receipt or a record as [name, status] pairs sorted by name in UTF-16 code-unit order. JavaScript orders the keys
 * of an object by itself (integer-like names such as '9' and '10' come first, numerically), so nothing that is digested or
 * compared relies on that order: it goes through this array.
 */
export function sensorPairs(sensors: Record<string, string>): Array<[string, string]> {
    return Object.entries(sensors).sort(([a], [b]) => byName(a, b));
}

function sortedSensors(sensors: Record<string, SensorStatus>): Record<string, SensorStatus> {
    return Object.fromEntries(sensorPairs(sensors)) as Record<string, SensorStatus>;
}

function sortedStrings(values: string[]): string[] {
    return [...values].sort(byName);
}

function isSha256Digest(v: unknown): v is string {
    return typeof v === 'string' && /^sha256:[0-9a-f]{64}$/.test(v);
}

function isPackageRootRel(v: unknown): v is string {
    return typeof v === 'string' && (v === '' || isSafeRepoRel(v));
}

function measurementProblem(name: string, value: unknown): string | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return `measurement for ${name} must be an object`;
    const m = value as Record<string, unknown>;
    const keys = Object.keys(m);
    if (keys.length !== 5 || !['inputs', 'packageRootRel', 'inputDigest', 'sensorFingerprint', 'measuredPaths'].every((k) => k in m)) {
        return `measurement for ${name} must have exactly inputs, packageRootRel, inputDigest, sensorFingerprint, measuredPaths`;
    }
    if (!Array.isArray(m.inputs) || m.inputs.length === 0 || m.inputs.some((g) => typeof g !== 'string' || g.length === 0 || !isSingleLine(g))) {
        return `measurement inputs for ${name} must be a nonempty array of single-line strings`;
    }
    if (!isPackageRootRel(m.packageRootRel)) return `measurement packageRootRel for ${name} must be '' or a safe repo-root POSIX path`;
    if (!isSha256Digest(m.inputDigest)) return `measurement inputDigest for ${name} must be sha256:<hex>`;
    if (!isSha256Digest(m.sensorFingerprint)) return `measurement sensorFingerprint for ${name} must be sha256:<hex>`;
    if (!Array.isArray(m.measuredPaths) || m.measuredPaths.length > MAX_MEASURED_PATHS) {
        return `measurement measuredPaths for ${name} must be an array within bounds`;
    }
    if (m.measuredPaths.some((p) => typeof p !== 'string' || !isSafeRepoRel(p))) {
        return `measurement measuredPaths for ${name} must be safe repo-root POSIX paths`;
    }
    const sorted = sortedStrings(m.measuredPaths as string[]);
    if (JSON.stringify(m.measuredPaths) !== JSON.stringify(sorted)) {
        return `measurement measuredPaths for ${name} must be sorted`;
    }
    return null;
}

/**
 * RF-4.6: schema-2 unmeasured-path relaxation applies only when every sensor on the
 * receipt had effective authored inputs (a nonempty measurement.inputs entry).
 */
export function allowsUnmeasuredRelaxation(receipt: SensorReceipt): boolean {
    if (receipt === null || typeof receipt !== 'object') return false;
    if (receipt.schema !== 2) return false;
    const names = Object.keys(receipt.sensors);
    if (names.length === 0) return false;
    for (const name of names) {
        const m = receipt.measurements[name];
        if (!m || !Array.isArray(m.inputs) || m.inputs.length === 0) return false;
    }
    return true;
}

/** Repo-root POSIX paths that count as measured for RF-4.5 late-path checks. */
export function measuredPathSet(receipt: SensorReceiptV2): Set<string> {
    const out = new Set<string>();
    for (const p of receipt.alwaysMeasuredPaths) out.add(p);
    for (const m of Object.values(receipt.measurements)) {
        for (const p of m.measuredPaths) out.add(p);
    }
    return out;
}

function isRuntimeStatePath(rel: string): boolean {
    return RUNTIME_STATE_EXCLUDES.some((ex) => rel === ex || rel.startsWith(`${ex}/`));
}

/** True when a late path is measured: frozen set OR rematch against any measurement's inputs (RF-4.5). */
function latePathIsMeasured(repoRel: string, receipt: SensorReceiptV2, frozen: Set<string>): boolean {
    if (frozen.has(repoRel)) return true;
    for (const m of Object.values(receipt.measurements)) {
        if (repoPathMatchesInputGlobs(repoRel, m.packageRootRel, m.inputs)) return true;
    }
    return false;
}

/**
 * Filter late files for Change Record validate (RF-4.5/4.6). Schema 1 and incomplete
 * schema 2 keep today's strict rule (only `docs/changes/` carved out). Complete schema 2
 * keeps paths in the frozen measured ∪ always-measured union OR matching authored inputs
 * globs (so new matching sources after verify are not a false green). Runtime-state never counts.
 */
export function filterLateFilesForReceipt(
    files: string[],
    receipt: SensorReceipt | null,
    recordDirPrefix: string,
): string[] {
    const outsideRecords = files.filter((f) => !f.startsWith(`${recordDirPrefix}/`));
    if (receipt === null || receipt.schema !== 2 || !allowsUnmeasuredRelaxation(receipt)) {
        return outsideRecords;
    }
    const measured = measuredPathSet(receipt);
    return outsideRecords.filter((f) => !isRuntimeStatePath(f) && latePathIsMeasured(f, receipt, measured));
}

/**
 * sha256 over the canonical JSON of the receipt without its digest, `sensors` being the name-sorted pairs of sensorPairs (R2.2c).
 * The digest is local (receipts are not versioned and are rewritten by every full run), so changing its canonical form only
 * invalidates receipts written before it; `change new` writes and `change validate` reads the same value.
 */
export function computeReceiptDigest(body: Omit<SensorReceipt, 'digest'>): string {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error(esc('invalid receipt: digest body must be an object'));
    if (body.sensors === null || typeof body.sensors !== 'object' || Array.isArray(body.sensors)) throw new Error(esc('invalid receipt: digest body sensors must be an object'));
    if (body.schema === 1) {
        const canonical = JSON.stringify({
            schema: body.schema, commit: body.commit, ranAt: body.ranAt, cliVersion: body.cliVersion,
            overall: body.overall, sensors: sensorPairs(body.sensors),
        });
        return 'sha256:' + crypto.createHash('sha256').update(canonical).digest('hex');
    }
    if (body.schema !== 2) throw new Error(esc('invalid receipt: digest body schema must be 1 or 2'));
    const v2 = body as Omit<SensorReceiptV2, 'digest'>;
    if (v2.measurements === null || typeof v2.measurements !== 'object' || Array.isArray(v2.measurements)) {
        throw new Error(esc('invalid receipt: digest body measurements must be an object'));
    }
    if (!Array.isArray(v2.alwaysMeasuredPaths)) throw new Error(esc('invalid receipt: digest body alwaysMeasuredPaths must be an array'));
    const measurements = Object.fromEntries(
        Object.entries(v2.measurements).sort(([a], [b]) => byName(a, b)).map(([name, m]) => [name, {
            inputs: m.inputs,
            packageRootRel: m.packageRootRel,
            inputDigest: m.inputDigest,
            sensorFingerprint: m.sensorFingerprint,
            measuredPaths: m.measuredPaths,
        }]),
    );
    const canonical = JSON.stringify({
        schema: v2.schema, commit: v2.commit, ranAt: v2.ranAt, cliVersion: v2.cliVersion,
        overall: v2.overall, sensors: sensorPairs(v2.sensors),
        measurements,
        alwaysMeasuredPaths: v2.alwaysMeasuredPaths,
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
    if (r.schema !== 1 && r.schema !== 2) return 'schema must be 1 or 2';
    const expectedKeys = r.schema === 1 ? RECEIPT_KEYS_V1 : RECEIPT_KEYS_V2;
    const keys = Object.keys(r);
    if (keys.length !== expectedKeys.length || !expectedKeys.every((k) => k in r)) return 'receipt must have exactly the schema keys';
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
    if (r.schema === 2) {
        const measurements = r.measurements;
        if (measurements === null || typeof measurements !== 'object' || Array.isArray(measurements)) return 'measurements must be an object';
        for (const [name, value] of Object.entries(measurements)) {
            if (!isSensorName(name)) return `measurement sensor names must be a single line of 1 to ${MAX_SENSOR_NAME} characters`;
            const problem = measurementProblem(name, value);
            if (problem !== null) return problem;
        }
        if (!Array.isArray(r.alwaysMeasuredPaths) || r.alwaysMeasuredPaths.length > MAX_MEASURED_PATHS) {
            return 'alwaysMeasuredPaths must be an array within bounds';
        }
        if (r.alwaysMeasuredPaths.some((p) => typeof p !== 'string' || !isSafeRepoRel(p))) {
            return 'alwaysMeasuredPaths must be safe repo-root POSIX paths';
        }
        const sortedAlways = sortedStrings(r.alwaysMeasuredPaths as string[]);
        if (JSON.stringify(r.alwaysMeasuredPaths) !== JSON.stringify(sortedAlways)) {
            return 'alwaysMeasuredPaths must be sorted';
        }
    }
    if (typeof r.digest !== 'string') return 'digest must be a string';
    const { digest, ...body } = r as unknown as SensorReceipt;
    if (computeReceiptDigest(body) !== digest) return 'digest does not match the content';
    return null;
}

function extractMeasurements(sensors: SensorResult[]): Record<string, SensorReceiptMeasurement> {
    const out: Record<string, SensorReceiptMeasurement> = {};
    for (const sensor of sensors) {
        const m = sensor.measurement;
        if (!m || typeof m !== 'object') continue;
        if (!Array.isArray(m.inputs) || m.inputs.length === 0) continue;
        if (!isPackageRootRel(m.packageRootRel)) continue;
        if (!isSha256Digest(m.inputDigest) || !isSha256Digest(m.sensorFingerprint)) continue;
        if (!Array.isArray(m.measuredPaths) || m.measuredPaths.some((p) => typeof p !== 'string' || !isSafeRepoRel(p))) continue;
        out[sensor.name] = {
            inputs: [...m.inputs],
            packageRootRel: m.packageRootRel,
            inputDigest: m.inputDigest,
            sensorFingerprint: m.sensorFingerprint,
            measuredPaths: sortedStrings(m.measuredPaths),
        };
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => byName(a, b)));
}

/** Builds a schema-2 receipt (RF-4.3). Schema 1 remains readable via `readReceipt` / `writeReceipt`. */
export function buildReceipt(input: {
    commit: string;
    ranAt: string;
    cliVersion: string;
    output: Pick<RunOutput, 'overall' | 'sensors'>;
    alwaysMeasuredPaths?: string[];
}): SensorReceipt {
    const out = input === null || typeof input !== 'object' ? undefined : input.output;
    if (out === null || typeof out !== 'object' || !Array.isArray(out.sensors) || out.sensors.some((s) => s === null || typeof s !== 'object')) {
        throw new Error('invalid receipt: run output must carry a sensors array');
    }
    const sensors = sortedSensors(Object.fromEntries(out.sensors.map((s) => [s.name, s.status])) as Record<string, SensorStatus>);
    const measurements = extractMeasurements(out.sensors);
    const alwaysFromSensors = new Set<string>();
    for (const sensor of out.sensors) {
        const extras = sensor.measurement?.alwaysMeasuredPaths;
        if (!Array.isArray(extras)) continue;
        for (const p of extras) {
            if (typeof p === 'string' && isSafeRepoRel(p)) alwaysFromSensors.add(p);
        }
    }
    const provided = Array.isArray(input.alwaysMeasuredPaths) ? input.alwaysMeasuredPaths : [];
    for (const p of provided) {
        if (typeof p === 'string' && isSafeRepoRel(p)) alwaysFromSensors.add(p);
    }
    // Validate always-measured always includes baseline (RF-2.12 / RF-4.5), even when empty.
    alwaysFromSensors.add(CACHE_DIGEST_BASELINE_REL);
    const alwaysMeasuredPaths = sortedStrings([...alwaysFromSensors]);
    const body: Omit<SensorReceiptV2, 'digest'> = {
        schema: 2,
        commit: input.commit,
        ranAt: input.ranAt,
        cliVersion: input.cliVersion,
        overall: out.overall as Overall,
        sensors,
        measurements,
        alwaysMeasuredPaths,
    };
    const receipt: SensorReceiptV2 = { ...body, digest: computeReceiptDigest(body) };
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
        if (output.sensors.every((sensor) => sensor !== null && typeof sensor === 'object' && sensor.status === 'skipped')) return withheld('every sensor was skipped, so the run certified nothing');
        if (Array.isArray(output.invalidEntries) && output.invalidEntries.length > 0) return withheld('some sensor entries of the manifest were invalid and skipped, so the verdict does not cover it');
        if (output.packDrift !== undefined && output.packDrift !== null) return withheld('the manifest is on the generic fallback while the tree has real stack indicators (pack drift)');
        if (output.overall === 'not_certified') return withheld('the verdict was not certified (not_certified)');
        if (!isRootManifest(pre.root, output.manifestPath)) return withheld("the manifest that ran is not the repository root's .awm/sensors.json (a receipt certifies a whole commit)");
        return finalizeReceipt(pre, output, deps);
    } catch (error) {
        return `no sensor receipt written: ${esc(error instanceof Error ? error.message : String(error))}\n`;
    }
}
