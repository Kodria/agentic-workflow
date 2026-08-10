// cli/src/core/update-check.ts
//
// Actualización del CLI en capas (WS-4): capa 1 = aviso pasivo con cache de 24h
// refrescado por un worker detached; capa 2 = self-update con confirmación en
// `awm update`. AWM_NO_UPDATE_CHECK=1 desactiva ambas (tests, CI).
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import pc from 'picocolors';
import { confirm, isCancel } from '@clack/prompts';
import { cliVersion, CLI_PACKAGE_NAME } from './cli-version';
import { compareSemver } from './versioning';

/** El aviso de actualizacion es cosmetico: una version ilegible (de la cache o
 *  del registro de npm) no debe romper el comando que el usuario pidio — solo
 *  se omite el aviso. El gate de `minCliVersion`, en cambio, falla CERRADO
 *  (ver verifyMinCliVersions). */
function isNewer(a: string, b: string): boolean {
    try { return compareSemver(a, b) > 0; } catch { return false; }
}
import { awmHome } from './paths';

const TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/latest`;

export interface UpdateCache { lastCheck: number; latest: string | null; }

function cacheFile(): string {
    return path.join(awmHome(), 'update-check.json');
}

export function readUpdateCache(): UpdateCache | null {
    try {
        const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8'));
        if (typeof raw.lastCheck === 'number') return raw as UpdateCache;
    } catch { /* ausente o corrupto → null */ }
    return null;
}

export function writeUpdateCache(c: UpdateCache): void {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(c), 'utf-8');
}

/** Última versión publicada en npm, o null ante cualquier falla (timeout 2s). */
export async function fetchLatestVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 2000).unref();
        const res = await fetchImpl(REGISTRY_URL, { signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const body = (await res.json()) as { version?: unknown };
        return typeof body.version === 'string' ? body.version : null;
    } catch {
        return null;
    }
}

/** Worker detached que refresca el cache sin bloquear el comando actual. */
export function spawnRefreshWorker(): void {
    const worker = path.join(__dirname, 'update-check-worker.js');
    if (!fs.existsSync(worker)) return;   // ts-node / dev: sin worker compilado, skip
    spawn(process.execPath, [worker], { detached: true, stdio: 'ignore', env: process.env }).unref();
}

/** Capa 1 — llamado al final de cualquier comando (hook postAction de Commander). */
export function maybeNotifyUpdate(opts?: { now?: number; spawnWorker?: () => void }): void {
    if (process.env.AWM_NO_UPDATE_CHECK) return;
    const now = opts?.now ?? Date.now();
    const spawnWorker = opts?.spawnWorker ?? spawnRefreshWorker;
    const cache = readUpdateCache();
    if (cache?.latest && isNewer(cache.latest, cliVersion())) {
        // stderr, NO stdout. Este aviso se imprime al final de CUALQUIER comando, asi
        // que en stdout se mezclaba con la salida de `--json` y rompia a cualquiera que
        // parsee: `awm doctor --json | jq` fallaba con un SyntaxError que no menciona la
        // causa. stdout es la interfaz de maquina; los avisos al humano van por stderr.
        process.stderr.write(pc.dim(`\n⬆ awm v${cache.latest} available → npm i -g ${CLI_PACKAGE_NAME}\n`));
    }
    if (!cache || now - cache.lastCheck > TTL_MS) spawnWorker();
}

/**
 * Cómo resolver la oferta de self-update:
 *  - `prompt`     — preguntar al humano (comportamiento histórico).
 *  - `skip`       — no preguntar y NO actualizar: solo avisar cómo hacerlo a mano.
 *  - `assume-yes` — no preguntar y SÍ actualizar (consentimiento explícito, `--yes`).
 */
export type SelfUpdateMode = 'prompt' | 'skip' | 'assume-yes';

/**
 * Sin nadie del otro lado, un prompt no es una pregunta: es un cuelgue. `awm update`
 * corre en CI, en cron y dentro de sesiones agénticas, y ahí el confirm de self-update
 * bloqueaba el proceso indefinidamente — el comando quedaba a mitad de camino y ningún
 * humano podía destrabarlo. La ausencia de TTY en stdin es la evidencia POSITIVA de que
 * no hay quien conteste, así que se degrada al aviso.
 *
 * Degrada a `skip`, jamás a `assume-yes`: nadie pidió reemplazar el binario global de la
 * máquina, y hacerlo por iniciativa propia porque "no había a quién preguntarle" es
 * exactamente la clase de acción que el silencio no autoriza.
 */
export function defaultSelfUpdateMode(): SelfUpdateMode {
    return process.stdin.isTTY === true ? 'prompt' : 'skip';
}

export interface SelfUpdateDeps {
    current?: string;
    latest?: string | null;
    mode?: SelfUpdateMode;
    confirmImpl?: (msg: string) => Promise<boolean>;
    runner?: (cmd: string, args: string[]) => { status: number | null };
    fetchImpl?: typeof fetch;
}

/** Capa 2 — en `awm update`: detecta, pregunta (si hay a quién), ejecuta npm i -g; degrada a aviso. */
export async function offerSelfUpdate(deps: SelfUpdateDeps = {}): Promise<void> {
    if (process.env.AWM_NO_UPDATE_CHECK) return;
    const current = deps.current ?? cliVersion();
    const mode = deps.mode ?? defaultSelfUpdateMode();
    const latest = deps.latest !== undefined ? deps.latest : await fetchLatestVersion(deps.fetchImpl ?? fetch);
    writeUpdateCache({ lastCheck: Date.now(), latest: latest ?? null });
    if (!latest || !isNewer(latest, current)) return;

    if (mode === 'skip') {
        console.log(pc.dim(`  ⬆ awm v${latest} available — to update: npm i -g ${CLI_PACKAGE_NAME}`));
        return;
    }

    const confirmImpl = deps.confirmImpl ?? (async (message: string) => {
        const r = await confirm({ message });
        return !isCancel(r) && r === true;
    });
    const yes = mode === 'assume-yes' ? true : await confirmImpl(`Update awm v${current} → v${latest} now?`);
    if (!yes) {
        console.log(pc.dim(`  To update later: npm i -g ${CLI_PACKAGE_NAME}`));
        return;
    }
    const runner = deps.runner ?? ((cmd: string, args: string[]) =>
        spawnSync(cmd, args, { stdio: 'inherit', shell: true }));
    const r = runner('npm', ['i', '-g', `${CLI_PACKAGE_NAME}@latest`]);
    if (r.status === 0) {
        console.log(pc.green(`  ✓ CLI updated to v${latest} (takes effect from the next command)`));
    } else {
        console.warn(pc.yellow(`  ⚠  Automatic update failed — run: npm i -g ${CLI_PACKAGE_NAME}`));
    }
}
