import fs from 'fs';
import path from 'path';
import { listRegistries, type RegistrySource } from '../../../core/registries';

const MAX_PACK_BYTES = 1024 * 1024;
const MAX_DIAGNOSTIC_IDENTITY_LENGTH = 128;

export type PackSource = { path: string; content: string; registry: RegistrySource };

function diagnosticRegistryName(name: string): string {
    return name.length <= MAX_DIAGNOSTIC_IDENTITY_LENGTH
        ? name
        : `${name.slice(0, MAX_DIAGNOSTIC_IDENTITY_LENGTH - 3)}...`;
}

function validPackName(pack: unknown): pack is string {
    return typeof pack === 'string' && /^[a-z][a-z0-9-]*$/.test(pack);
}

function contained(root: string, candidate: string): boolean {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return candidate.startsWith(prefix);
}

/** Walk each component under contentRoot with lstat: realpath alone would hide an
 * internal symlink whose target happens to remain inside the registry. */
function inspectContainedPack(root: string, pack: string, registryName: string): { candidate: string; stat: fs.Stats } | undefined {
    let rootStat: fs.Stats;
    try { rootStat = fs.lstatSync(root); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error(`registry "${registryName}" pack source root cannot be inspected`);
    }
    if (rootStat.isSymbolicLink()) throw new Error(`registry "${registryName}" pack source root must not be a symbolic link`);
    if (!rootStat.isDirectory()) throw new Error(`registry "${registryName}" pack source root must be a regular directory`);
    const components = ['sensor-packs', pack, 'pack.json'];
    let candidate = root;
    for (let index = 0; index < components.length; index++) {
        candidate = path.join(candidate, components[index]);
        let stat: fs.Stats;
        try { stat = fs.lstatSync(candidate); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') throw new Error(`registry "${registryName}" pack source has a non-regular or symbolic parent`);
            throw new Error(`registry "${registryName}" pack source cannot be inspected`);
        }
        if (stat.isSymbolicLink()) throw new Error(`registry "${registryName}" pack source must not contain symbolic links`);
        if (index < components.length - 1 && !stat.isDirectory()) throw new Error(`registry "${registryName}" pack source has a non-regular parent`);
        if (index === components.length - 1) return { candidate, stat };
    }
    throw new Error('pack source component walk did not reach pack.json');
}

function readContainedPack(real: string, inspected: fs.Stats, registryName: string): string {
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw new Error(`registry "${registryName}" pack source no-follow open is unavailable`);
    let descriptor: number;
    try {
        descriptor = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch {
        throw new Error(`registry "${registryName}" pack source cannot be safely opened`);
    }
    try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile()) throw new Error(`registry "${registryName}" pack source must be a contained regular file, never a symbolic link`);
        if (stat.dev !== inspected.dev || stat.ino !== inspected.ino) throw new Error(`registry "${registryName}" pack source changed identity during safe open`);
        if (stat.size !== inspected.size) throw new Error(`registry "${registryName}" pack source changed size during safe open`);
        if (stat.size > MAX_PACK_BYTES) throw new Error(`registry "${registryName}" pack source exceeds the 1 MiB limit`);
        return fs.readFileSync(descriptor, 'utf8');
    } finally {
        fs.closeSync(descriptor);
    }
}

/** Resolve only an exact, regular pack.json beneath the first configured registry.
 * Registry order is authority; an unsafe claimed source is a hard failure, not a fallback. */
export function listPackSources(pack: unknown, options: { registries?: RegistrySource[] } = {}): PackSource[] {
    if (!validPackName(pack)) throw new Error('pack name must be a stable lowercase id');
    const registries = options.registries ?? listRegistries();
    if (!Array.isArray(registries)) throw new Error('registries must be an array');
    const sources: PackSource[] = [];
    for (const registry of registries) {
        if (!registry || typeof registry.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(registry.name) || typeof registry.contentRoot !== 'string' || registry.contentRoot.trim() === '') throw new Error('registry has an invalid identity or content root');
        const registryName = diagnosticRegistryName(registry.name);
        const inspected = inspectContainedPack(registry.contentRoot, pack, registryName);
        if (!inspected) continue;
        const { candidate, stat } = inspected;
        if (!stat.isFile()) throw new Error(`registry "${registryName}" pack source must be a contained regular file, never a symbolic link`);
        if (stat.size > MAX_PACK_BYTES) throw new Error(`registry "${registryName}" pack source exceeds the 1 MiB limit`);
        let root: string; let real: string;
        try { root = fs.realpathSync(registry.contentRoot); real = fs.realpathSync(candidate); } catch { throw new Error(`registry "${registryName}" pack source cannot be canonicalized`); }
        if (!contained(root, real)) throw new Error(`registry "${registryName}" pack source escapes its registry root`);
        const content = readContainedPack(real, stat, registryName);
        sources.push({ path: real, content, registry });
    }
    return sources;
}

export function resolvePackSource(pack: unknown, options: { registries?: RegistrySource[] } = {}): PackSource {
    const source = listPackSources(pack, options)[0];
    if (source) return source;
    throw new Error('sensor pack was not found in configured registries');
}
