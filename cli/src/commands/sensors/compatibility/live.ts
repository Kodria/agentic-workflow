import { resolvePackSource } from './pack-source';
import { parseSensorPack } from './contract';
import { discoverProjectEvidence } from './discovery';
import { resolveProjectCompatibility } from './resolve';
import { runCompatibilityProbe } from './probe';
import type { CompatibilityEvidence, SensorPackV2 } from './types';

export type LiveCompatibility = {
    pack: SensorPackV2;
    sensors: Record<string, CompatibilityEvidence>;
};

/**
 * Re-resolve a v2 pack from the configured registry and current project evidence.
 * Manifest evidence is intentionally not an input: it is an init-time trace, not a
 * live certification source. Probes are bounded and structured through the shared
 * compatibility probe runner.
 */
export async function resolveLiveCompatibility(cwd: string, packName: string): Promise<LiveCompatibility> {
    if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('cwd must be a non-empty path');
    if (typeof packName !== 'string' || !/^[a-z][a-z0-9-]*$/.test(packName)) throw new Error('pack name must be a stable lowercase id');
    const source = resolvePackSource(packName);
    const parsed = parseSensorPack(JSON.parse(source.content), source.path);
    if (parsed.kind !== 'v2') throw new Error(`sensor pack "${packName}" does not provide a v2 compatibility contract`);
    return resolveParsedPackCompatibility(cwd, parsed.pack);
}

/** Resolve a pre-parsed v2 pack. Init uses this when given an explicit registry root. */
export async function resolveParsedPackCompatibility(cwd: string, pack: SensorPackV2): Promise<LiveCompatibility> {
    if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('cwd must be a non-empty path');
    if (!pack || typeof pack !== 'object' || pack.schemaVersion !== 2) throw new Error('pack must be a parsed v2 sensor pack');
    const evidence = discoverProjectEvidence(cwd, pack);
    const initial = resolveProjectCompatibility(pack, evidence).sensors;
    const sensors: Record<string, CompatibilityEvidence> = {};
    for (const [name, sensor] of Object.entries(pack.sensors)) {
        const base = initial[name];
        const variant = base.variantId === null ? null : sensor.variants.find(candidate => candidate.id === base.variantId) ?? null;
        const probe = variant
            ? await runCompatibilityProbe(variant.probe, {
                cwd,
                toolExecutable: variant.command.executable,
                configFiles: evidence.configFiles,
                scripts: evidence.scripts,
            })
            : null;
        sensors[name] = resolveProjectCompatibility(
            { ...pack, sensors: { [name]: sensor } },
            { ...evidence, probe: probe ?? undefined },
        ).sensors[name];
    }
    return { pack, sensors };
}
