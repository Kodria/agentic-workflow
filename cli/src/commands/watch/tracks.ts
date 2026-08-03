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
import { nextProtocolEffect, observeProtocolEffect } from '../../core/tracks/protocol';
import { addOwnedWorktree, removeOwnedWorktree, isAwmGitignored, foreignPathExists } from '../../core/tracks/git';
import { writeDescriptor } from '../../core/tracks/descriptor';
import { spawnStructured } from '../../core/journal/process';
import { JOIN_STRATEGY_NO_FF } from '../../core/tracks/types';
import type { CohortProtocol, ProtocolEffect, TrackProtocolState } from '../../core/tracks/types';
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

export interface TrackRuntime {
    addWorktree(planRoot: string, ref: TrackRef, baseSha: string): void;
    initTrackJournal(ref: TrackRef, context: TrackContext): void;
    spawnSupervisor(ref: TrackRef): ProcessRef | void;
    observeSupervisor(ref: TrackRef): SupervisorObservation;
}

export interface ReconcileTracksResult { state: JournalState; effectExecuted: string | null; }

const RUNTIME_EFFECTS = new Set(['create-worktree', 'create-track-journal', 'spawn-track-supervisor']);

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
        planHeadSha: state.cohortBaseSha,
    };
}

/** Vuelca las decisiones de `protocol.ts` de regreso al `TrackRef[]` real —
 *  nunca al revés: esta función jamás decide, solo transcribe. */
function applyProtocolToState(state: JournalState, protocol: CohortProtocol): JournalState {
    const next = structuredClone(state);
    next.cohortPhase = protocol.cohortPhase;
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
    // R4.6: la comprobación de "es ajeno" ocurre ANTES de tocar `runtime` — un
    // destino no vacío en este punto no puede ser nuestro (todavía no
    // intentamos crear nada ahí), así que esto NO cuenta como el side effect
    // del tick: es una observación pura, no una mutación.
    if (foreignPathExists(ref.worktreePath)) {
        const observed = observeProtocolEffect(protocol, effect, { kind: 'worktree-observed', trackId, owned: false });
        const next = persist(planRoot, branch, applyProtocolToState(s, observed));
        appendEvent(planRoot, branch, { kind: 'track-blocked', trackId, reason: 'worktree preexistente ajeno' });
        // Post-review fix: bloquear un track es en sí mismo UNA frontera —
        // dejar `stop:false` acá permitía que el MISMO call siguiera y
        // tocara `runtime.addWorktree` de otro track (dos side effects
        // reales en un solo `reconcileTracks()`, rompiendo el supuesto de
        // Task 9 de que cada boundary es crash-injectable por separado).
        return { state: next, stop: true, executed: null };
    }
    try {
        runtime.addWorktree(planRoot, ref, mustBaseSha(s));
    } catch (error) {
        const failed = observeProtocolEffect(protocol, effect, { kind: 'effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        const next = persist(planRoot, branch, applyProtocolToState(s, failed));
        appendEvent(planRoot, branch, { kind: 'track-effect-failed', trackId, effect: effect.kind, detail: (error as Error).message });
        return { state: next, stop: true, executed: effect.kind };
    }
    const observed = observeProtocolEffect(protocol, effect, { kind: 'worktree-observed', trackId, owned: true });
    const next = persist(planRoot, branch, applyProtocolToState(s, observed));
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
    if (ref.supervisorProcessRef === undefined) {
        // Post-review fix (3rd occurrence of this class of bug): la versión
        // anterior llamaba `observeSupervisor` y, si volvía 'absent', llamaba
        // `spawnSupervisor` EN EL MISMO call — dos fronteras de runtime
        // colapsadas en un solo `reconcileTracks()`. Un "esperar un tick de
        // más y volver a observar" no alcanza por sí solo: sin un registro
        // DURABLE de "ya intentamos spawnear", el próximo call observaría
        // 'absent' otra vez para siempre y jamás llegaría a spawnear. La
        // señal durable correcta ya existe: `ref.supervisorProcessRef`, que
        // ESTA MISMA función persiste apenas `spawnSupervisor` devuelve algo.
        // Mientras no esté seteado, "todavía no intentamos spawnear" es la
        // única fuente de verdad — ni siquiera hace falta preguntarle a
        // `runtime.observeSupervisor` primero (sabemos que no puede haber
        // nada real ahí todavía). Esto es ADEMÁS más eficiente que la
        // sugerencia original: cero ticks desperdiciados, y cada call sigue
        // tocando `runtime` como máximo una vez.
        const pr = runtime.spawnSupervisor(ref);
        const next = pr !== undefined ? persist(planRoot, branch, withRef(s, trackId, { supervisorProcessRef: pr })) : s;
        appendEvent(planRoot, branch, { kind: 'track-effect', trackId, effect: effect.kind });
        return { state: next, stop: true, executed: effect.kind };
    }
    const observation = runtime.observeSupervisor(ref);
    if (observation.kind === 'absent' || observation.kind === 'claimed') {
        // C11: ya spawneamos (supervisorProcessRef existe) — 'absent' acá
        // solo significa que el wrapper todavía no llegó a crear su claim
        // (ventana de arranque normal), y 'claimed' que el claim está tomado
        // pero identidad/readiness todavía no son observables. Ninguno de
        // los dos vuelve a llamar `spawnSupervisor`: el mismo intent ya
        // persistido se reintenta solo, nunca uno nuevo. Nada que persistir
        // acá — solo esperar al próximo tick.
        return { state: s, stop: true, executed: null };
    }
    if (observation.kind === 'foreign') {
        const blocked = observeProtocolEffect(protocol, effect, { kind: 'supervisor-observed', trackId, identity: 'other' });
        const next = persist(planRoot, branch, applyProtocolToState(s, blocked));
        appendEvent(planRoot, branch, { kind: 'track-blocked', trackId, reason: 'identidad de supervisor ajena' });
        return { state: next, stop: true, executed: null };
    }
    // 'ready': C8 — la comparación del nonce vive exclusivamente en protocol.ts.
    const observed = observeProtocolEffect(protocol, effect, {
        kind: 'supervisor-observed', trackId, identity: 'expected', readinessNonce: observation.readinessNonce,
    });
    const next = persist(planRoot, branch, applyProtocolToState(s, observed));
    appendEvent(planRoot, branch, { kind: 'track-armed-or-blocked', trackId });
    return { state: next, stop: true, executed: null };
}

function executeRuntimeEffect(
    planRoot: string, branch: string, s: JournalState, protocol: CohortProtocol,
    effect: ProtocolEffect, runtime: TrackRuntime,
): EffectRunResult {
    if (effect.kind === 'create-worktree') return runCreateWorktree(planRoot, branch, s, protocol, effect, runtime);
    if (effect.kind === 'create-track-journal') return runCreateTrackJournal(planRoot, branch, s, protocol, effect, runtime);
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
 */
export function reconcileTracks(
    planRoot: string, branch: string, state: JournalState, runtime: TrackRuntime, maxParallel: number,
): ReconcileTracksResult {
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

        const result = executeRuntimeEffect(planRoot, branch, s, protocol, effect, runtime);
        s = result.state;
        if (result.stop) return { state: s, effectExecuted: result.executed };
    }
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

/** Implementación real de `TrackRuntime`, inyectada por `Supervisor` en
 *  producción. Los tests de `reconcileTracks` usan un fake — ningún proceso
 *  ni worktree real se toca fuera de esta función. */
export function defaultTrackRuntime(planRoot: string, planBranch: string): TrackRuntime {
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
    };
}
