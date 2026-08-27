import fs from 'fs';
import path from 'path';
import { parseSensorManifest, serializeManifestV3, type SensorManifestV2, type SensorManifestV3ProjectSensors } from './compatibility/manifest';

export type V2MigrationSource =
    | { kind: 'logical'; registry: string; pack?: string }
    | { kind: 'source-unavailable' }
    | { kind: 'source-ambiguous' };

export type V2MigrationPlan = {
    candidate: SensorManifestV3ProjectSensors;
    equivalent: true;
};

function sameV2Semantics(v2: SensorManifestV2, v3: SensorManifestV3ProjectSensors): boolean {
    return v2.pack === v3.pack
        && v2.packSelection === v3.packSelection
        && v2.packageRoot === v3.packageRoot
        && v2.concurrency === v3.concurrency
        && JSON.stringify(v2.sensors) === JSON.stringify(v3.sensors);
}

/** Build, but never persist, a portable v3 replacement for a validated v2 manifest. */
export function planV2Migration(input: { manifest: unknown; source: unknown }): V2MigrationPlan {
    if (!input || typeof input !== 'object') throw new Error('v2 migration input is required');
    const parsed = parseSensorManifest(input.manifest, 'v2 migration manifest');
    if (parsed.kind !== 'v2') throw new Error('v2 migration requires a v2 project-sensors manifest');
    if (!input.source || typeof input.source !== 'object' || Array.isArray(input.source)) throw new Error('v2 migration source is required');
    const source = input.source as Record<string, unknown>;
    if (source.kind === 'source-unavailable') throw new Error('v2 migration source is unavailable');
    if (source.kind === 'source-ambiguous') throw new Error('v2 migration source is ambiguous');
    if (source.kind !== 'logical') throw new Error('v2 migration source is invalid');
    if (typeof source.registry !== 'string' || !/^[a-z][a-z0-9-]*$/.test(source.registry)) throw new Error('v2 migration source registry must be a stable lowercase id');
    if (source.pack !== undefined && source.pack !== parsed.pack.pack) throw new Error('v2 migration source pack mismatch');
    const candidate = {
        schemaVersion: 3 as const,
        mode: 'project-sensors' as const,
        pack: parsed.pack.pack,
        ...(parsed.pack.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}),
        source: { registry: source.registry },
        ...(parsed.pack.packageRoot ? { packageRoot: parsed.pack.packageRoot } : {}),
        sensors: parsed.pack.sensors,
        ...(parsed.pack.concurrency ? { concurrency: parsed.pack.concurrency } : {}),
    };
    const validated = parseSensorManifest(candidate, 'v2 migration candidate');
    if (validated.kind !== 'v3' || validated.pack.mode !== 'project-sensors' || !sameV2Semantics(parsed.pack, validated.pack)) {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    return { candidate: validated.pack, equivalent: true };
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
    if (before.kind !== 'v2' || after.kind !== 'v3' || after.pack.mode !== 'project-sensors' || !sameV2Semantics(before.pack, after.pack)) {
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
