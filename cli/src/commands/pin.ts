// src/commands/pin.ts
//
// awm pin <registry|base> <version> / awm unpin <registry|base> — editores
// triviales de preferences.pins. NO hacen checkout: eso es de `awm update`.
import { Command } from 'commander';
import pc from 'picocolors';
import { getPreferences, savePreferences } from '../utils/config';
import { readRegistriesConfig } from '../core/registries';
import { normalizePin } from '../core/versioning';

const VERSION_RE = /^v?\d+\.\d+\.\d+$/;

/** El registry base se llama `baseline` en disco (core/registries.ts), pero la
 *  ayuda del comando siempre documento `awm pin base <v>` — y `base` era
 *  aceptado y persistido como una clave de pin que NADA lee. El pin reportaba
 *  exito y no hacia absolutamente nada, incluso cuando es la salida documentada
 *  de un bloqueo por `minCliVersion`. Se acepta como ALIAS y se normaliza. */
const BASE_ALIAS = 'base';
const BASE_REGISTRY = 'baseline';

/** Nombre real en disco para lo que el usuario escribio. */
export function canonicalRegistryName(name: string): string {
    return name === BASE_ALIAS ? BASE_REGISTRY : name;
}

function knownRegistryNames(): string[] {
    // Ambos nombres son validos: el alias historico que documenta la ayuda del
    // comando, y el nombre real en disco — que antes se rechazaba si todavia no
    // habia registries.json, o sea justo cuando un usuario bloqueado intenta
    // salir del paso.
    const names = [BASE_ALIAS, BASE_REGISTRY, ...readRegistriesConfig().map((r) => r.name)];
    return Array.from(new Set(names));
}

function assertKnownRegistry(name: string): void {
    const known = knownRegistryNames();
    if (!known.includes(name)) {
        throw new Error(`Unknown registry "${name}". Valid names: ${known.join(', ')}.`);
    }
}

/** Valida y persiste pins[name] = version (normalizada sin prefijo v). */
export function setPin(name: string, version: string): string {
    assertKnownRegistry(name);
    if (!VERSION_RE.test(version)) {
        throw new Error(`Invalid version "${version}" — expected X.Y.Z (e.g. 1.2.0).`);
    }
    const normalized = normalizePin(version);
    const prefs = getPreferences();
    // Se persiste bajo el nombre REAL del registry; si no, el pin queda en una
    // clave que el resolutor de versiones nunca consulta.
    prefs.pins = { ...(prefs.pins ?? {}), [canonicalRegistryName(name)]: normalized };
    savePreferences(prefs);
    return normalized;
}

/** Borra pins[name]; devuelve true si existía. */
export function removePin(name: string): boolean {
    assertKnownRegistry(name);
    const key = canonicalRegistryName(name);
    const prefs = getPreferences();
    if (!prefs.pins || !(key in prefs.pins)) return false;
    delete prefs.pins[key];
    savePreferences(prefs);
    return true;
}

export function registerPinCommands(program: Command): void {
    program.command('pin <registry> <version>')
        .description("Pin a registry ('base' or an additional registry name) to a version tag, e.g. awm pin base 1.2.0")
        .action((registry: string, version: string) => {
            try {
                const normalized = setPin(registry, version);
                console.log(pc.green(`✓ ${registry} pinned to v${normalized}.`) + pc.dim(' Run `awm update` to apply.'));
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });

    program.command('unpin <registry>')
        .description('Remove the version pin of a registry (it returns to the latest tag on the next update)')
        .action((registry: string) => {
            try {
                const removed = removePin(registry);
                if (removed) {
                    console.log(pc.green(`✓ ${registry} unpinned.`) + pc.dim(' Run `awm update` to move to the latest tag.'));
                } else {
                    console.log(pc.yellow(`${registry} had no pin — nothing to do.`));
                }
            } catch (e) {
                console.error(pc.red(e instanceof Error ? e.message : String(e)));
                process.exit(1);
            }
        });
}
