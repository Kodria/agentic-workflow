// Runner concurrente (bloqueador 3): el supervisor spawnea wrappers DETACHED y
// jamas los espera; el avance viene del scan de sidecars en cada tick.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJournal, writeJournal } from '../../core/journal/store';
import { logsDir } from '../../core/journal/paths';
import { spawnStructured } from '../../core/journal/process';
import { claimPath, identityPath, resultPath } from '../job/exec-wrapper';
import { reconcileJobs, materializeRetry, ReconcileDecision } from '../job/reconcile';
import { isWellFormedProcessRef } from '../../core/journal/types';
import type { Job } from '../../core/journal/types';

export type WrapperSpawner = (job: Job, nonce: string, logsRoot: string, repoRoot: string) => void;

/** Spawner real: `awm job exec-wrapper` como proceso EXTERNO detached via el
 *  CLI compilado. fire-and-forget: unref + stdio propio del wrapper. */
export function defaultWrapperSpawner(cliEntry = path.resolve(__dirname, '..', '..', 'index.js')): WrapperSpawner {
    return (job, nonce, logsRoot, repoRoot) => {
        const argv = [
            process.execPath, cliEntry, 'job', 'exec-wrapper',
            '--job', job.id, '--nonce', nonce, '--logs', logsRoot, '--cwd', job.cwd,
            '--', ...job.argv,
        ];
        const { child } = spawnStructured(argv, repoRoot, nonce);
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();   // el supervisor NO espera; el wrapper sobrevive incluso si el supervisor muere
    };
}

/** spawn-intent + nonce persistidos ANTES de cualquier spawn (R1.8): si el
 *  supervisor muere entre journal y spawn, el replay decide por claim. */
export function spawnPendingWrappers(repoRoot: string, branch: string, spawner: WrapperSpawner): number {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const received = Object.values(s.jobs).filter((j) => j.executionState === 'received');
    if (received.length === 0) return 0;
    for (const j of received) {
        j.spawnNonce = crypto.randomBytes(8).toString('hex');
        j.executionState = 'spawn-intent';
        j.phaseTimestamps['spawn-intent'] = new Date().toISOString();
    }
    writeJournal(repoRoot, branch, s);   // intent DURABLE antes del primer spawn
    const logs = logsDir(repoRoot, branch);
    for (const j of received) spawner(j, j.spawnNonce!, logs, repoRoot);
    return received.length;
}

export interface CollectOutput { advanced: number; decisions: ReconcileDecision[]; }

const SCANNABLE = ['spawn-intent', 'claimed', 'running'];

function lastPhaseAgeMs(j: Job): number {
    const stamps = Object.values(j.phaseTimestamps).map((t) => Date.parse(t as string)).filter((n) => !Number.isNaN(n));
    if (stamps.length === 0) return Number.POSITIVE_INFINITY;
    return Date.now() - Math.max(...stamps);
}

/** Cada tick: sidecars primero (claim=>claimed, identity=>running con identidad
 *  REAL, result=>exited+verdict), reconciliacion (matriz unica) despues — solo
 *  para jobs fuera de su ventana de gracia post-spawn. */
export function collectAndReconcile(repoRoot: string, branch: string, opts: { reconcileGraceMs?: number } = {}): CollectOutput {
    const graceMs = opts.reconcileGraceMs ?? 10000;
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const logs = logsDir(repoRoot, branch);
    let advanced = 0;
    for (const j of Object.values(s.jobs)) {
        if (!SCANNABLE.includes(j.executionState)) continue;
        const nonce = j.spawnNonce ?? 'sin-nonce';
        if (fs.existsSync(resultPath(logs, j.id, nonce))) {
            try {
                const parsed = JSON.parse(fs.readFileSync(resultPath(logs, j.id, nonce), 'utf8'));
                if (typeof parsed.exitCode !== 'number') continue;   // shape invalido: lo vera reconcile como corrupt via gate
                j.executionState = 'exited';
                j.result = parsed;
                j.verdict = parsed.exitCode === 0 ? 'pass' : 'fail';
                j.phaseTimestamps.exited = j.phaseTimestamps.exited ?? new Date().toISOString();
                advanced++;
            } catch { /* resultado ilegible: la matriz decidira (unprovable) */ }
            continue;
        }
        if (fs.existsSync(identityPath(logs, j.id, nonce)) && j.executionState !== 'running') {
            try {
                const identity = JSON.parse(fs.readFileSync(identityPath(logs, j.id, nonce), 'utf8'));
                if (isWellFormedProcessRef(identity.wrapper) && isWellFormedProcessRef(identity.command)) {
                    j.wrapperRef = identity.wrapper;
                    j.processRef = identity.command;   // identidad REAL, nunca pid 0 (bloqueador 3)
                    j.executionState = 'running';
                    j.phaseTimestamps.running = new Date().toISOString();
                    j.lastProgressAt = new Date().toISOString();
                    advanced++;
                }
            } catch { /* sidecar a medio escribir: proximo tick */ }
            continue;
        }
        if (fs.existsSync(claimPath(logs, j.id, nonce)) && j.executionState === 'spawn-intent') {
            j.executionState = 'claimed';
            j.phaseTimestamps.claimed = new Date().toISOString();
            advanced++;
        }
    }
    // Matriz unica SOLO fuera de la gracia post-spawn: un wrapper recien
    // spawneado que aun no claimeo NO es un never-started.
    const out = reconcileJobs(s, logs, { eligible: (j) => lastPhaseAgeMs(j) > graceMs });
    for (const d of out.decisions) {
        if (d.action === 'retry-new-attempt') materializeRetry(s, d.jobId);
    }
    if (advanced > 0 || out.decisions.some((d) => d.action !== 'still-alive')) {
        writeJournal(repoRoot, branch, s);
    }
    return { advanced, decisions: out.decisions };
}

export interface RunnerTickOutput { spawned: number; advanced: number; decisions: ReconcileDecision[]; }

export function runnerTick(repoRoot: string, branch: string, spawner: WrapperSpawner, opts: { reconcileGraceMs?: number } = {}): RunnerTickOutput {
    const collected = collectAndReconcile(repoRoot, branch, opts);
    const spawned = spawnPendingWrappers(repoRoot, branch, spawner);
    return { spawned, advanced: collected.advanced, decisions: collected.decisions };
}
