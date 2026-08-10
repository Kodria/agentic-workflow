import { readJournal } from '../../core/journal/store';
import { refIsAlive } from '../../core/journal/process';
import type { Job } from '../../core/journal/types';

export interface PsRow { id: string; executionState: string; observationState: string; verdict?: string; alive: boolean | 'sin-pid'; }
export interface PsOutput { corruptState: boolean; jobs: PsRow[]; }

/** Fuente unica de "que hay corriendo": cruza identidad completa contra
 *  procesos vivos. corrupt es VISIBLE, nunca descartado (R1.6). */
export function queryPs(repoRoot: string, branch: string): PsOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, jobs: [] };
    const jobs = Object.values(r.state!.jobs).map((j: Job) => ({
        id: j.id, executionState: j.executionState, observationState: j.observationState, verdict: j.verdict,
        alive: j.processRef ? refIsAlive(j.processRef) : 'sin-pid' as const,
    }));
    return { corruptState: false, jobs };
}

export interface ListRow { id: string; executionState: string; verdict?: string; argv: string[]; satisfies?: string[]; }
export interface ListOutput { corruptState: boolean; cycleStatus: string | null; jobs: ListRow[]; }

export function queryList(repoRoot: string, branch: string): ListOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, cycleStatus: null, jobs: [] };
    return {
        corruptState: false,
        cycleStatus: r.state!.cycle.status,
        jobs: Object.values(r.state!.jobs).map((j) => ({
            id: j.id, executionState: j.executionState, verdict: j.verdict, argv: j.argv, satisfies: j.satisfies,
        })),
    };
}

export interface ShowOutput { corruptState: boolean; job: Job | null; }

export function queryShow(repoRoot: string, branch: string, jobId: string): ShowOutput {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt) return { corruptState: true, job: null };
    return { corruptState: false, job: r.state!.jobs[jobId] ?? null };
}
