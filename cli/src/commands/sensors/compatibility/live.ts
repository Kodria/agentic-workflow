import { resolvePackSource } from './pack-source';
import { parseSensorPack } from './contract';
import { discoverProjectEvidence } from './discovery';
import { resolveProjectCompatibility } from './resolve';
import { runCompatibilityProbe } from './probe';
import type { CompatibilityEvidence, SensorPackV2 } from './types';
import path from 'path';

export type LiveCompatibility = {
    pack: SensorPackV2;
    sensors: Record<string, CompatibilityEvidence>;
};
export type LiveCompatibilityOptions = { packSelection?: 'explicit' };

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
    const evidence = discoverProjectEvidence(cwd, pack);
    const resolutionEvidence = { ...evidence, ...(options.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}) };
    const initial = resolveProjectCompatibility(pack, resolutionEvidence).sensors;
    const sensors: Record<string, CompatibilityEvidence> = {};
    for (const [name, sensor] of Object.entries(pack.sensors)) {
        const base = initial[name];
        const variant = base.variantId === null ? null : sensor.variants.find(candidate => candidate.id === base.variantId) ?? null;
        const probe = variant
            ? await runCompatibilityProbe(variant.probe, {
                cwd,
                toolExecutable: variant.command.executable,
                toolResolution: variant.command.resolution,
                configFiles: evidence.configFiles,
                scripts: evidence.scripts,
            })
            : null;
        sensors[name] = resolveProjectCompatibility(
            { ...pack, sensors: { [name]: sensor } },
            { ...resolutionEvidence, probe: probe ?? undefined },
        ).sensors[name];
    }
    return { pack, sensors };
}
