// LA UNICA matriz de recuperacion (design R3.3 = R1.8, sin excepciones).
import fs from 'fs';
import crypto from 'crypto';
import type { Job, JobResult, JournalState } from '../../core/journal/types';
import { refIsAlive } from '../../core/journal/process';
import { replayVerdict, resultPath } from './exec-wrapper';

/** El sidecar de resultado lo escribe un proceso EXTERNO no coordinado
 *  (exec-wrapper): existencia del archivo (`replayVerdict`) no es prueba de
 *  contenido bien formado. Nunca fabricar un pass/fail de JSON invalido o de
 *  forma incorrecta (R1.6) — un resultado no verificable cae al mismo
 *  disposition que "unprovable": orphaned-authorization-required. */
function isWellFormedJobResult(x: unknown): x is JobResult {
    return typeof x === 'object' && x !== null && typeof (x as { exitCode?: unknown }).exitCode === 'number'
        && typeof (x as { endedAt?: unknown }).endedAt === 'string'
        && typeof (x as { resultPath?: unknown }).resultPath === 'string';
}

function readCompletedResult(logsRoot: string, jobId: string, nonce: string): JobResult | null {
    let raw: string;
    try { raw = fs.readFileSync(resultPath(logsRoot, jobId, nonce), 'utf8'); } catch { return null; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    return isWellFormedJobResult(parsed) ? parsed : null;
}

export type ReconcileAction = 'still-alive' | 'retry-same-intent' | 'adopt-result' | 'orphaned-authorization-required';
export interface ReconcileDecision { jobId: string; action: ReconcileAction; }
export interface ReconcileOutput { decisions: ReconcileDecision[]; }

const NON_TERMINAL = ['spawn-intent', 'claimed', 'running', 'cancel-requested'];

export interface ReconcileOpts {
    /** El runner excluye jobs dentro de su ventana de gracia post-spawn (el
     *  wrapper puede no haber claimeado AUN); default: todos elegibles. */
    eligible?: (j: Job) => boolean;
}

export function reconcileJobs(state: JournalState, logsRoot: string, opts: ReconcileOpts = {}): ReconcileOutput {
    const eligible = opts.eligible ?? (() => true);
    const decisions: ReconcileDecision[] = [];
    for (const j of Object.values(state.jobs)) {
        if (!NON_TERMINAL.includes(j.executionState)) continue;
        if (!eligible(j)) continue;
        const anyAlive = (j.processRef !== undefined && refIsAlive(j.processRef))
            || (j.wrapperRef !== undefined && refIsAlive(j.wrapperRef));
        if (anyAlive) {
            decisions.push({ jobId: j.id, action: 'still-alive' });
            continue;
        }
        const nonce = j.spawnNonce ?? j.processRef?.spawnNonce ?? 'sin-nonce';
        const verdict = replayVerdict(logsRoot, j.id, nonce);
        const result = verdict === 'completed' ? readCompletedResult(logsRoot, j.id, nonce) : null;
        if (verdict === 'never-started') {
            // Reemitir exactamente el mismo intent/nonce. El claim `wx` del
            // wrapper hace que un spawn original demorado y este retry no
            // puedan ejecutar ambos el comando.
            decisions.push({ jobId: j.id, action: 'retry-same-intent' });
        } else if (result !== null) {
            j.executionState = 'exited';
            j.spawnNonce = nonce;
            j.result = result;
            j.verdict = result.exitCode === 0 ? 'pass' : 'fail';
            j.phaseTimestamps.exited = j.phaseTimestamps.exited ?? new Date().toISOString();
            decisions.push({ jobId: j.id, action: 'adopt-result' });
        } else {
            // 'unprovable' O 'completed' con sidecar corrupto/mal formado:
            // ambos son evidencia no verificable — jamas fabricar un pass/fail
            // de JSON invalido, jamas relanzar solo (R1.6, R1.8).
            j.executionState = 'orphaned';
            decisions.push({ jobId: j.id, action: 'orphaned-authorization-required' });
        }
    }
    return { decisions };
}

/** Re-reclamar = Attempt NUEVO enlazado, nunca reutilizar (R1.7). El job viejo
 *  queda 'cancelled' (su intent se retira); el nuevo nace 'received' sin nonce
 *  — el runner le asigna uno fresco en spawn-intent. */
export function materializeRetry(state: JournalState, jobId: string): Job {
    const old = state.jobs[jobId];
    if (old === undefined) throw new Error(`job desconocido: ${jobId}`);
    old.executionState = 'cancelled';
    const fresh: Job = {
        ...old,
        id: `${old.id}-a${crypto.randomBytes(3).toString('hex')}`,
        executionState: 'received',
        observationState: 'progressing',
        spawnNonce: undefined, processRef: undefined, wrapperRef: undefined,
        verdict: undefined, result: undefined,
        phaseTimestamps: { received: new Date().toISOString() },
        attemptOf: old.id,
    };
    state.jobs[fresh.id] = fresh;
    for (const task of state.tasks) {
        for (const item of task.verificationPlan) {
            if (item.satisfiedBy === old.id) item.satisfiedBy = fresh.id;
        }
    }
    for (const item of state.cycleVerificationPlan) {
        if (item.satisfiedBy === old.id) item.satisfiedBy = fresh.id;
    }
    return fresh;
}
