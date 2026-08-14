import fs from 'fs';
import path from 'path';
import { parseSensorManifest, serializeManifestV2, type SensorManifestV2 } from './manifest';
import { resolveSemgrepPolicy } from './contract';

type V2Sensor = SensorManifestV2['sensors'][string];
export type MaterializeInput = {
    projectRoot: string;
    packRoot: string;
    pack: string;
    registryRoot?: string;
    sensors: Record<string, V2Sensor>;
    configure?: boolean;
};
export type MaterializeResult = {
    manifest: SensorManifestV2;
    configured: string[];
    preserved: string[];
    orphaned: string[];
};

function stableId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`${label} must be a stable lowercase id`);
    return value;
}

function containedAsset(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${label} must be a contained relative asset path`);
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

function atomicWrite(destination: string, content: string): void {
    const directory = path.dirname(destination);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporary, destination);
    } finally {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* best effort cleanup */ }
    }
}

function priorAssets(projectRoot: string): string[] {
    const manifest = path.join(projectRoot, '.awm', 'sensors.json');
    if (!fs.existsSync(manifest)) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch { throw new Error(`cannot materialize over invalid sensor manifest ${manifest}`); }
    const parsedManifest = parseSensorManifest(parsed, manifest);
    if (parsedManifest.kind !== 'v2') return [];
    return Object.values(parsedManifest.pack.sensors).flatMap(sensor => sensor.assets ?? []);
}

/** Write a selected, v2-only sensor configuration without overwriting user files.
 * The manifest is the commit point: created assets are removed best-effort if writing it fails. */
export function materializeResolvedSensors(input: MaterializeInput): MaterializeResult {
    if (!input || typeof input !== 'object') throw new Error('materialization input is required');
    const projectRoot = root(input.projectRoot, 'projectRoot');
    const packRoot = root(input.packRoot, 'packRoot');
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
    const manifest: SensorManifestV2 = { schemaVersion: 2, pack, sensors, ...(input.registryRoot ? { registryRoot: input.registryRoot } : {}) };
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
    const created: string[] = [];
    try {
        if (input.configure !== false) {
            for (const asset of selected) {
                const source = path.join(packRoot, ...asset.split('/'));
                const destination = path.join(projectRoot, ...asset.split('/'));
                let stat: fs.Stats;
                try { stat = fs.lstatSync(source); } catch { throw new Error(`selected asset is missing from pack: ${asset}`); }
                if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`selected asset must be a regular file: ${asset}`);
                if (fs.existsSync(destination)) { preserved.push(asset); continue; }
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                atomicWrite(destination, fs.readFileSync(source, 'utf8'));
                created.push(destination);
                configured.push(asset);
            }
        }
        atomicWrite(path.join(projectRoot, '.awm', 'sensors.json'), serializeManifestV2(manifest));
    } catch (error) {
        for (const file of created.reverse()) {
            try { fs.unlinkSync(file); } catch { /* best effort transaction rollback */ }
        }
        throw error;
    }
    return { manifest, configured, preserved, orphaned: prior.filter(asset => !selected.includes(asset)).sort() };
}
