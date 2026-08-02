// Limpieza explicita (design R2.2): lista primero, valida identidad COMPLETA,
// actua despues. No escribe estado canonico: la convergencia la observa el
// supervisor (single-writer) via reconcile.
import type { JournalState } from '../../core/journal/types';
import { refIsAlive, terminateGroupConfirmed } from '../../core/journal/process';

export interface ReapPlanEntry { jobId: string; pid: number; aliveWithIdentity: boolean; }

export function planReap(state: JournalState): ReapPlanEntry[] {
    return Object.values(state.jobs)
        .filter((j) => j.processRef !== undefined)
        .map((j) => ({ jobId: j.id, pid: j.processRef!.pid, aliveWithIdentity: refIsAlive(j.processRef!) }));
}

export async function executeReap(state: JournalState, jobIds: string[]): Promise<string[]> {
    const killed: string[] = [];
    for (const id of jobIds) {
        const j = state.jobs[id];
        if (j?.processRef === undefined) continue;
        if (!refIsAlive(j.processRef)) continue;   // identidad no confirmada => ni una senial (R2.1)
        const dead = await terminateGroupConfirmed(j.processRef, { termGraceMs: 3000, killGraceMs: 2000 });
        if (dead) killed.push(id);
    }
    return killed;
}
