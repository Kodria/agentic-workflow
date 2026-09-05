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
import { computeFingerprint } from '../../core/journal/fingerprint';
import { decidePrepare, decideJoinReconciliation, nextProtocolEffect, observeProtocolEffect, reconcileProtocol } from '../../core/tracks/protocol';
import {
    addOwnedWorktree, isAwmGitignored, foreignPathExists, ownedWorktreeExists,
    mergeBase, changedPaths, headSha, readMergeHead, isAncestor, dirtyPaths,
    mergeFrozenTrack as gitMergeFrozenTrack, abortOwnedMerge as gitAbortOwnedMerge,
    removeOwnedWorktree as gitRemoveOwnedWorktree, removeOwnedBranch as gitRemoveOwnedBranch,
} from '../../core/tracks/git';
import { assessActualOwnership } from '../../core/tracks/ownership';
import { writeDescriptor } from '../../core/tracks/descriptor';
import { acquireIntegrationLock, releaseIntegrationLock, stopControllerGenerationConfirmed } from '../../core/tracks/join';
import { runBeginTeardown } from './teardown-driver';
import { requestJob } from '../job/request';
import { computeGate, FingerprintNow } from '../job/gate';
import { spawnStructured, groupIsGone, terminatePreviouslyOwnedGroup } from '../../core/journal/process';
import { JOIN_STRATEGY_NO_FF } from '../../core/tracks/types';
import type { CohortProtocol, JoinIntent, PrepareObservation, ProtocolEffect, TrackPhase, TrackProtocolState } from '../../core/tracks/types';
import type { IntegrationLockHandle } from '../../core/tracks/join';
import type { ParsedTrack } from '../../core/tracks/plan-parser';
import type { JournalState, TrackContext, TrackRef, ProcessRef } from '../../core/journal/types';

/** R8.1 (Task 12): pura, sin I/O — nombra los tracks que todavía no llegaron a
 *  `MERGED_UNVERIFIED` (el ciclo permanece IN_PROGRESS mientras existan). Vive
 *  acá (no en `core/tracks/protocol.ts`) porque no es una decisión de
 *  transición de fase — `nextProtocolEffect` YA calcula la misma condición
 *  internamente para decidir `request-global-qa` (`protocol.ts` sigue siendo
 *  la única autoridad de esa transición); esto es solo un helper de
 *  DIAGNÓSTICO/consulta sobre el mismo criterio, para que un caller (CLI,
 *  logging) pueda nombrar qué falta sin duplicar la condición a mano.
 *
 *  Semántica sutil de "pendiente": un track cuenta como pendiente si TODAVÍA
 *  NO llegó a `MERGED_UNVERIFIED` **o más allá**. `JOINED` es la fase que
 *  sigue a `MERGED_UNVERIFIED` (ver `TRACK_PHASES` en `core/tracks/types.ts`
 *  y el observation `interlock-pass` en `protocol.ts`, que mueve TODOS los
 *  tracks a `JOINED` a la vez al cerrar la cohorte) — un track `JOINED` ya
 *  superó el hito que este helper vigila, así que NO es pendiente, aunque
 *  `JOINED !== 'MERGED_UNVERIFIED'` textualmente. Comparar solo contra
 *  `'MERGED_UNVERIFIED'` sin excluir también `'JOINED'` marcaría
 *  incorrectamente como pendiente un track que ya terminó. */
export function canCompleteCohort(state: JournalState): { complete: boolean; pendingTracks: string[] } {
    const tracks = state.tracks ?? [];
    const pendingTracks = tracks
        .filter((t) => t.phase !== 'MERGED_UNVERIFIED' && t.phase !== 'JOINED')
        .map((t) => t.trackId).sort();
    return { complete: tracks.length >= 2 && pendingTracks.length === 0, pendingTracks };
}

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

export interface TrackRuntime {
    addWorktree(planRoot: string, ref: TrackRef, baseSha: string): void;
    initTrackJournal(ref: TrackRef, context: TrackContext): void;
    spawnSupervisor(ref: TrackRef): ProcessRef | void;
    observeSupervisor(ref: TrackRef): SupervisorObservation;
    // Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): reemplaza el `teardownOwned(ref,
    // step)` TEMPORAL de Task 9 por tres primitivos separados, uno por
    // EFECTO real distinto — mismo criterio que `mergeFrozenTrack`/
    // `abortOwnedMerge` (Task 11): la decisión de CUÁL llamar (o de no llamar
    // ninguno) vive siempre en `decideTeardown`/`runBeginTeardown`, nunca acá.
    // Identity-verified: jamás un `kill(pid)` crudo — `true` <=> el grupo del
    // supervisor propio quedó confirmado ausente (recién ahora, o ya lo
    // estaba: misma dualidad que el resto de esta interfaz, ej.
    // `accept-worktree`/`accept-readiness`).
    stopOwnSupervisor(ref: TrackRef): Promise<boolean>;
    // El caller (`runBeginTeardown`) ya probó ownership completo
    // (`worktreeOwnershipProven`: `teardownIntent` + `.awm/track.json` +
    // `git worktree list`) ANTES de llamar esto — acá solo falta el efecto
    // real (`git.ts`'s `removeOwnedWorktree` ya aplica el guard de limpieza,
    // bloqueando si está sucio, y jamás usa `--force`).
    removeOwnedWorktree(repo: string, ref: TrackRef): void;
    // `git.ts`'s `removeOwnedBranch` ya verifica que no siga checked out y
    // usa SIEMPRE `-d` (nunca `-D`, R4.10).
    removeOwnedBranch(repo: string, branch: string): void;
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
    // R7/C3 (Task 12): pausa ADMINISTRATIVA del controller del plan antes del
    // job canónico de integración final — distinta de `ensureIntegrationLock`
    // (que solo pausa la PRIMERA vez, antes del primer merge, y memoiza el
    // lock por el resto de la vida del proceso). Acá el controller puede
    // haber sido relanzado desde entonces (ej. entre merges, o para correr
    // `post-implementation-qa`), así que esto se llama de nuevo,
    // incondicionalmente, cada vez que el driver de `request-final-
    // integration` necesita asegurarse de que nadie mute el árbol mientras
    // corre el job. Devuelve `true` <=> hizo trabajo real (había una
    // generación activa que se tuvo que terminar) — el driver lo trata como
    // SU único touch de este tick, igual criterio que `ensureIntegrationLock`
    // distingue `'acquired'` de `'already-held'`.
    pauseControllerGeneration(): Promise<boolean>;
    // R7.5 (Task 12): libera, si está retenido POR ESTE PROCESO, el
    // `integration.lock` adquirido por `ensureIntegrationLock` — el
    // complemento que Task 11 dejó explícitamente diferido ("este runtime
    // nunca libera lo que adquiere"). No-op si nunca se adquirió o si ya se
    // liberó (mismo criterio idempotente que el resto de esta interfaz).
    releaseIntegrationLockIfHeld(): void;
}

export interface ReconcileTracksResult { state: JournalState; effectExecuted: string | null; }

const RUNTIME_EFFECTS = new Set([
    'create-worktree', 'create-track-journal', 'spawn-track-supervisor', 'begin-teardown', 'freeze-track', 'merge-track',
    // R7 (Task 12): las 3 fronteras finales — únicas de la cohorte, jamás por
    // track (ver drivers `runRequestGlobalQa`/`runRequestFinalIntegration`/
    // `runRunFinalInterlock` más abajo).
    'request-global-qa', 'request-final-integration', 'run-final-interlock',
]);

/** Fases en las que un `joinRequested` todavía tiene futuro: el track aún no llegó a
 *  `ACTIVE`, así que el pedido espera a que llegue en vez de perderse. `ACTIVE` está incluida
 *  porque es justamente donde se aplica; cualquier otra fase lo vuelve moot. */
const JOIN_PENDING_PHASES: TrackPhase[] = [
    'DECLARED', 'PREPARE_INTENT', 'WORKTREE_CREATED', 'JOURNAL_CREATED', 'SUPERVISOR_STARTING', 'ARMED', 'ACTIVE',
];

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
        // R7/C3 (Task 12): espejo de `state.globalQaHeadSha`/
        // `finalIntegrationJobId` — sin esto, un restart perdería la
        // evidencia de que el QA global o la integración final ya pasaron y
        // `nextProtocolEffect` repetiría el efecto desde cero.
        globalQaHeadSha: state.globalQaHeadSha,
        finalIntegrationJobId: state.finalIntegrationJobId,
        // Mismo criterio que los tres campos de arriba: `reconcileProtocol` fija
        // `fallbackReason` sobre el protocolo, pero este loop lo reconstruye desde el
        // journal en cada vuelta — sin releerlo acá, la causa específica de la
        // degradación se pierde antes de que `enter-serial` llegue a usarla.
        fallbackReason: state.cohortFallbackReason,
    };
}

/** Vuelca las decisiones de `protocol.ts` de regreso al `TrackRef[]` real —
 *  nunca al revés: esta función jamás decide, solo transcribe. Exportada
 *  (junto con `persist`/`refOf`/`withRef`/`EffectRunResult` más abajo) para
 *  que `./teardown-driver` — que ejecuta el mismo patrón "gather -> decide ->
 *  tocar el mundo real como mucho una vez -> persistir -> stop" que todo
 *  `run*` de este archivo — reutilice estos helpers sin duplicarlos. */
export function applyProtocolToState(state: JournalState, protocol: CohortProtocol): JournalState {
    const next = structuredClone(state);
    next.cohortPhase = protocol.cohortPhase;
    // R6.2/R6.3/C7 (Task 11): persistir el HEAD del plan avanzado por
    // `reconcileProtocol`'s `accept-merge` (`out.planHeadSha = decision.
    // joinedCommitSha`) — sin esto, el siguiente `toProtocol` volvería a leer
    // `cohortBaseSha` (stale) y el segundo join de la cohorte usaría un
    // `expectedPlanHeadSha` incorrecto.
    if (protocol.planHeadSha !== undefined) next.cohortPlanHeadSha = protocol.planHeadSha;
    // R7/C3 (Task 12): los valores finales normalmente solo avanzan, salvo
    // que fallback abandone explícitamente esa ruta. En ese caso el reducer
    // ya invalidó su evidencia y el mirror durable DEBE borrarla también;
    // conservarla permitiría que un restart reconstruyera un protocolo que
    // contradice los tracks en teardown.
    if (protocol.cohortPhase === 'FALLBACK_PENDING') {
        next.globalQaHeadSha = undefined;
        next.finalIntegrationJobId = undefined;
        next.qaFinalizeRequested = undefined;
    } else {
        if (protocol.globalQaHeadSha !== undefined) next.globalQaHeadSha = protocol.globalQaHeadSha;
        if (protocol.finalIntegrationJobId !== undefined) next.finalIntegrationJobId = protocol.finalIntegrationJobId;
    }
    if (protocol.fallbackReason !== undefined) next.cohortFallbackReason = protocol.fallbackReason;
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

export function persist(planRoot: string, branch: string, s: JournalState): JournalState {
    writeJournal(planRoot, branch, s);
    const r = readJournal(planRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto tras persistir tracks (R1.6)');
    return r.state;
}

export function refOf(s: JournalState, trackId: string): TrackRef {
    const ref = s.tracks?.find((t) => t.trackId === trackId);
    if (ref === undefined) throw new Error(`invariante rota: TrackRef ausente para ${trackId}`);
    return ref;
}

export function withRef(s: JournalState, trackId: string, patch: Partial<TrackRef>): JournalState {
    return { ...s, tracks: (s.tracks ?? []).map((t) => (t.trackId === trackId ? { ...t, ...patch } : t)) };
}

function mustBaseSha(s: JournalState): string {
    if (s.cohortBaseSha === undefined) throw new Error('invariante rota: cohortBaseSha ausente para una cohorte en PREPARING/ACTIVE');
    return s.cohortBaseSha;
}

export interface EffectRunResult { state: JournalState; stop: boolean; executed: string | null; }

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

function sameIdSet(a: string[] | undefined, b: string[]): boolean {
    const left = [...(a ?? [])].sort();
    const right = [...b].sort();
    return left.length === right.length && left.every((v, i) => v === right[i]);
}

/** R7.1/R7.6/R7.7/C3 (Task 12): pura mutación de estado — jamás toca
 *  `runtime`. "Solo el HEAD final recibe QA e integración": `nextProtocolEffect`
 *  solo emite este efecto cuando TODOS los tracks llegaron a
 *  `MERGED_UNVERIFIED` a la vez (R7.6/R7.7) — nunca por cada merge
 *  individual. El primer branch acepta el autoreporte del controller
 *  (`qaFinalizeRequested`, ver `track-finalize-request` en `apply.ts`) SOLO
 *  tras re-verificar independientemente HEAD real + árbol limpio (fail-
 *  closed, mismo criterio que el freeze de un track en `runFreezeTrack` —
 *  nunca se confía ciegamente en el autoreporte); el segundo persiste el
 *  `nextAction` que instruye al controller a correr `post-implementation-qa`
 *  — el controller YA vivo (o el próximo que `Supervisor.ensureController`
 *  relance por su propio mecanismo existente) lo recoge leyendo el journal,
 *  sin que este driver necesite tocar ningún proceso. */
function runRequestGlobalQa(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'request-global-qa' }>,
): EffectRunResult {
    if (s.qaFinalizeRequested !== undefined) {
        const reported = s.qaFinalizeRequested;
        let actualHead: string;
        let clean: boolean;
        try {
            actualHead = headSha(planRoot);
            clean = dirtyPaths(planRoot).length === 0;
        } catch {
            return { state: s, stop: true, executed: null };   // indemostrable: esperar (fail-closed)
        }
        if (actualHead === reported.headSha && clean) {
            const observed = observeProtocolEffect(protocol, effect, { kind: 'global-qa-pass', headSha: actualHead, clean: true });
            const next = persist(planRoot, branch, applyProtocolToState(s, observed));
            appendEvent(planRoot, branch, { kind: 'global-qa-passed', headSha: actualHead });
            return { state: next, stop: true, executed: effect.kind };
        }
        // El autoreporte no coincide (todavía sucio, o HEAD distinto): nada
        // que aceptar este tick — el controller sigue corrigiendo hallazgos.
        return { state: s, stop: true, executed: null };
    }
    if (s.cycle.nextAction?.type === 'run-global-qa') {
        return { state: s, stop: true, executed: null };   // ya pedido: esperar el autoreporte
    }
    const next: JournalState = {
        ...s,
        cycle: {
            ...s.cycle,
            nextAction: { actionId: 'finalize-global-qa', type: 'run-global-qa', target: 'cycle', preconditions: [], attempt: 0, state: 'pending' },
        },
    };
    const persisted = persist(planRoot, branch, next);
    appendEvent(planRoot, branch, { kind: 'global-qa-requested' });
    return { state: persisted, stop: true, executed: effect.kind };
}

/** R7.3/R7.6/C4 (Task 12): a lo sumo UNA mutación real por tick — mismo
 *  criterio que `runMergeTrack` separa `ensureIntegrationLock` del intento de
 *  merge en dos fronteras distintas: acá la pausa del controller
 *  (`pauseControllerGeneration`, que a diferencia de `ensureIntegrationLock`
 *  se llama de nuevo cada vez porque el controller puede haberse relanzado
 *  desde el último merge) y el pedido del job canónico son también DOS
 *  fronteras separadas. El conjunto de satisfiers es SIEMPRE el completo y
 *  ordenado de `track-integration:*` de la cohorte (C4) — nunca un
 *  subconjunto, ni siquiera tras un crash/restart, porque `ids` es una
 *  función determinista de `s.tracks` y la idempotencyKey de `requestJob` es
 *  una función determinista de ese mismo conjunto. */
async function runRequestFinalIntegration(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'request-final-integration' }>, runtime: TrackRuntime,
): Promise<EffectRunResult> {
    const ids = [...new Set((s.tracks ?? []).map((t) => `track-integration:${t.trackId}`))].sort();
    const existing = Object.values(s.jobs).find((j) => sameIdSet(j.satisfies, ids));
    if (existing !== undefined) {
        if (existing.executionState === 'exited' && existing.verdict === 'pass') {
            let headNow: string;
            try {
                headNow = headSha(planRoot);
            } catch {
                return { state: s, stop: true, executed: null };
            }
            const observed = observeProtocolEffect(protocol, effect, { kind: 'integration-pass', jobId: existing.id, headSha: headNow });
            const next = persist(planRoot, branch, applyProtocolToState(s, observed));
            appendEvent(planRoot, branch, { kind: 'track-integration-passed', jobId: existing.id });
            return { state: next, stop: true, executed: effect.kind };
        }
        // Sigue vivo, o terminó sin pass: nada que tocar este tick (fail-
        // closed — un job canónico fallido requiere intervención humana, este
        // driver jamás reintenta a ciegas con un job distinto).
        return { state: s, stop: true, executed: null };
    }
    const pausedNow = await runtime.pauseControllerGeneration();
    if (pausedNow) {
        appendEvent(planRoot, branch, { kind: 'plan-generation-paused-for-integration' });
        return { state: s, stop: true, executed: effect.kind };
    }
    if (s.trackIntegration === undefined) {
        // Contrato canónico todavía no registrado (Step 6, `register --entity
        // track-integration`): indemostrable qué comando correr — fail-closed,
        // esperar a que se registre en vez de inventar un comando.
        return { state: s, stop: true, executed: null };
    }
    const gen = s.generations.find((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
    try {
        requestJob(planRoot, branch, gen?.token ?? 'no-active-generation', s.trackIntegration.argv, s.trackIntegration.paths, '.', {
            satisfies: ids, verificationKind: 'track-integration',
        });
    } catch (error) {
        // Precondición del Step 6 todavía no demostrable (merges pendientes,
        // árbol sucio, argv no canónico): nada que tocar, reintentar el
        // próximo tick con estado fresco.
        appendEvent(planRoot, branch, { kind: 'track-integration-request-failed', detail: (error as Error).message });
        return { state: s, stop: true, executed: null };
    }
    appendEvent(planRoot, branch, { kind: 'track-integration-requested', ids });
    return { state: s, stop: true, executed: effect.kind };
}

/** R7.4/R7.5/C3 (Task 12): NO reimplementa el interlock — llama a
 *  `computeGate`, el mismo mecanismo de R1/R3.2 que ya exige `qa`+`interlock`
 *  en `cycleVerificationPlan` (y ahora también cada `track-integration:*`,
 *  poblados por `registerTrackIntegrationItems`) y recomputa la vigencia de
 *  CADA fingerprint contra el árbol real — "el interlock global existente"
 *  al que se refiere el plan. Solo al pasar libera `integration.lock`
 *  (R7.5), el complemento que Task 11 dejó explícitamente diferido. */
function runRunFinalInterlock(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: Extract<ProtocolEffect, { kind: 'run-final-interlock' }>, runtime: TrackRuntime,
): EffectRunResult {
    const fingerprintNow: FingerprintNow = (argv, paths, cwd) => {
        try { return computeFingerprint(planRoot, argv, paths, cwd).fingerprint; }
        catch { return null; }
    };
    const gate = computeGate(s, false, fingerprintNow);
    if (!gate.pass) return { state: s, stop: true, executed: null };   // fail-closed: esperar evidencia completa
    if (protocol.globalQaHeadSha === undefined) throw new Error('invariante rota: globalQaHeadSha ausente en FINAL_INTERLOCK');
    const observed = observeProtocolEffect(protocol, effect, { kind: 'interlock-pass', headSha: protocol.globalQaHeadSha });
    const next = persist(planRoot, branch, applyProtocolToState(s, observed));
    runtime.releaseIntegrationLockIfHeld();
    appendEvent(planRoot, branch, { kind: 'cohort-complete' });
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

// Task 13 (R4.2/R4.3/R4.6/R4.10/C2/C9): el gathering READ-ONLY
// (`gatherTeardownObservation`) y el driver (`runBeginTeardown`) de UN track
// en teardown viven en `./teardown-driver` — extraídos post-review (mismo
// criterio que `join.ts` con `decideJoinReconciliation`/
// `acquireIntegrationLock`: la lógica del concern vive en su propio módulo,
// este archivo solo orquesta y wirea producción). `decideTeardown` sigue
// siendo la única autoridad de decisión, en `protocol.ts`, sin tocar.
async function executeRuntimeEffect(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: ProtocolEffect, runtime: TrackRuntime,
): Promise<EffectRunResult> {
    if (effect.kind === 'create-worktree') return runCreateWorktree(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'create-track-journal') return runCreateTrackJournal(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'begin-teardown') return runBeginTeardown(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'freeze-track') return runFreezeTrack(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'merge-track') return runMergeTrack(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'request-global-qa') return runRequestGlobalQa(planRoot, branch, s, protocol, effect);
    if (effect.kind === 'request-final-integration') return runRequestFinalIntegration(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'run-final-interlock') return runRunFinalInterlock(planRoot, branch, s, protocol, effect, runtime);
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
        // La request de teardown se consume en dos pasos durables, igual que
        // join: `apply.ts` solo deja el marcador y este reconciler traduce la
        // intención al reducer. BLOCKED, SERIAL y COMPLETE no admiten nueva
        // transición: limpiar únicamente el marcador preserva el estado seguro.
        const pendingTeardown = (s.tracks ?? []).find((track) => track.teardownRequested === true);
        if (pendingTeardown !== undefined) {
            const moot = ['BLOCKED', 'SERIAL', 'COMPLETE'].includes(s.cohortPhase);
            if (moot) {
                const next = structuredClone(s);
                for (const track of next.tracks ?? []) if (track.trackId === pendingTeardown.trackId) track.teardownRequested = undefined;
                s = persist(planRoot, branch, next);
                appendEvent(planRoot, branch, {
                    kind: 'track-teardown-moot', trackId: pendingTeardown.trackId, phase: pendingTeardown.phase,
                });
                return { state: s, effectExecuted: null };
            }
            const protocolBefore = toProtocol(s, maxParallel);
            const observed = reconcileProtocol(protocolBefore, { kind: 'teardown-requested', trackId: pendingTeardown.trackId });
            const next = applyProtocolToState(s, observed);
            for (const track of next.tracks ?? []) if (track.trackId === pendingTeardown.trackId) track.teardownRequested = undefined;
            s = persist(planRoot, branch, next);
            appendEvent(planRoot, branch, {
                kind: 'track-teardown-observed', trackId: pendingTeardown.trackId,
                phase: s.tracks?.find((t) => t.trackId === pendingTeardown.trackId)?.phase,
            });
            // El marcador es una frontera durable por sí mismo. No se consume
            // otro marcador ni se entra a begin-teardown hasta la siguiente
            // llamada, para que un crash conserve el resto de las requests.
            return { state: s, effectExecuted: null };
        }
        // El pedido de join del controller (`joinRequested`, marcado declarativamente al
        // consumir `track-join-request`) se convierte ACÁ en la observación que el reducer
        // entiende. La regla de si eso mueve la fase vive en `reconcileProtocol` (solo
        // `ACTIVE` pasa a `JOIN_REQUESTED`), no acá: este bloque solo produce la observación
        // que hasta ahora nadie producía. Se consume una por vuelta y se persiste, para no
        // colapsar dos fronteras en un mismo call (mismo invariante que el resto del loop).
        //
        // El pedido es DURABLE mientras el track todavía no llegó a `ACTIVE`. Un join que
        // llega antes de la activación no es un error del controller: es la carrera normal
        // — con `maxParallel` chico la cohorte activa de a un track por vez, así que el
        // controller termina su trabajo y pide el join mientras su track sigue en `ARMED`.
        // Se observó en la certificación: dos joins emitidos con ambos tracks en `ARMED`.
        // Descartarlos ahí (que es lo que hacía la primera versión de este bloque) devuelve
        // el mismo modo de falla que este cambio vino a cerrar — un pedido que reporta éxito
        // y no pasa nada — y solo sobrevivía porque el controller scripteado los re-emite.
        const pendingJoin = (s.tracks ?? []).find((t) => t.joinRequested === true && t.phase === 'ACTIVE');
        if (pendingJoin !== undefined) {
            const protocolBefore = toProtocol(s, maxParallel);
            const observed = reconcileProtocol(protocolBefore, { kind: 'join-requested', trackId: pendingJoin.trackId });
            const next = applyProtocolToState(s, observed);
            for (const t of next.tracks ?? []) if (t.trackId === pendingJoin.trackId) t.joinRequested = undefined;
            s = persist(planRoot, branch, next);
            appendEvent(planRoot, branch, {
                kind: 'track-join-observed', trackId: pendingJoin.trackId,
                phase: s.tracks?.find((t) => t.trackId === pendingJoin.trackId)?.phase,
            });
            continue;
        }
        // Pedido que ya no puede aplicarse nunca: el track pasó de `ACTIVE` (join duplicado,
        // o el relevo de un controller que re-emite) o quedó `BLOCKED`. Se limpia la marca
        // — dejarla prendida la haría reevaluar en cada tick sin progreso posible. Lo que NO
        // se limpia es el pedido de un track anterior a `ACTIVE`: ese sigue esperando.
        const mootJoin = teardownObserved ? undefined : (s.tracks ?? []).find((t) => t.joinRequested === true
            && !JOIN_PENDING_PHASES.includes(t.phase));
        if (mootJoin !== undefined) {
            const next = structuredClone(s);
            for (const t of next.tracks ?? []) if (t.trackId === mootJoin.trackId) t.joinRequested = undefined;
            s = persist(planRoot, branch, next);
            appendEvent(planRoot, branch, { kind: 'track-join-moot', trackId: mootJoin.trackId, phase: mootJoin.phase });
            continue;
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
            // `enter-serial` es el ÚNICO efecto de este branch que lleva una causa: la
            // degradación se lee entera en su propio evento, sin obligar a correlacionar
            // hacia atrás con el `track-effect-failed` que la originó.
            const reason = effect.kind === 'enter-serial' ? effect.reason : undefined;
            appendEvent(planRoot, branch, { kind: 'track-protocol-persist', effect: effect.kind, trackId, phase: label, reason });
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
                gitRemoveOwnedWorktree(root, ref.worktreePath);
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
        // Task 13 (reemplaza el `teardownOwned(ref, step)` TEMPORAL de Task
        // 9): cada primitivo es idempotente ante reintento tras crash —
        // "nada que remover"/"ya ausente" nunca lanza, es éxito vacuo (R4.2).
        async stopOwnSupervisor(ref) {
            if (ref.supervisorProcessRef === undefined) return true; // nunca llegamos a spawnear: nada que terminar
            // R4.8: identity-verified — jamás un `kill(pid)` crudo. Un `pgid`
            // reutilizado por OTRO proceso nunca se confunde con el nuestro:
            // post-review (hallazgo de revisión de Task 13), la identidad NO
            // se da por buena solo por haberse capturado en el spawn —
            // `supervisorProcessRef` se relee del journal persistido y este
            // paso puede correr arbitrariamente tarde (incluso tras un
            // restart completo), así que `terminatePreviouslyOwnedGroup`
            // reverifica la identidad completa del slot de líder
            // INMEDIATAMENTE antes de enviar cualquier señal (`process.ts`,
            // `groupLeaderReused`) — nunca confía solo en `groupIsGone`.
            const confirmed = groupIsGone(ref.supervisorProcessRef.processGroup)
                || await terminatePreviouslyOwnedGroup(ref.supervisorProcessRef, grace);
            if (confirmed) {
                // Step 4 del plan ("supervisor propio muerto confirmado Y
                // lock ausente"): un lock advisory que el supervisor dejó sin
                // liberar (crash a mitad de su propia salida) es, por
                // definición, stale una vez que TODO su grupo está
                // confirmado ausente por identidad — este path del lock vive
                // dentro del worktree PROPIO del track (`ref.worktreePath`),
                // nunca en un recurso compartido, así que reclamarlo acá
                // nunca puede pisar algo ajeno. Sin esto, un crash exacto
                // ahí dejaría el teardown reintentando `stop-own-supervisor`
                // para siempre (C9: debe converger).
                try { fs.rmSync(supervisorLockPath(ref.worktreePath), { force: true }); } catch { /* best-effort */ }
            }
            return confirmed;
        },
        removeOwnedWorktree(repo, ref) {
            // Ownership ya probado por el driver (`worktreeOwnershipProven`,
            // ver `gatherTeardownObservation`) antes de que `decideTeardown`
            // llegara a `remove-owned-worktree` — acá solo el efecto real;
            // `git.ts` bloquea (nombrando paths) si el worktree está sucio, y
            // nunca usa `--force` (R4.10).
            gitRemoveOwnedWorktree(repo, ref.worktreePath);
        },
        removeOwnedBranch(repo, branchName) {
            // `git.ts` ya verifica que no siga checked out y usa `-d`, nunca
            // `-D` (R4.10) — no-op si la branch ya no existe.
            gitRemoveOwnedBranch(repo, branchName);
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
        // R7/C3 (Task 12): a diferencia de `ensureIntegrationLock` (memoizado
        // por el resto de la vida del proceso), esto se llama de nuevo cada
        // vez que el driver de `request-final-integration` lo pide — el
        // controller puede haberse relanzado desde el último merge (ej. para
        // correr `post-implementation-qa`). `stopControllerGenerationConfirmed`
        // ya es un no-op seguro sin generación activa; `hadActive` es lo que
        // le permite al driver distinguir "hizo trabajo real" de "ya estaba
        // pausado", mismo criterio que `'acquired'`/`'already-held'` arriba.
        async pauseControllerGeneration() {
            const r = readJournal(planRoot, planBranch);
            if (r.corrupt || r.state === null) throw new Error('journal corrupto: no se puede pausar el controller del plan (R1.6)');
            const hadActive = r.state.generations.some((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
            if (!hadActive) return false;
            await stopControllerGenerationConfirmed(planRoot, planBranch, grace);
            return true;
        },
        // R7.5 (Task 12): complemento de `ensureIntegrationLock` que Task 11
        // dejó diferido — solo libera un lock que ESTE proceso adquirió
        // (identidad verificada por `releaseIntegrationLock`, que compara
        // `spawnNonce`), nunca uno ajeno.
        releaseIntegrationLockIfHeld() {
            if (integrationLock !== null) {
                releaseIntegrationLock(integrationLock);
                integrationLock = null;
            }
        },
    };
}
