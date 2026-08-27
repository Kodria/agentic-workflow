import fs from 'fs';
import path from 'path';
import { parseSensorPack } from './compatibility/contract';
import { parseSensorManifest, serializeManifestV3, type SensorManifestV2, type SensorManifestV3ProjectSensors } from './compatibility/manifest';
import type { PackSource } from './compatibility/pack-source';

export type V2MigrationSource = { kind: 'logical'; source: PackSource };

export type V2MigrationPlan = {
    candidate: SensorManifestV3ProjectSensors;
    equivalent: true;
    equivalence: VerifiedEquivalence;
};

/** Portable, field-by-field evidence for the v2-to-v3 semantic guarantee. */
export type V2MigrationEquivalenceReport = Readonly<{
    pack: boolean;
    enabledDisabled: boolean;
    structuredCommands: boolean;
    assets: boolean;
    timeouts: boolean;
    concurrency: boolean;
    compatibilityEvidence: boolean;
    packageRoot: boolean;
    logicalSourceBinding: boolean;
}>;

type VerifiedEquivalence = Readonly<{ [Field in keyof V2MigrationEquivalenceReport]: true }>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameSensorField(v2: SensorManifestV2, v3: SensorManifestV3ProjectSensors, pick: (sensor: SensorManifestV2['sensors'][string]) => unknown): boolean {
    const names = Object.keys(v2.sensors);
    return names.length === Object.keys(v3.sensors).length
        && names.every(name => name in v3.sensors && JSON.stringify(pick(v2.sensors[name])) === JSON.stringify(pick(v3.sensors[name])));
}

function compareV2Semantics(v2: SensorManifestV2, v3: SensorManifestV3ProjectSensors, registry: string): V2MigrationEquivalenceReport {
    return Object.freeze({
        pack: v2.pack === v3.pack && v2.packSelection === v3.packSelection,
        enabledDisabled: sameSensorField(v2, v3, sensor => sensor.enabled),
        structuredCommands: sameSensorField(v2, v3, sensor => sensor.command),
        assets: sameSensorField(v2, v3, sensor => sensor.assets),
        timeouts: sameSensorField(v2, v3, sensor => sensor.timeout),
        concurrency: v2.concurrency === v3.concurrency,
        compatibilityEvidence: sameSensorField(v2, v3, sensor => sensor.initializedCompatibility),
        packageRoot: v2.packageRoot === v3.packageRoot,
        logicalSourceBinding: v3.source.registry === registry,
    });
}

function allEquivalent(report: V2MigrationEquivalenceReport): report is V2MigrationEquivalenceReport & VerifiedEquivalence {
    return Object.values(report).every(value => value === true);
}

function exactLogicalSource(input: unknown, pack: string): V2MigrationSource['source'] {
    if (!isRecord(input)) throw new Error('v2 migration source is required');
    if (input.kind === 'source-unavailable') throw new Error('v2 migration source is unavailable');
    if (input.kind === 'source-ambiguous') throw new Error('v2 migration source is ambiguous');
    if (input.kind !== 'logical' || !isRecord(input.source)) throw new Error('v2 migration source must be a unique logical resolution');
    const source = input.source;
    if (typeof source.path !== 'string' || source.path.length === 0 || typeof source.content !== 'string' || !isRecord(source.registry)) {
        throw new Error('v2 migration source must contain an exact resolved pack');
    }
    const registry = source.registry;
    if (typeof registry.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(registry.name)
        || typeof registry.remote !== 'string' || typeof registry.contentRoot !== 'string' || registry.contentRoot.trim() === '') {
        throw new Error('v2 migration source registry must be a stable logical registry');
    }
    let parsedSource;
    try { parsedSource = parseSensorPack(JSON.parse(source.content), 'v2 migration resolved source'); }
    catch { throw new Error('v2 migration source exact v2 pack is invalid'); }
    if (parsedSource.kind !== 'v2' || parsedSource.pack.name !== pack) throw new Error('v2 migration source must contain the exact v2 pack');
    return source as V2MigrationSource['source'];
}

function hasPhysicalSensorPath(value: unknown, registryRoot: string | undefined): boolean {
    if (typeof value === 'string') {
        const normalized = value.replace(/\\/g, '/').toLowerCase();
        const root = registryRoot?.replace(/\\/g, '/').toLowerCase();
        return (root !== undefined && normalized.includes(root))
            || /\/(?:home|users)\/[^/]+(?:\/|$)/.test(normalized)
            || /(?:^|[^a-z0-9])[a-z]:\/users\/[^/]+(?:\/|$)/.test(normalized);
    }
    return Array.isArray(value) ? value.some(item => hasPhysicalSensorPath(item, registryRoot))
        : isRecord(value) && Object.values(value).some(item => hasPhysicalSensorPath(item, registryRoot));
}

/** Build, but never persist, a portable v3 replacement for a validated v2 manifest. */
export function planV2Migration(input: { manifest: unknown; source: unknown }): V2MigrationPlan {
    if (!input || typeof input !== 'object') throw new Error('v2 migration input is required');
    const parsed = parseSensorManifest(input.manifest, 'v2 migration manifest');
    if (parsed.kind !== 'v2') throw new Error('v2 migration requires a v2 project-sensors manifest');
    const source = exactLogicalSource(input.source, parsed.pack.pack);
    if (hasPhysicalSensorPath(parsed.pack.sensors, parsed.pack.registryRoot)) throw new Error('v2 migration sensor semantics contain a physical path');
    const candidate = {
        schemaVersion: 3 as const,
        mode: 'project-sensors' as const,
        pack: parsed.pack.pack,
        ...(parsed.pack.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}),
        source: { registry: source.registry.name },
        ...(parsed.pack.packageRoot ? { packageRoot: parsed.pack.packageRoot } : {}),
        sensors: parsed.pack.sensors,
        ...(parsed.pack.concurrency ? { concurrency: parsed.pack.concurrency } : {}),
    };
    const validated = parseSensorManifest(candidate, 'v2 migration candidate');
    if (validated.kind !== 'v3' || validated.pack.mode !== 'project-sensors') {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    const equivalence = compareV2Semantics(parsed.pack, validated.pack, source.registry.name);
    if (!allEquivalent(equivalence)) throw new Error('v2 migration candidate semantic mismatch');
    return { candidate: validated.pack, equivalent: true, equivalence };
}

/** Validate the old and new durable contracts, then atomically replace only the manifest. */
export function replaceV2ManifestWithV3(manifestPath: unknown, candidate: unknown): void {
    if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath) || path.basename(manifestPath) !== 'sensors.json') {
        throw new Error('v2 migration manifest path must be an absolute sensors.json path');
    }
    let original: unknown;
    try { original = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { throw new Error('v2 migration original manifest must be readable JSON'); }
    const before = parseSensorManifest(original, manifestPath);
    const after = parseSensorManifest(candidate, 'v2 migration candidate');
    if (before.kind !== 'v2' || after.kind !== 'v3' || after.pack.mode !== 'project-sensors') {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    if (hasPhysicalSensorPath(before.pack.sensors, before.pack.registryRoot) || hasPhysicalSensorPath(after.pack.sensors, before.pack.registryRoot)) {
        throw new Error('v2 migration candidate contains a physical path');
    }
    if (!allEquivalent(compareV2Semantics(before.pack, after.pack, after.pack.source.registry))) {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    const directory = path.dirname(manifestPath);
    const temporary = path.join(directory, `.${path.basename(manifestPath)}.${process.pid}.${Date.now()}.tmp`);
    try {
        fs.writeFileSync(temporary, serializeManifestV3(after.pack), { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporary, manifestPath);
    } finally {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort cleanup */ }
    }
}
