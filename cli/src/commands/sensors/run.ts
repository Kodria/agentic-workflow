import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { SensorManifest, RunOutput, PreparedSensorExecution, SensorResult } from './types';
import { readBaseline } from './baseline';
import { applyBaseline, executePrepared } from './result';
export { applyBaseline };
import { changedFiles, changedScopeError } from './changed';
// Solo `detectStack` (puro, lee el arbol) — NO `initSensors`, que escribe. `run` es un
// verbo de lectura: no debe tener a mano ninguna funcion capaz de mutar el proyecto.
import { detectStack } from './detection';
import { resolveParsedPackCompatibility } from './compatibility/live';
import { parseSensorPack } from './compatibility/contract';
import { resolveSensorSource } from './compatibility/source';
import type { PackSource } from './compatibility/pack-source';
import {
    isProjectDeclaredSensor,
    type PackBoundManifestSensor,
    type ParsedSensorManifest,
    type ProjectDeclaredSensor,
    type SensorManifestInvalidEntry,
    type SensorManifestV3ProjectSensors,
    type V3ManifestSensor,
} from './compatibility/manifest';
import { discoverPresentMarkers } from './compatibility/discovery';
import type { CompatibilityEvidence, SensorPackSensor, SensorVariant, StructuredCommand } from './compatibility/types';
import { listRegistries } from '../../core/registries';
import { prepareLegacySensor, prepareV2Sensor, validateRunOptions } from './prepare';
import { reduceVerdict } from './verdict';
import { resolveSensorProject, softRecoverInvalidProject } from './project';
import {
    admissionConfigRemedy,
    createExclusionPolicy,
    filesystemSnapshot,
    gitVerifier,
    loadAdmissionConfig,
    snapshotUnavailableRemedy,
    type ExclusionPolicy,
} from './read-only-observation';
import { buildAlwaysMeasuredPaths, CACHE_DIGEST_BASELINE_REL, computeCacheInputDigest } from './inputs-digest';
import {
    canCacheRawResult,
    computeSensorFingerprint,
    readResultCache,
    toCacheRaw,
    writeResultCache,
} from './result-cache';
import { cliVersion } from '../../core/cli-version';
import { gitState } from '../../core/changes/worktree';
import { repoRoot as resolveGitRoot } from '../../core/changes/git';
import type { SensorMeasurement } from './types';

// Sensor JSON output can be several MB on large repos (e.g. `eslint --format json`
// with thousands of findings). A 1MB cap killed the child with SIGTERM when
// exceeded — which previously surfaced as a false "timeout".
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
    /**
     * Admission-only observation guard. Sensor commands remain external tools,
     * so a changed worktree makes their result unusable as read-only evidence.
     */
    readOnly?: boolean;
    /** Skip `closureOnly` sensors (RF-5.10). Makes selection non-full for receipts. */
    slice?: boolean;
    /**
     * Opt-in fingerprint result cache (RF-2.11). Only `awm sensors run` sets this
     * true (unless `--no-cache`). ignoreBaseline / readOnly callers must leave it unset.
     */
    useCache?: boolean;
};

type CachePlan = {
    gitRoot: string;
    projectKey: string;
    sensorFingerprint: string;
    inputDigest: string;
    inputGlobs: string[];
    /** Repo-root-relative package root (`''` at repository root) for receipt rematch. */
    packageRootRel: string;
    alwaysMeasuredRepoRels: string[];
    measuredPaths: string[];
    /** Validate always-measured (cache set ∪ baseline.json), repo-root POSIX. */
    validateAlwaysMeasuredRepoRels: string[];
    /**
     * False when live tool/runtime versions are unavailable (RF-2.10): digests still
     * attach for schema-2 receipts (RF-4.6) but cache read/write stay disabled.
     */
    cacheable: boolean;
};

type PreparedSlot = {
    execution: PreparedSensorExecution;
    cachePlan: CachePlan | null;
};

function posixJoinRel(root: string, abs: string): string {
    return path.relative(root, abs).split(path.sep).join('/');
}

function effectiveClosureOnly(
    projectOrPack: { closureOnly?: boolean } | null | undefined,
    liveSensor: SensorPackSensor | undefined,
): boolean {
    if (projectOrPack && projectOrPack.closureOnly !== undefined) return projectOrPack.closureOnly;
    if (liveSensor && liveSensor.closureOnly !== undefined) return liveSensor.closureOnly;
    return false;
}

function effectiveInputs(
    manifestInputs: string[] | undefined,
    variant: SensorVariant | undefined,
): string[] | undefined {
    if (manifestInputs && manifestInputs.length > 0) return manifestInputs;
    if (variant?.inputs && variant.inputs.length > 0) return variant.inputs;
    return undefined;
}

function includePackageJsonForVariant(variant: SensorVariant | undefined): boolean {
    if (!variant) return false;
    if (variant.command.packageManager) return true;
    if (variant.requirements.packageJsonFields && variant.requirements.packageJsonFields.length > 0) return true;
    if (variant.probe.kind === 'package-script-present') return true;
    return false;
}

function sliceSkipExecution(name: string, requestedScope: PreparedSensorExecution['requestedScope']): PreparedSensorExecution {
    return {
        name,
        timeoutMs: 1,
        timeoutSource: 'fallback',
        requestedScope,
        effectiveScope: 'full',
        syntheticStatus: 'skipped',
        syntheticReason: 'closureOnly: skipped by --slice',
    };
}

function buildCachePlan(args: {
    gitRoot: string;
    packageRoot: string;
    manifestPath: string;
    sensorId: string;
    inputGlobs: string[];
    variant: SensorVariant | undefined;
    liveState: CompatibilityEvidence | undefined;
    assets: string[] | undefined;
    /** Project-declared command when no pack variant exists. */
    command?: StructuredCommand;
}): CachePlan | null {
    const toolVersion = args.liveState?.toolVersion;
    const runtimeVersion = args.liveState?.runtimeVersion;
    const command = args.variant?.command ?? args.command ?? null;
    const fingerprintParts = {
        variantId: args.liveState?.variantId ?? args.variant?.id ?? null,
        command,
        changedCommand: args.variant?.changedCommand,
        cliVersion: cliVersion(),
        inputs: args.inputGlobs,
        toolVersion,
        runtimeVersion,
    };
    // Cache requires live versions (RF-2.10). Receipt measurements still need a fingerprint
    // when versions are absent so project-declared sensors with inputs do not demote RF-4.6.
    const cacheFingerprint = computeSensorFingerprint(fingerprintParts);
    const fingerprint = cacheFingerprint
        ?? computeSensorFingerprint(fingerprintParts, { allowMissingLiveVersions: true });
    if (fingerprint === null) return null;

    const packageRootRel = posixJoinRel(args.gitRoot, args.packageRoot);
    const sensorsJsonRel = posixJoinRel(args.gitRoot, args.manifestPath);
    const includePackageJson = args.variant
        ? includePackageJsonForVariant(args.variant)
        : Boolean(args.command?.packageManager);
    const alwaysMeasuredRepoRels = buildAlwaysMeasuredPaths({
        sensorsJsonRel,
        assetRels: args.assets ?? args.variant?.assets ?? [],
        configFileRels: args.variant?.requirements.configFiles ?? [],
        includePackageJson,
        packageRootRel: packageRootRel === '' ? '' : packageRootRel,
    });
    const digest = computeCacheInputDigest({
        gitRoot: args.gitRoot,
        packageRoot: args.packageRoot,
        inputGlobs: args.inputGlobs,
        alwaysMeasuredRepoRels,
    });
    if (!digest.ok) return null;
    const projectKey = `sha256:${crypto.createHash('sha256').update(`${args.manifestPath}\0${args.packageRoot}`).digest('hex')}`;
    // Baseline is excluded from the cache digest but required for validate (RF-2.12 / RF-4.5).
    // It lives next to the manifest: `<packageRoot>/.awm/sensors.baseline.json` as repo-root POSIX.
    const validateBaselineRel = posixJoinRel(
        args.gitRoot,
        path.join(args.packageRoot, '.awm', 'sensors.baseline.json'),
    );
    const baselineForValidate = validateBaselineRel === '' ? CACHE_DIGEST_BASELINE_REL : validateBaselineRel;
    const validateAlwaysMeasuredRepoRels = [...new Set([
        ...alwaysMeasuredRepoRels,
        baselineForValidate,
    ])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const rootRel = packageRootRel === '' ? '' : packageRootRel;
    return {
        gitRoot: args.gitRoot,
        projectKey,
        sensorFingerprint: fingerprint,
        inputDigest: digest.digest,
        inputGlobs: args.inputGlobs,
        packageRootRel: rootRel,
        alwaysMeasuredRepoRels,
        measuredPaths: digest.matchedPaths,
        validateAlwaysMeasuredRepoRels,
        cacheable: cacheFingerprint !== null,
    };
}

function measurementFromPlan(plan: CachePlan): SensorMeasurement {
    return {
        inputs: [...plan.inputGlobs],
        packageRootRel: plan.packageRootRel,
        inputDigest: plan.inputDigest,
        sensorFingerprint: plan.sensorFingerprint,
        measuredPaths: [...plan.measuredPaths],
        alwaysMeasuredPaths: [...plan.validateAlwaysMeasuredRepoRels],
    };
}

async function runPreparedSlot(
    slot: PreparedSlot,
    projectCwd: string,
    baseline: ReturnType<typeof readBaseline>,
    cacheEnabled: boolean,
    writeCache: boolean,
): Promise<SensorResult> {
    const { execution, cachePlan } = slot;
    // RF-2.2/2.6/6.1: synthetic skip/disabled/inconclusive prepare results must not
    // be overridden by a prior cache hit.
    const synthetic = execution.syntheticStatus !== undefined;
    // RF-2.10: cacheable is false without live versions — still attach measurements below.
    if (cacheEnabled && cachePlan?.cacheable && !synthetic) {
        const cached = readResultCache(cachePlan.gitRoot, {
            sensorId: execution.name,
            projectKey: cachePlan.projectKey,
            sensorFingerprint: cachePlan.sensorFingerprint,
            inputDigest: cachePlan.inputDigest,
        });
        if (cached) {
            const raw: SensorResult = {
                name: cached.raw.name,
                status: cached.raw.status,
                errors: cached.raw.errors,
                ...(cached.raw.failureKind ? { failureKind: cached.raw.failureKind } : {}),
                ...(cached.raw.certification ? { certification: cached.raw.certification } : {}),
                ...(cached.raw.skipReason ? { skipReason: cached.raw.skipReason } : {}),
                cached: true,
                cacheProvenance: {
                    ...(cached.originCommit ? { originCommit: cached.originCommit } : {}),
                    originDirty: cached.originDirty,
                    inputDigest: cached.inputDigest,
                    sensorFingerprint: cached.sensorFingerprint,
                },
                measurement: measurementFromPlan(cachePlan),
                execution: {
                    timeoutMs: execution.timeoutMs,
                    timeoutSource: execution.timeoutSource,
                    elapsedMs: 0,
                    requestedScope: execution.requestedScope,
                    effectiveScope: execution.effectiveScope,
                },
            };
            return baseline ? applyBaseline(raw, baseline[execution.name]) : raw;
        }
    }

    const raw = await executePrepared(execution, projectCwd);
    if (cacheEnabled && writeCache && cachePlan?.cacheable && !synthetic && canCacheRawResult(raw) && execution.requestedScope === 'full') {
        const after = computeCacheInputDigest({
            gitRoot: cachePlan.gitRoot,
            packageRoot: projectCwd,
            inputGlobs: cachePlan.inputGlobs,
            alwaysMeasuredRepoRels: cachePlan.alwaysMeasuredRepoRels,
        });
        if (after.ok && after.digest === cachePlan.inputDigest) {
            const state = gitState(cachePlan.gitRoot, true);
            const originCommit = state.kind === 'ok' ? state.commit : null;
            const originDirty = state.kind === 'ok' ? state.dirty : true;
            try {
                writeResultCache(cachePlan.gitRoot, {
                    schema: 1,
                    sensorId: execution.name,
                    projectKey: cachePlan.projectKey,
                    sensorFingerprint: cachePlan.sensorFingerprint,
                    inputDigest: cachePlan.inputDigest,
                    originCommit,
                    originDirty,
                    raw: toCacheRaw(raw),
                });
            } catch {
                // Cache write is best-effort beside the verdict; never fail the run.
            }
        }
    }
    const withMeasurement: SensorResult = cachePlan
        ? { ...raw, measurement: measurementFromPlan(cachePlan) }
        : raw;
    return baseline ? applyBaseline(withMeasurement, baseline[execution.name]) : withMeasurement;
}

async function resolveLiveFromSource(cwd: string, source: PackSource, packSelection?: 'explicit'): Promise<Awaited<ReturnType<typeof resolveParsedPackCompatibility>> | null> {
    try {
        const parsed = parseSensorPack(JSON.parse(source.content), source.path);
        if (parsed.kind !== 'v2') return null;
        return await resolveParsedPackCompatibility(cwd, parsed.pack, { packSelection });
    } catch { return null; }
}

/** Compatibility adapter retained for the baseline command; authority selection is shared. */
export function findManifestDir(startCwd: string): string | null {
    try {
        const project = resolveSensorProject(startCwd);
        return project.state === 'configured' ? project.projectRoot : null;
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

export function shouldRun(isFast: boolean, opts: RunOptions): boolean {
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


function v3ProjectSensors(parsed: ParsedSensorManifest): SensorManifestV3ProjectSensors | null {
    return parsed.kind === 'v3' && parsed.pack.mode === 'project-sensors' ? parsed.pack : null;
}

function hasSelectedPack(manifest: SensorManifestV3ProjectSensors): boolean {
    return typeof manifest.pack === 'string' && manifest.pack.length > 0;
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
    catch {
        const root = typeof opts.cwd === 'string' && opts.cwd.trim() !== '' ? path.resolve(opts.cwd) : process.cwd();
        return { sensors: [], overall: 'not_certified', mode: 'invalid', reason: 'invalid-start-cwd', projectRoot: root, manifestPath: path.join(root, '.awm', 'sensors.json'), remedy: 'provide-an-existing-project-directory' };
    }
    if (project.state === 'missing') {
        return { sensors: [], overall: 'not_certified', mode: 'missing', reason: 'manifest-absent', projectRoot: project.projectRoot, manifestPath: project.manifestPath, remedy: 'run-awm-sensors-bootstrap' };
    }
    let invalidEntries: SensorManifestInvalidEntry[] = [];
    let configured: { projectRoot: string; manifestPath: string; packageRoot: string; manifest: ParsedSensorManifest };
    if (project.state === 'invalid') {
        const recovered = softRecoverInvalidProject(project);
        if (!recovered) {
            const reason = project.reason.includes('unsupported manifest schemaVersion') ? 'schema-unsupported' : 'manifest-malformed';
            return { sensors: [], overall: 'not_certified', mode: 'invalid', reason, projectRoot: project.projectRoot, manifestPath: project.manifestPath, remedy: 'repair-sensor-manifest' };
        }
        invalidEntries = recovered.invalidEntries;
        configured = recovered;
    } else {
        configured = project;
    }

    const manifestDir = configured.projectRoot;
    // Admission-only: `.awm/admission.json` is never read for ordinary runs.
    let readOnlyPolicy: ExclusionPolicy | undefined;
    let beforeReadOnly: string | undefined;
    if (opts.readOnly) {
        const admissionConfig = loadAdmissionConfig(manifestDir);
        if (!admissionConfig.ok) {
            return { sensors: [], overall: 'not_certified', projectRoot: configured.projectRoot, manifestPath: configured.manifestPath, mode: 'invalid', reason: 'admission-config-invalid', remedy: admissionConfigRemedy(admissionConfig) };
        }
        readOnlyPolicy = createExclusionPolicy(admissionConfig.config, gitVerifier(manifestDir));
        const before = filesystemSnapshot(manifestDir, readOnlyPolicy);
        if (!before.ok) {
            return { sensors: [], overall: 'not_certified', projectRoot: configured.projectRoot, manifestPath: configured.manifestPath, mode: 'invalid', reason: 'read-only-observation-unavailable', remedy: snapshotUnavailableRemedy(before.failure), readOnlyObservation: readOnlyPolicy.evidence() };
        }
        beforeReadOnly = before.digest;
    }
    const parsed = configured.manifest;
    const authority = { projectRoot: configured.projectRoot, manifestPath: configured.manifestPath };
    if (parsed.kind === 'v3' && (parsed.pack.mode === 'native-gate' || parsed.pack.mode === 'opt-out')) {
        return { sensors: [], overall: 'not_certified', ...authority, mode: parsed.pack.mode, reason: `${parsed.pack.mode}-declared`, declarationReason: parsed.pack.reason };
    }
    const projectSensorsManifest = v3ProjectSensors(parsed);
    const onlyProject = projectSensorsManifest !== null && !hasSelectedPack(projectSensorsManifest);
    let resolvedSource: ReturnType<typeof resolveSensorSource> | undefined;
    if (parsed.kind === 'v2' || (parsed.kind === 'v3' && projectSensorsManifest && hasSelectedPack(projectSensorsManifest))) {
        try { resolvedSource = resolveSensorSource(parsed as Parameters<typeof resolveSensorSource>[0], { registries: listRegistries() }); }
        catch { return { sensors: [], overall: 'not_certified', ...authority, mode: 'invalid', reason: 'sensor-source-invalid', remedy: 'repair-or-run-awm-update' }; }
        if (resolvedSource.kind === 'source-unavailable' || resolvedSource.kind === 'source-ambiguous') {
            return { sensors: [], overall: 'not_certified', ...authority, mode: resolvedSource.kind, reason: resolvedSource.reason, remedy: resolvedSource.remedy, source: { kind: resolvedSource.kind, candidates: resolvedSource.kind === 'source-ambiguous' ? resolvedSource.candidates : undefined } };
        }
    }

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
    const projectCwd = configured.packageRoot;
    const live = parsed.kind !== 'legacy' && resolvedSource && 'source' in resolvedSource
        ? await resolveLiveFromSource(projectCwd, resolvedSource.source, projectSensorsManifest && 'packSelection' in projectSensorsManifest ? projectSensorsManifest.packSelection : undefined)
        : null;
    const drift = parsed.kind === 'legacy' ? detectPackDrift(manifestDir, parsed.pack) : undefined;
    const requestedScope = opts.changed ? 'changed' as const : 'full' as const;
    const prepared: PreparedSlot[] = [];
    const cacheEnabled = opts.useCache === true && !opts.ignoreBaseline && !opts.readOnly;
    const writeCache = cacheEnabled && requestedScope === 'full';
    const gitRoot = resolveGitRoot(manifestDir) ?? manifestDir;

    const activeManifest = parsed.pack as unknown as SensorManifest;
    const sensorsMap = activeManifest.sensors ?? {};
    const packSelected = projectSensorsManifest !== null && hasSelectedPack(projectSensorsManifest);
    for (const [name, sensor] of Object.entries(sensorsMap)) {
        const entry = sensor as V3ManifestSensor | SensorManifest['sensors'][string];
        const projectEntry = parsed.kind !== 'legacy' && isProjectDeclaredSensor(entry as V3ManifestSensor)
            ? entry as ProjectDeclaredSensor
            : null;
        // RF-1.7: collision when the live pack defines this id. When pack is selected
        // but live cannot be resolved, fail closed — never run a project override that
        // might be colliding with an unresolved pack sensor name.
        const collidedWithPack = projectEntry !== null && (
            packSelected && live === null
                ? true
                : live?.pack.sensors[name] !== undefined
        );
        if (collidedWithPack) {
            invalidEntries.push({ name, reason: `project-sensor-name-collision: ${name}` });
            // RF-1.7: keep the pack sensor when live is available; otherwise skip.
            if (live === null || live.pack.sensors[name] === undefined) continue;
            // Fall through to pack-bound prepare using live.
        } else if (projectEntry !== null) {
            const fast = projectEntry.fast ?? false;
            if (!shouldRun(fast, opts)) continue;
            if (opts.slice && effectiveClosureOnly(projectEntry, undefined)) {
                prepared.push({ execution: sliceSkipExecution(name, requestedScope), cachePlan: null });
                continue;
            }
            const markers = [
                ...(projectEntry.applicability?.allFiles ?? []),
                ...(projectEntry.applicability?.anyFiles ?? []),
            ];
            const applicabilityPaths = markers.length > 0
                ? discoverPresentMarkers(projectCwd, markers)
                : undefined;
            const execution = prepareV2Sensor({
                name,
                sensor: projectEntry,
                requestedScope,
                changed: changed ?? undefined,
                projectTimeout: projectEntry.timeout,
                applicabilityPaths,
            });
            const disabled = projectEntry.enabled === false
                ? { ...execution, command: undefined, syntheticStatus: 'skipped' as const, syntheticReason: 'disabled' }
                : execution;
            // Project-declared sensors have no live tool/runtime versions → never cache (RF-2.10),
            // but still attach digests/measurements when authored inputs exist (RF-4.6).
            let projectPlan: CachePlan | null = null;
            const projectInputs = effectiveInputs(projectEntry.inputs, undefined);
            if (projectInputs) {
                projectPlan = buildCachePlan({
                    gitRoot,
                    packageRoot: projectCwd,
                    manifestPath: configured.manifestPath,
                    sensorId: name,
                    inputGlobs: projectInputs,
                    variant: undefined,
                    liveState: undefined,
                    assets: projectEntry.assets,
                    command: projectEntry.command,
                });
            }
            prepared.push({ execution: disabled, cachePlan: projectPlan });
            continue;
        }

        const liveSensor = parsed.kind !== 'legacy' ? live?.pack.sensors[name] : undefined;
        const liveState = parsed.kind !== 'legacy' ? live?.sensors[name] : undefined;
        let packBoundSensor: PackBoundManifestSensor | SensorManifest['sensors'][string] =
            entry as PackBoundManifestSensor | SensorManifest['sensors'][string];
        if (collidedWithPack && liveSensor) {
            // Always reconstruct from live — never leave packBoundSensor as the project entry.
            const fallbackVariant = liveSensor.variants[0];
            if (!fallbackVariant) continue;
            const variantId = liveState?.variantId ?? fallbackVariant.id;
            const variant = liveSensor.variants.find(candidate => candidate.id === variantId) ?? fallbackVariant;
            const packSyntheticCompatibility: CompatibilityEvidence = {
                state: 'compatible-unverified',
                reason: 'collision-pack-fallback',
                variantId,
                toolVersion: null,
                runtimeVersion: null,
                certifiedRange: null,
                evidence: [],
            };
            const reconstructed: PackBoundManifestSensor = {
                enabled: true,
                ...(liveSensor.fast !== undefined ? { fast: liveSensor.fast } : {}),
                ...(liveSensor.timeout !== undefined ? { timeout: liveSensor.timeout } : {}),
                variantId,
                command: variant.command as StructuredCommand,
                initializedCompatibility: liveState ?? packSyntheticCompatibility,
            };
            packBoundSensor = reconstructed;
        }
        const fast = parsed.kind !== 'legacy'
            ? (packBoundSensor as { fast?: boolean }).fast ?? liveSensor?.fast ?? false
            : (entry as { fast?: boolean }).fast ?? false;
        if (!shouldRun(fast, opts)) continue;

        if (opts.slice && effectiveClosureOnly(packBoundSensor as { closureOnly?: boolean }, liveSensor)) {
            prepared.push({ execution: sliceSkipExecution(name, requestedScope), cachePlan: null });
            continue;
        }

        const execution = parsed.kind !== 'legacy'
            ? prepareV2Sensor({
                name,
                sensor: packBoundSensor as PackBoundManifestSensor,
                liveSensor,
                liveState,
                requestedScope,
                changed: changed ?? undefined,
            })
            : prepareLegacySensor({
                name,
                config: entry as SensorManifest['sensors'][string],
                requestedScope,
                changed: changed ?? undefined,
            });
        const ready = (packBoundSensor as { enabled?: boolean }).enabled === false
            ? { ...execution, command: undefined, syntheticStatus: 'skipped' as const, syntheticReason: 'disabled' }
            : execution;

        // Measurement (and optional cache) when the sensor has authored inputs — even under
        // `--no-cache`, so schema-2 receipts still carry digests (RF-4.3 / RF-2.9).
        let cachePlan: CachePlan | null = null;
        if (parsed.kind !== 'legacy') {
            const variantId = (packBoundSensor as PackBoundManifestSensor).variantId;
            const variant = liveSensor?.variants.find((candidate) => candidate.id === variantId)
                ?? liveSensor?.variants.find((candidate) => candidate.id === liveState?.variantId);
            const inputs = effectiveInputs((packBoundSensor as PackBoundManifestSensor).inputs, variant);
            if (inputs) {
                cachePlan = buildCachePlan({
                    gitRoot,
                    packageRoot: projectCwd,
                    manifestPath: configured.manifestPath,
                    sensorId: name,
                    inputGlobs: inputs,
                    variant,
                    liveState,
                    assets: (packBoundSensor as PackBoundManifestSensor).assets ?? variant?.assets,
                });
            }
        }
        prepared.push({ execution: ready, cachePlan });
    }

    const results = await pooled(prepared.map(slot => async () => runPreparedSlot(
        slot,
        projectCwd,
        baseline,
        cacheEnabled,
        writeCache,
    )), resolveConcurrency(activeManifest, prepared.length));

    let overall = reduceVerdict(results);
    // Legacy commands retain operational compatibility but their shell-backed
    // contract cannot certify a green run.
    if (parsed.kind === 'legacy' && overall === 'pass') overall = 'not_certified';
    if (overall === 'skipped' && drift && drift.detection.pack !== 'generic') overall = 'not_certified';

    const output: RunOutput = {
        sensors: results,
        overall,
        ...authority,
        mode: 'project-sensors',
        reason: parsed.kind === 'legacy'
            ? 'legacy-v1'
            : onlyProject
                ? 'configured-v3'
                : resolvedSource?.kind === 'logical' ? 'configured-v3' : resolvedSource?.kind,
        ...(parsed.kind !== 'legacy' && resolvedSource && 'source' in resolvedSource
            ? { source: { kind: resolvedSource.kind, registry: resolvedSource.source.registry.name } } : {}),
        ...(invalidEntries.length > 0 ? { invalidEntries } : {}),
        ...(drift?.drift ? { packDrift: drift.drift } : {}),
        ...(changed ? { changedScope: { files: changed.files.length, ...(changed.error ? { error: changed.error } : {}) } } : {}),
    };
    if (readOnlyPolicy) {
        // Same policy instance: cached verdicts keep both passes consistent.
        const after = filesystemSnapshot(manifestDir, readOnlyPolicy);
        const readOnlyObservation = readOnlyPolicy.evidence();
        if (!after.ok || after.digest !== beforeReadOnly) {
            return { ...output, overall: 'not_certified', reason: 'read-only-mutation-detected', remedy: 'sensor execution changed the worktree; repair it before using this evidence for admission', readOnlyObservation };
        }
        return { ...output, readOnlyObservation };
    }
    return output;
}
