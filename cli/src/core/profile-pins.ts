// src/core/profile-pins.ts
//
// Gate de versión de `awm sync` — WS-3. Compara los pins del profile del
// proyecto (.awm/profile.json → registries) contra la versión checkouteada
// real de cada registry en la máquina.
import fs from 'fs';
import { registryContentRoot } from './registries';
import { currentVersion, normalizePin } from './versioning';

export interface PinFailure {
    name: string;
    required: string;            // sin prefijo v
    actual: string | null;       // null = siguiendo branch / sin tag exacto
    reason: 'mismatch' | 'missing-registry';
}

/** Dir del clone de un registry pineable: ~/.awm/registries/<name>. */
export function pinnedRepoDir(name: string): string {
    return registryContentRoot(name);
}

/** Verifica cada pin del proyecto contra la máquina. Lista vacía = todo en orden. */
export async function verifyProjectPins(pins: Record<string, string>): Promise<PinFailure[]> {
    const failures: PinFailure[] = [];
    for (const [name, requiredRaw] of Object.entries(pins)) {
        const required = normalizePin(requiredRaw);
        const dir = pinnedRepoDir(name);
        if (!fs.existsSync(dir)) {
            failures.push({ name, required, actual: null, reason: 'missing-registry' });
            continue;
        }
        const actual = await currentVersion(dir);
        if (actual !== required) {
            failures.push({ name, required, actual, reason: 'mismatch' });
        }
    }
    return failures;
}
