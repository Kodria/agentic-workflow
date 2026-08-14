import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { platform } from '../../../core/paths';
import type { SensorPack } from './types';

type Json = Record<string, unknown>;
export type ProjectEvidence = {
    cwd: string;
    os: NodeJS.Platform;
    runtimeVersions: Record<string, string | null>;
    /** Declared package ranges are context only, never evidence that a tool is installed. */
    declaredToolRanges: Record<string, string>;
    /** Exact versions inspected from contained local node_modules package metadata. */
    toolVersions: Record<string, string | null>;
    packageManager: string | null;
    packageManagerConflict: boolean;
    scripts: string[];
    configFiles: string[];
    paths: string[];
};

const LOCKFILES: Record<string, string> = { 'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lockb': 'bun', 'bun.lock': 'bun' };
const COMMON_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc', '.eslintrc.json', 'tsconfig.json', 'semgrep.yml', 'semgrep.yaml', '.semgrep.yml', 'pyproject.toml', 'ruff.toml', 'mypy.ini', 'setup.cfg'];

function safeFile(root: string, relative: string): boolean {
    if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => part === '.' || part === '..' || part === '')) return false;
    try { const stat = fs.lstatSync(path.join(root, relative)); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}

function safeParts(parts: string[]): boolean {
    return parts.length > 0 && parts.every(part => Boolean(part) && part !== '.' && part !== '..' && !part.includes('/') && !part.includes('\\'));
}

/** Refuse every symlink in a local environment path; evidence must never escape cwd. */
function containedEntry(root: string, parts: string[], expect: 'file' | 'directory'): string | null {
    if (!safeParts(parts)) return null;
    let candidate = root;
    try {
        for (const part of parts) {
            candidate = path.join(candidate, part);
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink()) return null;
        }
        const stat = fs.lstatSync(candidate);
        return (expect === 'file' ? stat.isFile() : stat.isDirectory()) ? candidate : null;
    } catch { return null; }
}

function readBoundedLocalFile(root: string, parts: string[]): string | null {
    const file = containedEntry(root, parts, 'file');
    if (!file) return null;
    try {
        const stat = fs.statSync(file);
        return stat.size <= 64 * 1024 ? fs.readFileSync(file, 'utf8') : null;
    } catch { return null; }
}

function exactVersion(value: unknown): string | null {
    return typeof value === 'string' && semver.valid(value.trim()) !== null ? semver.clean(value.trim()) : null;
}

function pythonEnvironment(root: string): { rootParts: string[]; runtimeVersion: string | null } | null {
    for (const name of ['.venv', 'venv']) {
        if (!containedEntry(root, [name], 'directory')) continue;
        const config = readBoundedLocalFile(root, [name, 'pyvenv.cfg']);
        const version = config?.match(/^version\s*=\s*([^\r\n#]+)\s*$/mi)?.[1] ?? null;
        return { rootParts: [name], runtimeVersion: exactVersion(version) };
    }
    return null;
}

function pythonSitePackages(root: string, environment: string[], target: NodeJS.Platform): string[][] {
    const candidates: string[][] = target === 'win32'
        ? [[...environment, 'Lib', 'site-packages']]
        : [];
    if (target !== 'win32') {
        const lib = containedEntry(root, [...environment, 'lib'], 'directory');
        if (lib) {
            try {
                for (const entry of fs.readdirSync(lib, { withFileTypes: true }).slice(0, 128)) {
                    if (entry.isDirectory() && !entry.isSymbolicLink() && /^python\d+\.\d+$/.test(entry.name)) candidates.push([...environment, 'lib', entry.name, 'site-packages']);
                }
            } catch { /* unreadable environments are not evidence */ }
        }
    }
    return candidates.filter(parts => containedEntry(root, parts, 'directory') !== null);
}

function pythonToolVersion(root: string, sitePackages: string[][], tool: string): string | null {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tool)) return null;
    const normalized = tool.replace(/[._-]+/g, '-').toLowerCase();
    for (const directory of sitePackages) {
        const folder = containedEntry(root, directory, 'directory');
        if (!folder) continue;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(folder, { withFileTypes: true }).slice(0, 512); } catch { continue; }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.endsWith('.dist-info')) continue;
            const distribution = entry.name.slice(0, -'.dist-info'.length);
            if (!distribution.toLowerCase().startsWith(normalized + '-')) continue;
            const metadata = readBoundedLocalFile(root, [...directory, entry.name, 'METADATA']);
            if (!metadata) continue;
            const name = metadata.match(/^Name:\s*([^\r\n]+)\s*$/mi)?.[1]?.trim().replace(/[._-]+/g, '-').toLowerCase();
            const version = exactVersion(metadata.match(/^Version:\s*([^\r\n]+)\s*$/mi)?.[1]);
            if (name === normalized && version) return version;
        }
    }
    return null;
}
function packageJson(root: string): Json | null {
    if (!safeFile(root, 'package.json')) return null;
    try { const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Json : null; } catch { return null; }
}
function stringMap(value: unknown): Record<string, string> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function installedPackageVersion(root: string, tool: string): string | null {
    if (!tool || tool.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
    const packageFile = path.join(root, 'node_modules', ...tool.split('/'), 'package.json');
    try {
        const modules = fs.realpathSync(path.join(root, 'node_modules'));
        const fileStat = fs.lstatSync(packageFile);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) return null;
        const real = fs.realpathSync(packageFile);
        if (!real.startsWith(modules + path.sep)) return null;
        const parsed: unknown = JSON.parse(fs.readFileSync(real, 'utf8'));
        const version: string | null = typeof (parsed as Json).version === 'string' ? (parsed as Json).version as string : null;
        return version !== null && semver.valid(version) !== null ? version : null;
    } catch { return null; }
}

/** Read bounded project metadata only; it never shells out, downloads, or mutates. */
export function discoverProjectEvidence(cwd: unknown, pack: SensorPack, dependencies: { platform?: () => NodeJS.Platform } = {}): ProjectEvidence {
    if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('cwd must be a non-empty path');
    let root: string; try { root = fs.realpathSync(cwd); if (!fs.statSync(root).isDirectory()) throw new Error(); } catch { throw new Error(`cwd is not a readable project directory: ${cwd}`); }
    if (!pack || typeof pack !== 'object' || typeof pack.name !== 'string') throw new Error('pack must be a parsed sensor pack');
    const targetPlatform = (dependencies.platform ?? platform)();
    const pkg = packageJson(root);
    const locks = Object.keys(LOCKFILES).filter(file => safeFile(root, file));
    const lockManagers = new Set(locks.map(file => LOCKFILES[file]));
    const declaredManager = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
    if (declaredManager) lockManagers.add(declaredManager);
    const configCandidates = new Set(COMMON_CONFIGS);
    if ('schemaVersion' in pack) {
        for (const marker of pack.detects) configCandidates.add(marker);
        for (const sensor of Object.values(pack.sensors)) {
            for (const marker of [...(sensor.applicability.allFiles ?? []), ...(sensor.applicability.anyFiles ?? [])]) configCandidates.add(marker);
            for (const variant of sensor.variants) for (const config of variant.requirements.configFiles ?? []) configCandidates.add(config);
        }
    }
    const configFiles = [...configCandidates].filter(file => safeFile(root, file)).sort();
    const scripts = Object.keys(stringMap(pkg?.scripts)).sort();
    const declaredToolRanges = { ...stringMap(pkg?.dependencies), ...stringMap(pkg?.devDependencies), ...stringMap(pkg?.peerDependencies) };
    const tools = new Set<string>();
    if ('schemaVersion' in pack) for (const sensor of Object.values(pack.sensors)) for (const variant of sensor.variants) tools.add(variant.requirements.tool);
    const environment = pythonEnvironment(root);
    const sitePackages = environment ? pythonSitePackages(root, environment.rootParts, targetPlatform) : [];
    const toolVersions = Object.fromEntries([...tools].sort().map(tool => [tool, pythonToolVersion(root, sitePackages, tool) ?? installedPackageVersion(root, tool)]));
    return {
        cwd: root, os: targetPlatform, runtimeVersions: { node: process.versions.node ?? null, ...(environment ? { python: environment.runtimeVersion } : {}) }, declaredToolRanges, toolVersions,
        packageManager: declaredManager ?? (lockManagers.size === 1 ? [...lockManagers][0] : null), packageManagerConflict: lockManagers.size > 1,
        scripts, configFiles, paths: [...new Set([...(safeFile(root, 'package.json') ? ['package.json'] : []), ...locks, ...configFiles])].sort(),
    };
}
