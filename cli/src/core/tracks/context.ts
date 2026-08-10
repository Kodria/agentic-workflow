// Resolucion de contexto autenticado (R2.6, R9.4, R9.5): un track SOLO se
// autentica leyendo el journal del PLAN que su propio descriptor declara —
// jamas enumera ni abre journals hermanos (R2.7). La lectura es siempre
// read-only al momento de necesitarse (R9.5): nada aqui espeja ni cachea
// estado ajeno.
import fs from 'fs';
import crypto from 'crypto';
import { sameExistingPath } from '../paths';
import type { JournalState, TrackContext } from '../journal/types';
import { readDescriptor } from './descriptor';
import { readJournal } from '../journal/store';

export type AuthenticatedContext =
    | { mode: 'plan'; repoRoot: string; journal: JournalState }
    | { mode: 'track'; repoRoot: string; descriptor: NonNullable<ReturnType<typeof readDescriptor>>; trackContext: TrackContext };

export function planDigest(source: string): string {
    return crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

/** R2.3/R2.4: un track jamas ejecuta una tarea fuera de su asignacion, y un
 *  planDigest divergente bloquea ANTES de mirar taskIds — el plan cambio
 *  bajo los pies del track, la asignacion entera dejo de ser confiable. */
export function assertTrackTask(ctx: TrackContext, taskId: string, currentPlanDigest: string): void {
    if (ctx.planDigest !== currentPlanDigest) throw new Error('BLOCKED: planDigest divergente');
    if (!ctx.taskIds.includes(taskId)) throw new Error(`task ${taskId} fuera de la asignación ${ctx.trackId}`);
}

/** Autentica un cwd contra el journal del plan que su descriptor declara
 *  (R2.6, R9.4). Recibe los JournalState YA leidos (localState del propio
 *  cwd, planState del journal del plan) — la funcion en si es pura, para que
 *  la autenticacion sea testeable sin tocar disco; el I/O real vive en
 *  `resolveCommandContext` mas abajo. */
export function resolveAuthenticatedContext(cwd: string, localState: JournalState, planState: JournalState = localState): AuthenticatedContext {
    const root = fs.realpathSync(cwd);
    const descriptor = readDescriptor(root);
    if (descriptor === null) return { mode: 'plan', repoRoot: root, journal: localState };
    if (localState.trackContext === undefined) throw new Error('descriptor presente sin trackContext');
    const planRoot = fs.realpathSync(descriptor.planRoot);
    const ref = planState.tracks?.find((candidate) => candidate.trackId === descriptor.trackId);
    if (planState.journalId !== descriptor.planJournalId || localState.trackContext.planJournalId !== descriptor.planJournalId) {
        throw new Error('planJournalId no coincide');
    }
    if (ref === undefined) throw new Error('TrackRef ausente en journal del plan');
    if (ref.fencingToken !== descriptor.fencingToken) throw new Error('fencingToken no coincide');
    // Identidad de filesystem, no de string: en Windows `process.cwd()` y el path guardado
    // en el journal pueden ser dos grafías de la misma carpeta (8.3 vs nombre largo).
    if (!sameExistingPath(ref.worktreePath, root) || sameExistingPath(planRoot, root)) throw new Error('realpath de track no coincide');
    if (localState.trackContext.trackId !== descriptor.trackId) throw new Error('trackId no coincide');
    return { mode: 'track', repoRoot: root, descriptor, trackContext: localState.trackContext };
}

export type CommandContext =
    | { mode: 'plan' }
    | { mode: 'track'; context: Extract<AuthenticatedContext, { mode: 'track' }> };

/** Guard de entrada para los verbos `awm job`/`awm watch` (R9.4). Sin
 *  descriptor => modo plan de siempre, SIN leer ningun journal — el caso
 *  comun (todo repo sin tracks) no paga ningun costo ni riesgo nuevo; la
 *  logica propia de cada verbo sigue leyendo el journal como ya lo hacia.
 *  Con descriptor presente, lee el journal local y el del plan (SOLO ese,
 *  R2.7/R9.5) y delega la autenticacion real a resolveAuthenticatedContext;
 *  cualquier fallo se homogeniza bajo un mensaje que SIEMPRE contiene
 *  "cwd no autenticado", para que el CLI lo reporte con un patron unico. */
export function resolveCommandContext(repoRoot: string, branch: string): CommandContext {
    const root = fs.realpathSync(repoRoot);
    const descriptor = readDescriptor(root);
    if (descriptor === null) return { mode: 'plan' };
    try {
        const local = readJournal(root, branch);
        if (local.corrupt || local.state === null) throw new Error('journal local corrupto o ausente');
        const plan = readJournal(descriptor.planRoot, descriptor.planBranch);
        if (plan.corrupt || plan.state === null) throw new Error('journal del plan corrupto o ausente');
        const authenticated = resolveAuthenticatedContext(root, local.state, plan.state);
        if (authenticated.mode !== 'track') throw new Error('descriptor presente pero no resolvio a modo track');
        return { mode: 'track', context: authenticated };
    } catch (error) {
        throw new Error(`cwd no autenticado: ${(error as Error).message}`);
    }
}
