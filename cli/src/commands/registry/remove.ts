// cli/src/commands/registry/remove.ts
import fs from 'fs';
import { readRegistriesConfig, writeRegistriesConfig, registryContentRoot } from '../../core/registries';

export type RemoveRegistryResult = { ok: true } | { ok: false; error: string };

export function removeRegistry(name: string): RemoveRegistryResult {
    const existing = readRegistriesConfig();
    if (!existing.some((r) => r.name === name)) {
        return { ok: false, error: `Registry "${name}" not found — see 'awm registry list'` };
    }
    writeRegistriesConfig(existing.filter((r) => r.name !== name));
    fs.rmSync(registryContentRoot(name), { recursive: true, force: true });
    return { ok: true };
}
