// src/core/registries.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import simpleGit from 'simple-git';
import { REGISTRY_DIR } from './registry';

const AWM_HOME = process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');

/** Content root del registry base. Mismo valor que REGISTRY_CONTENT_DIR (bundles.ts);
 *  duplicado aquí para evitar el ciclo de imports bundles → registries → bundles. */
export const BASE_CONTENT_DIR = path.join(REGISTRY_DIR, 'registry');
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
    return path.join(REGISTRIES_DIR, name);
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
    }
    return raw as RegistryEntry[];
}

export function writeRegistriesConfig(entries: RegistryEntry[]): void {
    fs.mkdirSync(AWM_HOME, { recursive: true });
    fs.writeFileSync(REGISTRIES_CONFIG_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

export function listRegistries(): RegistrySource[] {
    return readRegistriesConfig().map((e) => ({ ...e, contentRoot: registryContentRoot(e.name) }));
}

/** Roots de contenido en orden: base primero, luego adicionales presentes en disco.
 *  Un registry configurado pero ausente se omite (awm update lo re-clona). */
export function contentRoots(): string[] {
    const roots: string[] = [];
    if (fs.existsSync(BASE_CONTENT_DIR)) roots.push(BASE_CONTENT_DIR);
    for (const reg of listRegistries()) {
        if (fs.existsSync(reg.contentRoot)) roots.push(reg.contentRoot);
    }
    return roots;
}

/** Un registry válido tiene ≥1 dir de contenido en su raíz. */
export function validateRegistryLayout(root: string): boolean {
    return CONTENT_DIR_NAMES.some((d) => fs.existsSync(path.join(root, d)));
}

export type RegistrySyncResult =
    | { name: string; action: 'pulled' | 'recloned' }
    | { name: string; action: 'error'; error: string };

/** Pull (reset --hard) de cada registry adicional; re-clona si falta el dir.
 *  Errores por-registry NO fatales: se reportan en el resultado. */
export async function syncAdditionalRegistries(): Promise<RegistrySyncResult[]> {
    const results: RegistrySyncResult[] = [];
    for (const reg of listRegistries()) {
        try {
            if (!fs.existsSync(reg.contentRoot)) {
                fs.mkdirSync(REGISTRIES_DIR, { recursive: true });
                await simpleGit().clone(reg.remote, reg.contentRoot);
                results.push({ name: reg.name, action: 'recloned' });
            } else {
                const git = simpleGit(reg.contentRoot);
                await git.reset(['--hard']);
                await git.pull();
                results.push({ name: reg.name, action: 'pulled' });
            }
        } catch (e) {
            results.push({ name: reg.name, action: 'error', error: e instanceof Error ? e.message : String(e) });
        }
    }
    return results;
}
