import { resolvePackSource } from './pack-source';
import { parseSensorPack } from './contract';
import { discoverProjectEvidence } from './discovery';
import { resolveProjectCompatibility } from './resolve';
import { runCompatibilityProbe } from './probe';
import type { CompatibilityEvidence, SensorPackV2, SensorVariant } from './types';
import path from 'path';
import { spawnSync } from 'child_process';
import semver from 'semver';

export type LiveCompatibility = {
    pack: SensorPackV2;
    sensors: Record<string, CompatibilityEvidence>;
};
export type LiveCompatibilityOptions = { packSelection?: 'explicit' };

/** Execution-time evidence only. Status/discovery never invokes this resolver. */
function pathPackageManagerVersion(tool: string): string | null {
    if (!['npm', 'pnpm', 'yarn', 'bun'].includes(tool)) return null;
    try {
        const result = spawnSync(tool, ['--version'], { cwd: process.cwd(), shell: false, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024, windowsHide: true, stdio: 'pipe' });
        if (result.error || result.status !== 0 || result.signal || typeof result.stdout !== 'string' || result.stdout.length > 256) return null;
        return semver.valid(result.stdout.trim());
    } catch { return null; }
}

/**
 * Python package metadata is evidence only for a contained virtual environment.
 * A v2 command that names a Python-runtime tool must therefore resolve through
 * that same environment — never a same-named executable inherited from PATH.
 *
 * Keep this at the live pack boundary so the command used by probing, init's
 * materialized manifest, and `sensors run` is one identical structured command.
 */
function containedRuntimeCommand(variant: SensorVariant, pythonEnvironmentRoot: '.venv' | 'venv' | null): SensorVariant {
    if (variant.requirements.runtime !== 'python') return variant;
    return {
        ...variant,
        command: {
            ...variant.command,
            resolution: 'python-environment',
            ...(pythonEnvironmentRoot ? { pythonEnvironmentRoot } : {}),
        },
    };
}

export function bindContainedRuntimeCommands(pack: SensorPackV2, pythonEnvironmentRoot: '.venv' | 'venv' | null): SensorPackV2 {
    return {
        ...pack,
        sensors: Object.fromEntries(Object.entries(pack.sensors).map(([name, sensor]) => [
            name,
            { ...sensor, variants: sensor.variants.map(variant => containedRuntimeCommand(variant, pythonEnvironmentRoot)) },
        ])),
    };
}

/**
 * Re-resolve a v2 pack from the configured registry and current project evidence.
 * Manifest evidence is intentionally not an input: it is an init-time trace, not a
 * live certification source. Probes are bounded and structured through the shared
 * compatibility probe runner.
 */
export async function resolveLiveCompatibility(cwd: string, packName: string, registryRoot?: string, options: LiveCompatibilityOptions = {}): Promise<LiveCompatibility> {
    if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('cwd must be a non-empty path');
    if (typeof packName !== 'string' || !/^[a-z][a-z0-9-]*$/.test(packName)) throw new Error('pack name must be a stable lowercase id');
    if (registryRoot !== undefined && (typeof registryRoot !== 'string' || !path.isAbsolute(registryRoot) || path.normalize(registryRoot) !== registryRoot || /[\0\r\n]/.test(registryRoot))) {
        throw new Error('registry root provenance must be an absolute normalized path');
    }
    const source = registryRoot === undefined
        ? resolvePackSource(packName)
        : resolvePackSource(packName, { registries: [{ name: 'manifest-provenance', remote: 'local', contentRoot: registryRoot }] });
    const parsed = parseSensorPack(JSON.parse(source.content), source.path);
    if (parsed.kind !== 'v2') throw new Error(`sensor pack "${packName}" does not provide a v2 compatibility contract`);
    return resolveParsedPackCompatibility(cwd, parsed.pack, options);
}

/** Resolve a pre-parsed v2 pack. Init uses this when given an explicit registry root. */
export async function resolveParsedPackCompatibility(cwd: string, pack: SensorPackV2, options: LiveCompatibilityOptions = {}): Promise<LiveCompatibility> {
    if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('cwd must be a non-empty path');
    if (!pack || typeof pack !== 'object' || pack.schemaVersion !== 2) throw new Error('pack must be a parsed v2 sensor pack');
    const evidence = discoverProjectEvidence(cwd, pack, { pathToolVersion: pathPackageManagerVersion });
    const executionPack = bindContainedRuntimeCommands(pack, evidence.pythonEnvironmentRoot);
    const resolutionEvidence = { ...evidence, ...(options.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}) };
    const initial = resolveProjectCompatibility(executionPack, resolutionEvidence).sensors;
    const sensors: Record<string, CompatibilityEvidence> = {};
    for (const [name, sensor] of Object.entries(executionPack.sensors)) {
        const base = initial[name];
        const variant = base.variantId === null ? null : sensor.variants.find(candidate => candidate.id === base.variantId) ?? null;
        const probe = variant
            ? await runCompatibilityProbe(variant.probe, {
                cwd,
                toolExecutable: variant.command.executable,
                toolResolution: variant.command.resolution,
                pythonEnvironmentRoot: variant.command.pythonEnvironmentRoot,
                environment: variant.command.environment,
                configFiles: evidence.configFiles,
                scripts: evidence.scripts,
                variantArgs: variant.command.args,
            })
            : null;
        sensors[name] = resolveProjectCompatibility(
            { ...executionPack, sensors: { [name]: sensor } },
            { ...resolutionEvidence, probe: probe ?? undefined },
        ).sensors[name];
    }
    return { pack: executionPack, sensors };
}
