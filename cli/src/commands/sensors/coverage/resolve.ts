import fs from 'fs';
import path from 'path';
import { listRegistries } from '../../../core/registries';
import {
    MAX_COVERAGE_FILE_BYTES,
    parseCoverageContract,
    type CoverageContract,
} from './contract';
import { parseSensorManifest } from '../compatibility/manifest';
import type { SensorManifest } from '../types';

export type CoverageInputs =
    | { kind: 'not_configured' }
    | { kind: 'no_reference'; projectRoot: string; pack: string; registry: string; manifest: SensorManifest }
    | { kind: 'ready'; projectRoot: string; pack: string; registry: string; manifest: SensorManifest; contract: CoverageContract };

function readFailure(file: string, error: unknown): Error {
    return new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
}

/** Read JSON from a regular, bounded file without ever following a symlink. */
export function readBoundedJson(file: unknown): unknown {
    if (typeof file !== 'string' || file.trim().length === 0) throw new Error('readBoundedJson: file must be a non-empty string');

    let listed: fs.Stats;
    try {
        listed = fs.lstatSync(file);
    } catch (error) {
        throw readFailure(file, error);
    }
    if (!listed.isFile() || listed.isSymbolicLink()) throw new Error(`Cannot read ${file}: expected a regular file`);
    if (listed.size > MAX_COVERAGE_FILE_BYTES) throw new Error(`Cannot read ${file}: exceeds 1 MiB limit`);

    const noFollow = fs.constants.O_NOFOLLOW;
    if (typeof noFollow !== 'number') throw new Error(`Cannot read ${file}: platform cannot guarantee no symlink dereference`);

    let descriptor: number | undefined;
    let content: string;
    try {
        descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.size > MAX_COVERAGE_FILE_BYTES) {
            throw new Error('expected a regular file within the 1 MiB limit');
        }
        const buffer = Buffer.allocUnsafe(MAX_COVERAGE_FILE_BYTES + 1);
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (!Number.isSafeInteger(count) || count < 0 || count > MAX_COVERAGE_FILE_BYTES) {
            throw new Error('exceeds 1 MiB limit');
        }
        content = buffer.subarray(0, count).toString('utf8');
    } catch (error) {
        throw readFailure(file, error);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }

    try {
        return JSON.parse(content) as unknown;
    } catch (error) {
        throw new Error(`Invalid JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function readPackEnvelope(input: unknown, file: string, expectedName: string): { coverage?: unknown } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(`Invalid pack at ${file}: expected object`);
    const pack = input as Record<string, unknown>;
    if (typeof pack.name !== 'string' || pack.name !== expectedName) {
        throw new Error(`Invalid pack at ${file}: name must equal '${expectedName}'`);
    }
    if (typeof pack.sensors !== 'object' || pack.sensors === null || Array.isArray(pack.sensors)) {
        throw new Error(`Invalid pack at ${file}: sensors must be an object`);
    }
    return 'coverage' in pack ? { coverage: pack.coverage } : {};
}

function safeRegistryName(name: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) {
        throw new Error(`Invalid registry name '${name}': expected a safe path component`);
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
    if ('schemaVersion' in manifest) throw new Error(`Invalid coverage manifest at ${manifestPath}: v2 requires the compatibility resolver`);
    for (const registry of listRegistries()) {
        safeRegistryName(registry.name);
        const packPath = path.join(registry.contentRoot, 'sensor-packs', manifest.pack, 'pack.json');
        try {
            fs.lstatSync(packPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw readFailure(packPath, error);
        }
        const { coverage } = readPackEnvelope(readBoundedJson(packPath), packPath, manifest.pack);
        if (coverage === undefined) return { kind: 'no_reference', projectRoot, pack: manifest.pack, registry: registry.name, manifest };
        return {
            kind: 'ready', projectRoot, pack: manifest.pack, registry: registry.name,
            manifest, contract: parseCoverageContract(coverage, packPath),
        };
    }
    throw new Error(`Pack '${manifest.pack}' was not found in configured registries`);
}
