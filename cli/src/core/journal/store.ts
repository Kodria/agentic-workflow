import fs from 'fs';
import { writeFileAtomicDurable } from '../atomic-file';
import { emptyState, isWellFormedState, JournalState } from './types';
import { journalDir, statePath, requestsDir, acksDir, logsDir, exportDir, eventsPath } from './paths';

export interface ReadResult { state: JournalState | null; corrupt: boolean; raw?: string; }

export function initJournal(repoRoot: string, branch: string): void {
    for (const d of [journalDir(repoRoot, branch), requestsDir(repoRoot, branch), acksDir(repoRoot, branch), logsDir(repoRoot, branch), exportDir(repoRoot, branch)]) {
        fs.mkdirSync(d, { recursive: true, mode: 0o700 });
        fs.chmodSync(d, 0o700);   // mkdirSync mode es umask-dependiente: fijar explicito (R1.2)
    }
    const sp = statePath(repoRoot, branch);
    if (!fs.existsSync(sp)) {
        writeFileAtomicDurable(sp, JSON.stringify(emptyState(branch), null, 2) + '\n', 0o600);
    }
}

/** Lectura corrupt-aware (R1.6): sintaxis invalida O shape invalido => corrupt:true.
 *  Los CONSUMIDORES deciden: consultas muestran 'corrupt'; gate/reconcile bloquean. */
export function readJournal(repoRoot: string, branch: string): ReadResult {
    const sp = statePath(repoRoot, branch);
    let raw: string;
    try { raw = fs.readFileSync(sp, 'utf8'); } catch { return { state: null, corrupt: true }; }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { state: null, corrupt: true, raw }; }
    if (!isWellFormedState(parsed)) return { state: null, corrupt: true, raw };
    return { state: parsed, corrupt: false, raw };
}

/** Escritura canonica: SOLO el supervisor la invoca (single-writer). CAS por
 *  revision monotonica: el snapshot que traes debe ser el vigente. */
export function writeJournal(repoRoot: string, branch: string, state: JournalState): void {
    const current = readJournal(repoRoot, branch);
    if (current.corrupt) throw new Error('journal corrupto: no se escribe sobre corrupcion (R1.6)');
    if (current.state !== null && current.state.revision !== state.revision) {
        throw new Error(`revision desactualizada: disco=${current.state.revision} propuesta=${state.revision}`);
    }
    const next: JournalState = { ...state, revision: state.revision + 1 };
    if (!isWellFormedState(next)) throw new Error('writeJournal: estado propuesto con forma invalida, no se persiste (R1.6)');
    writeFileAtomicDurable(statePath(repoRoot, branch), JSON.stringify(next, null, 2) + '\n', 0o600);
}

/** Auditoria derivada best-effort (R4.6): la escribe SOLO el supervisor, un
 *  fallo aqui jamas invalida el estado — state.json es la unica autoridad. */
export function appendEvent(repoRoot: string, branch: string, event: Record<string, unknown>): void {
    try {
        fs.appendFileSync(eventsPath(repoRoot, branch), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
    } catch {
        // best-effort: un evento perdido no se reconstruye ni bloquea (R4.6)
    }
}
