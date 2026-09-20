import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fsyncDirSync, writeFileAtomicDurable } from '../atomic-file';
import { emptyState, isWellFormedState, JournalState, PlanBinding } from './types';
import { journalDir, statePath, requestsDir, acksDir, logsDir, exportDir, eventsPath } from './paths';
import { EXECUTION_IDENTITY_SCHEMA, executionPlanDigest, fullPlanDigest } from '../plan/identity';
import { verifiedPlanSnapshot } from '../plan/validate';
import type { PlanValidationReport } from '../plan/types';

/** Three distinct facts the two booleans below encode, named once so consumers
 *  report them instead of collapsing absence into damage (#173). */
export type JournalPresence = 'present' | 'absent' | 'corrupt';

export function journalPresence(read: Pick<ReadResult, 'state' | 'corrupt' | 'absent'>): JournalPresence {
    if (read.corrupt) return 'corrupt';
    if (read.absent || read.state === null) return 'absent';
    return 'present';
}

/** What an absent journal actually needs, naming the command rather than leaving
 *  the operator to infer it — and saying who this interlock is for. */
export const ABSENT_JOURNAL_DETAIL = 'journal ausente (no corrupto): el interlock desatendido exige un journal ligado — corre `awm watch --init --plan <plan>`. Un ciclo interactivo no requiere journal.';

export interface ReadResult {
    state: JournalState | null;
    corrupt: boolean;
    /**
     * A journal that was never created, which is a different FACT from a damaged
     * one and needs a different response: absence is resolved by
     * `awm watch --init --plan`, corruption by inspecting the file. Collapsing
     * the two sent operators looking for damage in a healthy repository — see
     * #173. `corrupt` and `absent` are mutually exclusive; consumers that must
     * block on both still check `state === null`.
     */
    absent: boolean;
    raw?: string;
}

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
    for (const d of journalDirectories(repoRoot, branch)) {
        assertControlledDirectory(d);
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: false, mode: 0o700 });
        assertControlledDirectory(d);
        fs.chmodSync(d, 0o700);   // mkdirSync mode es umask-dependiente: fijar explicito (R1.2)
    }
}

/** Every journal segment is owned state.  Validate it centrally before any
 * directory operation or journal file I/O so a hostile `.awm`/`journal`/branch
 * link cannot redirect writes or reads outside the repository. */
function journalDirectories(repoRoot: string, branch: string): string[] {
    const root = path.join(repoRoot, '.awm');
    const journal = path.join(root, 'journal');
    return [root, journal, journalDir(repoRoot, branch), requestsDir(repoRoot, branch), acksDir(repoRoot, branch), logsDir(repoRoot, branch), exportDir(repoRoot, branch)];
}

function assertControlledDirectory(directory: string): void {
    try {
        const stat = fs.lstatSync(directory);
        if (stat.isSymbolicLink()) throw new Error(`journal path rejects symlink: ${directory}`);
        if (!stat.isDirectory()) throw new Error(`journal path is not a directory: ${directory}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
}

function assertJournalTree(repoRoot: string, branch: string): void {
    for (const directory of journalDirectories(repoRoot, branch).slice(0, 3)) assertControlledDirectory(directory);
}

/** Inspect every existing bootstrap segment before the caller writes anything. */
export function assertJournalInitPaths(repoRoot: string, branch: string): void {
    for (const directory of journalDirectories(repoRoot, branch)) assertControlledDirectory(directory);
    assertJournalFileNotSymlink(statePath(repoRoot, branch));
}

function assertJournalFileNotSymlink(file: string): void {
    try {
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`journal file rejects symlink: ${file}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
}

export function initJournal(repoRoot: string, branch: string): void {
    initializeDirectories(repoRoot, branch);
    const sp = statePath(repoRoot, branch);
    assertJournalFileNotSymlink(sp);
    if (!fs.existsSync(sp)) {
        writeFileAtomicDurable(sp, JSON.stringify(emptyState(branch), null, 2) + '\n', 0o600);
    }
}

/** Create, never replace, the schema-2 state.  The final hard-link is an
 * exclusive atomic publication: another initializer wins cleanly and the
 * completed prior journal is left untouched. */
export function initBoundJournal(repoRoot: string, branch: string, binding: PlanBinding, report?: PlanValidationReport): void {
    if (binding.executionDigest !== undefined) assertBindingReport(binding, report);
    initializeDirectories(repoRoot, branch);
    const sp = statePath(repoRoot, branch);
    assertJournalFileNotSymlink(sp);
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
 *  Un journal que nunca se creo es `absent`, jamas `corrupt`.
 *  Los CONSUMIDORES deciden: consultas muestran el estado; gate/reconcile bloquean. */
export function readJournal(repoRoot: string, branch: string): ReadResult {
    const sp = statePath(repoRoot, branch);
    let raw: string;
    try {
        // Both tree assertions RETURN on ENOENT and throw a plain Error for an
        // unsafe or linked segment, so the only ENOENT that can reach here comes
        // from the state file itself. An unsafe tree is therefore never reported
        // as absence — the same rule `watchJournalStatus` already states.
        assertJournalTree(repoRoot, branch);
        assertJournalFileNotSymlink(sp);
        raw = fs.readFileSync(sp, 'utf8');
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? { state: null, corrupt: false, absent: true }
            : { state: null, corrupt: true, absent: false };
    }
    let parsed: unknown;
    try { parsed = normalizeSchemaOne(JSON.parse(raw)); } catch { return { state: null, corrupt: true, absent: false, raw }; }
    if (!isWellFormedState(parsed)) return { state: null, corrupt: true, absent: false, raw };
    return { state: parsed, corrupt: false, absent: false, raw };
}

/** Escritura canonica: SOLO el supervisor la invoca (single-writer). CAS por
 *  revision monotonica: el snapshot que traes debe ser el vigente. */
export function writeJournal(repoRoot: string, branch: string, state: JournalState): void {
    if (state.branch !== branch) throw new Error(`writeJournal: branch del estado (${state.branch}) no coincide con branch destino (${branch})`);
    const current = readJournal(repoRoot, branch);
    if (current.corrupt) throw new Error('journal corrupto: no se escribe sobre corrupcion (R1.6)');
    // Absence used to arrive here as `corrupt`, and this guard is what kept
    // initialization create-only. Naming it explicitly preserves that exactly:
    // only initJournal/initBoundJournal may bring a journal into existence.
    if (current.absent) throw new Error('journal inexistente: la creacion es de initJournal/initBoundJournal, no de writeJournal');
    if (current.state !== null && current.state.revision !== state.revision) {
        throw new Error(`revision desactualizada: disco=${current.state.revision} propuesta=${state.revision}`);
    }
    const next: JournalState = { ...state, revision: state.revision + 1 };
    if (!isWellFormedState(next)) throw new Error('writeJournal: estado propuesto con forma invalida, no se persiste (R1.6)');
    assertJournalTree(repoRoot, branch);
    assertJournalFileNotSymlink(statePath(repoRoot, branch));
    writeFileAtomicDurable(statePath(repoRoot, branch), JSON.stringify(next, null, 2) + '\n', 0o600);
}

/** Explicit, guarded schema-2 binding transition.  It intentionally uses the
 * normal journal write path: state and its audit history are published in one
 * atomic durable replacement, while initBoundJournal remains create-only. */
export function rebindJournalPlan(repoRoot: string, branch: string, binding: PlanBinding, report?: PlanValidationReport): JournalState {
    const current = readJournal(repoRoot, branch);
    if (current.corrupt || current.state === null) throw new Error('journal inexistente o corrupto: no se puede reconciliar binding');
    if (current.state.schema !== 2 || !current.state.planBinding) throw new Error('journal no tiene un binding desatendido reconciliable');
    const previous = current.state.planBinding;
    if (!previous.executionDigest || previous.executionDigest !== binding.executionDigest
        || previous.executionIdentitySchema !== EXECUTION_IDENTITY_SCHEMA || binding.executionIdentitySchema !== EXECUTION_IDENTITY_SCHEMA
        || previous.path !== binding.path || previous.schema !== binding.schema || previous.executionMode !== binding.executionMode) {
        throw new Error('rebind requires proved unchanged execution identity');
    }
    assertBindingReport(binding, report);
    const next: JournalState = {
        ...current.state,
        planBinding: binding,
        planBindingHistory: [...(current.state.planBindingHistory ?? []), current.state.planBinding],
    };
    writeJournal(repoRoot, branch, next);
    return { ...next, revision: next.revision + 1 };
}

/** The old commitment was emitted at initialization/rebind from trusted core
 * validation. Only a new immutable report can demonstrate the same execution
 * identity. Snapshot bytes stay process-private and are never written/exported. */
function assertBindingReport(binding: PlanBinding, report?: PlanValidationReport): void {
    if (!report || report.state !== 'valid') throw new Error('binding execution identity requires a verified plan report');
    const snapshot = verifiedPlanSnapshot(report);
    if (binding.executionIdentitySchema !== EXECUTION_IDENTITY_SCHEMA || report.planDigest !== binding.digest
        || report.executionDigest !== binding.executionDigest || report.schema !== binding.schema
        || report.executionMode !== binding.executionMode || fullPlanDigest(snapshot) !== binding.digest
        || executionPlanDigest(snapshot) !== binding.executionDigest) throw new Error('verified plan snapshot mismatches binding commitment');
}

/** Auditoria derivada best-effort (R4.6): la escribe SOLO el supervisor, un
 *  fallo aqui jamas invalida el estado — state.json es la unica autoridad. */
export function appendEvent(repoRoot: string, branch: string, event: Record<string, unknown>): void {
    try {
        assertJournalTree(repoRoot, branch);
        const ep = eventsPath(repoRoot, branch);
        assertJournalFileNotSymlink(ep);
        fs.appendFileSync(ep, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
    } catch {
        // best-effort: un evento perdido no se reconstruye ni bloquea (R4.6)
    }
}
