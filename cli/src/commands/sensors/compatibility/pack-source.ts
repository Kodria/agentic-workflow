import fs from 'fs';
import path from 'path';
import { listRegistries, type RegistrySource } from '../../../core/registries';

const MAX_PACK_BYTES = 1024 * 1024;

export type PackSource = { path: string; content: string; registry: RegistrySource };

function validPackName(pack: unknown): pack is string {
    return typeof pack === 'string' && /^[a-z][a-z0-9-]*$/.test(pack);
}

function contained(root: string, candidate: string): boolean {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return candidate.startsWith(prefix);
}

/** Resolve only an exact, regular pack.json beneath the first configured registry.
 * Registry order is authority; an unsafe claimed source is a hard failure, not a fallback. */
export function resolvePackSource(pack: unknown, options: { registries?: RegistrySource[] } = {}): PackSource {
    if (!validPackName(pack)) throw new Error('pack name must be a stable lowercase id');
    const registries = options.registries ?? listRegistries();
    if (!Array.isArray(registries)) throw new Error('registries must be an array');
    for (const registry of registries) {
        if (!registry || typeof registry.contentRoot !== 'string' || registry.contentRoot.trim() === '') throw new Error('registry has an invalid content root');
        const candidate = path.join(registry.contentRoot, 'sensor-packs', pack, 'pack.json');
        let stat: fs.Stats;
        try { stat = fs.lstatSync(candidate); } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') throw new Error(`pack source ${candidate} has a non-regular or symbolic parent`);
            throw new Error(`cannot inspect pack source ${candidate}`);
        }
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`pack source ${candidate} must be a contained regular file, never a symbolic link`);
        if (stat.size > MAX_PACK_BYTES) throw new Error(`pack source ${candidate} exceeds the 1 MiB limit`);
        let root: string; let real: string;
        try { root = fs.realpathSync(registry.contentRoot); real = fs.realpathSync(candidate); } catch { throw new Error(`cannot canonicalize pack source ${candidate}`); }
        if (!contained(root, real)) throw new Error(`pack source ${candidate} escapes its registry root`);
        return { path: real, content: fs.readFileSync(real, 'utf8'), registry };
    }
    throw new Error(`sensor pack "${pack}" was not found in configured registries`);
}
