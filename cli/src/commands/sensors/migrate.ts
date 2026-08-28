import fs from 'fs';
import path from 'path';
import { parseSensorPack } from './compatibility/contract';
import { parseSensorManifest, serializeManifestV3, type SensorManifestV2, type SensorManifestV3ProjectSensors } from './compatibility/manifest';
import { readInspectedBoundedFile, withNoFollowChildDirectory, withNoFollowDirectory, type SafeFileFailure } from './compatibility/safe-file';
import type { SensorSourceResolution } from './compatibility/source';

/**
 * `resolveSensorSource` establishes uniqueness before this pure planner runs.
 * Re-probing here would turn migration planning into an environment reader.
 */
type SourceBearingSensorResolution = Extract<SensorSourceResolution, { source: unknown }>;
export type V2MigrationSource = SourceBearingSensorResolution & { kind: 'logical' | 'legacy-rebound' };

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
    fast: boolean;
    variants: boolean;
    policies: boolean;
    sensorIdentityAndOrder: boolean;
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
        fast: sameSensorField(v2, v3, sensor => sensor.fast),
        variants: sameSensorField(v2, v3, sensor => sensor.variantId),
        policies: sameSensorField(v2, v3, sensor => sensor.policyRef),
        sensorIdentityAndOrder: JSON.stringify(Object.keys(v2.sensors)) === JSON.stringify(Object.keys(v3.sensors)),
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
    if ((input.kind !== 'logical' && input.kind !== 'legacy-rebound') || !isRecord(input.source)) throw new Error('v2 migration source must be a unique logical resolution');
    const source = input.source;
    if (Object.keys(source).some(key => !['path', 'content', 'registry'].includes(key))
        || typeof source.path !== 'string' || typeof source.content !== 'string' || !isRecord(source.registry)) {
        throw new Error('v2 migration source must contain an exact resolved pack');
    }
    const registry = source.registry;
    if (Object.keys(registry).some(key => !['name', 'remote', 'contentRoot'].includes(key))
        || typeof registry.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(registry.name)
        || typeof registry.remote !== 'string' || registry.remote.trim() === '' || /[\0\r\n]/.test(registry.remote)
        || typeof registry.contentRoot !== 'string' || !path.isAbsolute(registry.contentRoot) || path.normalize(registry.contentRoot) !== registry.contentRoot) {
        throw new Error('v2 migration source registry must be a stable logical registry');
    }
    let canonicalContentRoot: string;
    try { canonicalContentRoot = fs.realpathSync(registry.contentRoot); }
    catch { throw new Error('v2 migration source registry root must be canonicalizable'); }
    const expectedPath = path.join(canonicalContentRoot, 'sensor-packs', pack, 'pack.json');
    if (source.path !== expectedPath) throw new Error('v2 migration source must contain an exact resolved pack');
    let parsedSource;
    try { parsedSource = parseSensorPack(JSON.parse(source.content), 'v2 migration resolved source'); }
    catch { throw new Error('v2 migration source exact v2 pack is invalid'); }
    if (parsedSource.kind !== 'v2' || parsedSource.pack.name !== pack) throw new Error('v2 migration source must contain the exact v2 pack');
    return source as V2MigrationSource['source'];
}

function assertSourceCompatibleWithManifest(source: V2MigrationSource['source'], manifest: SensorManifestV2): void {
    let parsedSource;
    try { parsedSource = parseSensorPack(JSON.parse(source.content), 'v2 migration resolved source'); }
    catch { throw new Error('v2 migration source exact v2 pack is invalid'); }
    if (parsedSource.kind !== 'v2' || parsedSource.pack.name !== manifest.pack) {
        throw new Error('v2 migration source must contain the exact v2 pack');
    }
    for (const [name, sensor] of Object.entries(manifest.sensors)) {
        const selected = parsedSource.pack.sensors[name];
        if (!selected || !selected.variants.some(variant => variant.id === sensor.variantId)) {
            throw new Error('v2 migration source is not compatible with selected manifest sensors');
        }
    }
}

function hasPhysicalSensorPath(value: unknown, registryRoots: readonly (string | undefined)[]): boolean {
    if (typeof value === 'string') {
        const normalized = path.posix.normalize(value.replace(/\\/g, '/')).toLowerCase();
        const roots = registryRoots
            .filter((root): root is string => typeof root === 'string' && root.length > 0)
            .map(root => path.posix.normalize(root.replace(/\\/g, '/')).toLowerCase());
        const hasAbsolutePathAtTokenBoundary = /(?:^|[^A-Za-z0-9_.~\/\\-])["']?(?:\/|\\|[A-Za-z]:|\/\/)/.test(value);
        return roots.some(root => normalized.includes(root))
            || hasAbsolutePathAtTokenBoundary;
    }
    return Array.isArray(value) ? value.some(item => hasPhysicalSensorPath(item, registryRoots))
        : isRecord(value) && Object.values(value).some(item => hasPhysicalSensorPath(item, registryRoots));
}

type InspectedManifest = { stat: fs.BigIntStats; content: Buffer };

function inspectManifest(manifestPath: string, failure: (reason: SafeFileFailure) => Error): InspectedManifest {
    let stat: fs.BigIntStats;
    try { stat = fs.lstatSync(manifestPath, { bigint: true }); }
    catch { throw failure('open'); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw failure('regular');
    return { stat, content: readInspectedBoundedFile(manifestPath, stat, 1024 * 1024, failure) };
}

function assertManifestUnchanged(manifestPath: string, original: InspectedManifest): void {
    const changed = (): Error => new Error('v2 migration original manifest changed before commit');
    const current = inspectManifest(manifestPath, () => changed());
    if (current.stat.dev !== original.stat.dev || current.stat.ino !== original.stat.ino
        || current.stat.size !== original.stat.size || !current.content.equals(original.content)) {
        throw changed();
    }
}

function sameManifest(left: InspectedManifest, right: InspectedManifest): boolean {
    return left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino
        && left.stat.size === right.stat.size && left.content.equals(right.content);
}

function cleanupMigrationStaging(directory: string, files: readonly string[]): void {
    for (const file of files) {
        try { fs.unlinkSync(file); } catch { /* only remove names created in our private staging directory */ }
    }
    try { fs.rmdirSync(directory); } catch { /* best-effort cleanup of our empty staging directory */ }
}

/** Build, but never persist, a portable v3 replacement for a validated v2 manifest. */
export function planV2Migration(input: { manifest: unknown; source: unknown }): V2MigrationPlan {
    if (!input || typeof input !== 'object') throw new Error('v2 migration input is required');
    const parsed = parseSensorManifest(input.manifest, 'v2 migration manifest');
    if (parsed.kind !== 'v2') throw new Error('v2 migration requires a v2 project-sensors manifest');
    const source = exactLogicalSource(input.source, parsed.pack.pack);
    assertSourceCompatibleWithManifest(source, parsed.pack);
    if (hasPhysicalSensorPath(parsed.pack.sensors, [parsed.pack.registryRoot, source.registry.contentRoot])
        || hasPhysicalSensorPath(parsed.pack.packageRoot, [])) throw new Error('v2 migration sensor semantics contain a physical path');
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
export function replaceV2ManifestWithV3(manifestPath: unknown, candidate: unknown, source: unknown): void {
    if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath) || path.basename(manifestPath) !== 'sensors.json') {
        throw new Error('v2 migration manifest path must be an absolute sensors.json path');
    }
    const originalFailure = (_reason: SafeFileFailure): Error => new Error('v2 migration original manifest must be readable JSON');
    let inspected: InspectedManifest;
    let original: unknown;
    try {
        inspected = inspectManifest(manifestPath, originalFailure);
        original = JSON.parse(inspected.content.toString('utf8'));
    }
    catch { throw new Error('v2 migration original manifest must be readable JSON'); }
    const before = parseSensorManifest(original, manifestPath);
    const after = parseSensorManifest(candidate, 'v2 migration candidate');
    if (before.kind !== 'v2' || after.kind !== 'v3' || after.pack.mode !== 'project-sensors') {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    const logicalSource = exactLogicalSource(source, before.pack.pack);
    assertSourceCompatibleWithManifest(logicalSource, before.pack);
    if (after.pack.source.registry !== logicalSource.registry.name) {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    if (hasPhysicalSensorPath(before.pack.sensors, [before.pack.registryRoot, logicalSource.registry.contentRoot])
        || hasPhysicalSensorPath(after.pack.sensors, [before.pack.registryRoot, logicalSource.registry.contentRoot])
        || hasPhysicalSensorPath(before.pack.packageRoot, []) || hasPhysicalSensorPath(after.pack.packageRoot, [])) {
        throw new Error('v2 migration candidate contains a physical path');
    }
    if (!allEquivalent(compareV2Semantics(before.pack, after.pack, logicalSource.registry.name))) {
        throw new Error('v2 migration candidate semantic mismatch');
    }
    const directory = path.dirname(manifestPath);
    const basename = path.basename(manifestPath);
    const parentFailure = () => new Error('v2 migration manifest parent changed or contains a symlink');
    withNoFollowDirectory(directory, parentFailure, boundParent => {
        const boundManifest = path.join(boundParent, basename);
        // Re-check through the bound parent before creating any staging file.
        // This also connects the initially inspected manifest identity to the
        // authority used for all subsequent publication and cleanup paths.
        assertManifestUnchanged(boundManifest, inspected);
        const staging = fs.mkdtempSync(path.join(boundParent, `.${basename}.migrate-`));
        const stagingName = path.basename(staging);
        let preserveStaging = false;
        try {
            return withNoFollowChildDirectory(boundParent, stagingName, parentFailure, boundStaging => {
                const replacement = path.join(boundStaging, 'replacement');
                const displaced = path.join(boundStaging, 'displaced');
                fs.writeFileSync(replacement, serializeManifestV3(after.pack), { encoding: 'utf8', flag: 'wx' });
                assertManifestUnchanged(boundManifest, inspected);
                // Move the observed target aside, prove its identity, then link
                // the staged replacement into an absent name so concurrent work
                // is never overwritten.
                fs.renameSync(boundManifest, displaced);
                const moved = inspectManifest(displaced, () => new Error('v2 migration original manifest changed before commit'));
                if (!sameManifest(moved, inspected)) {
                    try { fs.linkSync(displaced, boundManifest); }
                    catch {
                        preserveStaging = true;
                        throw new Error('v2 migration original manifest changed before commit and could not be restored without clobbering a concurrent update');
                    }
                    throw new Error('v2 migration original manifest changed before commit');
                }
                try { fs.linkSync(replacement, boundManifest); }
                catch (error) {
                    try { fs.linkSync(displaced, boundManifest); }
                    catch {
                        if (fs.existsSync(boundManifest)) throw error;
                        preserveStaging = true;
                        throw new Error('v2 migration could not restore the original manifest without clobbering a concurrent update');
                    }
                    throw error;
                }
            });
        } finally {
            if (!preserveStaging) {
                const cleanupRoot = path.join(boundParent, stagingName);
                cleanupMigrationStaging(cleanupRoot, [path.join(cleanupRoot, 'replacement'), path.join(cleanupRoot, 'displaced')]);
            }
        }
    });
}
