import fs from 'fs';
import path from 'path';
import { resolveOnPath } from '../../core/paths';
import { SensorCheck, SensorStatusResult, SensorManifest } from './types';
import { parseSensorManifest } from './compatibility/manifest';
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
    const manifestPath = project.manifestPath;
    const packageRoot = project.packageRoot;
    const base = { projectRoot: project.projectRoot, manifestPath };

    let manifest: SensorManifest;
    try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const parsed = parseSensorManifest(raw, manifestPath);
        if (parsed.kind === 'v3') {
            if (parsed.pack.mode === 'native-gate' || parsed.pack.mode === 'opt-out') {
                return { overall: 'NOT_CONFIGURED', pack: null, ...base, mode: parsed.pack.mode, reason: `${parsed.pack.mode}-declared`, checks: {} };
            }
            let source;
            try { source = resolveSensorSource(parsed, { registries: listRegistries() }); }
            catch (error) { return { overall: 'DEGRADED', pack: parsed.pack.pack, ...base, mode: 'source-unavailable', reason: error instanceof Error ? error.message : 'source-unavailable', remedy: 'install-registry-or-run-awm-update', checks: {} }; }
            if (source.kind === 'source-unavailable' || source.kind === 'source-ambiguous') {
                return { overall: 'DEGRADED', pack: parsed.pack.pack, ...base, mode: source.kind, reason: source.reason, remedy: source.remedy, checks: {} };
            }
            return { overall: 'DEGRADED', pack: parsed.pack.pack, ...base, mode: 'project-sensors', reason: source.kind, checks: {} };
        }
        if (parsed.kind === 'v2') {
            // Monorepo support (mirrors run.ts/init.ts): detection and structured-command
            // asset resolution both need to see the real package, not the (possibly
            // unrelated) directory the manifest lives in.
            const projectCwd = packageRoot;
            const checks: Record<string, SensorCheck> = {};
            let source: ReturnType<typeof resolveSensorSource>;
            try { source = resolveSensorSource(parsed, { registries: listRegistries() }); }
            catch (error) {
                return { overall: 'DEGRADED', pack: parsed.pack.pack, ...base, mode: 'source-unavailable', reason: error instanceof Error ? error.message : 'source-unavailable', remedy: 'install-registry-or-run-awm-update', checks: {} };
            }
            if (source.kind === 'source-unavailable' || source.kind === 'source-ambiguous') {
                return { overall: 'DEGRADED', pack: parsed.pack.pack, ...base, mode: source.kind, reason: source.reason, remedy: source.remedy, checks: {} };
            }
            let compatibility: Record<string, CompatibilityEvidence>;
            try {
                compatibility = resolveStaticV2Compatibility(projectCwd, parsed.pack, source.source);
            } catch (error) {
                const detail = error instanceof Error ? error.message : 'live compatibility unavailable';
                for (const [name, sensor] of Object.entries(parsed.pack.sensors)) {
                    checks[name] = sensor.enabled === false ? { ok: true, detail: 'disabled' } : { ok: false, detail };
                }
                return { overall: 'DEGRADED', pack: parsed.pack.pack, ...base, mode: 'project-sensors', reason: source.kind, checks };
            }
            for (const [name, sensor] of Object.entries(parsed.pack.sensors)) {
                if (sensor.enabled === false) {
                    checks[name] = { ok: true, detail: 'disabled' };
                    continue;
                }
                checks[name] = staticCompatibilityCheck(sensor, compatibility[name])
                    ?? checkStructuredCommand(sensor.command, projectCwd, sensor.assets);
            }
            return { overall: Object.keys(checks).length > 0 && Object.values(checks).every(check => check.ok) ? 'READY' : 'DEGRADED', pack: parsed.pack.pack, ...base, mode: 'project-sensors', reason: source.kind, checks };
        }
        manifest = parsed.pack;
    } catch {
        // Preserve the historic diagnostic path for a hand-edited legacy manifest:
        // malformed v2 is fail-closed, while a legacy `sensors:null` is surfaced as
        // degraded rather than crashing the status command.
        try {
            const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('schemaVersion' in raw) && typeof (raw as any).pack === 'string') {
                return { overall: 'DEGRADED', pack: (raw as any).pack, ...base, mode: 'project-sensors', reason: 'legacy-v1', checks: {} };
            }
        } catch { /* malformed JSON is not configured */ }
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    const checks: Record<string, SensorCheck> = {};
    for (const [name, config] of Object.entries(manifest.sensors ?? {})) {
        if (config.enabled === false) { checks[name] = { ok: true, detail: 'disabled' }; continue; }
        if (!config.cmd) { checks[name] = { ok: false, detail: 'no cmd configured' }; continue; }
        checks[name] = checkCmd(config.cmd, packageRoot);
    }

    // `Object.values({}).every(...)` is vacuously true — a manifest with zero sensor
    // entries (the registry had no pack.json for this stack; see init.ts) must not read
    // as READY just because there was nothing to fail. Same false-green `checkManifest`
    // guards against in preflight.
    if (Object.keys(manifest.sensors ?? {}).length === 0) {
        return { overall: 'DEGRADED', pack: manifest.pack, checks };
    }
    return { overall: Object.values(checks).every(check => check.ok) ? 'READY' : 'DEGRADED', pack: manifest.pack, ...base, mode: 'project-sensors', reason: 'legacy-v1', checks };
}
