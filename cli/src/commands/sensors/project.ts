import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';
import { parseSensorManifest, type ParsedSensorManifest } from './compatibility/manifest';

export type SensorProjectResolution =
    | { state: 'configured'; projectRoot: string; manifestPath: string; packageRoot: string; manifest: ParsedSensorManifest }
    | { state: 'missing'; projectRoot: string; manifestPath: string }
    | { state: 'invalid'; projectRoot: string; manifestPath: string; reason: string };

function regularManifest(manifestPath: string): boolean {
    try {
        const stat = fs.lstatSync(manifestPath);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch {
        return false;
    }
}

function gitMarker(directory: string): boolean {
    try {
        const stat = fs.lstatSync(path.join(directory, '.git'));
        return stat.isDirectory() || stat.isFile();
    } catch {
        return false;
    }
}

function manifestResolution(projectRoot: string): SensorProjectResolution {
    const manifestPath = path.join(projectRoot, '.awm', 'sensors.json');
    try {
        fs.lstatSync(manifestPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', projectRoot, manifestPath };
        return { state: 'invalid', projectRoot, manifestPath, reason: 'sensor manifest cannot be inspected' };
    }
    if (!regularManifest(manifestPath)) return { state: 'invalid', projectRoot, manifestPath, reason: 'sensor manifest must be a regular file' };
    try {
        let text: string;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(manifestPath));
        } catch {
            return { state: 'invalid', projectRoot, manifestPath, reason: 'sensor manifest must be valid UTF-8' };
        }
        const manifest = parseSensorManifest(JSON.parse(text), manifestPath);
        let configuredPackageRoot: string | undefined;
        if (manifest.kind === 'v2') configuredPackageRoot = manifest.pack.packageRoot;
        if (manifest.kind === 'v3' && manifest.pack.mode === 'project-sensors') configuredPackageRoot = manifest.pack.packageRoot;
        const packageRoot = configuredPackageRoot ? path.resolve(projectRoot, configuredPackageRoot) : projectRoot;
        if (!fs.existsSync(packageRoot) || !fs.statSync(packageRoot).isDirectory()) {
            return { state: 'invalid', projectRoot, manifestPath, reason: 'packageRoot must name an existing directory' };
        }
        const realProjectRoot = fs.realpathSync(projectRoot);
        const realPackageRoot = fs.realpathSync(packageRoot);
        const relative = path.relative(realProjectRoot, realPackageRoot);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            return { state: 'invalid', projectRoot, manifestPath, reason: 'packageRoot escapes the manifest directory' };
        }
        return { state: 'configured', projectRoot, manifestPath, packageRoot, manifest };
    } catch (error) {
        return { state: 'invalid', projectRoot, manifestPath, reason: error instanceof Error ? error.message : 'sensor manifest could not be parsed' };
    }
}

/** Resolves one manifest authority, never crossing a Git worktree boundary. */
export function resolveSensorProject(startCwd: string): SensorProjectResolution {
    if (typeof startCwd !== 'string' || startCwd.length === 0) throw new Error('startCwd must be a nonempty directory path');
    let directory: string;
    try {
        directory = fs.realpathSync(path.resolve(startCwd));
    } catch {
        throw new Error(`startCwd does not exist: ${startCwd}`);
    }
    if (!fs.statSync(directory).isDirectory()) throw new Error(`startCwd is not a directory: ${startCwd}`);

    let boundary: string | null = null;
    let probe = directory;
    while (true) {
        if (gitMarker(probe)) { boundary = probe; break; }
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
    }
    if (boundary === null) return manifestResolution(directory);

    let current = directory;
    while (true) {
        const resolved = manifestResolution(current);
        if (resolved.state !== 'missing') return resolved;
        if (current === boundary) return resolved;
        current = path.dirname(current);
    }
}
