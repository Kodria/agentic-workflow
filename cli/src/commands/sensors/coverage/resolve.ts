import fs from 'fs';
import path from 'path';
import {
    MAX_COVERAGE_FILE_BYTES,
    parseCoverageContract,
    type CoverageContract,
} from './contract';
import { parseSensorPack } from '../compatibility/contract';
import { parseSensorManifest, type ParsedSensorManifest } from '../compatibility/manifest';
import { resolvePackSource } from '../compatibility/pack-source';
import { readInspectedBoundedFile, type SafeFileFailure } from '../compatibility/safe-file';

type CoverageManifest = Exclude<ParsedSensorManifest, { kind: 'v3' }>;

export type CoverageInputs =
    | { kind: 'not_configured' }
    | { kind: 'no_reference'; projectRoot: string; pack: string; registry: string; manifest: CoverageManifest }
    | { kind: 'ready'; projectRoot: string; pack: string; registry: string; manifest: CoverageManifest; contract: CoverageContract };

function readFailure(file: string, error: unknown): Error {
    return new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
}

/** Read JSON from a regular, bounded file without ever following a symlink. */
export function readBoundedJson(file: unknown): unknown {
    if (typeof file !== 'string' || file.trim().length === 0) throw new Error('readBoundedJson: file must be a non-empty string');

    let listed: fs.BigIntStats;
    try {
        listed = fs.lstatSync(file, { bigint: true });
    } catch (error) {
        throw readFailure(file, error);
    }
    if (!listed.isFile() || listed.isSymbolicLink()) throw new Error(`Cannot read ${file}: expected a regular file`);
    if (listed.size > BigInt(MAX_COVERAGE_FILE_BYTES)) throw new Error(`Cannot read ${file}: exceeds 1 MiB limit`);

    const failure = (reason: SafeFileFailure): Error => {
        if (reason === 'open') return new Error('cannot be safely opened');
        if (reason === 'regular') return new Error('expected a regular file');
        if (reason === 'identity') return new Error('file changed identity during safe open');
        if (reason === 'size') return new Error('file changed size during safe open');
        return new Error('exceeds 1 MiB limit');
    };
    let content: string;
    try {
        content = readInspectedBoundedFile(file, listed, MAX_COVERAGE_FILE_BYTES, failure).toString('utf8');
    } catch (error) {
        throw readFailure(file, error);
    }

    try {
        return JSON.parse(content) as unknown;
    } catch (error) {
        throw new Error(`Invalid JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Finds the nearest manifest without following a symlink during discovery. */
function findManifestDirNoFollow(startCwd: string): string | null {
    let dir = path.resolve(startCwd);
    while (true) {
        const manifestPath = path.join(dir, '.awm', 'sensors.json');
        try {
            fs.lstatSync(manifestPath);
            return dir;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw readFailure(manifestPath, error);
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

export function resolveCoverageInputs(cwd: unknown): CoverageInputs {
    if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('resolveCoverageInputs: cwd must be a non-empty string');
    const projectRoot = findManifestDirNoFollow(cwd);
    if (!projectRoot) return { kind: 'not_configured' };

    const manifestPath = path.join(projectRoot, '.awm', 'sensors.json');
    const manifest = parseSensorManifest(readBoundedJson(manifestPath), manifestPath);
    if (manifest.kind === 'v3') throw new Error('schemaVersion 3 sensor manifests require the project resolver');
    const source = manifest.kind === 'v2' && manifest.pack.registryRoot !== undefined
        ? resolvePackSource(manifest.pack.pack, { registries: [{ name: 'manifest-provenance', remote: 'local', contentRoot: manifest.pack.registryRoot }] })
        : resolvePackSource(manifest.pack.pack);
    let sourceJson: unknown;
    try { sourceJson = JSON.parse(source.content) as unknown; } catch (error) {
        throw new Error(`Invalid JSON at ${source.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsedPack = parseSensorPack(sourceJson, source.path);
    if (parsedPack.pack.name !== manifest.pack.pack) {
        throw new Error(`Invalid pack at ${source.path}: name must equal '${manifest.pack.pack}'`);
    }
    const { coverage } = parsedPack.pack;
    if (coverage === undefined) return { kind: 'no_reference', projectRoot, pack: manifest.pack.pack, registry: source.registry.name, manifest };
    return {
        kind: 'ready', projectRoot, pack: manifest.pack.pack, registry: source.registry.name,
        manifest, contract: parseCoverageContract(coverage, source.path),
    };
}
