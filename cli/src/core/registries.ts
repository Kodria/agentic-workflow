// src/core/registries.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { resolveBaseRemote } from './registry';
import { resolveTargetRef, machineVersionOpts, compareSemver } from './versioning';
import { cliVersion } from './cli-version';

// Evaluated at require-time — tests must use jest.resetModules() + late require() to pick up env overrides.
const AWM_HOME = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');

export const REGISTRIES_DIR = path.join(AWM_HOME, 'registries');
export const REGISTRIES_CONFIG_PATH = path.join(AWM_HOME, 'registries.json');

export const CONTENT_DIR_NAMES = ['skills', 'bundles', 'workflows', 'agents'] as const;

export interface RegistryEntry {
    name: string;
    remote: string;
}

export interface RegistrySource extends RegistryEntry {
    contentRoot: string;
}

export function registryContentRoot(name: string): string {
    const root = path.join(REGISTRIES_DIR, name);
    if (!path.resolve(root).startsWith(path.resolve(REGISTRIES_DIR) + path.sep)) {
        throw new Error(`Invalid registry name "${name}" — must not contain path separators`);
    }
    return root;
}

export function readRegistriesConfig(): RegistryEntry[] {
    if (!fs.existsSync(REGISTRIES_CONFIG_PATH)) return [];
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(REGISTRIES_CONFIG_PATH, 'utf-8'));
    } catch (e) {
        throw new Error(
            `Invalid registries config at ${REGISTRIES_CONFIG_PATH}: ${e instanceof Error ? e.message : String(e)}`
        );
    }
    if (!Array.isArray(raw)) {
        throw new Error(`Invalid registries config at ${REGISTRIES_CONFIG_PATH}: expected a JSON array`);
    }
    for (const entry of raw) {
        if (typeof (entry as Record<string, unknown>)?.name !== 'string' || typeof (entry as Record<string, unknown>)?.remote !== 'string') {
            throw new Error(
                `Invalid registries config at ${REGISTRIES_CONFIG_PATH}: malformed entry ${JSON.stringify(entry)}`
            );
        }
        if (entry.name === '.' || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('..')) {
            throw new Error(
                `Invalid registries config at ${REGISTRIES_CONFIG_PATH}: malformed entry name "${entry.name}" (path traversal)`
            );
        }
    }
    return raw as RegistryEntry[];
}

export function writeRegistriesConfig(entries: RegistryEntry[]): void {
    fs.mkdirSync(AWM_HOME, { recursive: true });
    fs.writeFileSync(REGISTRIES_CONFIG_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

/** Bootstrap de máquina (awm init): si no hay registries.json, lo crea con la
 *  entrada baseline (remote por cadena WS-2: env > prefs > default).
 *  Devuelve true si sembró. Nunca toca un registries.json existente. */
export function seedBaselineRegistry(): boolean {
    if (fs.existsSync(REGISTRIES_CONFIG_PATH)) return false;
    writeRegistriesConfig([{ name: 'baseline', remote: resolveBaseRemote() }]);
    return true;
}

export function listRegistries(): RegistrySource[] {
    return readRegistriesConfig().map((e) => ({ ...e, contentRoot: registryContentRoot(e.name) }));
}

/** Roots de contenido en orden de registries.json.
 *  Un registry configurado pero ausente se omite (awm update lo re-clona). */
export function contentRoots(): string[] {
    const roots: string[] = [];
    for (const reg of listRegistries()) {
        if (fs.existsSync(reg.contentRoot)) roots.push(reg.contentRoot);
    }
    return roots;
}

/** Primer content root configurado (en orden de registries.json) que contiene el
 *  directorio pedido ('hooks', 'sensor-packs', 'skills'…). null si ninguno. */
export function capabilityRoot(dirName: string): string | null {
    for (const root of contentRoots()) {
        if (fs.existsSync(path.join(root, dirName))) return root;
    }
    return null;
}

/** Un registry válido tiene ≥1 dir de contenido en su raíz. */
export function validateRegistryLayout(root: string): boolean {
    return CONTENT_DIR_NAMES.some((d) => fs.existsSync(path.join(root, d)));
}

export type RegistrySyncResult =
    | { name: string; action: 'pulled' | 'recloned'; version: string }  // version: 'vX.Y.Z' | 'HEAD'
    | { name: string; action: 'error'; error: string };

/** Sincroniza cada registry configurado al ref resuelto (pin > último tag > HEAD);
 *  re-clona si falta el dir. Errores por-registry NO fatales: se reportan en el resultado. */
export async function syncRegistries(): Promise<RegistrySyncResult[]> {
    const results: RegistrySyncResult[] = [];
    for (const reg of listRegistries()) {
        try {
            const freshClone = !fs.existsSync(reg.contentRoot);
            if (freshClone) {
                fs.mkdirSync(REGISTRIES_DIR, { recursive: true });
                try {
                    await simpleGit().clone(reg.remote, reg.contentRoot);
                } catch (e) {
                    fs.rmSync(reg.contentRoot, { recursive: true, force: true });
                    throw e;
                }
            } else {
                await simpleGit(reg.contentRoot).reset(['--hard']);
            }
            const git = simpleGit(reg.contentRoot);
            let resolved;
            try {
                resolved = await resolveTargetRef(reg.contentRoot, machineVersionOpts(reg.name));
                await git.checkout(resolved.ref);
                if (resolved.kind !== 'tag') await git.pull('origin', resolved.ref);
            } catch (e) {
                if (freshClone) fs.rmSync(reg.contentRoot, { recursive: true, force: true });
                throw e;
            }
            results.push({
                name: reg.name,
                action: freshClone ? 'recloned' : 'pulled',
                version: resolved.kind === 'tag' ? `v${resolved.version}` : 'HEAD',
            });
        } catch (e) {
            results.push({ name: reg.name, action: 'error', error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}

export const REGISTRY_MANIFEST_NAME = 'awm-registry.json';

export interface RegistryManifest {
    /** Nombres de artifacts que este registry puede sobreescribir de roots anteriores. */
    overrides: Set<string>;
    /** Versión mínima del CLI requerida por el contenido ("X.Y.Z", sin prefijo v). Opcional — WS-4. */
    minCliVersion?: string;
}

export function readRegistryManifest(root: string): RegistryManifest {
    const file = path.join(root, REGISTRY_MANIFEST_NAME);
    if (!fs.existsSync(file)) return { overrides: new Set() };
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        throw new Error(
            `Invalid registry manifest at ${file}: ${e instanceof Error ? e.message : String(e)}`
        );
    }
    const overrides = (raw as Record<string, unknown>)?.overrides ?? [];
    if (!Array.isArray(overrides) || overrides.some((n) => typeof n !== 'string')) {
        throw new Error(`Invalid registry manifest at ${file}: "overrides" must be an array of strings`);
    }
    for (const name of overrides as string[]) {
        if (!name || name === '.' || name.includes('..') || /[/\\]/.test(name)) {
            throw new Error(`Invalid registry manifest at ${file}: override name "${name}" (path traversal)`);
        }
    }
    let minCliVersion: string | undefined;
    const rawMin = (raw as Record<string, unknown>)?.minCliVersion;
    if (rawMin !== undefined) {
        if (typeof rawMin !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(rawMin)) {
            throw new Error(`Invalid registry manifest at ${file}: "minCliVersion" must be "X.Y.Z", got ${JSON.stringify(rawMin)}`);
        }
        minCliVersion = rawMin.replace(/^v/, '');
    }
    return { overrides: new Set(overrides as string[]), minCliVersion };
}

/** Nombre del registry dueño de un path: el nombre del clone bajo REGISTRIES_DIR,
 *  o null si no pertenece a ninguno. */
export function registryNameForPath(p: string): string | null {
    const resolved = path.resolve(p);
    const regsRoot = path.resolve(REGISTRIES_DIR) + path.sep;
    if (resolved.startsWith(regsRoot)) {
        const first = resolved.slice(regsRoot.length).split(path.sep)[0];
        return first || null;
    }
    return null;
}

export interface CliVersionFailure { name: string; min: string; }

/** Registries cuyo manifest exige un CLI más nuevo que el actual (capa 3, WS-4). */
export function verifyMinCliVersions(current: string = cliVersion()): CliVersionFailure[] {
    const failures: CliVersionFailure[] = [];
    for (const reg of listRegistries()) {
        if (!fs.existsSync(reg.contentRoot)) continue;
        let min: string | undefined;
        try { min = readRegistryManifest(reg.contentRoot).minCliVersion; } catch { continue; }
        if (min && compareSemver(current, min) < 0) failures.push({ name: reg.name, min });
    }
    return failures;
}
