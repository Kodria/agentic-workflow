import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SensorManifest, SensorResult, RunOutput, SensorError } from './types';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';
import { readBaseline, partition } from './baseline';

const MANIFEST_FILE = '.awm/sensors.json';
const DEFAULT_FAST_TIMEOUT = 10_000;
const DEFAULT_SLOW_TIMEOUT = 120_000;
// Sensor JSON output can be several MB on large repos (e.g. `eslint --format json`
// with thousands of findings). execSync defaults to a 1MB buffer and kills the
// child with SIGTERM when exceeded — which previously surfaced as a false "timeout".
const MAX_BUFFER = 64 * 1024 * 1024;

export type RunOptions = {
    fast?: boolean;
    slow?: boolean;
    all?: boolean;
    cwd?: string;
    /** Skip baseline suppression (used by `awm sensors baseline` to capture all findings). */
    ignoreBaseline?: boolean;
};

/**
 * Apply the baseline to a sensor result: keep only findings not already accepted.
 * `status` becomes 'pass' when every finding was baseline-suppressed. Skipped
 * sensors are returned untouched.
 */
function applyBaseline(result: SensorResult, accepted: string[] | undefined): SensorResult {
    if (result.status === 'skipped') return result;
    const { newErrors, suppressed } = partition(result.name, result.errors, accepted);
    if (suppressed === 0) return result;
    return {
        ...result,
        errors: newErrors,
        status: newErrors.length > 0 ? 'fail' : 'pass',
        newCount: newErrors.length,
        baselineCount: suppressed,
    };
}

function readManifest(cwd: string): SensorManifest | null {
    const p = path.join(cwd, MANIFEST_FILE);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

/**
 * Walk up from `startCwd` looking for the nearest ancestor that contains
 * `.awm/sensors.json` (git/.git pattern). Returns that directory, or null
 * if none is found before the filesystem root.
 */
export function findManifestDir(startCwd: string): string | null {
    let dir = path.resolve(startCwd);
    while (true) {
        if (fs.existsSync(path.join(dir, MANIFEST_FILE))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return null; // reached filesystem root
        dir = parent;
    }
}

function shouldRun(isFast: boolean, opts: RunOptions): boolean {
    if (opts.all) return true;
    if (opts.fast && isFast) return true;
    if (opts.slow && !isFast) return true;
    if (!opts.fast && !opts.slow && !opts.all) return true;
    return false;
}

function getFormatter(name: string): (raw: string) => SensorError[] {
    if (name === 'typecheck') return parseTscOutput;
    if (name === 'lint') return parseEslintOutput;
    if (name === 'security') return parseSemgrepOutput;
    return parseGenericOutput;
}

function runSensor(name: string, cmd: string, timeout: number, cwd: string): SensorResult {
    try {
        const raw = execSync(cmd, { encoding: 'utf-8', timeout, cwd, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'] });
        const errors = getFormatter(name)(raw);
        return { name, status: errors.length > 0 ? 'fail' : 'pass', errors };
    } catch (err: any) {
        // Output exceeded maxBuffer — child is killed before output can be read.
        // Check this BEFORE the SIGTERM branch (ENOBUFS kills with SIGTERM too).
        if (err.code === 'ENOBUFS') {
            return { name, status: 'skipped', errors: [], skipReason: `output exceeded ${MAX_BUFFER} bytes` };
        }
        // Genuine timeout: execSync kills with SIGTERM after `timeout` ms.
        if (err.code === 'ETIMEDOUT' || (err.killed && err.signal === 'SIGTERM')) {
            return { name, status: 'skipped', errors: [], skipReason: `timeout after ${timeout}ms` };
        }
        // Non-zero exit — the normal path for linters/typecheckers that found
        // findings. Parse the output; if it yields findings, that's a fail.
        const raw = String((err.stdout ?? '') + (err.stderr ?? ''));
        const errors = getFormatter(name)(raw);
        if (errors.length > 0) return { name, status: 'fail', errors };
        // A missing tool (binary not installed) must NOT pass silently — the gate
        // cannot certify what it could not run. Treat it as a fail with a clear message.
        const lower = raw.toLowerCase();
        const toolMissing =
            (err as any).code === 'ENOENT' ||               // execSync spawn failure (no shell)
            lower.includes('command not found') ||
            lower.includes('enoent') ||
            lower.includes('could not determine executable');
        if (toolMissing) {
            return {
                name,
                status: 'fail',
                errors: [{ message: `sensor tool not available: ${raw.slice(0, 200)}` }],
            };
        }
        return { name, status: 'skipped', errors: [], skipReason: `exit ${err.status}: ${raw.slice(0, 200)}` };
    }
}

export function runSensors(opts: RunOptions = {}): RunOutput {
    const startCwd = opts.cwd ?? process.cwd();
    const manifestDir = findManifestDir(startCwd);
    if (!manifestDir) return { sensors: [], overall: 'not_certified' };
    const manifest = readManifest(manifestDir);
    if (!manifest) return { sensors: [], overall: 'not_certified' };
    const cwd = manifestDir; // ejecutar sensores y baseline desde donde vive el manifest

    const results: SensorResult[] = [];
    // Baseline suppresses already-accepted findings so sensors fail only on NEW
    // ones (essential on repos with a large pre-existing baseline). Absent file or
    // --ignore-baseline → every finding counts (backward-compatible).
    const baseline = opts.ignoreBaseline ? null : readBaseline(cwd);

    for (const [name, config] of Object.entries(manifest.sensors)) {
        const isFast = config.fast ?? false;
        if (!shouldRun(isFast, opts)) continue;

        if (config.enabled === false) {
            results.push({ name, status: 'skipped', errors: [], skipReason: 'disabled' });
            continue;
        }
        if (!config.cmd) {
            results.push({ name, status: 'skipped', errors: [], skipReason: 'no cmd configured' });
            continue;
        }

        const timeout = config.timeout ?? (isFast ? DEFAULT_FAST_TIMEOUT : DEFAULT_SLOW_TIMEOUT);
        let result = runSensor(name, config.cmd, timeout, cwd);
        if (baseline) result = applyBaseline(result, baseline[name]);
        results.push(result);
    }

    const overall = results.some(r => r.status === 'fail') ? 'fail'
        : results.length > 0 && results.every(r => r.status === 'skipped') ? 'skipped'
        : results.length === 0 ? 'skipped'
        : 'pass';

    return { sensors: results, overall };
}
