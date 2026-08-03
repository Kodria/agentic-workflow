// P1/P2 (bootstrap durable de tracks, R4.1-R4.10, C1/C2/C8/C11): el ÚNICO
// lugar que ejecuta side effects reales derivados de `protocol.ts`. Esta
// función es un driver DELGADO — toda decisión de qué pasa después vive en
// `core/tracks/protocol.ts` (regla de autoridad única, ver ese archivo);
// `reconcileTracks` solo traduce `JournalState` <-> `CohortProtocol`, ejecuta
// como máximo UNA llamada mutante a `TrackRuntime` por invocación, y persiste
// cada frontera antes/después de intentarla (para que Task 9 pueda inyectar
// crashes en cualquier punto y probar que el restart converge).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent, initJournal } from '../../core/journal/store';
import { emitRequest, listPendingRequests } from '../../core/journal/requests';
import { supervisorLockPath } from '../../core/journal/paths';
import { refIsAlive } from '../../core/journal/process';
import { decidePrepare, decideJoinReconciliation, nextProtocolEffect, observeProtocolEffect } from '../../core/tracks/protocol';
import {
    addOwnedWorktree, removeOwnedWorktree, removeOwnedBranch,
    isAwmGitignored, foreignPathExists, ownedWorktreeExists,
    mergeBase, changedPaths, headSha, readMergeHead, isAncestor,
    mergeFrozenTrack as gitMergeFrozenTrack, abortOwnedMerge as gitAbortOwnedMerge,
} from '../../core/tracks/git';
import { assessActualOwnership } from '../../core/tracks/ownership';
import { writeDescriptor } from '../../core/tracks/descriptor';
import { acquireIntegrationLock, stopControllerGenerationConfirmed } from '../../core/tracks/join';
import { spawnStructured, groupIsGone, terminatePreviouslyOwnedGroup } from '../../core/journal/process';
import { JOIN_STRATEGY_NO_FF } from '../../core/tracks/types';
import type { CohortProtocol, JoinIntent, PrepareObservation, ProtocolEffect, TrackProtocolState } from '../../core/tracks/types';
import type { IntegrationLockHandle } from '../../core/tracks/join';
import type { ParsedTrack } from '../../core/tracks/plan-parser';
import type { JournalState, TrackContext, TrackRef, ProcessRef } from '../../core/journal/types';

/** Contrato más rico que el `'absent'|'claimed'|'ready'|'foreign'` puramente
 *  ilustrativo del plan: `ready` necesita cargar el readinessNonce
 *  efectivamente observado para que C8 (comparación de nonce) se pueda
 *  decidir en `protocol.ts`, la única autoridad — sin esto, `reconcileTracks`
 *  tendría que inventar la comparación acá mismo. */
export type SupervisorObservation =
    | { kind: 'absent' }
    | { kind: 'claimed' }
    | { kind: 'ready'; readinessNonce: string }
    | { kind: 'foreign' };

/** Task 9 (interfaz TEMPORAL — Task 13 la reemplaza por el módulo dedicado
 *  de teardown sin cambiar esta firma, ver plan R5 Task 13 / Step 5):
 *  `tracks.ts` decide CUÁL paso corresponde mirando `ref.phase` (dato del
 *  journal que ya le pertenece a este driver) — `teardownOwned` solo lo
 *  ejecuta contra el mundo real. `'blocked'` <=> el paso es indemostrable
 *  (ej. no se pudo confirmar la terminación del grupo del supervisor con
 *  identidad verificada, R4.8) y el track debe bloquearse en vez de avanzar. */
export type TeardownStep = 'supervisor' | 'worktree' | 'branch';

export interface TrackRuntime {
    addWorktree(planRoot: string, ref: TrackRef, baseSha: string): void;
    initTrackJournal(ref: TrackRef, context: TrackContext): void;
    spawnSupervisor(ref: TrackRef): ProcessRef | void;
    observeSupervisor(ref: TrackRef): SupervisorObservation;
    teardownOwned(ref: TrackRef, step: TeardownStep): Promise<'ok' | 'blocked'>;
    // R5.2/R6.3 (Task 10): único touch REAL de `freeze-track` — escribe
    // `track-freeze-request` al `requestsDir` PROPIO del track (cross-
    // worktree, mismo primitivo durable `emitRequest` que cualquier otra
    // request — ver el comentario grande sobre el patrón de freeze en
    // `apply.ts`). El supervisor del PLAN JAMÁS escribe el journal del track
    // directamente; esto es lo más cerca que llega — un ARCHIVO en su
    // requestsDir, consumido transaccionalmente por el propio
    // `Supervisor.tick()` del track en su próximo tick.
    emitFreezeRequest(ref: TrackRef, generationToken: string): void;
    // R6.2/R6.3/R6.6-R6.9/C7 (Task 11): únicos touches REALES de `merge-track`
    // — modelados 1:1 sobre `core/tracks/git.ts` (mismo criterio que
    // `addWorktree`/`initTrackJournal` arriba: la decisión de CUÁL de las dos
    // llamar sigue siendo de `decideJoinReconciliation`/`protocol.ts`, nunca
    // de esta interfaz — acá solo se declara la frontera fakeable).
    mergeFrozenTrack(repo: string, intent: JoinIntent): void;
    abortOwnedMerge(repo: string, intent: JoinIntent): void;
    // C7 (Task 11): "antes de mutar la rama del plan, el supervisor pausa su
    // controller generation y adquiere `integration.lock`" — se llama, en
    // efecto, una única vez por PROCESO vivo (la implementación de
    // producción memoiza el handle en un closure; llamadas subsiguientes,
    // mientras el mismo proceso siga vivo, son no-op). La liberación queda
    // para Task 12, tras el interlock final — este runtime nunca libera lo
    // que adquiere.
    //
    // Post-review fix (Finding 1, revisión de Task 11): el valor de retorno
    // distingue "esta llamada hizo trabajo real" (`'acquired'` — pausó la
    // generación del plan Y escribió `integration.lock` en disco, ambos
    // touches genuinos) de "ya estaba adquirido por este proceso, no-op"
    // (`'already-held'`). `runMergeTrack` usa esto para separar la
    // adquisición del lock del intento de merge en dos fronteras
    // `reconcileTracks()` distintas — antes, un `'acquired'` seguido en el
    // MISMO call de un `mergeFrozenTrack`/`abortOwnedMerge` colapsaba dos
    // mutaciones reales en una sola invocación (exactamente la clase de bug
    // que Task 8 encontró y arregló tres veces).
    ensureIntegrationLock(planJournalId: string, expectedPlanHeadSha: string): Promise<'acquired' | 'already-held'>;
}

export interface ReconcileTracksResult { state: JournalState; effectExecuted: string | null; }

const RUNTIME_EFFECTS = new Set(['create-worktree', 'create-track-journal', 'spawn-track-supervisor', 'begin-teardown', 'freeze-track', 'merge-track']);

function toProtocol(state: JournalState, maxParallel: number): CohortProtocol {
    const tracks: Record<string, TrackProtocolState> = {};
    for (const ref of state.tracks ?? []) {
        tracks[ref.trackId] = {
            trackId: ref.trackId,
            phase: ref.phase,
            fencingToken: ref.fencingToken,
            readinessNonce: ref.readinessNonce,
            frozenHeadSha: ref.frozenHeadSha,
            expectedPlanHeadSha: ref.joinIntent?.expectedPlanHeadSha,
            expectedTrackHeadSha: ref.joinIntent?.expectedTrackHeadSha,
            joinedCommitSha: ref.joinedCommitSha,
            blockedReason: ref.blockedReason,
        };
    }
    return {
        planJournalId: state.journalId,
        cohortPhase: state.cohortPhase ?? 'PREPARING',
        maxParallel,
        tracks,
        // R6.2/R6.3/C7 (Task 11): `cohortPlanHeadSha` es el HEAD real y
        // AVANZANTE de la rama del plan tras cada join aceptado — antes del
        // primer merge todavía no existe, y el HEAD real del plan en ese
        // momento ES `cohortBaseSha` (nada mutó la rama todavía). Usar
        // `cohortBaseSha` acá SIEMPRE (en vez de solo como fallback) sería el
        // bug: congelaría `expectedPlanHeadSha` en el base original para
        // TODOS los joins de la cohorte, rompiendo el segundo join en
        // adelante (C7 exige que cada join sucesivo valide contra el HEAD
        // real post-merge-anterior, no contra el punto de partida).
        planHeadSha: state.cohortPlanHeadSha ?? state.cohortBaseSha,
    };
}

/** Vuelca las decisiones de `protocol.ts` de regreso al `TrackRef[]` real —
 *  nunca al revés: esta función jamás decide, solo transcribe. */
function applyProtocolToState(state: JournalState, protocol: CohortProtocol): JournalState {
    const next = structuredClone(state);
    next.cohortPhase = protocol.cohortPhase;
    // R6.2/R6.3/C7 (Task 11): persistir el HEAD del plan avanzado por
    // `reconcileProtocol`'s `accept-merge` (`out.planHeadSha = decision.
    // joinedCommitSha`) — sin esto, el siguiente `toProtocol` volvería a leer
    // `cohortBaseSha` (stale) y el segundo join de la cohorte usaría un
    // `expectedPlanHeadSha` incorrecto.
    if (protocol.planHeadSha !== undefined) next.cohortPlanHeadSha = protocol.planHeadSha;
    next.tracks = (next.tracks ?? []).map((ref) => {
        const t = protocol.tracks[ref.trackId];
        if (t === undefined) return ref;
        return {
            ...ref,
            phase: t.phase,
            frozenHeadSha: t.frozenHeadSha,
            blockedReason: t.blockedReason,
            joinedCommitSha: t.joinedCommitSha,
            joinIntent: t.expectedPlanHeadSha !== undefined && t.expectedTrackHeadSha !== undefined
                ? { expectedPlanHeadSha: t.expectedPlanHeadSha, expectedTrackHeadSha: t.expectedTrackHeadSha, strategy: JOIN_STRATEGY_NO_FF }
                : ref.joinIntent,
        };
    });
    return next;
}

function persist(planRoot: string, branch: string, s: JournalState): JournalState {
    writeJournal(planRoot, branch, s);
    const r = readJournal(planRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto tras persistir tracks (R1.6)');
    return r.state;
}

function refOf(s: JournalState, trackId: string): TrackRef {
    const ref = s.tracks?.find((t) => t.trackId === trackId);
    if (ref === undefined) throw new Error(`invariante rota: TrackRef ausente para ${trackId}`);
    return ref;
}

function withRef(s: JournalState, trackId: string, patch: Partial<TrackRef>): JournalState {
    return { ...s, tracks: (s.tracks ?? []).map((t) => (t.trackId === trackId ? { ...t, ...patch } : t)) };
}

function mustBaseSha(s: JournalState): string {
    if (s.cohortBaseSha === undefined) throw new Error('invariante rota: cohortBaseSha ausente para una cohorte en PREPARING/ACTIVE');
    return s.cohortBaseSha;
}

interface EffectRunResult { state: JournalState; stop: boolean; executed: string | null; }

function runCreateWorktree(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'create-worktree' }>, runtime: TrackRuntime,
): EffectRunResult {
    const trackId = effect.trackId;
    const ref = refOf(s, trackId);
    // Task 9 (R4.2/R4.6/C11): observaciones read-only del mundo real ANTES de
    // tocar `runtime` — ninguna de las dos cuenta como el side effect del
    // tick, igual que documentaba la versión anterior de este comentario.
    // `ownedWorktreeExists` se consulta PRIMERO: un destino no vacío que ya
    // está registrado por git en la branch determinista de este track solo
    // puede ser NUESTRO, de un `addWorktree` que genuinamente corrió pero
    // crasheó antes de que este mismo bloque persistiera `worktree-observed`
    // — sin este chequeo, `foreignPathExists` (que no distingue "ajeno" de
    // "nuestro intento interrumpido") bloquearía el track para siempre.
    const observed: PrepareObservation = ownedWorktreeExists(planRoot, ref.worktreePath, ref.branch)
        ? { worktreeOwned: true }
        : { worktreeForeignNonEmpty: foreignPathExists(ref.worktreePath) };
    const decision = decidePrepare(protocol.tracks[trackId], observed);

    if (decision === 'accept-worktree') {
        const applied = observeProtocolEffect(protocol, effect, { kind: 'worktree-observed', trackId, owned: true });
        const next = persist(planRoot, branch, applyProtocolToState(s, applied));
        appendEvent(planRoot, branch, { kind: 'track-effect', trackId, effect: effect.kind });
        return { state: next, stop: true, executed: effect.kind };
    }
    if (decision === 'block-foreign') {
        const blocked = observeProtocolEffect(protocol, effect, { kind: 'worktree-observed', trackId, owned: false });
        const next = persist(planRoot, branch, applyProtocolToState(s, blocked));
        appendEvent(planRoot, branch, { kind: 'track-blocked', trackId, reason: 'worktree preexistente ajeno' });
        // Post-review fix (Task 8): bloquear un track es en sí mismo UNA
        // frontera — dejar `stop:false` acá permitía que el MISMO call
        // siguiera y tocara `runtime.addWorktree` de otro track (dos side
        // effects reales en un solo `reconcileTracks()`, rompiendo el
        // supuesto de Task 9 de que cada boundary es crash-injectable por
        // separado).
        return { state: next, stop: true, executed: null };
    }
    // decision === 'retry-worktree': ni ajeno ni nuestro todavía — recién
    // acá se toca `runtime` de verdad.
    try {
        runtime.addWorktree(planRoot, ref, mustBaseSha(s));
    } catch (error) {
        const failed = observeProtocolEffect(protocol, effect, { kind: 'effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        const next = persist(planRoot, branch, applyProtocolToState(s, failed));
        appendEvent(planRoot, branch, { kind: 'track-effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        return { state: next, stop: true, executed: effect.kind };
    }
    const applied = observeProtocolEffect(protocol, effect, { kind: 'worktree-observed', trackId, owned: true });
    const next = persist(planRoot, branch, applyProtocolToState(s, applied));
    appendEvent(planRoot, branch, { kind: 'track-effect', trackId, effect: effect.kind });
    return { state: next, stop: true, executed: effect.kind };
}

function runCreateTrackJournal(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'create-track-journal' }>, runtime: TrackRuntime,
): EffectRunResult {
    const trackId = effect.trackId;
    const ref = refOf(s, trackId);
    // GAP CONOCIDO Y DELIBERADAMENTE DIFERIDO (ver el comentario largo en
    // `apply.ts` junto a `track-prepare-request`): `taskIds`/`planDigest`
    // deberían nacer del plan .md parseado, pero NINGÚN task (1-8) provee un
    // mecanismo para que el supervisor localice ese archivo — decisión
    // humana pendiente sobre qué task lo resuelve. R2.1/R9.1: lo que SÍ es
    // autoridad
    // aquí es la identidad del track y el baseSha común de la cohorte.
    const context: TrackContext = { trackId, taskIds: [], planDigest: '', baseSha: mustBaseSha(s), planJournalId: s.journalId };
    // Task 9: a diferencia de `create-worktree`/`spawn-track-supervisor`,
    // `decidePrepare` no tiene nada que desambiguar acá — `write-descriptor`
    // es la única decisión posible en fase WORKTREE_CREATED, PORQUE
    // `runtime.initTrackJournal` ya es idempotente por construcción
    // (`initJournal` jamás pisa un `state.json` existente, `writeDescriptor`
    // sobreescribe con el mismo contenido siempre): reintentar tras un crash
    // en cualquier punto de esta llamada converge solo, sin necesitar
    // distinguir "primera vez" de "reintento". Se llama de todos modos para
    // que la autoridad de decisión sea siempre `protocol.ts`, nunca un
    // "por qué no hace falta acá" implícito en `tracks.ts`.
    if (decidePrepare(protocol.tracks[trackId], {}) !== 'write-descriptor') {
        throw new Error(`invariante rota: decidePrepare esperaba 'write-descriptor' para ${trackId}`);
    }
    try {
        runtime.initTrackJournal(ref, context);
    } catch (error) {
        const failed = observeProtocolEffect(protocol, effect, { kind: 'effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        const next = persist(planRoot, branch, applyProtocolToState(s, failed));
        appendEvent(planRoot, branch, { kind: 'track-effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        return { state: next, stop: true, executed: effect.kind };
    }
    const applied = observeProtocolEffect(protocol, effect, { kind: 'effect-applied', effect });
    const next = persist(planRoot, branch, applyProtocolToState(s, applied));
    appendEvent(planRoot, branch, { kind: 'track-effect', trackId, effect: effect.kind });
    return { state: next, stop: true, executed: effect.kind };
}

/** R5.2/R5.7/R5.8/R5.9/R6.3/R6.4/R6.5/C5 (Task 10): "freeze del track,
 *  quiescencia del plan y precondiciones de join". Deliberadamente NO usa
 *  `decidePrepare`/una fase intermedia `FREEZE_REQUESTED` persistida vía
 *  `effect-applied` — `nextProtocolEffect` solo re-emite `freeze-track`
 *  mientras `t.phase === 'JOIN_REQUESTED'` (ver `protocol.ts`), así que este
 *  driver progresa AL MISMO trackId en sucesivos ticks (como
 *  `runSpawnTrackSupervisor` progresa dentro de `SUPERVISOR_STARTING`) y
 *  recién transiciona la fase cuando emite `freeze-observation` (-> FROZEN),
 *  nunca antes.
 *
 * "El supervisor del plan solo acepta freeze cuando observa los seis hechos.
 *  No escribe directamente el journal del track" — este driver JAMÁS llama
 *  `writeJournal(ref.worktreePath, ...)`: solo LEE el journal propio del
 *  track (read-only, gathering nunca cuenta como el side effect del tick,
 *  mismo criterio que `foreignPathExists` en `runCreateWorktree`) y, si
 *  todavía no se pidió nada, escribe una `track-freeze-request` a su
 *  requestsDir vía `runtime.emitFreezeRequest` (el ÚNICO touch real de este
 *  efecto — el trabajo real de las 6 observaciones lo hace el propio
 *  `Supervisor.tick()` del track, en su journal, en su propio proceso). */
function runFreezeTrack(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'freeze-track' }>, runtime: TrackRuntime,
): EffectRunResult {
    const trackId = effect.trackId;
    const ref = refOf(s, trackId);

    const r = readJournal(ref.worktreePath, ref.branch);
    if (r.corrupt || r.state === null) {
        // Journal del track todavía no legible (crash entre `create-track-
        // journal` y esto no debería alcanzar acá — la cohorte exige ARMED
        // antes de ACTIVE — pero fail-closed: sin evidencia legible, nada se
        // asume, se reintenta en el próximo tick).
        return { state: s, stop: true, executed: null };
    }
    const trackState = r.state;

    if (trackState.frozen !== undefined) {
        // El track ya completó, DURABLEMENTE en SU journal, los 6 hechos
        // internos (drenado, gate local verde, worktree limpio, generación
        // propia terminada) — el plan re-verifica acá lo barato e
        // independientemente comprobable ANTES de aceptar (nunca confía
        // ciegamente en el autoreporte del track para lo que puede probar
        // por sí mismo): supervisor realmente caído + lock realmente
        // liberado. Gate/limpieza/drenado NO se re-verifican acá — son caros
        // de recomputar desde afuera (requieren el propio contexto de
        // fingerprint del track) y el propio track ya los probó bajo su lock
        // antes de persistir `frozen`.
        const supervisorAlive = ref.supervisorProcessRef !== undefined && refIsAlive(ref.supervisorProcessRef);
        const lockExists = fs.existsSync(supervisorLockPath(ref.worktreePath));
        if (supervisorAlive || lockExists) {
            // Paso 6 ("libera el lock y sale") todavía no confirmado desde
            // afuera: esperar al próximo tick (fail-closed, R6.4).
            return { state: s, stop: true, executed: null };
        }

        const observed = observeProtocolEffect(protocol, effect, {
            kind: 'freeze-observation', trackId, frozenHeadSha: trackState.frozen.headSha,
        });
        let next = applyProtocolToState(s, observed);

        // R5.7/R5.8/R5.9/C5 (Step 6): ownership REAL post-hoc, desde commits
        // YA congelados — nunca `git status` para esto (esa es la
        // herramienta de limpieza, no de ownership). `ref.ownership` es el
        // mismo campo que el plan ya lleva por track (hoy `[]` por el gap
        // conocido y deliberadamente diferido de `apply.ts` — parsear el .md
        // del plan sigue sin convención de descubrimiento; una vez que algo
        // lo popule, este consumidor funciona sin cambios).
        const parsedTrack: ParsedTrack = { trackId, taskIds: [], ownership: ref.ownership, dependsOn: [], sharedResources: [] };
        let actual: { outsideOwnership: string[]; globalClasses: string[] } = { outsideOwnership: [], globalClasses: [] };
        if (s.cohortBaseSha !== undefined) {
            try {
                const base = mergeBase(planRoot, s.cohortBaseSha, trackState.frozen.headSha);
                const changes = changedPaths(planRoot, base, trackState.frozen.headSha);
                actual = assessActualOwnership(parsedTrack, changes);
            } catch {
                // git indemostrable: no se afirma nada sobre ownership — ni
                // se bloquea el freeze por esto (Step 6 nunca revierte
                // merges ya hechos ni el propio freeze), simplemente no hay
                // evidencia nueva que registrar este tick.
            }
        }
        if (actual.globalClasses.length > 0) {
            const marks = actual.globalClasses.map((cls) => `${trackId}:${cls}`);
            next = {
                ...next,
                cohortParallelInvalidatedBy: [...new Set([...(next.cohortParallelInvalidatedBy ?? []), ...marks])],
            };
        }

        const persisted = persist(planRoot, branch, next);
        appendEvent(planRoot, branch, { kind: 'track-frozen-observed', trackId, frozenHeadSha: trackState.frozen.headSha });
        if (actual.outsideOwnership.length > 0) {
            appendEvent(planRoot, branch, { kind: 'track-ownership-violation', trackId, paths: actual.outsideOwnership });
        }
        if (actual.globalClasses.length > 0) {
            appendEvent(planRoot, branch, { kind: 'parallel-invalidated', trackId, classes: actual.globalClasses });
        }
        return { state: persisted, stop: true, executed: effect.kind };
    }

    if (trackState.freezeRequested === true) {
        // Ya se pidió: el propio track todavía está drenando/verificando —
        // nada nuevo que tocar este tick.
        return { state: s, stop: true, executed: null };
    }

    // Todavía no se pidió nada (según el journal del track): antes de tocar
    // `runtime`, un chequeo read-only barato — ¿ya hay una
    // `track-freeze-request` sin consumir en su requestsDir? (misma
    // convención que `ownedWorktreeExists`/`foreignPathExists` en
    // `runCreateWorktree`: gathering nunca cuenta como el side effect).
    // Sin esto, cada tick del plan mientras el track todavía no consumió
    // re-emitiría una request nueva — inofensivo (idempotente en `apply.ts`)
    // pero innecesario.
    let alreadyPending = false;
    try {
        alreadyPending = listPendingRequests(ref.worktreePath, ref.branch).some((p) => !p.corrupt && p.envelope.kind === 'track-freeze-request');
    } catch {
        alreadyPending = false;   // requestsDir todavía no listable: nada pendiente que se pueda probar
    }
    if (alreadyPending) return { state: s, stop: true, executed: null };

    // Emitir la request al journal PROPIO del track — único touch real de
    // este efecto. El `generationToken` viaja con la generación activa QUE
    // EL TRACK TIENE HOY; si no tiene ninguna, un sentinel no-vacío
    // (`isWellFormedEnvelope` exige `generationToken` no-vacío para CUALQUIER
    // request — R1.6, forma antes que contenido) que igual pasa el chequeo de
    // `consumePendingRequests`, porque ese chequeo solo compara contra
    // `activeToken` cuando `activeToken !== null`: sin generación activa,
    // cualquier token (sentinel incluido) se acepta igual. Un desfasaje entre
    // esta lectura y el consumo real produce, a lo sumo, un
    // `rejected-stale-generation` inofensivo — nunca corrompe nada, y el
    // próximo tick reintenta con una lectura fresca.
    const activeGen = trackState.generations.find((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
    runtime.emitFreezeRequest(ref, activeGen?.token ?? 'no-active-generation');
    appendEvent(planRoot, branch, { kind: 'track-freeze-requested', trackId });
    return { state: s, stop: true, executed: effect.kind };
}

/** R6.2/R6.6-R6.9/C7 (Task 11): gathering READ-ONLY del estado real de un
 *  intento de join — jamás cuenta como el side effect del tick (mismo
 *  criterio que `ownedWorktreeExists`/`foreignPathExists` en
 *  `runCreateWorktree`). `trackIsAncestor` solo se calcula cuando no hay
 *  `MERGE_HEAD` (si lo hay, la pregunta "¿ya se mergeó?" no aplica todavía —
 *  `decideJoinReconciliation` ni siquiera la consulta en ese caso). */
function gatherJoinObservation(
    planRoot: string, expectedTrackHeadSha: string,
): { mergeHead: string | null; planHead: string; trackIsAncestor: boolean } {
    const mergeHead = readMergeHead(planRoot);
    const planHead = headSha(planRoot);
    const trackIsAncestor = mergeHead === null ? isAncestor(planRoot, expectedTrackHeadSha, planHead) : false;
    return { mergeHead, planHead, trackIsAncestor };
}

/** R6.2/R6.3/R6.6-R6.9/C7 (Task 11): a lo sumo UN touch REAL de `merge-track`
 *  por invocación. Autoridad de DECISIÓN sigue siendo `decideJoinReconciliation`
 *  (`protocol.ts`, reexportada por `join.ts`) — este driver la llama dos
 *  veces con el MISMO criterio que `runCreateWorktree` llama `decidePrepare`
 *  y luego, por separado, `observeProtocolEffect`: una vez sobre la
 *  observación `before` para decidir CUÁL efecto git ejecutar (a lo sumo
 *  UNO: `mergeFrozenTrack` o `abortOwnedMerge`), y la fase final se persiste
 *  siempre a través de `observeProtocolEffect` (que la recalcula sobre la
 *  observación real, nunca confía en la excepción de la llamada a
 *  `runtime` por sí sola — un `git merge` que tira no prueba ni éxito ni
 *  fallo, la única fuente de verdad es releer el repo).
 *
 *  Post-review fix (Finding 1, revisión de Task 11): `ensureIntegrationLock`
 *  y el intento de merge/abort SON DOS fronteras `reconcileTracks()`
 *  distintas, no una — mismo criterio que `runSpawnTrackSupervisor` separa
 *  "persistir el supervisorIntent" de "spawnear/observar" (R1.8/C11). En el
 *  PRIMER tick de un proceso vivo, `ensureIntegrationLock` hace trabajo real
 *  (pausa la generación del plan + escribe `integration.lock`, dos
 *  mutaciones genuinas) — devuelve `'acquired'` y este driver corta ACÁ,
 *  `stop: true`, sin llegar siquiera a leer `gatherJoinObservation` ni a
 *  decidir `retry-merge`/`abort-own-merge`. Recién el PRÓXIMO
 *  `reconcileTracks()`, con el lock ya confirmado held (`'already-held'`,
 *  no-op memoizado en el mismo proceso), este driver continúa y intenta el
 *  merge/abort. Tras un crash real entre ambas fronteras, un proceso nuevo
 *  repite el mismo `'acquired'` (reclamando identidad muerta, misma lógica
 *  que `acquireIntegrationLock` ya prueba) y vuelve a cortar ahí — nunca
 *  colapsa las dos mutaciones en un solo call. La liberación del lock sigue
 *  siendo responsabilidad de Task 12 (después del interlock final) — este
 *  driver JAMÁS libera lo que adquiere acá. */
async function runMergeTrack(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'merge-track' }>, runtime: TrackRuntime,
): Promise<EffectRunResult> {
    const trackId = effect.trackId;
    const intent: JoinIntent = {
        expectedPlanHeadSha: effect.expectedPlanHeadSha,
        expectedTrackHeadSha: effect.expectedTrackHeadSha,
        strategy: JOIN_STRATEGY_NO_FF,
    };

    // C7: antes de la PRIMERA mutación real de la rama del plan — pausa la
    // generación del plan y adquiere `integration.lock` (primitivos de Task
    // 10, sin ningún caller hasta acá). Si esta llamada tuvo que hacer
    // trabajo real (`'acquired'`), ESE es el único touch de este tick: se
    // corta acá (ver el comentario grande arriba) — el intento de merge
    // queda para el próximo `reconcileTracks()`, una vez el lock ya esté
    // `'already-held'` (no-op memoizado mientras el mismo proceso siga vivo).
    const lockState = await runtime.ensureIntegrationLock(s.journalId, intent.expectedPlanHeadSha);
    if (lockState === 'acquired') {
        appendEvent(planRoot, branch, { kind: 'track-integration-lock-acquired', trackId });
        return { state: s, stop: true, executed: effect.kind };
    }

    const before = gatherJoinObservation(planRoot, intent.expectedTrackHeadSha);
    const decision = decideJoinReconciliation(intent, before);

    if (decision.action === 'retry-merge') {
        let detail: string | undefined;
        try {
            runtime.mergeFrozenTrack(planRoot, intent);
        } catch (error) {
            // Conflicto real o HEAD del plan movido bajo nuestros pies: NUNCA
            // se asume cuál de los dos fue por la excepción sola — la
            // relectura de abajo es la única fuente de verdad (R6.8). El
            // mensaje SÍ se conserva como `detail` diagnóstico en el evento
            // (Finding 2) — nunca para decidir, solo para que un operador
            // mirando el log pueda distinguir un conflicto benigno (que
            // resuelve solo en el próximo retry) de un repo estructuralmente
            // roto (permisos, disco lleno, git roto) que retrearía en
            // silencio para siempre sin esto.
            detail = (error as Error).message;
        }
        const after = gatherJoinObservation(planRoot, intent.expectedTrackHeadSha);
        const observed = observeProtocolEffect(protocol, effect, { kind: 'join-observation', trackId, ...after });
        const next = persist(planRoot, branch, applyProtocolToState(s, observed));
        appendEvent(planRoot, branch, { kind: 'track-merge-attempted', trackId, detail });
        return { state: next, stop: true, executed: effect.kind };
    }

    if (decision.action === 'abort-own-merge') {
        let detail: string | undefined;
        try {
            runtime.abortOwnedMerge(planRoot, intent);
        } catch (error) {
            // Igual criterio que arriba: la relectura decide, nunca la
            // excepción (ej. una carrera real donde el MERGE_HEAD dejó de
            // ser nuestro entre `before` y este intento de abort) — el
            // mensaje se conserva solo como `detail` diagnóstico (Finding 2).
            detail = (error as Error).message;
        }
        const after = gatherJoinObservation(planRoot, intent.expectedTrackHeadSha);
        const observed = observeProtocolEffect(protocol, effect, { kind: 'join-observation', trackId, ...after });
        const next = persist(planRoot, branch, applyProtocolToState(s, observed));
        appendEvent(planRoot, branch, { kind: 'track-merge-aborted', trackId, detail });
        return { state: next, stop: true, executed: effect.kind };
    }

    // 'accept-merge' / 'block': la observación YA leída (`before`) alcanza —
    // ningún efecto git nuevo que ejecutar este tick (mismo criterio que
    // `runCreateWorktree`'s ramas 'accept-worktree'/'block-foreign').
    const observed = observeProtocolEffect(protocol, effect, { kind: 'join-observation', trackId, ...before });
    const next = persist(planRoot, branch, applyProtocolToState(s, observed));
    appendEvent(planRoot, branch, {
        kind: decision.action === 'accept-merge' ? 'track-merged' : 'track-blocked',
        trackId, ...(decision.action === 'block' ? { reason: decision.reason } : {}),
    });
    return { state: next, stop: true, executed: effect.kind };
}

/** cliEntry: mismo patrón que `defaultWrapperSpawner` en runner.ts — desde
 *  `dist/src/commands/watch/tracks.js`, `../../` resuelve a `dist/src/index.js`. */
function defaultCliEntry(): string {
    return path.resolve(__dirname, '..', '..', 'index.js');
}

function runSpawnTrackSupervisor(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'spawn-track-supervisor' }>, runtime: TrackRuntime,
): EffectRunResult {
    const trackId = effect.trackId;
    const ref = refOf(s, trackId);
    if (ref.supervisorIntent === undefined) {
        // R1.8/C11: el intent (nonce + argv + claimPath) se persiste ANTES de
        // spawnear nada — si el supervisor del plan muere justo acá, el
        // próximo tick reintenta el MISMO intent, nunca uno nuevo.
        const supervisorNonce = crypto.randomBytes(16).toString('hex');
        const intent = {
            nonce: supervisorNonce,
            // R4.7/C11: `--nonce` viaja explícito en el argv — es el MISMO
            // valor que `observeSupervisorFromDisk` va a exigir de vuelta en
            // el identity sidecar del wrapper (BLOCKER post-review: el
            // wrapper NUNCA debe generar el suyo propio, o jamás matchea).
            argv: [process.execPath, defaultCliEntry(), 'track', 'supervisor-wrapper', '--track', ref.trackId,
                '--readiness', ref.readinessNonce, '--fence', ref.fencingToken, '--nonce', supervisorNonce],
            claimPath: path.join(ref.worktreePath, '.awm', 'supervisor.claim'),
        };
        const applied = observeProtocolEffect(protocol, effect, { kind: 'effect-applied', effect });
        const next = persist(planRoot, branch, withRef(applyProtocolToState(s, applied), trackId, { supervisorIntent: intent }));
        appendEvent(planRoot, branch, { kind: 'track-supervisor-intent', trackId });
        // Post-review fix: persistir el supervisorIntent es en sí mismo UNA
        // frontera durable (R1.8/C11) — con `stop:false` el MISMO call podía
        // seguir de largo y llamar a `runtime.observeSupervisor`/
        // `spawnSupervisor` en la misma invocación, colapsando dos
        // boundaries ("intent persistido" y "supervisor consultado/spawneado")
        // que Task 9 necesita poder crashear por separado.
        return { state: next, stop: true, executed: null };
    }
    // Task 9 (R4.2/C11, reemplaza el gate anterior basado ÚNICAMENTE en
    // `ref.supervisorProcessRef === undefined`): SIEMPRE se observa el mundo
    // real primero — read-only, jamás cuenta como el side effect del tick,
    // mismo criterio que `foreignPathExists`/`ownedWorktreeExists` en
    // `runCreateWorktree` — y es `decidePrepare` (protocol.ts) quien decide
    // qué hacer con lo observado. Esto es una optimización real, no la
    // garantía de correctitud: en el caso común (crash después de que el
    // wrapper ya escribió claim/identity/ready en disco) evita un
    // `spawnSupervisor` redundante. Pero sigue existiendo una ventana
    // angosta entre que `runtime.spawnSupervisor` forkea el proceso real y
    // que ESE proceso escribe su claim (`supervisor-wrapper.ts`, `fs.openSync`
    // con `wx`) — un crash justo ahí deja `observeSupervisor` en `'absent'`
    // y `decidePrepare` vuelve a pedir `retry-supervisor-same-intent`, o sea
    // un segundo fork real. Lo que impide que eso deje dos supervisores
    // vivos es el propio claim atómico `wx` del wrapper (mismo patrón que
    // `job/exec-wrapper.ts`/`reconcile.ts`): el wrapper perdedor recibe
    // `EEXIST` en su propio intento de claim y sale como "already-claimed"
    // antes de escribir identity/ready o lanzar `awm watch` — inofensivo,
    // no prevenido acá.
    const observation = runtime.observeSupervisor(ref);
    const decision = decidePrepare(protocol.tracks[trackId], { supervisorArtifact: observation.kind });

    if (decision === 'block-foreign') {
        const blocked = observeProtocolEffect(protocol, effect, { kind: 'supervisor-observed', trackId, identity: 'other' });
        const next = persist(planRoot, branch, applyProtocolToState(s, blocked));
        appendEvent(planRoot, branch, { kind: 'track-blocked', trackId, reason: 'identidad de supervisor ajena' });
        return { state: next, stop: true, executed: null };
    }

    if (decision === 'retry-supervisor-same-intent') {
        if (ref.supervisorProcessRef === undefined) {
            // Observación confirma 'absent': recién ACÁ se toca `runtime` de
            // verdad. Leer (no-mutante) y, si de veras no hay nada, spawnear
            // (mutante) en el MISMO call sigue siendo UNA sola frontera
            // mutante por invocación — igual patrón que
            // `foreignPathExists` -> `addWorktree` en `runCreateWorktree`.
            const pr = runtime.spawnSupervisor(ref);
            const next = pr !== undefined ? persist(planRoot, branch, withRef(s, trackId, { supervisorProcessRef: pr })) : s;
            appendEvent(planRoot, branch, { kind: 'track-effect', trackId, effect: effect.kind });
            return { state: next, stop: true, executed: effect.kind };
        }
        // `supervisorProcessRef` ya persistido (spawn de un tick anterior)
        // pero el wrapper todavía no escribió ni su claim: ventana de
        // arranque normal, nada que hacer todavía.
        return { state: s, stop: true, executed: null };
    }

    // 'accept-readiness': ya hay evidencia real en disco de un intento
    // previo (posiblemente de una instancia que crasheó antes de persistir
    // `supervisorProcessRef`) — NUNCA volver a llamar `spawnSupervisor`
    // (C11). C8 decide acá mismo si el nonce observado corresponde.
    if (observation.kind === 'claimed') {
        // Claim tomado pero identidad/readiness todavía no observables:
        // esperar al próximo tick, nada que persistir.
        return { state: s, stop: true, executed: null };
    }
    if (observation.kind === 'ready') {
        const observed = observeProtocolEffect(protocol, effect, {
            kind: 'supervisor-observed', trackId, identity: 'expected', readinessNonce: observation.readinessNonce,
        });
        const next = persist(planRoot, branch, applyProtocolToState(s, observed));
        appendEvent(planRoot, branch, { kind: 'track-armed-or-blocked', trackId });
        return { state: next, stop: true, executed: null };
    }
    // Defensivo: `decidePrepare`/`observeSupervisor` ya cubrieron
    // exhaustivamente absent/foreign/claimed/ready arriba (fail-closed).
    throw new Error(`invariante rota: observación de supervisor no manejada para ${trackId}`);
}

/** Fases del teardown provisorio (Step 5, T13 reemplaza el cuerpo sin cambiar
 *  `TrackRuntime.teardownOwned`) que ya dejaron TODO su trabajo real hecho —
 *  `nextProtocolEffect` sigue emitiendo `begin-teardown` para este trackId
 *  hasta que llegue a `REMOVED` (no hay un `ProtocolEffect` por paso; son
 *  transiciones mecánicas, siempre en el mismo orden, sin ninguna decisión
 *  que dependa de una observación — por eso `tracks.ts` las persiste
 *  directamente en vez de rebotarlas por `observeProtocolEffect`). */
const TEARDOWN_STEP_FOR_PHASE: Partial<Record<TrackRef['phase'], TeardownStep>> = {
    TEARDOWN_INTENT: 'supervisor', SUPERVISOR_STOPPED: 'worktree', WORKTREE_REMOVED: 'branch',
};
const TEARDOWN_NEXT_PHASE: Record<TeardownStep, TrackRef['phase']> = {
    supervisor: 'SUPERVISOR_STOPPED', worktree: 'WORKTREE_REMOVED', branch: 'BRANCH_REMOVED',
};

async function runBeginTeardown(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'begin-teardown' }>, runtime: TrackRuntime,
): Promise<EffectRunResult> {
    const trackId = effect.trackId;
    const ref = refOf(s, trackId);

    if (TEARDOWN_STEP_FOR_PHASE[ref.phase] === undefined && ref.phase !== 'BRANCH_REMOVED') {
        // Primera vez que este trackId entra a teardown (venía de cualquier
        // fase de trabajo, o de un teardown que crasheó antes de persistir
        // siquiera `TEARDOWN_INTENT`): la única transición que SÍ pasa por
        // `protocol.ts` (`EFFECT_APPLIED_PHASE['begin-teardown']` ya la
        // mapea a `TEARDOWN_INTENT`), el resto de los pasos son mecánicos.
        const applied = observeProtocolEffect(protocol, effect, { kind: 'effect-applied', effect });
        const next = persist(planRoot, branch, applyProtocolToState(s, applied));
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: 'TEARDOWN_INTENT' });
        return { state: next, stop: true, executed: null };
    }

    const step = TEARDOWN_STEP_FOR_PHASE[ref.phase];
    if (step !== undefined) {
        const result = await runtime.teardownOwned(ref, step);
        if (result === 'blocked') {
            const blocked = observeProtocolEffect(protocol, effect, { kind: 'teardown-blocked', trackId, detail: `paso de teardown '${step}' indemostrable` });
            const next = persist(planRoot, branch, applyProtocolToState(s, blocked));
            appendEvent(planRoot, branch, { kind: 'track-blocked', trackId, reason: `teardown:${step}` });
            return { state: next, stop: true, executed: effect.kind };
        }
        const nextPhase = TEARDOWN_NEXT_PHASE[step];
        const next = persist(planRoot, branch, withRef(s, trackId, { phase: nextPhase }));
        appendEvent(planRoot, branch, { kind: 'track-teardown-step', trackId, step: nextPhase });
        return { state: next, stop: true, executed: effect.kind };
    }

    // ref.phase === 'BRANCH_REMOVED': worktree y branch ya se removieron —
    // solo falta la observación de protocolo (autoridad única) que marca el
    // track REMOVED de verdad, la misma que `protocol.test.ts` ya explora
    // para el efecto `begin-teardown` (Step 3/T1).
    const removed = observeProtocolEffect(protocol, effect, { kind: 'track-removed', trackId });
    const next = persist(planRoot, branch, applyProtocolToState(s, removed));
    appendEvent(planRoot, branch, { kind: 'track-removed', trackId });
    return { state: next, stop: true, executed: effect.kind };
}

async function executeRuntimeEffect(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: ProtocolEffect, runtime: TrackRuntime,
): Promise<EffectRunResult> {
    if (effect.kind === 'create-worktree') return runCreateWorktree(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'create-track-journal') return runCreateTrackJournal(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'begin-teardown') return runBeginTeardown(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'freeze-track') return runFreezeTrack(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'merge-track') return runMergeTrack(planRoot, branch, s, protocol, effect, runtime);
    return runSpawnTrackSupervisor(planRoot, branch, s, protocol, effect as Extract<ProtocolEffect, { kind: 'spawn-track-supervisor' }>, runtime);
}

/**
 * Driver de P1/P2: construye la vista pura desde el journal, pide la
 * siguiente decisión a `protocol.ts`, y la ejecuta. SOLO las transiciones
 * puramente en memoria y sin consecuencia observable fuera del journal
 * (`persist-prepare-intent`, `activate-cohort`, `activate-track`) se drenan
 * dentro del mismo call —persistiendo cada una antes de seguir—, porque no
 * cruzan ninguna frontera con el mundo real ni bloquean nada.
 *
 * TODO lo demás cuenta como UNA frontera y detiene el call ahí mismo, aunque
 * en sí mismo no haya llamado a `runtime` todavía: persistir un
 * `supervisorIntent` (R1.8 — el intent debe quedar durable ANTES de que
 * cualquier llamada futura a `runtime.spawnSupervisor` pueda ocurrir, en un
 * tick DISTINTO), bloquear un track por ajeno (R4.6), y por supuesto
 * cualquier consulta real a `runtime`
 * (`addWorktree`/`initTrackJournal`/`spawnSupervisor`/`observeSupervisor`).
 * Un `reconcileTracks()` jamás cruza dos de estas fronteras en el mismo call
 * — ni dos tracks distintos, ni dos pasos del mismo track — precisamente
 * para que Task 9 pueda inyectar un crash exactamente después de cualquiera
 * de ellas y probar que el restart converge (post-review fix: la versión
 * original dejaba `stop:false` en el bloqueo por ajeno y en el persist del
 * `supervisorIntent`, permitiendo que un solo call colapsara dos fronteras).
 * Esto es también lo que mantiene visible, entre dos ticks, el estado
 * "todos ARMED pero la cohorte todavía no activó" (C1).
 *
 * `async` desde Task 9 (Step 5): el paso `supervisor` de `begin-teardown`
 * termina el grupo del supervisor con `terminatePreviouslyOwnedGroup`
 * (identity-verified, R4.8), que espera una escalera de gracia real
 * (SIGTERM -> confirmar -> SIGKILL -> confirmar) — jamás un `kill(pid)` sin
 * confirmación. Todo caller sigue siendo dueño de awaitear el resultado
 * (ver `Supervisor.tick`); ningún test que llame a `reconcileTracks`
 * directamente puede seguir tratándolo como síncrono.
 */
export async function reconcileTracks(
    planRoot: string, branch: string, state: JournalState, runtime: TrackRuntime, maxParallel: number,
): Promise<ReconcileTracksResult> {
    let s = state;
    for (;;) {
        if (s.tracks === undefined || s.tracks.length < 2 || s.cohortPhase === undefined) {
            return { state: s, effectExecuted: null };
        }
        const protocol = toProtocol(s, maxParallel);
        const effect = nextProtocolEffect(protocol);
        if (effect === null) return { state: s, effectExecuted: null };

        if (!RUNTIME_EFFECTS.has(effect.kind)) {
            const applied = observeProtocolEffect(protocol, effect, { kind: 'effect-applied', effect });
            const candidate = applyProtocolToState(s, applied);
            // Defensivo: un ProtocolEffect sin fase mapeada en `EFFECT_APPLIED_PHASE`
            // (ej. `merge-track`/`request-global-qa`, todavía sin driver propio en
            // esta task — llegan en Tasks 11/12) no debe hacer que este loop gire
            // para siempre repitiendo el mismo efecto sin progreso observable.
            if (candidate.cohortPhase === s.cohortPhase && JSON.stringify(candidate.tracks) === JSON.stringify(s.tracks)) {
                return { state: s, effectExecuted: null };
            }
            s = persist(planRoot, branch, candidate);
            const trackId = 'trackId' in effect ? effect.trackId : undefined;
            const label = trackId !== undefined ? (s.tracks?.find((t) => t.trackId === trackId)?.phase ?? effect.kind) : s.cohortPhase;
            appendEvent(planRoot, branch, { kind: 'track-protocol-persist', effect: effect.kind, trackId, phase: label });
            continue;
        }

        const result = await executeRuntimeEffect(planRoot, branch, s, protocol, effect, runtime);
        s = result.state;
        if (result.stop) return { state: s, effectExecuted: result.executed };
    }
}

/**
 * R6.2/R6.8/C7 (Task 11): reconcilia un `MERGE_HEAD` REAL dejado abierto por
 * un crash a mitad de un `merge-track` — se llama desde `Supervisor.tick()`
 * ANTES de `verifyBranchInvariant` (y de cualquier guard general futuro que
 * pudiera rechazar el repo por estar "a mitad de un merge"): hoy ningún
 * guard existente rechaza por `MERGE_HEAD` (ni `verifyBranchInvariant` — solo
 * compara nombre de rama — ni ningún otro), pero esta función corre primero
 * de todos modos para que uno agregado en el futuro nunca pueda rechazar un
 * estado que ya es reconciliable.
 *
 * Deliberadamente NO reimplementa la decisión: si el `MERGE_HEAD` observado
 * coincide con el `joinIntent.expectedTrackHeadSha` de un track propio en
 * `JOIN_INTENT`, delega en el mismísimo `reconcileTracks` (que, sobre ese
 * estado, computa `merge-track` como su próximo efecto y lo ejecuta vía
 * `runMergeTrack` — CERO lógica duplicada). Si el `MERGE_HEAD` no es
 * atribuible a ningún intent propio (ajeno o indemostrable), no toca nada —
 * fail-closed, deja que el guard/operador que corresponda decida.
 *
 * Devuelve `handled: true` cuando efectivamente ejecutó `reconcileTracks` —
 * el caller (`Supervisor.tick`) usa esto para NO volver a invocarlo más
 * tarde en el mismo tick (a lo sumo UNA mutación real de tracks por tick,
 * mismo invariante que ya sostiene `reconcileTracks` por sí solo).
 */
export async function reconcileOpenJoin(
    planRoot: string, branch: string, state: JournalState, runtime: TrackRuntime, maxParallel: number,
): Promise<{ handled: boolean; state: JournalState }> {
    if (state.tracks === undefined || state.tracks.length < 2 || state.cohortPhase === undefined) {
        return { handled: false, state };
    }
    let mergeHead: string | null;
    try {
        mergeHead = readMergeHead(planRoot);
    } catch {
        // Indemostrable acá: se deja para el `reconcileTracks` normal de este
        // mismo tick (o el próximo) — esta función es un adelanto oportunista,
        // nunca la única vía de reconciliación.
        return { handled: false, state };
    }
    if (mergeHead === null) return { handled: false, state };
    const ownsIt = state.tracks.some((t) => t.phase === 'JOIN_INTENT' && t.joinIntent?.expectedTrackHeadSha === mergeHead);
    if (!ownsIt) return { handled: false, state }; // MERGE_HEAD ajeno o sin intent propio que lo explique (fail-closed)
    const result = await reconcileTracks(planRoot, branch, state, runtime, maxParallel);
    return { handled: true, state: result.state };
}

// --- Implementación de producción (wiring real de watch/supervisor.ts) -----

function planDescriptorContext(planRoot: string, planBranch: string): { planRoot: string; planBranch: string } {
    return { planRoot: fs.realpathSync(planRoot), planBranch };
}

/** Lee los sidecars que `track supervisor-wrapper` (Step 5) escribe en el
 *  propio worktree del track: claim -> identity -> ready, en ese orden — el
 *  mismo contrato de `exec-wrapper.ts` (claim/identity/result), adaptado al
 *  supervisor de un track en vez de a un job. */
export function observeSupervisorFromDisk(ref: TrackRef): SupervisorObservation {
    if (ref.supervisorIntent === undefined) return { kind: 'absent' };
    const claimPath = ref.supervisorIntent.claimPath;
    const dir = path.dirname(claimPath);
    if (!fs.existsSync(claimPath)) return { kind: 'absent' };
    const identityPath = path.join(dir, 'supervisor.identity.json');
    if (!fs.existsSync(identityPath)) return { kind: 'claimed' };
    let identity: { nonce?: unknown };
    try {
        identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    } catch {
        return { kind: 'foreign' };
    }
    if (identity.nonce !== ref.supervisorIntent.nonce) return { kind: 'foreign' };
    const readyPath = path.join(dir, 'supervisor.ready.json');
    if (!fs.existsSync(readyPath)) return { kind: 'claimed' };
    let ready: { readinessNonce?: unknown };
    try {
        ready = JSON.parse(fs.readFileSync(readyPath, 'utf8'));
    } catch {
        return { kind: 'claimed' };
    }
    if (typeof ready.readinessNonce !== 'string') return { kind: 'claimed' };
    return { kind: 'ready', readinessNonce: ready.readinessNonce };
}

export interface TeardownGrace { termGraceMs: number; killGraceMs: number; }

/** Grace por defecto si el caller no provee una explícita (ej. tests viejos
 *  de `defaultTrackRuntime` que no ejercitan teardown): mismo orden de
 *  magnitud que `DEFAULT_SUPERVISOR_CONFIG` en `supervisor.ts`, nunca cero
 *  (una escalera SIGTERM->SIGKILL sin ventana de gracia no es una escalera). */
const DEFAULT_TEARDOWN_GRACE: TeardownGrace = { termGraceMs: 30000, killGraceMs: 5000 };

/** Implementación real de `TrackRuntime`, inyectada por `Supervisor` en
 *  producción. Los tests de `reconcileTracks` usan un fake — ningún proceso
 *  ni worktree real se toca fuera de esta función. */
export function defaultTrackRuntime(planRoot: string, planBranch: string, grace: TeardownGrace = DEFAULT_TEARDOWN_GRACE): TrackRuntime {
    // C7 (Task 11): memoizado por CLOSURE — vive tanto como este runtime
    // (creado una vez por `Supervisor`, ver su constructor). Un proceso
    // nuevo tras un crash real construye un `defaultTrackRuntime` fresco
    // (`integrationLock === null` de nuevo) y `acquireIntegrationLock`
    // reclama con su propia lógica de identidad muerta probada — nunca acá.
    let integrationLock: IntegrationLockHandle | null = null;
    return {
        addWorktree(root, ref, baseSha) {
            // CRITICAL post-review fix: `git check-ignore` es una operación de
            // working-tree — solo puede responder por lo que está REALMENTE
            // checkeado en algún lado. El repo del plan vive en su HEAD vivo,
            // que puede ser un commit distinto (posterior) de `baseSha`; si un
            // `.gitignore` para `.awm` se agregó (o quitó) entre `baseSha` y
            // HEAD, chequear contra `root` responde por un árbol que el
            // worktree que estamos por crear NUNCA va a tener. La única
            // verificación honesta es contra el worktree YA CREADO, checkeado
            // en `baseSha` de verdad — así que primero se crea, y recién
            // después se verifica. Si falla, el worktree es NUESTRO (lo
            // acabamos de crear en esta misma llamada) y se descarta —
            // jamás queda vivo e inseguro (C2 fail-closed).
            addOwnedWorktree(root, ref, baseSha);
            if (!isAwmGitignored(ref.worktreePath)) {
                removeOwnedWorktree(root, ref.worktreePath);
                throw new Error('`.awm` no está gitignoreado en el worktree recién creado (checkeado en baseSha): se descarta (degradación C2)');
            }
        },
        initTrackJournal(ref, context) {
            initJournal(ref.worktreePath, ref.branch);
            const r = readJournal(ref.worktreePath, ref.branch);
            if (r.corrupt || r.state === null) throw new Error('journal de track corrupto tras init');
            const s = r.state;
            if (s.trackContext !== undefined && s.trackContext.trackId !== context.trackId) {
                // R4.6: un trackContext ajeno preexistente jamás se sobreescribe.
                throw new Error(`trackContext preexistente pertenece a otro track: ${s.trackContext.trackId}`);
            }
            if (s.trackContext === undefined) {
                s.trackContext = context;
                writeJournal(ref.worktreePath, ref.branch, s);
            }
            const plan = planDescriptorContext(planRoot, planBranch);
            writeDescriptor(ref.worktreePath, {
                schema: 1, planRoot: plan.planRoot, planBranch: plan.planBranch,
                trackId: ref.trackId, planJournalId: context.planJournalId, fencingToken: ref.fencingToken,
            });
        },
        spawnSupervisor(ref) {
            if (ref.supervisorIntent === undefined) return undefined;
            const { child, ref: pref } = spawnStructured(ref.supervisorIntent.argv, ref.worktreePath, ref.supervisorIntent.nonce);
            child.unref();   // detached: el supervisor del plan jamás espera al del track (R4.7)
            return pref;
        },
        observeSupervisor: observeSupervisorFromDisk,
        // R5.2/R6.3 (Task 10): `emitRequest` ya es el primitivo durable
        // genérico de `core/journal/requests.ts` — cross-worktree acá solo
        // significa "el primer argumento no es `planRoot`, es el worktree
        // del TRACK" (`requestsDir` no distingue de quién es el journal).
        emitFreezeRequest(ref, generationToken) {
            emitRequest(ref.worktreePath, ref.branch, {
                kind: 'track-freeze-request',
                generationToken,
                idempotencyKey: `freeze-${ref.trackId}-${ref.fencingToken}`,
                payload: { trackId: ref.trackId, fencingToken: ref.fencingToken },
            });
        },
        // Task 9 (interfaz TEMPORAL, ver `TrackRuntime.teardownOwned`): cada
        // paso es idempotente ante reintento tras crash — "nada que remover"
        // nunca lanza, es éxito vacuo (R4.2).
        async teardownOwned(ref, step) {
            if (step === 'supervisor') {
                if (ref.supervisorProcessRef === undefined) return 'ok'; // nunca llegamos a spawnear: nada que terminar
                if (groupIsGone(ref.supervisorProcessRef.processGroup)) return 'ok';
                // R4.8: identity-verified — jamás un `kill(pid)` crudo. Un
                // `pgid` reutilizado por OTRO proceso nunca se confunde con
                // el nuestro (`terminatePreviouslyOwnedGroup` reenvía la
                // señal al PGID capturado, pero solo tras haber confirmado
                // que el grupo sigue existiendo; la identidad completa ya se
                // verificó al capturar `supervisorProcessRef` en el spawn).
                const confirmed = await terminatePreviouslyOwnedGroup(ref.supervisorProcessRef, grace);
                return confirmed ? 'ok' : 'blocked';
            }
            if (step === 'worktree') {
                if (!fs.existsSync(ref.worktreePath)) return 'ok'; // nunca se creó (ej. create-worktree falló antes de mutar nada)
                removeOwnedWorktree(planRoot, ref.worktreePath);
                return 'ok';
            }
            // 'branch': `removeOwnedBranch` ya es idempotente (no-op si no existe).
            removeOwnedBranch(planRoot, ref.branch);
            return 'ok';
        },
        // R6.2/R6.3/C7 (Task 11): delega 1:1 en `core/tracks/git.ts` — la
        // decisión de CUÁL llamar (o si bloquear en su lugar) es siempre de
        // `decideJoinReconciliation`/`runMergeTrack`, nunca de acá.
        mergeFrozenTrack(repo, intent) {
            gitMergeFrozenTrack(repo, intent);
        },
        abortOwnedMerge(repo, intent) {
            gitAbortOwnedMerge(repo, intent);
        },
        async ensureIntegrationLock(planJournalId, expectedPlanHeadSha) {
            if (integrationLock !== null) return 'already-held';   // ya adquirido por este proceso: no-op
            await stopControllerGenerationConfirmed(planRoot, planBranch, grace);
            integrationLock = acquireIntegrationLock(planRoot, { planJournalId, expectedPlanHeadSha });
            return 'acquired';
        },
    };
}
