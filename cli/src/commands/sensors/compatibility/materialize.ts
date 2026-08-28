import fs from 'fs';
import path from 'path';
import { parseSensorManifest, serializeManifestV2, serializeManifestV3, type SensorManifestV2, type SensorManifestV3ProjectSensors } from './manifest';
import { resolveSemgrepPolicy } from './contract';
import { readInspectedBoundedFile, withNoFollowChildDirectory, withNoFollowDirectory, type SafeFileFailure } from './safe-file';
import type { PackSource } from './pack-source';

type V2Sensor = SensorManifestV2['sensors'][string];
const MAX_ASSET_BYTES = 1024 * 1024;
export type MaterializeInput = {
    projectRoot: string;
    packRoot: string;
    pack: string;
    packSelection?: 'explicit';
    registryRoot?: string;
    /** Contained relative path from projectRoot to where sensors actually detect
     *  and execute (monorepo support). When set, configured assets are copied
     *  here instead of projectRoot — a config-relative tool invocation only
     *  finds its asset if it sits where the tool's cwd actually is. The
     *  manifest file itself always stays at projectRoot regardless. */
    packageRoot?: string;
    sensors: Record<string, V2Sensor>;
    configure?: boolean;
};
export type MaterializeResult = {
    manifest: SensorManifestV2;
    configured: string[];
    preserved: string[];
    orphaned: string[];
};
export type PortableMaterializeInput = Omit<MaterializeInput, 'registryRoot' | 'packRoot'> & { source: PackSource };
export type PortableMaterializeResult = Omit<MaterializeResult, 'manifest'> & { manifest: SensorManifestV3ProjectSensors };

function stableId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`${label} must be a stable lowercase id`);
    return value;
}

function containedAsset(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || path.isAbsolute(value) || /^(?:[A-Za-z]:|[\\/])/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${label} must be a contained relative asset path`);
    return value;
}

function root(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty path`);
    const resolved = path.resolve(value);
    try {
        if (!fs.statSync(resolved).isDirectory()) throw new Error();
    } catch { throw new Error(`${label} must be an existing directory`); }
    return resolved;
}

function registryPackRoot(value: unknown): string {
    const resolved = root(value, 'packRoot');
    const parsed = path.parse(resolved);
    let current = parsed.root;
    for (const component of path.relative(parsed.root, resolved).split(path.sep).filter(Boolean)) {
        let stat: fs.Stats;
        try { stat = fs.lstatSync(current); } catch { throw new Error('packRoot must be an existing directory'); }
        if (stat.isSymbolicLink()) throw new Error('packRoot contains a symlink');
        current = path.join(current, component);
    }
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch { throw new Error('packRoot must be an existing directory'); }
    if (stat.isSymbolicLink()) throw new Error('packRoot contains a symlink');
    return resolved;
}

function withSafeProjectDestination<T>(configRoot: string, asset: string, createParents: boolean, operation: (destination: string, directory: string) => T): T {
    const failure = () => new Error(`project destination contains a symlink or unavailable component: ${asset}`);
    const descend = (directory: string, components: string[]): T => {
        const component = components.shift();
        if (!component) return operation(path.join(directory, asset.split('/').at(-1)!), directory);
        const next = path.join(directory, component);
        if (createParents) {
            try { fs.mkdirSync(next); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        return withNoFollowChildDirectory(directory, component, failure, bound => descend(bound, components));
    };
    return withNoFollowDirectory(configRoot, failure, rootDirectory => descend(rootDirectory, asset.split('/').slice(0, -1)));
}

function destinationExists(destination: string, asset: string): boolean {
    try {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink()) throw new Error(`project destination contains a symlink: ${asset}`);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function atomicWrite(configRoot: string, asset: string, content: string, noClobber = false): void {
    withSafeProjectDestination(configRoot, asset, true, (destination, directory) => {
        if (noClobber && destinationExists(destination, asset)) throw new Error(`project manifest already exists and will not be overwritten: ${asset}`);
        const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
        let ownsTemporary = false;
        try {
            fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
            ownsTemporary = true;
            if (noClobber) fs.linkSync(temporary, destination);
            else fs.renameSync(temporary, destination);
            ownsTemporary = false;
        } finally {
            try { if (ownsTemporary) fs.unlinkSync(temporary); } catch { /* bound directory prevents redirected cleanup */ }
        }
    });
}

/** Publish a new asset without ever replacing an owner-created destination. */
function atomicCreateAsset(configRoot: string, asset: string, content: string): fs.BigIntStats | undefined {
    return withSafeProjectDestination(configRoot, asset, true, (destination, directory) => {
        if (destinationExists(destination, asset)) return undefined;
        const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
        let ownsTemporary = false;
        try {
            fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
            ownsTemporary = true;
            try { fs.linkSync(temporary, destination); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
                throw error;
            }
            return fs.lstatSync(destination, { bigint: true });
        } finally {
            try { if (ownsTemporary) fs.unlinkSync(temporary); } catch { /* bound directory prevents redirected cleanup */ }
        }
    });
}

function removeCreatedAsset(configRoot: string, asset: string, created: fs.BigIntStats): void {
    try {
        withSafeProjectDestination(configRoot, asset, false, destination => {
            const current = fs.lstatSync(destination, { bigint: true });
            if (current.isFile() && !current.isSymbolicLink() && current.dev === created.dev && current.ino === created.ino) fs.unlinkSync(destination);
        });
    } catch { /* best effort rollback never follows a swapped project ancestor */ }
}

function selectedRegistryAsset(packRoot: string, asset: string): { file: string; stat: fs.BigIntStats } {
    let current = packRoot;
    for (const [index, component] of asset.split('/').entries()) {
        let stat: fs.BigIntStats;
        try { stat = fs.lstatSync(current, { bigint: true }); } catch { throw new Error(`selected asset is missing from pack: ${asset}`); }
        if (stat.isSymbolicLink()) throw new Error(`selected asset contains a symlink: ${asset}`);
        if (index < asset.split('/').length - 1 && !stat.isDirectory()) throw new Error(`selected asset is missing from pack: ${asset}`);
        current = path.join(current, component);
    }
    let stat: fs.BigIntStats;
    try { stat = fs.lstatSync(current, { bigint: true }); } catch { throw new Error(`selected asset is missing from pack: ${asset}`); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`selected asset must be a regular file: ${asset}`);
    if (stat.size > BigInt(MAX_ASSET_BYTES)) throw new Error(`selected asset exceeds the 1 MiB limit: ${asset}`);
    return { file: current, stat };
}

function readSelectedRegistryAsset(packRoot: string, selected: { file: string; stat: fs.BigIntStats }, asset: string): string {
    // Re-walk the bounded parent chain immediately before the leaf-safe-open.
    // A replaced ancestor can otherwise redirect the same pathname outside the
    // inspected registry between selection and the O_NOFOLLOW leaf open.
    const current = selectedRegistryAsset(packRoot, asset);
    if (current.stat.dev !== selected.stat.dev || current.stat.ino !== selected.stat.ino) {
        throw new Error(`selected asset changed identity during safe open: ${asset}`);
    }
    const failure = (reason: SafeFileFailure): Error => {
        if (reason === 'open') return new Error(`selected asset cannot be safely opened: ${asset}`);
        if (reason === 'regular') return new Error(`selected asset must be a regular file: ${asset}`);
        if (reason === 'identity') return new Error(`selected asset changed identity during safe open: ${asset}`);
        if (reason === 'size') return new Error(`selected asset changed size during safe open: ${asset}`);
        return new Error(`selected asset exceeds the 1 MiB limit: ${asset}`);
    };
    return readInspectedBoundedFile(selected.file, selected.stat, MAX_ASSET_BYTES, failure).toString('utf8');
}

function portableSource(source: unknown, pack: string): { registry: string; packRoot: string } {
    if (!source || typeof source !== 'object') throw new Error('portable source is required');
    const candidate = source as Partial<PackSource>;
    if (!candidate.registry || typeof candidate.registry !== 'object' || typeof candidate.registry.name !== 'string' || typeof candidate.registry.contentRoot !== 'string' || typeof candidate.path !== 'string') {
        throw new Error('portable source must be a validated pack source');
    }
    const registry = stableId(candidate.registry.name, 'source.registry.name');
    const configuredRoot = root(candidate.registry.contentRoot, 'source.registry.contentRoot');
    let contentRoot: string;
    try { contentRoot = fs.realpathSync(configuredRoot); } catch { throw new Error('source.registry.contentRoot must be canonicalizable'); }
    const packRoot = registryPackRoot(path.join(contentRoot, 'sensor-packs', pack));
    const expectedPack = path.join(packRoot, 'pack.json');
    if (path.resolve(candidate.path) !== expectedPack) throw new Error('portable source selected pack path does not match its registry');
    return { registry, packRoot };
}

function priorAssets(projectRoot: string): string[] {
    const manifest = path.join(projectRoot, '.awm', 'sensors.json');
    if (!fs.existsSync(manifest)) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { throw new Error(`cannot materialize over invalid sensor manifest ${manifest}`); }
    const parsedManifest = parseSensorManifest(parsed, manifest);
    if (parsedManifest.kind === 'v2') return Object.values(parsedManifest.pack.sensors).flatMap(sensor => sensor.assets ?? []);
    if (parsedManifest.kind === 'v3' && parsedManifest.pack.mode === 'project-sensors') return Object.values(parsedManifest.pack.sensors).flatMap(sensor => sensor.assets ?? []);
    return [];
}

/** Materialize a previously selected logical registry source into a portable v3 manifest. */
export function materializePortableSensors(input: PortableMaterializeInput): PortableMaterializeResult {
    if (!input || typeof input !== 'object') throw new Error('materialization input is required');
    const projectRoot = root(input.projectRoot, 'projectRoot');
    const pack = stableId(input.pack, 'pack');
    const source = portableSource(input.source, pack);
    const packRoot = source.packRoot;
    if (!input.sensors || typeof input.sensors !== 'object' || Array.isArray(input.sensors)) throw new Error('sensors must be an object');
    const candidate = {
        schemaVersion: 3 as const, mode: 'project-sensors' as const, pack,
        ...(input.packSelection === 'explicit' ? { packSelection: 'explicit' as const } : {}),
        source: { registry: source.registry },
        ...(input.packageRoot ? { packageRoot: containedAsset(input.packageRoot, 'packageRoot') } : {}),
        sensors: input.sensors,
    };
    const parsed = parseSensorManifest(candidate, 'portable materialized manifest');
    if (parsed.kind !== 'v3' || parsed.pack.mode !== 'project-sensors') throw new Error('portable materialized manifest must be v3 project-sensors');
    const manifest = parsed.pack;
    const configRoot = manifest.packageRoot ? root(path.join(projectRoot, manifest.packageRoot), 'packageRoot') : projectRoot;
    for (const [name, sensor] of Object.entries(manifest.sensors)) {
        if (sensor.policyRef) resolveSemgrepPolicy(sensor.policyRef, path.join(packRoot, 'pack.json'), `sensors.${name}`);
    }
    const selected = [...new Set(Object.values(manifest.sensors).flatMap(sensor => sensor.assets ?? []))].map((asset, index) => containedAsset(asset, `assets[${index}]`)).sort();
    const prior = priorAssets(projectRoot);
    const configured: string[] = []; const preserved: string[] = []; const created: Array<{ asset: string; stat: fs.BigIntStats }> = [];
    try {
        if (input.configure !== false) {
            for (const asset of selected) {
                const selectedSource = selectedRegistryAsset(packRoot, asset);
                const createdAsset = atomicCreateAsset(configRoot, asset, readSelectedRegistryAsset(packRoot, selectedSource, asset));
                if (createdAsset) {
                    created.push({ asset, stat: createdAsset }); configured.push(asset);
                } else preserved.push(asset);
            }
        }
        atomicWrite(projectRoot, '.awm/sensors.json', serializeManifestV3(manifest), true);
    } catch (error) {
        for (const file of created.reverse()) removeCreatedAsset(configRoot, file.asset, file.stat);
        throw error;
    }
    return { manifest, configured, preserved, orphaned: prior.filter(asset => !selected.includes(asset)).sort() };
}

/** Write a selected, v2-only sensor configuration without overwriting user files.
 * The manifest is the commit point: created assets are removed best-effort if writing it fails. */
export function materializeResolvedSensors(input: MaterializeInput): MaterializeResult {
    if (!input || typeof input !== 'object') throw new Error('materialization input is required');
    const projectRoot = root(input.projectRoot, 'projectRoot');
    const packRoot = registryPackRoot(input.packRoot);
    const pack = stableId(input.pack, 'pack');
    if (!input.sensors || typeof input.sensors !== 'object' || Array.isArray(input.sensors)) throw new Error('sensors must be an object');
    const sensors: Record<string, V2Sensor> = {};
    for (const [name, sensor] of Object.entries(input.sensors)) {
        stableId(name, 'sensor id');
        // Reuse the durable parser as the single schema boundary before persisting.
        const parsed = parseSensorManifest({ schemaVersion: 2, pack, sensors: { [name]: sensor } }, 'materialized sensor');
        if (parsed.kind !== 'v2') throw new Error('materialized sensor must be v2');
        sensors[name] = parsed.pack.sensors[name];
    }
    const manifest: SensorManifestV2 = { schemaVersion: 2, pack, sensors, ...(input.packSelection === 'explicit' ? { packSelection: 'explicit' } : {}), ...(input.registryRoot ? { registryRoot: input.registryRoot } : {}), ...(input.packageRoot ? { packageRoot: containedAsset(input.packageRoot, 'packageRoot') } : {}) };
    // Assets land where sensors will actually run — projectRoot by default, or
    // packageRoot underneath it for a monorepo. The manifest write below stays
    // pinned to projectRoot either way (see atomicWrite call at the end).
    const configRoot = manifest.packageRoot ? root(path.join(projectRoot, manifest.packageRoot), 'packageRoot') : projectRoot;
    // A policy reference is deliberately not a materialized asset. Resolve it here
    // from the registry-owned sibling only, so a manifest cannot turn arbitrary
    // registry content into a project write through a cosmetic policy field.
    for (const [name, sensor] of Object.entries(sensors)) {
        if (sensor.policyRef) resolveSemgrepPolicy(sensor.policyRef, path.join(packRoot, 'pack.json'), `sensors.${name}`);
    }
    const selected = [...new Set(Object.values(sensors).flatMap(sensor => sensor.assets ?? []))].map((asset, index) => containedAsset(asset, `assets[${index}]`)).sort();
    const prior = priorAssets(projectRoot);
    const configured: string[] = [];
    const preserved: string[] = [];
    const created: Array<{ asset: string; stat: fs.BigIntStats }> = [];
    try {
        if (input.configure !== false) {
            for (const asset of selected) {
                const selectedSource = selectedRegistryAsset(packRoot, asset);
                const createdAsset = atomicCreateAsset(configRoot, asset, readSelectedRegistryAsset(packRoot, selectedSource, asset));
                if (createdAsset) {
                    created.push({ asset, stat: createdAsset });
                    configured.push(asset);
                } else preserved.push(asset);
            }
        }
        atomicWrite(projectRoot, '.awm/sensors.json', serializeManifestV2(manifest));
    } catch (error) {
        for (const file of created.reverse()) removeCreatedAsset(configRoot, file.asset, file.stat);
        throw error;
    }
    return { manifest, configured, preserved, orphaned: prior.filter(asset => !selected.includes(asset)).sort() };
}
