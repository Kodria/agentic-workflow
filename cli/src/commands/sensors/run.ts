import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCommand, runStructuredCommand, ExecResult } from './exec';
import { SensorResult, SensorError } from './types';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';
import { parseTestOutput } from './formatters/test';
import { parseMypyOutput } from './formatters/mypy';
import { parseRuffOutput } from './formatters/ruff';
import { parseShellcheckOutput } from './formatters/shellcheck';
import { SensorManifest, RunOutput, PreparedSensorExecution } from './types';
import { readBaseline } from './baseline';
import { applyBaseline, executePrepared } from './result';
export { applyBaseline };
import { changedFiles, changedScopeError } from './changed';
// Solo `detectStack` (puro, lee el arbol) — NO `initSensors`, que escribe. `run` es un
// verbo de lectura: no debe tener a mano ninguna funcion capaz de mutar el proyecto.
import { detectStack } from './init';
import { parseSensorManifest } from './compatibility/manifest';
import { resolveLiveCompatibility, resolveParsedPackCompatibility } from './compatibility/live';
import { parseSensorPack } from './compatibility/contract';
import { resolveSensorSource } from './compatibility/source';
import type { PackSource } from './compatibility/pack-source';
import { listRegistries } from '../../core/registries';
import { prepareLegacySensor, prepareV2Sensor, validateRunOptions } from './prepare';
import { reduceVerdict } from './verdict';
import { resolveSensorProject } from './project';

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


async function resolveLiveV2(cwd: string, manifest: ReturnType<typeof parseSensorManifest>): Promise<Awaited<ReturnType<typeof resolveLiveCompatibility>> | null> {
    if (manifest.kind !== 'v2') return null;
    try {
        return await resolveLiveCompatibility(cwd, manifest.pack.pack, manifest.pack.registryRoot, { packSelection: manifest.pack.packSelection });
    } catch { return null; }
}

async function resolveLiveFromSource(cwd: string, source: PackSource, packSelection?: 'explicit'): Promise<Awaited<ReturnType<typeof resolveLiveCompatibility>> | null> {
    try {
        const parsed = parseSensorPack(JSON.parse(source.content), source.path);
        if (parsed.kind !== 'v2') return null;
        return await resolveParsedPackCompatibility(cwd, parsed.pack, { packSelection });
    } catch { return null; }
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
    if (opts.fast && opts.slow) return true;
    if (opts.fast) return isFast;
    if (opts.slow) return !isFast;
    return true;
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


/**
 * One orchestration path for both manifest contracts. Preparation selects the
 * authorized command; execution, baseline handling, and verdict reduction are
 * deliberately format-agnostic.
 */
export async function runSensors(opts: RunOptions = {}): Promise<RunOutput> {
    validateRunOptions(opts);
    let project: ReturnType<typeof resolveSensorProject>;
    try { project = resolveSensorProject(opts.cwd ?? process.cwd()); }
    catch { return { sensors: [], overall: 'not_certified' }; }
    if (project.state !== 'configured') return { sensors: [], overall: 'not_certified' };

    const manifestDir = project.projectRoot;
    const parsed = project.manifest;
    const authority = { projectRoot: project.projectRoot, manifestPath: project.manifestPath };
    if (parsed.kind === 'v3' && (parsed.pack.mode === 'native-gate' || parsed.pack.mode === 'opt-out')) {
        return { sensors: [], overall: 'not_certified', ...authority, mode: parsed.pack.mode, reason: `${parsed.pack.mode}-declared` };
    }
    let resolvedSource: ReturnType<typeof resolveSensorSource> | undefined;
    if (parsed.kind === 'v2' || parsed.kind === 'v3') {
        try { resolvedSource = resolveSensorSource(parsed, { registries: listRegistries() }); }
        catch (error) { return { sensors: [], overall: 'not_certified', ...authority, mode: 'source-unavailable', reason: error instanceof Error ? error.message : 'source-unavailable', remedy: 'install-registry-or-run-awm-update' }; }
        if (resolvedSource.kind === 'source-unavailable' || resolvedSource.kind === 'source-ambiguous') {
            return { sensors: [], overall: 'not_certified', ...authority, mode: resolvedSource.kind, reason: resolvedSource.reason, remedy: resolvedSource.remedy, source: { kind: resolvedSource.kind, candidates: resolvedSource.kind === 'source-ambiguous' ? resolvedSource.candidates : undefined } };
        }
    }
    if (parsed.kind === 'v3') return { sensors: [], overall: 'not_certified', ...authority, mode: 'project-sensors', reason: resolvedSource?.kind ?? 'project-sensors' };

    const baseline = opts.ignoreBaseline ? null : readBaseline(manifestDir);
    const changed = opts.changed ? changedFiles(manifestDir, opts.base ?? 'HEAD') : null;
    // Legacy commands pass changed filenames through a shell; preserve the native
    // Windows safety fallback. Structured v2 argv never crosses that shell layer.
    if (parsed.kind === 'legacy' && changed && !changed.error) {
        const scopeError = changedScopeError(changed);
        if (scopeError) changed.error = scopeError;
    }
    // Monorepo support: a v2 manifest may declare packageRoot so detection and
    // execution both happen against the real package (e.g. "cli"), while the
    // manifest itself stays discoverable at the repo root via findManifestDir.
    // Legacy manifests never carry this field — manifestDir is always correct
    // for them, unchanged.
    const projectCwd = project.packageRoot;
    const live = parsed.kind === 'v2' && resolvedSource && (resolvedSource.kind === 'logical' || resolvedSource.kind === 'legacy-bound' || resolvedSource.kind === 'legacy-rebound')
        ? await resolveLiveFromSource(projectCwd, resolvedSource.source, parsed.pack.packSelection)
        : null;
    const drift = parsed.kind === 'legacy' ? detectPackDrift(manifestDir, parsed.pack) : undefined;
    const requestedScope = opts.changed ? 'changed' as const : 'full' as const;
    const prepared: PreparedSensorExecution[] = [];

    for (const [name, sensor] of Object.entries(parsed.pack.sensors)) {
        const liveSensor = parsed.kind === 'v2' ? live?.pack.sensors[name] : undefined;
        const fast = parsed.kind === 'v2'
            ? sensor.fast ?? liveSensor?.fast ?? false
            : sensor.fast ?? false;
        if (!shouldRun(fast, opts)) continue;

        const execution = parsed.kind === 'v2'
            ? prepareV2Sensor({ name, sensor, liveSensor, liveState: live?.sensors[name], requestedScope, changed: changed ?? undefined })
            : prepareLegacySensor({ name, config: sensor, requestedScope, changed: changed ?? undefined });
        prepared.push(sensor.enabled === false
            ? { ...execution, command: undefined, syntheticStatus: 'skipped', syntheticReason: 'disabled' }
            : execution);
    }

    const results = await pooled(prepared.map(entry => async () => {
        const result = await executePrepared(entry, projectCwd);
        return baseline ? applyBaseline(result, baseline[entry.name]) : result;
    }), resolveConcurrency(parsed.pack, prepared.length));

    let overall = reduceVerdict(results);
    // Legacy commands retain operational compatibility but their shell-backed
    // contract cannot certify a green run.
    if (parsed.kind === 'legacy' && overall === 'pass') overall = 'not_certified';
    if (overall === 'skipped' && drift && drift.detection.pack !== 'generic') overall = 'not_certified';

    return {
        sensors: results,
        overall,
        ...authority,
        mode: 'project-sensors',
        reason: parsed.kind === 'v2' ? resolvedSource?.kind : 'legacy-v1',
        ...(parsed.kind === 'v2' && resolvedSource && (resolvedSource.kind === 'logical' || resolvedSource.kind === 'legacy-bound' || resolvedSource.kind === 'legacy-rebound')
            ? { source: { kind: resolvedSource.kind, registry: resolvedSource.source.registry.name } } : {}),
        ...(drift?.drift ? { packDrift: drift.drift } : {}),
        ...(changed ? { changedScope: { files: changed.files.length, ...(changed.error ? { error: changed.error } : {}) } } : {}),
    };
}
