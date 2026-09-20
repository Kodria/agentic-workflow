import { journalPresence, readJournal, type JournalPresence } from '../../core/journal/store';
import { refIsAlive } from '../../core/journal/process';
import type { Job } from '../../core/journal/types';

export interface PsRow { id: string; executionState: string; observationState: string; verdict?: string; alive: boolean | 'sin-pid'; }
export interface PsOutput { corruptState: boolean; journal: JournalPresence; jobs: PsRow[]; }

/** Fuente unica de "que hay corriendo": cruza identidad completa contra
 *  procesos vivos. corrupt es VISIBLE, nunca descartado (R1.6), y un journal
 *  que nunca existio se reporta como `absent`, no como corrupcion (#173). */
export function queryPs(repoRoot: string, branch: string): PsOutput {
    const r = readJournal(repoRoot, branch);
    const journal = journalPresence(r);
    if (journal !== 'present') return { corruptState: journal === 'corrupt', journal, jobs: [] };
    const jobs = Object.values(r.state!.jobs).map((j: Job) => ({
        id: j.id, executionState: j.executionState, observationState: j.observationState, verdict: j.verdict,
        alive: j.processRef ? refIsAlive(j.processRef) : 'sin-pid' as const,
    }));
    return { corruptState: false, journal, jobs };
}

export interface ListRow { id: string; executionState: string; verdict?: string; argv: string[]; satisfies?: string[]; }
export interface ListOutput { corruptState: boolean; journal: JournalPresence; cycleStatus: string | null; jobs: ListRow[]; }

export function queryList(repoRoot: string, branch: string): ListOutput {
    const r = readJournal(repoRoot, branch);
    const journal = journalPresence(r);
    if (journal !== 'present') return { corruptState: journal === 'corrupt', journal, cycleStatus: null, jobs: [] };
    return {
        corruptState: false,
        journal,
        cycleStatus: r.state!.cycle.status,
        jobs: Object.values(r.state!.jobs).map((j) => ({
            id: j.id, executionState: j.executionState, verdict: j.verdict, argv: j.argv, satisfies: j.satisfies,
        })),
    };
}

export interface ShowOutput { corruptState: boolean; journal: JournalPresence; job: Job | null; }

export function queryShow(repoRoot: string, branch: string, jobId: string): ShowOutput {
    const r = readJournal(repoRoot, branch);
    const journal = journalPresence(r);
    if (journal !== 'present') return { corruptState: journal === 'corrupt', journal, job: null };
    return { corruptState: false, journal, job: r.state!.jobs[jobId] ?? null };
}
