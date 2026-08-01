// LA UNICA matriz de recuperacion (design R3.3 = R1.8, sin excepciones).
import fs from 'fs';
import crypto from 'crypto';
import type { Job, JournalState } from '../../core/journal/types';
import { refIsAlive } from '../../core/journal/process';
import { replayVerdict, resultPath } from './exec-wrapper';

export type ReconcileAction = 'still-alive' | 'retry-new-attempt' | 'adopt-result' | 'orphaned-authorization-required';
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
        if (verdict === 'never-started') {
            decisions.push({ jobId: j.id, action: 'retry-new-attempt' });   // seguro: nunca ejecuto
        } else if (verdict === 'completed') {
            const result = JSON.parse(fs.readFileSync(resultPath(logsRoot, j.id, nonce), 'utf8'));
            j.executionState = 'exited';
            j.spawnNonce = nonce;
            j.result = result;
            j.verdict = result.exitCode === 0 ? 'pass' : 'fail';
            j.phaseTimestamps.exited = j.phaseTimestamps.exited ?? new Date().toISOString();
            decisions.push({ jobId: j.id, action: 'adopt-result' });
        } else {
            j.executionState = 'orphaned';                                   // jamas relanzar solo (R1.8)
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
    return fresh;
}
