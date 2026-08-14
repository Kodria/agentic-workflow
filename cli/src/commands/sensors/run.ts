import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCommand, runStructuredCommand, ExecResult } from './exec';
import { SensorManifest, SensorResult, RunOutput, SensorError } from './types';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';
import { parseTestOutput } from './formatters/test';
import { parseMypyOutput } from './formatters/mypy';
import { parseRuffOutput } from './formatters/ruff';
import { parseShellcheckOutput } from './formatters/shellcheck';
import { readBaseline, partition } from './baseline';
import { changedFiles, applyChangedCmd, filterByExtension, hasUnsafeWin32Chars } from './changed';
// Solo `detectStack` (puro, lee el arbol) — NO `initSensors`, que escribe. `run` es un
// verbo de lectura: no debe tener a mano ninguna funcion capaz de mutar el proyecto.
import { detectStack } from './init';
import { isWindowsNative } from '../../core/paths';
import { parseSensorManifest } from './compatibility/manifest';
import { resolveLiveCompatibility } from './compatibility/live';

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
    /**
     * Scope sensors that opt in (via `changedCmd`) to the files this tree changed.
     * Sensors that do not opt in still run in full — see `SensorConfig.changedCmd`.
     */
    changed?: boolean;
    /** Comparison point for `changed`. Defaults to `HEAD` (uncommitted work only). */
    base?: string;
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

async function resolveLiveV2(cwd: string, manifest: ReturnType<typeof parseSensorManifest>): Promise<Awaited<ReturnType<typeof resolveLiveCompatibility>> | null> {
    if (manifest.kind !== 'v2') return null;
    try {
        return await resolveLiveCompatibility(cwd, manifest.pack.pack, manifest.pack.registryRoot, { explicitPackSelection: manifest.pack.packSelection === 'explicit' });
    } catch { return null; }
}

async function runV2Sensor(name: string, command: import('./compatibility/types').StructuredCommand, timeout: number, cwd: string, formatter?: string): Promise<SensorResult> {
    const res = await runStructuredCommand(command, { timeout, cwd, maxBuffer: MAX_BUFFER });
    const format = getFormatter(name, formatter);
    if (res.spawnError) return { name, status: 'fail', errors: [{ message: `sensor could not be started: ${res.spawnError.message}` }] };
    if (res.timedOut || res.overflowed) return { name, status: 'inconclusive', errors: [], skipReason: res.timedOut ? `timeout after ${timeout}ms` : `output exceeded ${MAX_BUFFER} bytes` };
    const errors = format(res.stdout + res.stderr);
    if (res.code === 0) return { name, status: errors.length ? 'fail' : 'pass', errors };
    return errors.length ? { name, status: 'fail', errors } : { name, status: 'inconclusive', errors: [], skipReason: `exit ${res.code}` };
}

/**
 * Detect — and only detect — that the manifest's pack no longer describes the tree:
 * it sits on the `generic` fallback while real stack indicators (package.json,
 * pyproject.toml, a root `*.sh`…) are present, so the gate is measuring almost
 * nothing. Pure: reads the tree, writes nothing, consults no registry.
 *
 * It used to *heal* this, by calling `initSensors(..., configure: true)` — which
 * overwrites the committed `.awm/sensors.json` and copies the pack's config files
 * into the project root. That made `awm sensors run`, a read verb, leave a dirty
 * working tree, and swapped in sensors whose tools the project never installed
 * (one root `deploy.sh` pulls in the whole shell pack), turning a green run red.
 * Rewriting the manifest is `awm sensors init`'s job — the verb whose name says so.
 * Here the drift is only named: reported as `packDrift` on the run's own output,
 * and failed on by preflight's `pack` check.
 */
export function detectPackDrift(
    manifestDir: string,
    manifest: SensorManifest,
): { detection: ReturnType<typeof detectStack>; drift?: NonNullable<RunOutput['packDrift']> } {
    const detection = detectStack(manifestDir);
    if (manifest.pack !== 'generic' || detection.pack === 'generic') return { detection };
    return {
        detection,
        drift: {
            manifest: manifest.pack,
            detected: detection.pack,
            remedy: `run \`awm sensors init\` to adopt the '${detection.pack}' pack for this stack`,
        },
    };
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
        // Temp directories are test/scratch boundaries, never project ancestors.
        // This prevents an unrelated /tmp/.awm from being adopted by a fresh project.
        if (dir === path.resolve(os.tmpdir())) return null;
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

/**
 * Dispatch by the pack's `formatter` field (the real tool behind the sensor slot —
 * `lint` is eslint on js-ts but ruff on python, shellcheck on shell) when present.
 * Manifests written before this field existed carry no `formatter`, so they fall back
 * to the pre-existing name-based dispatch — nothing already installed breaks.
 */
function getFormatter(name: string, formatterField?: string): (raw: string) => SensorError[] {
    // A `formatter` field that is PRESENT but unrecognized (a typo in a pack.json, or a
    // future pack declaring a tool this CLI version doesn't know about yet) is a
    // different situation from no field at all. Falling through to name-based dispatch
    // in that case would silently misparse a foreign output shape via the wrong parser
    // (e.g. a `bandit` formatter falling through to `parseSemgrepOutput`, reading
    // bandit's differently-shaped JSON and producing garbage findings). Only the
    // ABSENT case (old manifest, written before this field existed) gets name-based
    // backward-compat dispatch; a present-but-unknown value degrades honestly to the
    // generic raw-wrap formatter instead.
    if (formatterField !== undefined) {
        switch (formatterField) {
            case 'tsc': return parseTscOutput;
            case 'eslint-llm': return parseEslintOutput;
            case 'semgrep': return parseSemgrepOutput;
            case 'test': return parseTestOutput;
            case 'mypy': return parseMypyOutput;
            case 'ruff': return parseRuffOutput;
            case 'shellcheck': return parseShellcheckOutput;
            case 'generic': return parseGenericOutput;
            default: return parseGenericOutput;
        }
    }
    if (name === 'typecheck') return parseTscOutput;
    if (name === 'lint') return parseEslintOutput;
    if (name === 'security') return parseSemgrepOutput;
    if (name === 'test') return parseTestOutput;
    return parseGenericOutput;
}

function isExitCodeSensor(name: string): boolean {
    return name === 'test';
}

async function runSensor(name: string, cmd: string, timeout: number, cwd: string, formatterField?: string): Promise<SensorResult> {
    const res: ExecResult = await runCommand(cmd, { timeout, cwd, maxBuffer: MAX_BUFFER });
    const format = getFormatter(name, formatterField);

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
    let parsedManifest: ReturnType<typeof parseSensorManifest>;
    try { parsedManifest = parseSensorManifest(JSON.parse(fs.readFileSync(path.join(manifestDir, MANIFEST_FILE), 'utf8')), path.join(manifestDir, MANIFEST_FILE)); }
    catch { return { sensors: [], overall: 'not_certified' }; }
    if (parsedManifest.kind === 'v2') {
        const live = await resolveLiveV2(manifestDir, parsedManifest);
        const tasks: Array<() => Promise<SensorResult>> = [];
        for (const [name, sensor] of Object.entries(parsedManifest.pack.sensors)) {
            const state = live?.sensors[name];
            const liveSensor = live?.pack.sensors[name];
            if (!shouldRun(sensor.fast ?? liveSensor?.fast ?? false, opts)) continue;
            if (sensor.enabled === false) {
                tasks.push(() => Promise.resolve({ name, status: 'skipped', errors: [], skipReason: 'disabled' }));
                continue;
            }
            if (!state || state.state !== 'certified') {
                tasks.push(() => Promise.resolve({ name, status: 'inconclusive', errors: [], skipReason: state ? `${state.state}: ${state.reason}` : 'compatibility could not be revalidated' }));
                continue;
            }
            if (state.variantId !== sensor.variantId) {
                tasks.push(() => Promise.resolve({ name, status: 'inconclusive', errors: [], skipReason: `variant-drift: manifest ${sensor.variantId}, live ${state.variantId ?? 'none'}; run \`awm sensors init\`` }));
                continue;
            }
            const selected = liveSensor?.variants.find(candidate => candidate.id === state.variantId);
            if (!selected) {
                tasks.push(() => Promise.resolve({ name, status: 'inconclusive', errors: [], skipReason: 'variant-drift: selected live variant has no command; run `awm sensors init`' }));
                continue;
            }
            // Variant IDs are stable selectors, not immutable command snapshots.
            // Only the just re-resolved pack command is authorized to execute.
            tasks.push(() => runV2Sensor(name, selected.command, (sensor.fast ?? liveSensor?.fast ?? false) ? DEFAULT_FAST_TIMEOUT : DEFAULT_SLOW_TIMEOUT, manifestDir, selected.formatter));
        }
        const sensors = await pooled(tasks, Math.min(MAX_CONCURRENCY, Math.max(1, tasks.length)));
        return { sensors, overall: sensors.some(sensor => sensor.status === 'fail') ? 'fail' : sensors.some(sensor => sensor.status === 'inconclusive') ? 'not_certified' : sensors.length ? 'pass' : 'skipped' };
    }
    const drift = detectPackDrift(manifestDir, manifest);
    const activeManifest = manifest; // el manifest COMITEADO es lo que se corre; `run` no lo reescribe
    const cwd = manifestDir; // ejecutar sensores y baseline desde donde vive el manifest

    // Baseline suppresses already-accepted findings so sensors fail only on NEW
    // ones (essential on repos with a large pre-existing baseline). Absent file or
    // --ignore-baseline → every finding counts (backward-compatible).
    const baseline = opts.ignoreBaseline ? null : readBaseline(cwd);

    // A scoped run must never define the accepted set. `buildBaseline` snapshots the
    // findings of the run it is given, so baselining a `--changed` run would write a
    // baseline covering only the touched files and silently drop every accepted
    // finding elsewhere in the repo — which then reports as NEW on the next full run.
    // The two flags only ever meet by mistake, so refuse rather than pick a meaning.
    if (opts.changed && opts.ignoreBaseline) {
        throw new Error(
            'refusing to combine --changed with a baseline capture: a partial run cannot define '
            + 'the accepted set (it would drop every accepted finding outside the diff). '
            + 'Run `awm sensors baseline` without --changed.',
        );
    }

    // Resolved once for the whole run, not per sensor: `git` is cheap but the answer
    // must be identical across sensors, or two of them scope to different file sets.
    const changed = opts.changed ? changedFiles(cwd, opts.base ?? 'HEAD') : null;

    // Security (BatBadBut / CVE-2024-27980): on native Windows, `runCommand` spawns
    // the sensor command through cmd.exe (`shell: true`), which parses `& | < > ^ %`
    // as ITS OWN syntax before the target program ever sees argv — quoting does not
    // reliably neutralize this layer (the primary research this fix is based on
    // concludes escaping it is not safely possible). A changed filename carrying one
    // of these is refused, not escaped: routed through the exact same fallback the
    // module already has for "scope could not be resolved" (`changed.error`), so
    // every sensor degrades to its full unscoped command rather than interpolating
    // an unsafe path. POSIX is unaffected — single-quote quoting there is fully
    // literal per POSIX shell grammar, no metacharacter exception exists.
    if (changed && !changed.error && isWindowsNative() && changed.files.some(hasUnsafeWin32Chars)) {
        changed.error = 'a changed filename contains a cmd.exe metacharacter (& | < > ^ % or newline/CR) '
            + 'that quoting cannot reliably neutralize on native Windows — refusing to interpolate it, '
            + 'falling back to the full unscoped command';
    }

    // Sensors are independent processes over the same tree, so they run
    // concurrently rather than one-after-another: wall clock becomes the slowest
    // sensor instead of the sum of all of them. Tasks are built — and dispatched —
    // in manifest order, so the reported order stays stable.
    const tasks: Array<() => Promise<SensorResult>> = [];
    const settled = (r: SensorResult) => () => Promise.resolve(r);

    for (const [name, config] of Object.entries(activeManifest.sensors ?? {})) {
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

        // Scoping applies only where the pack opted in AND the scope resolved. Any
        // other combination falls back to the full command: slower, never wrong.
        let cmd = config.cmd;
        let scope: 'changed' | undefined;
        if (changed && !changed.error && config.changedCmd) {
            if (!config.changedCmd.includes('{files}')) {
                // Running the template as-is would cover the whole repo while the
                // result claimed to be scoped — a mislabel, not a slow path.
                tasks.push(settled({
                    name,
                    status: 'inconclusive',
                    errors: [],
                    skipReason: 'changedCmd has no {files} placeholder',
                }));
                continue;
            }
            const inScope = filterByExtension(changed.files, config.changedExtensions);
            if (inScope.length === 0) {
                tasks.push(settled({
                    name,
                    status: 'skipped',
                    errors: [],
                    skipReason: 'no changed files in scope',
                    scope: 'changed',
                }));
                continue;
            }
            cmd = applyChangedCmd(config.changedCmd, inScope);
            scope = 'changed';
        }

        const timeout = config.timeout ?? (isFast ? DEFAULT_FAST_TIMEOUT : DEFAULT_SLOW_TIMEOUT);
        tasks.push(async () => {
            const result = await runSensor(name, cmd, timeout, cwd, config.formatter);
            const scoped = scope ? { ...result, scope } : result;
            return baseline ? applyBaseline(scoped, baseline[name]) : scoped;
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

    // Legacy commands retain operational compatibility but their unversioned,
    // shell-backed contract can never certify a run.
    if (parsedManifest.kind === 'legacy' && overall === 'pass') overall = 'not_certified';

    // Honest floor: a benign-green 'skipped' over a tree that clearly HAS a stack
    // (indicators present) is a false green — the gate ran nothing real. Never green.
    if (overall === 'skipped' && drift.detection.pack !== 'generic') {
        overall = 'not_certified';
    }

    return {
        sensors: results,
        overall,
        ...(drift.drift ? { packDrift: drift.drift } : {}),
        // Always emitted on a --changed run, including when the scope failed to
        // resolve: a green that came back from an unscoped fallback and a green from a
        // genuinely scoped run are different claims, and the caller cannot tell them
        // apart from the sensor list alone.
        ...(changed ? { changedScope: { files: changed.files.length, ...(changed.error ? { error: changed.error } : {}) } } : {}),
    };
}
