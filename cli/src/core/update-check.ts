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
    if (cache?.latest && compareSemver(cache.latest, cliVersion()) > 0) {
        console.log(pc.dim(`\n⬆ awm v${cache.latest} available → npm i -g ${CLI_PACKAGE_NAME}`));
    }
    if (!cache || now - cache.lastCheck > TTL_MS) spawnWorker();
}

export interface SelfUpdateDeps {
    current?: string;
    latest?: string | null;
    confirmImpl?: (msg: string) => Promise<boolean>;
    runner?: (cmd: string, args: string[]) => { status: number | null };
    fetchImpl?: typeof fetch;
}

/** Capa 2 — en `awm update`: detecta, pregunta, ejecuta npm i -g; degrada a aviso. */
export async function offerSelfUpdate(deps: SelfUpdateDeps = {}): Promise<void> {
    if (process.env.AWM_NO_UPDATE_CHECK) return;
    const current = deps.current ?? cliVersion();
    const latest = deps.latest !== undefined ? deps.latest : await fetchLatestVersion(deps.fetchImpl ?? fetch);
    writeUpdateCache({ lastCheck: Date.now(), latest: latest ?? null });
    if (!latest || compareSemver(latest, current) <= 0) return;

    const confirmImpl = deps.confirmImpl ?? (async (message: string) => {
        const r = await confirm({ message });
        return !isCancel(r) && r === true;
    });
    const yes = await confirmImpl(`Update awm v${current} → v${latest} now?`);
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
