import fs from 'fs';
import path from 'path';
import { resolveOnPath } from '../../core/paths';
import { SensorCheck, SensorStatusResult } from './types';
import { parseSensorPack } from './compatibility/contract';
import { discoverProjectEvidence } from './compatibility/discovery';
import { bindContainedRuntimeCommands } from './compatibility/live';
import type { PackSource } from './compatibility/pack-source';
import { resolveProjectCompatibility, resolveSensorCompatibility } from './compatibility/resolve';
import { resolveSensorProject, softRecoverInvalidProject } from './project';
import { resolveSensorSource, type SensorSourceResolution } from './compatibility/source';
import { listRegistries } from '../../core/registries';
import type { CompatibilityEvidence, StructuredCommand } from './compatibility/types';
import {
    isProjectDeclaredSensor,
    type ProjectDeclaredSensor,
    type SensorManifestV2,
    type SensorManifestV3ProjectSensors,
    type V3ManifestSensor,
} from './compatibility/manifest';

/** First non-flag token after `npx` — the tool the command actually runs. */
function npxTool(parts: string[]): string | undefined {
    for (let i = 1; i < parts.length; i++) {
        if (!parts[i].startsWith('-')) return parts[i];
    }
    return undefined;
}

/** If the command references `--config <file>`, that file must exist in the repo. */
function configCheck(parts: string[], cwd: string): SensorCheck | null {
    const i = parts.indexOf('--config');
    const cfg = i !== -1 ? parts[i + 1] : undefined;
    if (cfg && !fs.existsSync(path.join(cwd, cfg))) {
        return { ok: false, detail: `missing config: ${cfg}` };
    }
    return null;
}

/**
 * Verify a sensor command can actually run — not just that `npx` exists.
 * - `npx <tool>`: the tool MUST be installed locally (node_modules/.bin). Otherwise
 *   `npx` would fetch a remote package at run time (dependency-confusion risk) and
 *   the sensor would fail. A green status here would be a lie.
 * - other binaries: must resolve on PATH (`where` on win32, `command -v` elsewhere).
 * - any `--config <file>` referenced must exist.
 */
function checkCmd(cmd: string, cwd: string): SensorCheck {
    const parts = cmd.split(/\s+/).filter(Boolean);
    const bin = parts[0];

    if (bin === 'npx') {
        const tool = npxTool(parts);
        if (!tool) return { ok: false, detail: 'npx without a tool specified' };
        const localBin = path.join(cwd, 'node_modules', '.bin', tool);
        if (!fs.existsSync(localBin)) {
            return {
                ok: false,
                detail: `${tool} not installed locally (npx would download a remote package) — add it to devDependencies`,
            };
        }
        return configCheck(parts, cwd) ?? { ok: true, detail: `${tool} (node_modules/.bin)` };
    }

    if (!resolveOnPath(bin)) {
        return { ok: false, detail: `${bin} not found in PATH` };
    }
    return configCheck(parts, cwd) ?? { ok: true, detail: bin };
}

/** Check a v2 command's declared local prerequisite without invoking it. */
function checkStructuredCommand(command: StructuredCommand, cwd: string, assets: string[] = []): SensorCheck {
    const missingAsset = assets.find(asset => !fs.existsSync(path.join(cwd, asset)));
    if (missingAsset) return { ok: false, detail: `missing config: ${missingAsset}` };
    if (command.resolution === 'node-modules-bin') {
        const binary = path.join(cwd, 'node_modules', '.bin', command.executable);
        const present = fs.existsSync(binary)
            || fs.existsSync(`${binary}.cmd`)
            || fs.existsSync(`${binary}.exe`);
        return present
            ? { ok: true, detail: `${command.executable} (node_modules/.bin)` }
            : { ok: false, detail: `${command.executable} not installed locally` };
    }
    if (command.resolution === 'python-environment') {
        if (!command.pythonEnvironmentRoot) return { ok: false, detail: `${command.executable} has no selected Python environment` };
        const root = path.join(cwd, command.pythonEnvironmentRoot);
        const candidates = process.platform === 'win32'
            ? [path.join(root, 'Scripts', `${command.executable}.exe`), path.join(root, 'Scripts', `${command.executable}.cmd`)]
            : [path.join(root, 'bin', command.executable)];
        return candidates.some(candidate => fs.existsSync(candidate))
            ? { ok: true, detail: `${command.executable} (${command.pythonEnvironmentRoot})` }
            : { ok: false, detail: `${command.executable} not found in ${command.pythonEnvironmentRoot}` };
    }
    return resolveOnPath(command.executable)
        ? { ok: true, detail: command.executable }
        : { ok: false, detail: `${command.executable} not found in PATH` };
}

/**
 * Re-evaluate only locally discoverable v2 compatibility evidence. Unlike the
 * execution path, status never runs a compatibility probe: probes such as
 * `eslint --print-config` are process execution and would turn this command
 * into a health check. A selected variant still proves that its current tool
 * and runtime ranges are compatible; its probe state remains unverifiable.
 */
function resolveStaticV2Compatibility(cwd: string, manifest: SensorManifestV2, source: PackSource): Record<string, CompatibilityEvidence> {
    const parsed = parseSensorPack(JSON.parse(source.content), source.path);
    if (parsed.kind !== 'v2') throw new Error(`sensor pack "${manifest.pack}" does not provide a v2 compatibility contract`);
    const evidence = discoverProjectEvidence(cwd, parsed.pack);
    const executionPack = bindContainedRuntimeCommands(parsed.pack, evidence.pythonEnvironmentRoot);
    const resolutionEvidence = {
        ...evidence,
        ...(manifest.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}),
    };
    const initial = resolveProjectCompatibility(executionPack, resolutionEvidence).sensors;
    return Object.fromEntries(Object.entries(executionPack.sensors).map(([name, sensor]) => {
        const variant = initial[name]?.variantId === null
            ? null
            : sensor.variants.find(candidate => candidate.id === initial[name]?.variantId) ?? null;
        // These two probe kinds consume discovery output only. Keep their useful
        // static validation in status while leaving every command-backed probe
        // inconclusive rather than dispatching it.
        const probeStatus = variant?.probe.kind === 'config-present'
            ? (evidence.configFiles.length > 0 ? 'matched' : 'not-matched')
            : variant?.probe.kind === 'package-script-present'
                ? (variant.probe.script !== undefined && evidence.scripts.includes(variant.probe.script) ? 'matched' : 'not-matched')
                : undefined;
        return [name, probeStatus === undefined
            ? initial[name]
            : resolveSensorCompatibility(sensor, { ...resolutionEvidence, probe: { status: probeStatus } }, { pack: executionPack.name, sensor: name })];
    }));
}

/** Applicable pack sensors with no manifest entry, so the gap is attributable in
 *  every `awm sensors status`, not only in the output of the `init` that skipped it. */
function uninitializedSensors(manifest: SensorManifestV2, compatibility: Record<string, CompatibilityEvidence>): Record<string, { state: string; reason: string }> | undefined {
    const entries = Object.entries(compatibility)
        .filter(([name, evidence]) => evidence !== undefined && evidence.state !== 'not-applicable' && !Object.prototype.hasOwnProperty.call(manifest.sensors, name))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, evidence]) => [name, { state: evidence.state, reason: evidence.reason }] as const);
    return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/**
 * Status never executes, so `discoverProjectEvidence` is called here without
 * `pathToolVersion` and a `resolution: 'path'` tool is structurally invisible to
 * it: `npm` on PATH resolves as `missing-tool`/`tool-not-found` whether it is
 * installed or not. Reporting that as "compatibility drift" asserts something
 * this command did not measure. `checkStructuredCommand` DOES consult PATH for
 * exactly these commands, so defer to it rather than claim drift. Any other live
 * state, or a genuinely different resolved variant, is still real drift.
 *
 * Today `missing-tool`/`tool-not-found` is the ONLY verdict a `path` tool can
 * receive here, because discovery cannot see its version at all — so the state
 * and reason conditions are unreachable as written. They are kept because every
 * one of them can only make this guard NARROWER: a combination they reject falls
 * through to the drift report, never past it. A future discovery that does read
 * PATH would make them load-bearing rather than silently permissive.
 */
function unobservableOnPath(sensor: SensorManifestV2['sensors'][string], live: CompatibilityEvidence): boolean {
    return sensor.command.resolution === 'path' && live.variantId === null
        && live.state === 'missing-tool' && live.reason === 'tool-not-found';
}

function staticCompatibilityCheck(sensor: SensorManifestV2['sensors'][string], live: CompatibilityEvidence | undefined): SensorCheck | null {
    if (!live) return { ok: false, detail: 'live compatibility unavailable' };
    if (unobservableOnPath(sensor, live)) return null;
    if (live.variantId !== sensor.variantId) {
        return { ok: false, detail: `compatibility drift: initialized ${sensor.variantId}, resolved ${live.variantId ?? live.state}` };
    }
    if (live.state === 'incompatible' || live.state === 'missing-tool' || live.state === 'not-applicable' || live.reason === 'probe-not-matched') {
        return { ok: false, detail: `live compatibility ${live.state}: ${live.reason}` };
    }
    return null;
}

type ResolvedSource = Extract<SensorSourceResolution, { source: PackSource }>;

function resolvedSourceMetadata(source: ResolvedSource): { reason: string; source: NonNullable<SensorStatusResult['source']> } {
    return {
        reason: source.kind === 'logical' ? 'configured-v3' : source.kind,
        source: { kind: source.kind, registry: source.source.registry.name },
    };
}

function projectMetadata(project: ReturnType<typeof resolveSensorProject>, mode: NonNullable<SensorStatusResult['mode']>, reason: string, extra: Partial<SensorStatusResult> = {}): Partial<SensorStatusResult> {
    return {
        mode, reason, projectRoot: project.projectRoot, manifestPath: project.manifestPath,
        ...(project.state === 'configured' ? { packageRoot: project.packageRoot } : {}),
        ...extra,
    };
}

function sourceFailure(project: Extract<ReturnType<typeof resolveSensorProject>, { state: 'configured' }>, pack: string, source: Exclude<SensorSourceResolution, ResolvedSource>): SensorStatusResult {
    if (source.kind === 'source-unavailable') {
        return {
            overall: 'DEGRADED', pack, checks: {},
            ...projectMetadata(project, 'source-unavailable', source.reason, { remedy: source.remedy }),
        };
    }
    return {
        overall: 'DEGRADED', pack, checks: {},
        ...projectMetadata(project, 'source-ambiguous', source.reason, { remedy: source.remedy, candidates: source.candidates }),
    };
}

function invalidStatus(project: ReturnType<typeof resolveSensorProject>, pack: string | null, reason = 'manifest-malformed', remedy = 'repair-sensor-manifest'): SensorStatusResult {
    return {
        overall: 'DEGRADED', pack, checks: {},
        ...projectMetadata(project, 'invalid', reason, { remedy }),
    };
}

function hasSelectedPack(manifest: SensorManifestV3ProjectSensors): boolean {
    return typeof manifest.pack === 'string' && manifest.pack.length > 0;
}

function projectSensorCheck(sensor: ProjectDeclaredSensor, cwd: string): SensorCheck {
    if (sensor.enabled === false) {
        return { ok: true, detail: 'disabled (project-declared)', certification: 'project-declared' };
    }
    const check = checkStructuredCommand(sensor.command, cwd, sensor.assets);
    return {
        ok: check.ok,
        detail: check.ok ? `project-declared: ${check.detail}` : `${check.detail} (project-declared)`,
        certification: 'project-declared',
    };
}

function packBoundOnly(manifest: SensorManifestV2 | SensorManifestV3ProjectSensors): SensorManifestV2 {
    const sensors = Object.fromEntries(
        Object.entries(manifest.sensors).filter(([, sensor]) => !isProjectDeclaredSensor(sensor as V3ManifestSensor)),
    ) as SensorManifestV2['sensors'];
    const pack = 'pack' in manifest && typeof manifest.pack === 'string' ? manifest.pack : '';
    return { schemaVersion: 2, pack, sensors };
}

/** Live pack sensor ids, or null when the pack cannot be resolved (fail closed). */
function livePackSensorIds(source: PackSource): Set<string> | null {
    try {
        const parsed = parseSensorPack(JSON.parse(source.content), source.path);
        if (parsed.kind !== 'v2') return null;
        return new Set(Object.keys(parsed.pack.sensors));
    } catch {
        return null;
    }
}

/**
 * RF-1.7 status: never label a colliding project id as project-declared READY.
 * When pack is selected and live is unavailable, fail closed rather than claiming
 * the project override is safe.
 */
function projectDeclaredOrCollisionCheck(
    name: string,
    sensor: ProjectDeclaredSensor,
    packageRoot: string,
    packSelected: boolean,
    liveIds: Set<string> | null,
): SensorCheck {
    if (packSelected && (liveIds === null || liveIds.has(name))) {
        return {
            ok: false,
            detail: liveIds === null
                ? `project-sensor-name-collision: ${name} (live pack unavailable)`
                : `project-sensor-name-collision: ${name}; pack sensor kept`,
        };
    }
    return projectSensorCheck(sensor, packageRoot);
}

/** Soft-isolate valid siblings into checks while authority remains invalid (RF soft-parse). */
function softIsolatedChecks(
    project: Extract<ReturnType<typeof resolveSensorProject>, { state: 'invalid' }>,
): Record<string, SensorCheck> {
    const recovered = softRecoverInvalidProject(project);
    if (!recovered) return {};
    const checks: Record<string, SensorCheck> = {};
    const sensors = recovered.manifest.kind === 'v3' && recovered.manifest.pack.mode === 'project-sensors'
        ? recovered.manifest.pack.sensors
        : {};
    for (const [name, sensor] of Object.entries(sensors)) {
        if (isProjectDeclaredSensor(sensor as V3ManifestSensor)) {
            checks[name] = projectSensorCheck(sensor as ProjectDeclaredSensor, recovered.packageRoot);
        }
    }
    for (const entry of recovered.invalidEntries) {
        checks[entry.name] = { ok: false, detail: entry.reason };
    }
    return checks;
}

export async function computeSensorStatus(cwd: string = process.cwd()): Promise<SensorStatusResult> {
    let project: ReturnType<typeof resolveSensorProject>;
    try {
        project = resolveSensorProject(cwd);
    } catch {
        const root = typeof cwd === 'string' && cwd.trim() !== '' ? path.resolve(cwd) : process.cwd();
        return { overall: 'DEGRADED', pack: null, checks: {}, mode: 'invalid', reason: 'invalid-start-cwd', projectRoot: root, manifestPath: path.join(root, '.awm', 'sensors.json'), remedy: 'provide-an-existing-project-directory' };
    }
    if (project.state === 'missing') {
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {}, ...projectMetadata(project, 'missing', 'manifest-absent', { remedy: 'run-awm-sensors-bootstrap' }) };
    }
    if (project.state === 'invalid') {
        let pack: string | null = null;
        let reason = 'manifest-malformed';
        let remedy = 'repair-sensor-manifest';
        try {
            const text = fs.readFileSync(project.manifestPath, 'utf-8');
            try {
                const raw: unknown = JSON.parse(text);
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    const record = raw as Record<string, unknown>;
                    if (!('schemaVersion' in record) && typeof record.pack === 'string') pack = record.pack;
                    else if (typeof record.pack === 'string') pack = record.pack;
                }
                // JSON.parse succeeded — this is schema invalidity, not "not valid JSON" (RF-4.1).
                if (project.reason.includes('unsupported manifest schemaVersion')) {
                    reason = 'schema-unsupported';
                } else {
                    reason = `schema-invalid: ${project.reason}`;
                    // Project-entry schema failures must not lead with `awm sensors init` (RF-3.3).
                    remedy = 'repair-the-invalid-sensor-entry-in-sensors-json';
                }
            } catch {
                reason = 'manifest-malformed';
            }
        } catch { /* unreadable manifest stays malformed */ }
        // Soft-isolate valid siblings into checks (same WithIssues path as run) while
        // keeping mode=invalid so preflight RF-4.1 still sees schema-invalid authority.
        return {
            ...invalidStatus(project, pack, reason, remedy),
            checks: softIsolatedChecks(project),
        };
    }
    const packageRoot = project.packageRoot;
    const parsed = project.manifest;
    if (parsed.kind === 'v3' && parsed.pack.mode !== 'project-sensors') {
        return {
            overall: 'NOT_CONFIGURED', pack: null, checks: {},
            ...projectMetadata(project, parsed.pack.mode, `${parsed.pack.mode}-declared`, { declarationReason: parsed.pack.reason }),
        };
    }

    if (parsed.kind === 'v3' && parsed.pack.mode === 'project-sensors' && !hasSelectedPack(parsed.pack)) {
        // Only-project: no pack source to resolve. Report each project sensor with
        // project-declared provenance rather than an empty Pack:none DEGRADED (RF-2.8).
        const checks: Record<string, SensorCheck> = {};
        for (const [name, sensor] of Object.entries(parsed.pack.sensors)) {
            if (isProjectDeclaredSensor(sensor)) {
                checks[name] = projectSensorCheck(sensor, packageRoot);
            } else {
                checks[name] = { ok: false, detail: 'pack-bound sensor requires a nonempty pack' };
            }
        }
        return {
            overall: Object.keys(checks).length > 0 && Object.values(checks).every(check => check.ok) ? 'READY' : 'DEGRADED',
            pack: null,
            checks,
            ...projectMetadata(project, 'project-sensors', 'project-declared-only'),
        };
    }

    if (parsed.kind === 'v2' || parsed.kind === 'v3') {
        const parsedPack = parsed.pack as SensorManifestV2 | SensorManifestV3ProjectSensors;
        const packId = typeof parsedPack.pack === 'string' ? parsedPack.pack : null;
        const packSelected = typeof parsedPack.pack === 'string' && parsedPack.pack.length > 0;
        let resolution: SensorSourceResolution;
        try {
            resolution = resolveSensorSource(parsed, { registries: listRegistries() });
        } catch {
            return invalidStatus(project, packId, 'sensor-source-invalid', 'repair-or-run-awm-update');
        }
        if (!('source' in resolution)) return sourceFailure(project, packId ?? 'unknown', resolution);
        const sourceMeta = resolvedSourceMetadata(resolution);
        const liveIds = livePackSensorIds(resolution.source);
        const packManifest = packBoundOnly(parsedPack);
        const checks: Record<string, SensorCheck> = {};
        let compatibility: Record<string, CompatibilityEvidence>;
        try {
            compatibility = resolveStaticV2Compatibility(packageRoot, packManifest, resolution.source);
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'live compatibility unavailable';
            for (const [name, sensor] of Object.entries(parsedPack.sensors)) {
                if (isProjectDeclaredSensor(sensor as V3ManifestSensor)) {
                    checks[name] = projectDeclaredOrCollisionCheck(
                        name, sensor as ProjectDeclaredSensor, packageRoot, packSelected, liveIds,
                    );
                } else {
                    checks[name] = (sensor as SensorManifestV2['sensors'][string]).enabled === false
                        ? { ok: true, detail: 'disabled' }
                        : { ok: false, detail };
                }
            }
            return { overall: 'DEGRADED', pack: packId, checks, ...projectMetadata(project, 'project-sensors', sourceMeta.reason, { ...sourceMeta }) };
        }
        for (const [name, sensor] of Object.entries(parsedPack.sensors)) {
            if (isProjectDeclaredSensor(sensor as V3ManifestSensor)) {
                checks[name] = projectDeclaredOrCollisionCheck(
                    name, sensor as ProjectDeclaredSensor, packageRoot, packSelected, liveIds,
                );
                continue;
            }
            const packSensor = sensor as SensorManifestV2['sensors'][string];
            checks[name] = packSensor.enabled === false ? { ok: true, detail: 'disabled' }
                : staticCompatibilityCheck(packSensor, compatibility[name]) ?? checkStructuredCommand(packSensor.command, packageRoot, packSensor.assets);
        }
        const uninitialized = uninitializedSensors(packManifest, compatibility);
        return {
            overall: Object.keys(checks).length > 0 && Object.values(checks).every(check => check.ok) ? 'READY' : 'DEGRADED',
            pack: packId, checks,
            ...(uninitialized ? { uninitialized } : {}),
            ...projectMetadata(project, 'project-sensors', sourceMeta.reason, { ...sourceMeta }),
        };
    }

    const manifest = parsed.pack;
    const checks: Record<string, SensorCheck> = {};
    for (const [name, config] of Object.entries(manifest.sensors ?? {})) {
        if (config.enabled === false) { checks[name] = { ok: true, detail: 'disabled' }; continue; }
        if (!config.cmd) { checks[name] = { ok: false, detail: 'no cmd configured' }; continue; }
        checks[name] = checkCmd(config.cmd, packageRoot);
    }
    return {
        overall: Object.keys(manifest.sensors ?? {}).length > 0 && Object.values(checks).every(check => check.ok) ? 'READY' : 'DEGRADED',
        pack: manifest.pack, checks, ...projectMetadata(project, 'project-sensors', 'legacy-v1'),
    };
}
