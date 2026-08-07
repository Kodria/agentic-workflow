import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCommand, ExecResult } from './exec';
import { SensorManifest, SensorResult, RunOutput, SensorError } from './types';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';
import { parseTestOutput } from './formatters/test';
import { readBaseline, partition } from './baseline';
import { detectStack, initSensors } from './init';
import { capabilityRoot } from '../../core/registries';

const MANIFEST_FILE = '.awm/sensors.json';
const DEFAULT_FAST_TIMEOUT = 10_000;
const DEFAULT_SLOW_TIMEOUT = 120_000;
// Sensor JSON output can be several MB on large repos (e.g. `eslint --format json`
// with thousands of findings). A 1MB cap killed the child with SIGTERM when
// exceeded — which previously surfaced as a false "timeout".
const MAX_BUFFER = 64 * 1024 * 1024;
/** Hard ceiling on parallel sensors: past this, they only contend for the same cores. */
const MAX_CONCURRENCY = 4;

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
 * `status` becomes 'pass' when every finding was baseline-suppressed. Results
 * without a verdict of their own — skipped and inconclusive — are returned
 * untouched: there is nothing to ratchet, and letting them through here would
 * hand back a `pass` for a sensor that never reported anything.
 */
export function applyBaseline(result: SensorResult, accepted: string[] | undefined): SensorResult {
    if (result.status === 'skipped' || result.status === 'inconclusive') return result;
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
 * Upgrade-only, idempotent pack reconciliation. If the manifest sits on the
 * `generic` fallback but the tree now has real stack indicators (package.json,
 * pyproject.toml…), re-detect and rebuild via initSensors — which merges existing
 * custom sensors and copies the pack's config files. Never downgrades, never
 * touches a real pack. FS/registry failures degrade to a no-op (the honest floor
 * in runSensors covers the gap).
 */
export function reconcilePack(
    manifestDir: string,
    manifest: SensorManifest,
    registryRoot?: string,
): { manifest: SensorManifest; upgradedFrom?: string; detection: ReturnType<typeof detectStack> } {
    if (manifest.pack !== 'generic') {
        const detection = detectStack(manifestDir);
        return { manifest, detection };
    }
    const detection = detectStack(manifestDir);
    if (detection.pack === 'generic') return { manifest, detection }; // truly generic — stay honest
    const root = registryRoot ?? capabilityRoot('sensor-packs');
    if (!root || !fs.existsSync(root)) return { manifest, detection }; // can't rebuild without registry
    try {
        const { manifest: rebuilt } = initSensors({ cwd: manifestDir, registryRoot: root, configure: true });
        return { manifest: rebuilt, upgradedFrom: 'generic', detection };
    } catch {
        return { manifest, detection }; // never abort the run on a reconcile failure
    }
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
    if (name === 'test') return parseTestOutput;
    return parseGenericOutput;
}

function isExitCodeSensor(name: string): boolean {
    return name === 'test';
}

async function runSensor(name: string, cmd: string, timeout: number, cwd: string): Promise<SensorResult> {
    const res: ExecResult = await runCommand(cmd, { timeout, cwd, maxBuffer: MAX_BUFFER });
    const format = getFormatter(name);

    // The shell itself never started (bad cwd, no shell). Nothing ran.
    if (res.spawnError) {
        return {
            name,
            status: 'fail',
            errors: [{ message: `sensor could not be started: ${res.spawnError.message}` }],
        };
    }

    // Cut short by the deadline or the output cap. The run is NOT a verdict — but
    // whatever it printed before being cut is still evidence, and throwing it away
    // is what forced the caller to re-run the same command by hand to learn
    // anything. Findings in the partial output are real findings; their absence
    // proves nothing, so a clean partial can never be `pass`.
    if (res.timedOut || res.overflowed) {
        const reason = res.timedOut
            ? `timeout after ${timeout}ms`
            : `output exceeded ${MAX_BUFFER} bytes`;
        const errors = format(res.stdout + res.stderr);
        if (errors.length > 0) {
            return {
                name,
                status: 'fail',
                errors,
                incomplete: `${reason} — findings below are from partial output; the run did not finish`,
            };
        }
        return { name, status: 'inconclusive', errors: [], skipReason: reason };
    }

    if (res.code === 0) {
        const errors = format(res.stdout);
        return { name, status: errors.length > 0 ? 'fail' : 'pass', errors };
    }

    // Non-zero exit — the normal path for linters/typecheckers that found
    // findings. Parse the output; if it yields findings, that's a fail.
    const raw = res.stdout + res.stderr;
    const errors = format(raw);
    if (errors.length > 0) return { name, status: 'fail', errors };

    // A missing tool (binary not installed) must NOT pass silently — the gate
    // cannot certify what it could not run. Treat it as a fail with a clear message.
    //
    // Exit 127 is the POSIX signal for "command not found" and is the only check
    // here that holds across shells and locales: bash writes `command not found`
    // but dash — `/bin/sh` on Debian/Ubuntu, hence most CI runners and containers
    // — writes `not found`, so matching shell text alone read an absent tool as a
    // benign skip. A failure to spawn the shell itself is a different thing and
    // is handled above via `spawnError`. The cut-short branches are evaluated
    // above too, so reaching here with status 127 means the command did not exist.
    //
    // A wrapper (`npm test`, `npx …`) that exits 127 because a binary it invokes
    // is absent is classified the same way, deliberately: the gate still ran
    // nothing and still cannot certify anything.
    const lower = raw.toLowerCase();
    const toolMissing =
        res.code === 127 ||                             // POSIX: command not found
        lower.includes('command not found') ||          // bash, zsh
        // cmd.exe reports an absent binary with exit 1, so 127 does not cover
        // Windows; this exact phrase does. Kept narrow on purpose — a loose
        // `not found` would also match a tool that ran and said "not found"
        // for reasons of its own.
        lower.includes('is not recognized as an internal or external command') ||
        lower.includes('enoent') ||
        lower.includes('could not determine executable');
    if (toolMissing) {
        return {
            name,
            status: 'fail',
            errors: [{ message: `sensor tool not available: ${raw.slice(0, 200)}` }],
        };
    }
    // Exit-code sensors (tests): any genuine non-zero exit is a real failure,
    // even when no per-line findings can be parsed from the output.
    if (isExitCodeSensor(name)) {
        return { name, status: 'fail', errors: [{ message: `SENSOR[${name}] failed (exit ${res.code})` }] };
    }
    // Residual case: it exited non-zero, the tool exists, and no finding
    // could be parsed. We do not know what happened — say so instead of
    // reporting a benign skip.
    return { name, status: 'inconclusive', errors: [], skipReason: `exit ${res.code}: ${raw.slice(0, 200)}` };
}

/**
 * How many sensors may run at once. Sensors are separate processes over the same
 * tree, so they parallelise cleanly — but each one (tsc, eslint, depcruise) is
 * largely single-threaded, and oversubscribing the box just makes every sensor
 * slower and more likely to hit its own deadline. Leave a core for the agent.
 */
export function resolveConcurrency(manifest: SensorManifest, sensorCount: number): number {
    const configured = Number(process.env.AWM_SENSORS_CONCURRENCY ?? manifest.concurrency);
    if (Number.isFinite(configured) && configured >= 1) return Math.min(Math.floor(configured), sensorCount);
    const cores = os.cpus()?.length ?? 2;
    return Math.max(1, Math.min(MAX_CONCURRENCY, cores - 1, sensorCount));
}

/** Run `tasks` with at most `limit` in flight, preserving input order in the output. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
    const results = new Array<T>(tasks.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const i = next++;
            if (i >= tasks.length) return;
            results[i] = await tasks[i]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

export async function runSensors(opts: RunOptions = {}): Promise<RunOutput> {
    const startCwd = opts.cwd ?? process.cwd();
    const manifestDir = findManifestDir(startCwd);
    if (!manifestDir) return { sensors: [], overall: 'not_certified' };
    const manifest = readManifest(manifestDir);
    if (!manifest) return { sensors: [], overall: 'not_certified' };
    const reconciled = reconcilePack(manifestDir, manifest);
    const activeManifest = reconciled.manifest;
    const cwd = manifestDir; // ejecutar sensores y baseline desde donde vive el manifest

    // Baseline suppresses already-accepted findings so sensors fail only on NEW
    // ones (essential on repos with a large pre-existing baseline). Absent file or
    // --ignore-baseline → every finding counts (backward-compatible).
    const baseline = opts.ignoreBaseline ? null : readBaseline(cwd);

    // Sensors are independent processes over the same tree, so they run
    // concurrently rather than one-after-another: wall clock becomes the slowest
    // sensor instead of the sum of all of them. Tasks are built — and dispatched —
    // in manifest order, so the reported order stays stable.
    const tasks: Array<() => Promise<SensorResult>> = [];
    const settled = (r: SensorResult) => () => Promise.resolve(r);

    for (const [name, config] of Object.entries(activeManifest.sensors)) {
        const isFast = config.fast ?? false;
        if (!shouldRun(isFast, opts)) continue;

        if (config.enabled === false) {
            tasks.push(settled({ name, status: 'skipped', errors: [], skipReason: 'disabled' }));
            continue;
        }
        if (!config.cmd) {
            // Enabled but with nothing to run: broken config, not a deliberate
            // opt-out. `enabled: false` is how a sensor is turned off.
            tasks.push(settled({ name, status: 'inconclusive', errors: [], skipReason: 'no cmd configured' }));
            continue;
        }

        const cmd = config.cmd;
        const timeout = config.timeout ?? (isFast ? DEFAULT_FAST_TIMEOUT : DEFAULT_SLOW_TIMEOUT);
        tasks.push(async () => {
            const result = await runSensor(name, cmd, timeout, cwd);
            return baseline ? applyBaseline(result, baseline[name]) : result;
        });
    }

    const results = await pooled(tasks, resolveConcurrency(activeManifest, tasks.length));

    // `fail` outranks `inconclusive`: when something is broken AND something
    // could not be measured, the broken thing is the actionable verdict.
    let overall: RunOutput['overall'] = results.some(r => r.status === 'fail') ? 'fail'
        : results.some(r => r.status === 'inconclusive') ? 'not_certified'
        : results.length > 0 && results.every(r => r.status === 'skipped') ? 'skipped'
        : results.length === 0 ? 'skipped'
        : 'pass';

    // Honest floor: a benign-green 'skipped' over a tree that clearly HAS a stack
    // (indicators present) is a false green — the gate ran nothing real. Never green.
    if (overall === 'skipped' && reconciled.detection.pack !== 'generic') {
        overall = 'not_certified';
    }

    return {
        sensors: results,
        overall,
        ...(reconciled.upgradedFrom ? { packUpgraded: `${reconciled.upgradedFrom}→${activeManifest.pack}` } : {}),
    };
}
