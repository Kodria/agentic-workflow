// Runner concurrente (bloqueador 3): el supervisor spawnea wrappers DETACHED y
// jamas los espera; el avance viene del scan de sidecars en cada tick.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJournal, writeJournal } from '../../core/journal/store';
import { logsDir } from '../../core/journal/paths';
import { spawnStructured, argvDigest } from '../../core/journal/process';
import { claimPath, identityPath, resultPath, logPath } from '../job/exec-wrapper';
import { reconcileJobs, ReconcileDecision } from '../job/reconcile';
import { isWellFormedProcessRef } from '../../core/journal/types';
import type { Job, ProcessRef } from '../../core/journal/types';

export type WrapperSpawner = (job: Job, nonce: string, logsRoot: string, repoRoot: string) => ProcessRef | void;

/** Spawner real: `awm job exec-wrapper` como proceso EXTERNO detached via el
 *  CLI compilado. fire-and-forget: unref + stdio propio del wrapper. */
export function defaultWrapperSpawner(cliEntry = path.resolve(__dirname, '..', '..', 'index.js')): WrapperSpawner {
    return (job, nonce, logsRoot, repoRoot) => {
        const argv = [
            process.execPath, cliEntry, 'job', 'exec-wrapper',
            '--job', job.id, '--nonce', nonce, '--logs', logsRoot, '--cwd', job.cwd,
            '--', ...job.argv,
        ];
        const { child, ref } = spawnStructured(argv, repoRoot, nonce);
        child.unref();   // el supervisor NO espera; el wrapper sobrevive incluso si el supervisor muere
        return ref;
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
    for (const j of received) {
        // Un spawn que lanza sincronicamente NO debe abortar el resto del lote:
        // el spawn-intent de cada job ya quedo durable arriba: el proximo tick
        // lo recoge (claim=>claimed) o la matriz lo declara never-started.
        try { spawner(j, j.spawnNonce!, logs, repoRoot); } catch { /* ver comentario: el intent ya persistio, el proximo tick decide */ }
    }
    return received.length;
}

export interface CollectOutput { advanced: number; decisions: ReconcileDecision[]; }

const SCANNABLE = ['spawn-intent', 'claimed', 'running'];

function lastPhaseAgeMs(j: Job): number {
    const stamps = Object.values(j.phaseTimestamps).map((t) => Date.parse(t as string)).filter((n) => !Number.isNaN(n));
    if (stamps.length === 0) return Number.POSITIVE_INFINITY;
    return Date.now() - Math.max(...stamps);
}

// Observacional puro (R3.5): la duracion NUNCA produce transicion terminal.
// Señal de progreso = mtime del log del job (analogo al "output consumido por
// el supervisor" del stall de CONTROLADOR en generations.ts, pero para el job
// mismo). Sin campo nuevo de tracking de bytes: el propio `lastProgressAt` ya
// persistido sirve de referencia — si el log crecio (mtime mas nuevo que la
// ultima marca), hay progreso; si no, y ya paso el umbral, es sospecha de
// estancamiento. `suspected-stall` jamas mata ni reintenta nada — eso solo lo
// hace `awm job reap`, invocado por un humano.
export const DEFAULT_STALL_OBSERVATION_MS = 5 * 60000;   // orden de magnitud de heartbeatTimeoutMs, pero independiente (jobs != controlador)

function updateJobObservation(j: Job, logs: string, stallObservationMs: number): void {
    if (j.executionState !== 'running') return;
    const nonce = j.spawnNonce ?? 'sin-nonce';
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(logPath(logs, j.id, nonce)).mtimeMs; } catch { /* log aun no existe: sin progreso nuevo */ }
    const baselineIso = j.lastProgressAt ?? j.phaseTimestamps.running;
    const baselineMs = baselineIso !== undefined ? Date.parse(baselineIso) : Number.NEGATIVE_INFINITY;
    if (mtimeMs > baselineMs) {
        j.lastProgressAt = new Date().toISOString();
        j.observationState = 'progressing';
        return;
    }
    if (Date.now() - baselineMs > stallObservationMs) {
        j.observationState = 'suspected-stall';
    }
}

/** Cada tick: sidecars primero (claim=>claimed, identity=>running con identidad
 *  REAL, result=>exited+verdict), reconciliacion (matriz unica) despues — solo
 *  para jobs fuera de su ventana de gracia post-spawn. */
export function collectAndReconcile(repoRoot: string, branch: string, opts: { reconcileGraceMs?: number; stallObservationMs?: number } = {}): CollectOutput {
    const graceMs = opts.reconcileGraceMs ?? 10000;
    const stallObservationMs = opts.stallObservationMs ?? DEFAULT_STALL_OBSERVATION_MS;
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const logs = logsDir(repoRoot, branch);
    let advanced = 0;
    let observationTouched = false;
    for (const j of Object.values(s.jobs)) {
        if (!SCANNABLE.includes(j.executionState)) continue;
        const nonce = j.spawnNonce ?? 'sin-nonce';
        if (fs.existsSync(claimPath(logs, j.id, nonce)) && fs.existsSync(resultPath(logs, j.id, nonce))) {
            try {
                const parsed = JSON.parse(fs.readFileSync(resultPath(logs, j.id, nonce), 'utf8'));
                if (typeof parsed.exitCode !== 'number' || typeof parsed.endedAt !== 'string' || typeof parsed.resultPath !== 'string') continue;
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
                if (identity.jobId === j.id && identity.nonce === nonce
                    && isWellFormedProcessRef(identity.wrapper) && isWellFormedProcessRef(identity.command)
                    && identity.wrapper.spawnNonce === nonce && identity.command.spawnNonce === nonce
                    && identity.command.argvDigest === argvDigest(j.argv)) {
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
    // observationState (R3.5): puramente informativo, corre para TODO job aun
    // 'running' tras el scan de arriba — jamas toca executionState ni participa
    // de la matriz de abajo.
    for (const j of Object.values(s.jobs)) {
        const before = `${j.observationState}|${j.lastProgressAt ?? ''}`;
        updateJobObservation(j, logs, stallObservationMs);
        if (`${j.observationState}|${j.lastProgressAt ?? ''}` !== before) observationTouched = true;
    }
    // Matriz unica SOLO fuera de la gracia post-spawn: un wrapper recien
    // spawneado que aun no claimeo NO es un never-started.
    const out = reconcileJobs(s, logs, { eligible: (j) => lastPhaseAgeMs(j) > graceMs });
    if (advanced > 0 || observationTouched || out.decisions.some((d) => d.action !== 'still-alive')) {
        writeJournal(repoRoot, branch, s);
    }
    return { advanced, decisions: out.decisions };
}

export interface RunnerTickOutput { spawned: number; advanced: number; decisions: ReconcileDecision[]; }

/** `dispatch:false` (R5.2/R6.3, Task 10 — "el supervisor del track deja de
 *  despachar" durante un freeze): el drenaje de jobs YA vivos sigue intacto
 *  (`collectAndReconcile` siempre corre, y un job `spawn-intent` sin claim
 *  aun se reintenta con el MISMO intent — la reconciliacion de
 *  `retry-same-intent` de abajo NUNCA se gatea por `dispatch`, corre
 *  siempre, freeze o no: es exactamente lo que permite que un job cuyo
 *  wrapper murio justo al pedirse el freeze siga avanzando hacia un estado
 *  terminal en vez de quedar varado en `spawn-intent` para siempre — sin
 *  esto, `liveJobs` jamas llegaria a cero y `attemptFreeze` jamas
 *  convergeria, R6.3), pero jamás se arranca un job GENUINAMENTE nuevo
 *  (`spawnPendingWrappers` para `received`) mientras el freeze está en
 *  curso — eso sí queda gateado por `dispatch`. Default `true`: ningún
 *  caller existente (loop normal del supervisor) cambia de comportamiento. */
export function runnerTick(
    repoRoot: string, branch: string, spawner: WrapperSpawner,
    opts: { reconcileGraceMs?: number; stallObservationMs?: number; dispatch?: boolean } = {},
): RunnerTickOutput {
    const dispatch = opts.dispatch ?? true;
    const collected = collectAndReconcile(repoRoot, branch, opts);
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const logs = logsDir(repoRoot, branch);
    // Reintento de intent YA vivo (nunca trabajo nuevo): un job en
    // `spawn-intent` sin claim es, por definicion, un intent que YA se
    // habia decidido antes del freeze — reemitir el MISMO spawn es
    // progresar/drenar ese job, no arrancar algo nuevo. Corre SIEMPRE,
    // incluso con `dispatch:false`.
    for (const decision of collected.decisions) {
        if (decision.action !== 'retry-same-intent') continue;
        const job = r.state.jobs[decision.jobId];
        if (job?.executionState !== 'spawn-intent' || job.spawnNonce === undefined) continue;
        try { spawner(job, job.spawnNonce, logs, repoRoot); } catch { /* el mismo intent durable se reintentara en otro tick */ }
    }
    const spawned = dispatch ? spawnPendingWrappers(repoRoot, branch, spawner) : 0;
    return { spawned, advanced: collected.advanced, decisions: collected.decisions };
}
