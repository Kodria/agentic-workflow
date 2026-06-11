// cli/src/commands/registry/add.ts
// Logic for `awm registry add`, separated from commander wiring (testable without prompts).
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import {
    REGISTRIES_DIR,
    readRegistriesConfig,
    writeRegistriesConfig,
    registryContentRoot,
    validateRegistryLayout,
    contentRoots,
    CONTENT_DIR_NAMES,
} from '../../core/registries';
import { discoverSkills, discoverWorkflows, discoverAgents } from '../../core/discovery';
import { discoverAllBundles } from '../../core/bundles';

export type AddRegistryResult =
    | { ok: true; name: string; contentRoot: string }
    | { ok: false; name?: string; error: string };

export function deriveRegistryName(remote: string): string {
    const base = remote.replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
    return base.replace(/\.git$/, '');
}

export async function addRegistry(remote: string, nameOverride?: string): Promise<AddRegistryResult> {
    const name = nameOverride ?? deriveRegistryName(remote);
    if (!name || name === '.' || /[/\\]/.test(name)) {
        return { ok: false, error: `Invalid registry name "${name}" — use --name <simple-dir-name>` };
    }
    const existing = readRegistriesConfig();
    if (existing.some((r) => r.name === name)) {
        return { ok: false, name, error: `Registry "${name}" already exists — remove it first with 'awm registry remove ${name}'` };
    }
    const dest = registryContentRoot(name);
    if (fs.existsSync(dest)) {
        return { ok: false, name, error: `Destination already exists on disk: ${dest}` };
    }

    fs.mkdirSync(REGISTRIES_DIR, { recursive: true });
    try {
        await simpleGit().clone(remote, dest);
    } catch (e) {
        fs.rmSync(dest, { recursive: true, force: true });
        return { ok: false, name, error: `Clone failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    if (!validateRegistryLayout(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
        return {
            ok: false,
            name,
            error: `Invalid registry layout: expected at least one of ${CONTENT_DIR_NAMES.map((d) => `${d}/`).join(', ')} at the repo root of ${remote}`,
        };
    }

    // Collision check against already-known content — BEFORE writing config.
    try {
        const roots = [...contentRoots(), dest];
        discoverSkills(roots);
        discoverWorkflows(roots);
        discoverAgents(roots);
        discoverAllBundles(roots);
    } catch (e) {
        fs.rmSync(dest, { recursive: true, force: true });
        return { ok: false, name, error: e instanceof Error ? e.message : String(e) };
    }

    writeRegistriesConfig([...existing, { name, remote }]);
    return { ok: true, name, contentRoot: dest };
}
