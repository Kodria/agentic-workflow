import fs from 'fs';
import path from 'path';
import { resolveOnPath } from '../../core/paths';
import { SensorCheck, SensorStatusResult } from './types';
import { parseSensorPack } from './compatibility/contract';
import { discoverProjectEvidence } from './compatibility/discovery';
import type { PackSource } from './compatibility/pack-source';
import { resolveProjectCompatibility, resolveSensorCompatibility } from './compatibility/resolve';
import { resolveSensorProject } from './project';
import { resolveSensorSource, type SensorSourceResolution } from './compatibility/source';
import { listRegistries } from '../../core/registries';
import type { CompatibilityEvidence, StructuredCommand } from './compatibility/types';
import type { SensorManifestV2 } from './compatibility/manifest';

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
    const resolutionEvidence = {
        ...evidence,
        ...(manifest.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}),
    };
    const initial = resolveProjectCompatibility(parsed.pack, resolutionEvidence).sensors;
    return Object.fromEntries(Object.entries(parsed.pack.sensors).map(([name, sensor]) => {
        const variant = initial[name]?.variantId === null
            ? null
            : sensor.variants.find(candidate => candidate.id === initial[name]?.variantId) ?? null;
        // These two probe kinds consume discovery output only. Keep their useful
        // static validation in status while leaving every command-backed probe
        // inconclusive rather than dispatching it.
        const probeStatus = variant?.probe.kind === 'config-present'
            ? (evidence.configFiles.length > 0 ? 'matched' : 'not-matched')
            : variant?.probe.kind === 'package-script-present'
                ? (evidence.scripts.length > 0 ? 'matched' : 'not-matched')
                : undefined;
        return [name, probeStatus === undefined
            ? initial[name]
            : resolveSensorCompatibility(sensor, { ...resolutionEvidence, probe: { status: probeStatus } }, { pack: parsed.pack.name, sensor: name })];
    }));
}

function staticCompatibilityCheck(sensor: SensorManifestV2['sensors'][string], live: CompatibilityEvidence | undefined): SensorCheck | null {
    if (!live) return { ok: false, detail: 'live compatibility unavailable' };
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
        try {
            const raw: unknown = JSON.parse(fs.readFileSync(project.manifestPath, 'utf-8'));
            if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('schemaVersion' in raw) && typeof (raw as any).pack === 'string') {
                pack = (raw as any).pack;
            }
        } catch { /* malformed JSON is not configured */ }
        const reason = project.reason.includes('unsupported manifest schemaVersion') ? 'schema-unsupported' : 'manifest-malformed';
        return invalidStatus(project, pack, reason);
    }
    const packageRoot = project.packageRoot;
    const parsed = project.manifest;
    if (parsed.kind === 'v3' && parsed.pack.mode !== 'project-sensors') {
        return {
            overall: 'NOT_CONFIGURED', pack: null, checks: {},
            ...projectMetadata(project, parsed.pack.mode, `${parsed.pack.mode}-declared`, { declarationReason: parsed.pack.reason }),
        };
    }

    if (parsed.kind === 'v2' || parsed.kind === 'v3') {
        const parsedPack = parsed.pack as SensorManifestV2;
        let resolution: SensorSourceResolution;
        try {
            resolution = resolveSensorSource(parsed, { registries: listRegistries() });
        } catch {
            return invalidStatus(project, parsedPack.pack, 'sensor-source-invalid', 'repair-or-run-awm-update');
        }
        if (!('source' in resolution)) return sourceFailure(project, parsedPack.pack, resolution);
        const sourceMeta = resolvedSourceMetadata(resolution);
        const manifest = parsedPack;
        const checks: Record<string, SensorCheck> = {};
        let compatibility: Record<string, CompatibilityEvidence>;
        try {
            compatibility = resolveStaticV2Compatibility(packageRoot, manifest, resolution.source);
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'live compatibility unavailable';
            for (const [name, sensor] of Object.entries(manifest.sensors)) checks[name] = sensor.enabled === false ? { ok: true, detail: 'disabled' } : { ok: false, detail };
            return { overall: 'DEGRADED', pack: manifest.pack, checks, ...projectMetadata(project, 'project-sensors', sourceMeta.reason, { ...sourceMeta }) };
        }
        for (const [name, sensor] of Object.entries(manifest.sensors)) {
            checks[name] = sensor.enabled === false ? { ok: true, detail: 'disabled' }
                : staticCompatibilityCheck(sensor, compatibility[name]) ?? checkStructuredCommand(sensor.command, packageRoot, sensor.assets);
        }
        return {
            overall: Object.keys(checks).length > 0 && Object.values(checks).every(check => check.ok) ? 'READY' : 'DEGRADED',
            pack: manifest.pack, checks,
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
