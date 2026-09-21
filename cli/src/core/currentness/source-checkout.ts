// src/core/currentness/source-checkout.ts
//
// Seam de test para la currentness del CLI, inerte en una instalación publicada.
//
// Los tests que ejercitan el gate de currentness lanzan el CLI COMPILADO como
// subproceso, así que no pueden alcanzar `CurrentnessDeps.fetch` — quedan
// atados a lo que npm tenga publicado en ese instante, y se ponen rojos según
// de qué lado de un publish corra la pata de CI (#181).
//
// El override suple el `latest` observado, y el veredicto se computa DESDE ese
// valor: `installed === latest ? current : stale`. Es decir, quien pueda fijarlo
// puede poner el gate en verde. Por eso NO alcanza con validar el formato: el
// seam se honra únicamente cuando el CLI corre desde un checkout de fuente,
// señalado por un archivo que jamás viaja en el tarball.
//
// `cli/package.json` declara `files: ["dist", "prebuilds"]`, un whitelist: el
// marcador vive en la raíz del paquete y queda fuera del publish por
// construcción. En un `npm i -g` el archivo no existe y la variable no hace
// nada. Alcanzar el seam en producción exige escribir dentro del directorio del
// paquete instalado — quien pueda hacerlo ya puede editar el código, así que el
// seam no habilita ninguna capacidad nueva.
import fs from 'fs';
import path from 'path';
import { packageRoot } from '../cli-version';

export const SOURCE_CHECKOUT_MARKER = '.awm-source-checkout';
export const LATEST_OVERRIDE_ENV = 'AWM_CURRENTNESS_LATEST_CLI';

/** Más estricta que la gramática de check.ts a propósito: sin `v`, sin espacios. */
const BARE_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function isSourceCheckout(root: string | null = packageRoot()): boolean {
    if (root === null) return false;
    try {
        return fs.statSync(path.join(root, SOURCE_CHECKOUT_MARKER)).isFile();
    } catch {
        return false;
    }
}

/**
 * El `latest` declarado para el CLI, o null para consultar npm.
 *
 * Devuelve null —sin mirar el valor— cuando el CLI no corre desde un checkout
 * de fuente: ese es el caso de producción y el seam no existe ahí.
 *
 * Cuando SÍ se honra, un valor malformado es un error ruidoso y no un silencioso
 * fallback a la red: un typo en CI restauraría exactamente la dependencia que
 * este seam viene a sacar, y lo haría en verde.
 */
export function observedLatestCliOverride(
    env: NodeJS.ProcessEnv = process.env,
    root: string | null = packageRoot(),
): string | null {
    const declared = env[LATEST_OVERRIDE_ENV];
    if (declared === undefined) return null;
    if (!isSourceCheckout(root)) return null;
    const value = declared.trim();
    if (!BARE_SEMVER.test(value)) {
        throw new Error(`${LATEST_OVERRIDE_ENV} debe ser un semver desnudo X.Y.Z; se recibió ${JSON.stringify(declared)}`);
    }
    return value;
}
