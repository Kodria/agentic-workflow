import fs from 'fs';
import type { RegistrySource } from '../../../core/registries';
import { parseSensorPack } from './contract';
import type { ParsedSensorManifest } from './manifest';
import { listPackSources, type PackSource } from './pack-source';

export type SensorSourceResolution =
    | { kind: 'logical' | 'legacy-bound' | 'legacy-rebound'; source: PackSource }
    | { kind: 'source-unavailable'; reason: 'registry-not-installed' | 'no-compatible-registry'; remedy: 'install-registry-or-run-awm-update' }
    | { kind: 'source-ambiguous'; candidates: string[]; reason: 'multiple-compatible-registries'; remedy: 'configure-one-logical-registry' };

type Dependencies = { registries: RegistrySource[] };
type V3Manifest = { kind: 'v3'; pack: { mode: string; pack: string; source: { registry: string } } };
const MAX_CANDIDATE_IDENTITIES = 32;

function unavailable(reason: 'registry-not-installed' | 'no-compatible-registry'): SensorSourceResolution {
    return { kind: 'source-unavailable', reason, remedy: 'install-registry-or-run-awm-update' };
}

function requireRegistries(deps: Dependencies): RegistrySource[] {
    if (!deps || !Array.isArray(deps.registries)) throw new Error('resolveSensorSource requires a registry inventory');
    for (const registry of deps.registries) {
        if (!registry || typeof registry.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(registry.name)
            || typeof registry.remote !== 'string' || typeof registry.contentRoot !== 'string' || registry.contentRoot.trim() === '') {
            throw new Error('resolveSensorSource received an invalid registry inventory entry');
        }
    }
    return deps.registries;
}

function compatible(source: PackSource, manifest: Extract<ParsedSensorManifest, { kind: 'v2' }>['pack']): boolean {
    let parsed: ReturnType<typeof parseSensorPack>;
    try { parsed = parseSensorPack(JSON.parse(source.content), source.path); } catch { throw new Error(`registry "${source.registry.name}" has an invalid sensor pack`); }
    if (parsed.kind !== 'v2' || parsed.pack.name !== manifest.pack) return false;
    return Object.entries(manifest.sensors).every(([name, sensor]) =>
        parsed.pack.sensors[name]?.variants.some(variant => variant.id === sensor.variantId) === true,
    );
}

/** Resolves only local registry inventory; it never fetches, probes tools, or writes. */
export function resolveSensorSource(manifest: ParsedSensorManifest | V3Manifest, deps: Dependencies): SensorSourceResolution {
    const registries = requireRegistries(deps);
    if (manifest.kind === 'v3') {
        if (!manifest.pack || manifest.pack.mode !== 'project-sensors' || typeof manifest.pack.pack !== 'string'
            || !manifest.pack.source || typeof manifest.pack.source.registry !== 'string') {
            throw new Error('sensor source resolution requires a valid project-sensors manifest');
        }
        const matches = registries.filter(entry => entry?.name === manifest.pack.source.registry);
        if (matches.length !== 1) return unavailable('registry-not-installed');
        const source = listPackSources(manifest.pack.pack, { registries: matches })[0];
        return source ? { kind: 'logical', source } : unavailable('no-compatible-registry');
    }
    if (manifest.kind !== 'v2') throw new Error('sensor source resolution requires a v2 or v3 project-sensors manifest');

    if (manifest.pack.registryRoot !== undefined && fs.existsSync(manifest.pack.registryRoot)) {
        const source = listPackSources(manifest.pack.pack, { registries: [{ name: 'manifest-provenance', remote: 'local', contentRoot: manifest.pack.registryRoot }] })[0];
        if (!source) throw new Error('existing v2 registry provenance does not contain its selected sensor pack');
        return { kind: 'legacy-bound', source };
    }
    const candidates = listPackSources(manifest.pack.pack, { registries }).filter(source => compatible(source, manifest.pack));
    if (candidates.length === 0) return unavailable('no-compatible-registry');
    if (candidates.length === 1) return { kind: 'legacy-rebound', source: candidates[0] };
    return { kind: 'source-ambiguous', candidates: candidates.map(candidate => candidate.registry.name).sort().slice(0, MAX_CANDIDATE_IDENTITIES), reason: 'multiple-compatible-registries', remedy: 'configure-one-logical-registry' };
}
