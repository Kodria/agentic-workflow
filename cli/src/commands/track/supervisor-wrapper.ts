// Wrapper detached del supervisor de UN track (Step 5, R4.7-R4.10, C11):
// mismo contrato de durabilidad que `job/exec-wrapper.ts` (claim exclusivo ->
// identidad -> resultado), adaptado a "arrancar un supervisor" en vez de "un
// comando". Claim con `wx`: un segundo wrapper lanzado con el mismo intent
// jamás lanza un segundo supervisor — solo detecta el claim y sale.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import { captureSelfRef, EXEC_STDIO } from '../../core/journal/process';
import { writeFileAtomicDurable, fsyncDirSync } from '../../core/atomic-file';
import { initJournal, readJournal } from '../../core/journal/store';
import { supervisorLockPath } from '../../core/journal/paths';

export interface SupervisorWrapperOptions {
    worktreePath: string;
    trackId: string;
    // R4.7/C11: el MISMO nonce que el supervisor del plan persistió en
    // `ref.supervisorIntent.nonce` (tracks.ts) ANTES de spawnear — nunca uno
    // generado acá. `observeSupervisorFromDisk` compara este valor contra
    // `supervisorIntent.nonce`: si el wrapper inventara el suyo, JAMÁS
    // coincidiría y todo wrapper legítimo quedaría clasificado 'foreign'.
    nonce: string;
    readinessNonce: string;
    fencingToken: string;
    planRoot: string;
    planBranch: string;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    launchWatch?: (worktreePath: string) => void;
    maxWaitIterations?: number;   // solo para tests: acota el polling infinito
}

export type WrapperOutcome = 'already-claimed' | 'blocked' | 'active';

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function localBranch(worktreePath: string): string {
    return execFileSync('git', ['branch', '--show-current'], { cwd: worktreePath, encoding: 'utf8', stdio: EXEC_STDIO }).trim();
}

function defaultLaunchWatch(worktreePath: string): void {
    const cliEntry = path.resolve(__dirname, '..', '..', 'index.js');
    const child = spawn(process.execPath, [cliEntry, 'watch'], { cwd: worktreePath, detached: true, stdio: 'ignore' });
    child.unref();
}

/**
 * Ejecuta el ciclo de vida completo del wrapper: claim exact-once -> identity
 * sidecar -> init del journal local (idempotente, ya lo creó el supervisor
 * del plan) -> readiness sidecar -> espera read-only al propio TrackRef del
 * plan -> al pasar a ACTIVE, lanza `awm watch` y espera a que el lock quede
 * adquirido. Mientras espera slot, NO corre gate, fingerprint ni tareas.
 */
export async function runSupervisorWrapper(opts: SupervisorWrapperOptions): Promise<WrapperOutcome> {
    const dir = path.join(opts.worktreePath, '.awm');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const claimPath = path.join(dir, 'supervisor.claim');
    let fd: number;
    try {
        fd = fs.openSync(claimPath, 'wx', 0o600);
    } catch {
        return 'already-claimed';
    }
    const nonce = opts.nonce;
    try {
        fs.writeFileSync(fd, JSON.stringify({ trackId: opts.trackId, nonce, claimedAt: new Date().toISOString(), pid: process.pid }) + '\n');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fsyncDirSync(dir);

    writeFileAtomicDurable(
        path.join(dir, 'supervisor.identity.json'),
        JSON.stringify({ trackId: opts.trackId, nonce, self: captureSelfRef(nonce) }, null, 2) + '\n',
        0o600,
    );

    // Idempotente: el supervisor del plan ya corrió `initTrackJournal` antes
    // de spawnear este wrapper — esto solo defiende contra el caso en que
    // ese paso quedó a medias (nunca sobreescribe: `initJournal` no toca un
    // state.json ya existente).
    initJournal(opts.worktreePath, localBranch(opts.worktreePath));

    writeFileAtomicDurable(
        path.join(dir, 'supervisor.ready.json'),
        JSON.stringify({ readinessNonce: opts.readinessNonce, at: new Date().toISOString() }, null, 2) + '\n',
        0o600,
    );

    const sleep = opts.sleep ?? defaultSleep;
    const pollMs = opts.pollMs ?? 2000;
    const maxIterations = opts.maxWaitIterations ?? Number.POSITIVE_INFINITY;
    for (let i = 0; i < maxIterations; i++) {
        const r = readJournal(opts.planRoot, opts.planBranch);
        if (!r.corrupt && r.state !== null) {
            const ref = r.state.tracks?.find((t) => t.trackId === opts.trackId);
            if (ref?.phase === 'ACTIVE') break;
            // BLOCKED/REMOVED: el plan ya decidió que este track no avanza —
            // el wrapper nunca lanza `awm watch` para un track que el plan
            // bloqueó, ni insiste indefinidamente (C1: la barrera es del plan).
            if (ref?.phase === 'BLOCKED' || ref?.phase === 'REMOVED') return 'blocked';
        }
        if (i === maxIterations - 1) return 'blocked';
        await sleep(pollMs);
    }

    const launch = opts.launchWatch ?? defaultLaunchWatch;
    launch(opts.worktreePath);
    const lockPath = supervisorLockPath(opts.worktreePath);
    for (let i = 0; i < (opts.maxWaitIterations ?? 50) && !fs.existsSync(lockPath); i++) {
        await sleep(Math.min(pollMs, 100));
    }
    return 'active';
}
