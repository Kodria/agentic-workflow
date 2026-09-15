import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fsyncDirSync, writeFileAtomicDurable } from '../atomic-file';
import { emptyState, isWellFormedState, JournalState, PlanBinding } from './types';
import { journalDir, statePath, requestsDir, acksDir, logsDir, exportDir, eventsPath } from './paths';

export interface ReadResult { state: JournalState | null; corrupt: boolean; raw?: string; }

/** Schema 1 evoluciono de forma aditiva durante R1/R5. Normalizamos solamente
 * campos que antes no existian; evidencia legacy queda deliberadamente con
 * fingerprint vacio para que el gate la considere stale, nunca certificada.
 * `tracks`/`trackContext` NO se normalizan por ausencia: son opcionales
 * (solo el journal de un plan-con-tracks o de un track individual los
 * lleva), asi que faltar es una forma legitima, no legacy — no se les
 * inventa un default para un journal que jamas los tuvo (R9.2). */
function normalizeSchemaOne(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
    const parsed = structuredClone(value) as Record<string, unknown>;
    if (parsed.schema !== 1) return parsed;
    if (parsed.requestProblems === undefined) parsed.requestProblems = [];
    if (parsed.custodyDecisions === undefined) parsed.custodyDecisions = [];
    // R9.3: journals legacy pre-R5 no tenian journalId. Se materializa
    // DETERMINISTICAMENTE desde (branch, cycle.startedAt) para que dos
    // lecturas del MISMO snapshot legacy nunca produzcan identidades
    // distintas (a diferencia de emptyState, que usa randomUUID solo para
    // journals genuinamente nuevos). Se persiste en la siguiente escritura
    // CAS normal — la lectura por si sola sigue siendo read-only.
    if (parsed.journalId === undefined) {
        const branch = typeof parsed.branch === 'string' ? parsed.branch : '';
        const cycle = typeof parsed.cycle === 'object' && parsed.cycle !== null
            ? parsed.cycle as Record<string, unknown> : {};
        const startedAt = typeof cycle.startedAt === 'string' ? cycle.startedAt : '';
        parsed.journalId = `legacy-${crypto.createHash('sha256')
            .update(`${branch}\0${startedAt}`).digest('hex').slice(0, 32)}`;
    }
    if (typeof parsed.cycle === 'object' && parsed.cycle !== null && !Array.isArray(parsed.cycle)) {
        const cycle = parsed.cycle as Record<string, unknown>;
        if (cycle.status === 'IN_PROGRESS' && cycle.nextAction === undefined) {
            cycle.nextAction = { actionId: 'bootstrap-cycle', type: 'plan-cycle', target: 'cycle', preconditions: [], attempt: 0, state: 'pending' };
        }
    }
    // R7 Task 12: `Job.satisfies` migró de `string` a `string[]` (varios items
    // satisfechos por un mismo job, ej. el job canónico de integración final).
    // Un journal legacy con `satisfies` string se normaliza a un array de un
    // elemento — jamás se pierde el enlace ya persistido.
    if (typeof parsed.jobs === 'object' && parsed.jobs !== null && !Array.isArray(parsed.jobs)) {
        for (const job of Object.values(parsed.jobs as Record<string, unknown>)) {
            if (typeof job !== 'object' || job === null || Array.isArray(job)) continue;
            const j = job as Record<string, unknown>;
            if (typeof j.satisfies === 'string') j.satisfies = [j.satisfies];
        }
    }
    if (Array.isArray(parsed.verdicts)) {
        for (const item of parsed.verdicts) {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
            const verdict = item as Record<string, unknown>;
            if (verdict.fingerprint === undefined) verdict.fingerprint = '';
            if (verdict.argv === undefined) verdict.argv = [];
            if (verdict.paths === undefined) verdict.paths = [];
            if (verdict.cwd === undefined) verdict.cwd = '.';
        }
    }
    return parsed;
}

function initializeDirectories(repoRoot: string, branch: string): void {
    for (const d of [journalDir(repoRoot, branch), requestsDir(repoRoot, branch), acksDir(repoRoot, branch), logsDir(repoRoot, branch), exportDir(repoRoot, branch)]) {
        fs.mkdirSync(d, { recursive: true, mode: 0o700 });
        fs.chmodSync(d, 0o700);   // mkdirSync mode es umask-dependiente: fijar explicito (R1.2)
    }
}

export function initJournal(repoRoot: string, branch: string): void {
    initializeDirectories(repoRoot, branch);
    const sp = statePath(repoRoot, branch);
    if (!fs.existsSync(sp)) {
        writeFileAtomicDurable(sp, JSON.stringify(emptyState(branch), null, 2) + '\n', 0o600);
    }
}

/** Create, never replace, the schema-2 state.  The final hard-link is an
 * exclusive atomic publication: another initializer wins cleanly and the
 * completed prior journal is left untouched. */
export function initBoundJournal(repoRoot: string, branch: string, binding: PlanBinding): void {
    initializeDirectories(repoRoot, branch);
    const sp = statePath(repoRoot, branch);
    const initial: JournalState = { ...emptyState(branch), schema: 2, planBinding: binding };
    if (!isWellFormedState(initial)) throw new Error('binding de plan invalido');
    const temporary = path.join(journalDir(repoRoot, branch), `.state.${process.pid}.${crypto.randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
        fd = fs.openSync(temporary, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(initial, null, 2) + '\n', 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        try { fs.linkSync(temporary, sp); fsyncDirSync(path.dirname(sp)); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('refusing to overwrite existing journal');
            throw error;
        }
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* preserve primary error */ }
        try { fs.rmSync(temporary, { force: true }); } catch { /* preserve primary error */ }
    }
}

/** Lectura corrupt-aware (R1.6): sintaxis invalida O shape invalido => corrupt:true.
 *  Los CONSUMIDORES deciden: consultas muestran 'corrupt'; gate/reconcile bloquean. */
export function readJournal(repoRoot: string, branch: string): ReadResult {
    const sp = statePath(repoRoot, branch);
    let raw: string;
    try {
        if (fs.lstatSync(sp).isSymbolicLink()) return { state: null, corrupt: true };
        raw = fs.readFileSync(sp, 'utf8');
    } catch { return { state: null, corrupt: true }; }
    let parsed: unknown;
    try { parsed = normalizeSchemaOne(JSON.parse(raw)); } catch { return { state: null, corrupt: true, raw }; }
    if (!isWellFormedState(parsed)) return { state: null, corrupt: true, raw };
    return { state: parsed, corrupt: false, raw };
}

/** Escritura canonica: SOLO el supervisor la invoca (single-writer). CAS por
 *  revision monotonica: el snapshot que traes debe ser el vigente. */
export function writeJournal(repoRoot: string, branch: string, state: JournalState): void {
    if (state.branch !== branch) throw new Error(`writeJournal: branch del estado (${state.branch}) no coincide con branch destino (${branch})`);
    const current = readJournal(repoRoot, branch);
    if (current.corrupt) throw new Error('journal corrupto: no se escribe sobre corrupcion (R1.6)');
    if (current.state !== null && current.state.revision !== state.revision) {
        throw new Error(`revision desactualizada: disco=${current.state.revision} propuesta=${state.revision}`);
    }
    const next: JournalState = { ...state, revision: state.revision + 1 };
    if (!isWellFormedState(next)) throw new Error('writeJournal: estado propuesto con forma invalida, no se persiste (R1.6)');
    writeFileAtomicDurable(statePath(repoRoot, branch), JSON.stringify(next, null, 2) + '\n', 0o600);
}

/** Explicit, guarded schema-2 binding transition.  It intentionally uses the
 * normal journal write path: state and its audit history are published in one
 * atomic durable replacement, while initBoundJournal remains create-only. */
export function rebindJournalPlan(repoRoot: string, branch: string, binding: PlanBinding): JournalState {
    const current = readJournal(repoRoot, branch);
    if (current.corrupt || current.state === null) throw new Error('journal inexistente o corrupto: no se puede reconciliar binding');
    if (current.state.schema !== 2 || !current.state.planBinding) throw new Error('journal no tiene un binding desatendido reconciliable');
    const next: JournalState = {
        ...current.state,
        planBinding: binding,
        planBindingHistory: [...(current.state.planBindingHistory ?? []), current.state.planBinding],
    };
    writeJournal(repoRoot, branch, next);
    return { ...next, revision: next.revision + 1 };
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
