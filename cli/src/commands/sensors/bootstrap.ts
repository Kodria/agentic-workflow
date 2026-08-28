import { listRegistries } from '../../core/registries';
import { parseSensorPack } from './compatibility/contract';
import { parseSensorManifest, serializeManifestV3, type SensorManifestV3, type SensorManifestV3ProjectSensors } from './compatibility/manifest';
import { listPackSources, type PackSource } from './compatibility/pack-source';
import { resolveParsedPackCompatibility } from './compatibility/live';
import { resolveSensorSource } from './compatibility/source';
import { detectStack } from './detection';
import { planV2Migration, type V2MigrationPlan } from './migrate';
import { resolveSensorProject } from './project';
import { materializePortableSensors } from './compatibility/materialize';
import { replaceV2ManifestWithV3 } from './migrate';
import { withProjectLease, writeProjectFile } from './compatibility/safe-file';
import fs from 'fs';
import { createHash } from 'crypto';
import path from 'path';

export type BootstrapMode = 'project-sensors' | 'native-gate' | 'opt-out';
export type BootstrapOptions = { mode?: BootstrapMode; reason?: string; dryRun?: boolean; registryRoot?: string; configure?: boolean; pack?: string; packageRoot?: string };
export type BootstrapChange = Readonly<{ path: '.awm/sensors.json' | string; action: 'create' | 'replace' }>;
export type BootstrapPlan =
    | Readonly<{ kind: 'noop'; projectRoot: string; manifestPath: string; changes: []; dryRun: boolean }>
    | Readonly<{ kind: 'blocked'; projectRoot: string; manifestPath: string; changes: []; dryRun: boolean; reason: string; remedy: string; candidates?: string[] }>
    | Readonly<{ kind: 'create'; projectRoot: string; manifestPath: string; changes: BootstrapChange[]; dryRun: boolean; manifest: SensorManifestV3; source?: PackSource; configure?: boolean }>
    | Readonly<{ kind: 'migrate'; projectRoot: string; manifestPath: string; changes: [BootstrapChange]; dryRun: boolean; migration: V2MigrationPlan; source: unknown; originalDigest: string }>;

function blocked(projectRoot: string, manifestPath: string, dryRun: boolean, reason: string, remedy: string, candidates?: string[]): BootstrapPlan {
    return { kind: 'blocked', projectRoot, manifestPath, changes: [], dryRun, reason, remedy, ...(candidates ? { candidates } : {}) };
}

function options(input: unknown): Required<Pick<BootstrapOptions, 'dryRun'>> & BootstrapOptions {
    if (input === undefined) return { dryRun: false };
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('bootstrap options must be an object');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !['mode', 'reason', 'dryRun', 'registryRoot', 'configure', 'pack', 'packageRoot'].includes(key))) throw new Error('bootstrap options contain an unknown field');
    if (value.mode !== undefined && value.mode !== 'project-sensors' && value.mode !== 'native-gate' && value.mode !== 'opt-out') throw new Error('bootstrap mode must be project-sensors, native-gate, or opt-out');
    if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.trim() === '' || value.reason.length > 512 || /[\0\r\n]/.test(value.reason))) throw new Error('bootstrap reason must be a nonempty bounded single-line string');
    if (value.dryRun !== undefined && typeof value.dryRun !== 'boolean') throw new Error('bootstrap dryRun must be a boolean');
    if (value.configure !== undefined && typeof value.configure !== 'boolean') throw new Error('bootstrap configure must be a boolean');
    if (value.registryRoot !== undefined && (typeof value.registryRoot !== 'string' || (!path.isAbsolute(value.registryRoot) && !path.win32.isAbsolute(value.registryRoot)) || /[\0\r\n]/.test(value.registryRoot))) throw new Error('bootstrap registryRoot must be an absolute single-line path');
    if (value.pack !== undefined && (typeof value.pack !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value.pack))) throw new Error('bootstrap pack must be a stable lowercase id');
    if (value.packageRoot !== undefined && (typeof value.packageRoot !== 'string' || value.packageRoot.length === 0 || value.packageRoot.includes('\\') || value.packageRoot.split('/').some(part => part === '' || part === '.' || part === '..'))) throw new Error('bootstrap packageRoot must be a contained relative path');
    return { mode: value.mode as BootstrapMode | undefined, reason: value.reason as string | undefined, dryRun: value.dryRun === true, registryRoot: value.registryRoot as string | undefined, configure: value.configure !== false, pack: value.pack as string | undefined, packageRoot: value.packageRoot as string | undefined };
}

function declaration(mode: Exclude<BootstrapMode, 'project-sensors'>, reason: string): SensorManifestV3 {
    return { schemaVersion: 3, mode, reason };
}

function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function projectSensors(projectRoot: string, registryRoot?: string, requestedPack?: string, packageRoot?: string): Promise<{ manifest: SensorManifestV3ProjectSensors; source: PackSource; changes: BootstrapChange[] } | { reason: string; remedy: string; candidates?: string[] }> {
    const detectionRoot = packageRoot ? path.resolve(projectRoot, packageRoot) : projectRoot;
    const detected = detectStack(detectionRoot);
    const pack = requestedPack ?? detected.pack;
    const registries = listRegistries();
    const selected = registryRoot === undefined ? registries : registries.filter(registry => registry.contentRoot === registryRoot);
    if (registryRoot !== undefined && selected.length !== 1) return { reason: 'registry-root-not-configured', remedy: 'configure-the-registry-before-bootstrap' };
    const sources = listPackSources(pack, { registries: selected });
    if (sources.length === 0) return { reason: 'source-unavailable', remedy: 'install-registry-or-run-awm-update' };
    if (sources.length !== 1) return { reason: 'source-ambiguous', remedy: 'configure-one-logical-registry', candidates: sources.map(item => item.registry.name).sort().slice(0, 32) };
    const source = sources[0];
    let parsed;
    try { parsed = parseSensorPack(JSON.parse(source.content), source.path); }
    catch { return { reason: 'source-invalid', remedy: 'repair-or-run-awm-update' }; }
    if (parsed.kind !== 'v2') return { reason: 'source-unsupported', remedy: 'install-a-v2-sensor-pack' };
    let live;
    try { live = await resolveParsedPackCompatibility(projectRoot, parsed.pack); }
    catch { return { reason: 'compatibility-unresolvable', remedy: 'repair-project-tools-or-select-another-mode' }; }
    const sensors: SensorManifestV3ProjectSensors['sensors'] = {};
    for (const [name, packSensor] of Object.entries(live.pack.sensors)) {
        const evidence = live.sensors[name];
        const variant = evidence.variantId === null ? undefined : packSensor.variants.find(item => item.id === evidence.variantId);
        if (!variant) return { reason: 'sensor-variant-unresolvable', remedy: 'repair-project-tools-or-select-another-mode' };
        sensors[name] = { enabled: true, ...(packSensor.fast === undefined ? {} : { fast: packSensor.fast }), ...(packSensor.timeout === undefined ? {} : { timeout: packSensor.timeout }), variantId: variant.id, command: variant.command, ...(variant.assets.length === 0 ? {} : { assets: variant.assets }), ...(variant.policyRef ? { policyRef: variant.policyRef } : {}), initializedCompatibility: evidence };
    }
    const manifest = parseSensorManifest({ schemaVersion: 3, mode: 'project-sensors', pack, source: { registry: source.registry.name }, ...(packageRoot ? { packageRoot } : {}), sensors }, 'bootstrap candidate');
    if (manifest.kind !== 'v3' || manifest.pack.mode !== 'project-sensors') throw new Error('bootstrap project-sensors candidate is invalid');
    serializeManifestV3(manifest.pack);
    const assets = [...new Set(Object.values(sensors).flatMap(sensor => sensor.assets ?? []))].sort();
    return { manifest: manifest.pack, source, changes: [{ path: '.awm/sensors.json', action: 'create' }, ...assets.map(asset => ({ path: packageRoot ? `${packageRoot}/${asset}` : asset, action: 'create' as const }))] };
}

/** Plan a one-time portable bootstrap. This function never writes project or machine state. */
export async function planSensorBootstrap(cwd: string = process.cwd(), input: BootstrapOptions = {}): Promise<BootstrapPlan> {
    const opts = options(input);
    const project = resolveSensorProject(cwd);
    if (project.state === 'invalid') return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'manifest-invalid', 'repair-sensor-manifest');
    if (project.state === 'configured') {
        if (project.manifest.kind === 'v3') {
            if (opts.mode !== undefined && opts.mode !== project.manifest.pack.mode) {
                return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'mode-conflicts-with-existing-declaration', 'run-bootstrap-without-mode');
            }
            return { kind: 'noop', projectRoot: project.projectRoot, manifestPath: project.manifestPath, changes: [], dryRun: opts.dryRun };
        }
        if (project.manifest.kind === 'legacy') return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'legacy-v1-preserved', 'migrate-the-manifest-explicitly');
        let source;
        try { source = resolveSensorSource(project.manifest, { registries: listRegistries() }); }
        catch { return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'source-invalid', 'repair-or-run-awm-update'); }
        if (!('source' in source)) return blocked(project.projectRoot, project.manifestPath, opts.dryRun, source.reason, source.remedy);
        try {
            const original = fs.readFileSync(project.manifestPath);
            return { kind: 'migrate', projectRoot: project.projectRoot, manifestPath: project.manifestPath, changes: [{ path: '.awm/sensors.json', action: 'replace' }], dryRun: opts.dryRun, migration: planV2Migration({ manifest: project.manifest.pack, source }), source, originalDigest: digest(original) };
        }
        catch { return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'migration-not-equivalent', 'repair-or-select-one-compatible-registry'); }
    }
    if (!opts.mode) return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'mode-required', 'choose-project-sensors-native-gate-or-opt-out');
    if (opts.mode !== 'project-sensors') {
        if (!opts.reason) return blocked(project.projectRoot, project.manifestPath, opts.dryRun, 'reason-required', 'provide-a-versioned-reason');
        return { kind: 'create', projectRoot: project.projectRoot, manifestPath: project.manifestPath, changes: [{ path: '.awm/sensors.json', action: 'create' }], dryRun: opts.dryRun, manifest: declaration(opts.mode, opts.reason), configure: opts.configure };
    }
    const planned = await projectSensors(project.projectRoot, opts.registryRoot, opts.pack, opts.packageRoot);
    if ('reason' in planned) return blocked(project.projectRoot, project.manifestPath, opts.dryRun, planned.reason, planned.remedy, 'candidates' in planned ? planned.candidates : undefined);
    return { kind: 'create', projectRoot: project.projectRoot, manifestPath: project.manifestPath, changes: planned.changes, dryRun: opts.dryRun, manifest: planned.manifest, source: planned.source, configure: opts.configure };
}

/** Apply only a validated, non-dry-run create or migration plan. */
export function applySensorBootstrap(plan: BootstrapPlan): 'created' | 'migrated' {
    if (!plan || typeof plan !== 'object') throw new Error('bootstrap plan is required');
    if (plan.kind !== 'create' && plan.kind !== 'migrate') throw new Error('only a create or migrate bootstrap plan can be applied');
    if (plan.dryRun) throw new Error('a dry-run bootstrap plan cannot be applied');
    if (plan.kind === 'migrate') {
        const current = fs.readFileSync(plan.manifestPath);
        if (digest(current) !== plan.originalDigest) throw new Error('bootstrap migration plan is stale: manifest changed after planning');
        replaceV2ManifestWithV3(plan.manifestPath, plan.migration.candidate, plan.source);
        return 'migrated';
    }
    if (plan.manifest.mode === 'project-sensors') {
        if (!plan.source) throw new Error('project-sensors bootstrap plan requires its resolved source');
        materializePortableSensors({ projectRoot: plan.projectRoot, pack: plan.manifest.pack, source: plan.source, ...(plan.manifest.packageRoot ? { packageRoot: plan.manifest.packageRoot } : {}), sensors: plan.manifest.sensors, configure: plan.configure !== false });
        return 'created';
    }
    const parsed = parseSensorManifest(plan.manifest, 'bootstrap declaration');
    if (parsed.kind !== 'v3' || parsed.pack.mode === 'project-sensors') throw new Error('bootstrap declaration plan is invalid');
    withProjectLease(plan.projectRoot, () => {
        writeProjectFile(plan.projectRoot, '.awm/sensors.json', Buffer.from(serializeManifestV3(parsed.pack), 'utf8'), { mode: 'create', createParents: true });
    });
    return 'created';
}
