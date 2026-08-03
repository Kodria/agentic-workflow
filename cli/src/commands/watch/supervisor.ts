// Loop foreground (R4.4/R4.5): tick = apply -> collect/spawn -> stall -> gate.
// COMPLETE exige gate verde (que exige cero vivos): drenaje ANTES de declarar.
// Custodia BLOCKED: el loop sigue, el lock NO se libera, nada se mata.
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { adapterFor } from '../../core/journal/adapter';
import { groupIsGone, terminateGroupConfirmed } from '../../core/journal/process';
import { computeGate, computeTrackGate, FingerprintNow } from '../job/gate';
import { isWorktreeClean, headSha } from '../../core/tracks/git';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';
import { consumePendingRequests } from './apply';
import { runnerTick, WrapperSpawner, defaultWrapperSpawner } from './runner';
import { reconcileTracks, reconcileOpenJoin, defaultTrackRuntime, TrackRuntime } from './tracks';
import { decideStall, Backoff, beginGeneration, activeGeneration, ensureControllerGeneration, collectControllerGeneration, controllerGenerationHasUnresolvedClaim, resolveGeneration, enterCustody } from './generations';
import type { JournalState } from '../../core/journal/types';

export interface SupervisorConfig {
    provider: string;
    heartbeatTimeoutMs: number;
    activityWindowMs: number;
    tickMs: number;
    termGraceMs: number;
    killGraceMs: number;
    reconcileGraceMs: number;
    jobStallObservationMs: number;   // R3.5: umbral observacional de suspected-stall por job (nunca mata nada)
    maxParallelTracks: number;       // R10.2/R10.3: tope de tracks ACTIVE simultáneos (ver core/tracks/concurrency.ts)
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
    provider: 'codex',
    heartbeatTimeoutMs: 5 * 60000,      // R4.2 default 5 min
    activityWindowMs: 10 * 60000,       // R4.2 ventana propia adicional
    tickMs: 5000,
    termGraceMs: 30000,                  // R4.2b flush 30 s
    killGraceMs: 5000,
    reconcileGraceMs: 10000,
    jobStallObservationMs: 5 * 60000,   // R3.5 default: mismo orden de magnitud que heartbeatTimeoutMs, concern independiente
    maxParallelTracks: 1,                // overridden en tiempo de ejecución con loadDefaultParallelism() (watch/index.ts)
};

// 'frozen' (R5.2/R6.3, Task 10): SOLO puede ocurrir en el journal de un
// TRACK individual (nunca en el del plan) — el track terminó, con las 6
// observaciones demostrables (cero jobs vivos, gate local verde, worktree
// limpio, generación propia terminada con identidad confirmada), de
// atender un `track-freeze-request` pedido por el supervisor del plan.
export type TickOutcome = 'continue' | 'custody' | 'complete' | 'frozen';

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export class Supervisor {
    private backoff = new Backoff();
    private relaunchNotBefore = 0;
    private lastActivity: { key: string; changedAt: number } | null = null;
    private lastGenerationToken: string | null = null;

    private trackRuntime: TrackRuntime;

    constructor(
        private repoRoot: string,
        private branch: string,
        private cfg: SupervisorConfig,
        private spawner: WrapperSpawner,
        trackRuntime?: TrackRuntime,
    ) {
        this.trackRuntime = trackRuntime ?? defaultTrackRuntime(repoRoot, branch, { termGraceMs: cfg.termGraceMs, killGraceMs: cfg.killGraceMs });
    }

    private fingerprintNow: FingerprintNow = (argv, paths, cwd) => {
        try { return computeFingerprint(this.repoRoot, argv, paths, cwd).fingerprint; }
        catch { return null; }   // no recomputable => el gate NO certifica (fail-closed)
    };

    private ensureController(resumePrompt: string): 'ok' | 'deferred' | 'custody' {
        if (Date.now() < this.relaunchNotBefore) return 'deferred';
        if (this.backoff.exhausted()) {
            enterCustody(this.repoRoot, this.branch, 'tope de intentos de launch/relaunch por hora alcanzado (R4.3)');
            return 'custody';
        }
        try {
            ensureControllerGeneration(this.repoRoot, this.branch, this.cfg.provider, resumePrompt, this.spawner, this.cfg.reconcileGraceMs);
            return 'ok';
        } catch (error) {
            this.backoff.recordRelaunch();
            const delayMs = this.backoff.nextMs();
            this.relaunchNotBefore = Date.now() + delayMs;
            appendEvent(this.repoRoot, this.branch, {
                kind: 'controller-launch-failed', detail: (error as Error).message, retryAfterMs: delayMs,
            });
            if (this.backoff.exhausted()) {
                enterCustody(this.repoRoot, this.branch, 'tope de intentos de launch/relaunch por hora alcanzado (R4.3)');
                return 'custody';
            }
            return 'deferred';
        }
    }

    async tick(): Promise<TickOutcome> {
        const before0 = readJournal(this.repoRoot, this.branch);
        if (before0.corrupt || before0.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        // R6.2/R6.8/C7 (Task 11): reconciliar un `MERGE_HEAD` abierto por un
        // crash a mitad de un merge ANTES de cualquier guard general — hoy
        // ningún guard existente (`verifyBranchInvariant` incluido) rechaza
        // por `MERGE_HEAD`, pero esto corre primero de todos modos para que
        // uno agregado en el futuro nunca pueda rechazar un estado ya
        // reconciliable. `openJoin.handled` evita una SEGUNDA mutación real
        // de tracks más abajo en este mismo tick (a lo sumo una por tick).
        const openJoin = await reconcileOpenJoin(this.repoRoot, this.branch, before0.state, this.trackRuntime, this.cfg.maxParallelTracks);
        const before = openJoin.state;
        verifyBranchInvariant(this.repoRoot, before.branch);
        if (before.cycle.status === 'COMPLETE') return 'complete';
        // R5.2/R6.3 (Task 10): restart-safe — un track ya `frozen` (crash del
        // loop DESPUÉS de persistir el paso 6 pero ANTES de que
        // `runSupervisorLoop` liberara el lock/saliera) jamás debe relanzar
        // un controller nuevo ni volver a despachar; simplemente reafirma el
        // mismo resultado terminal.
        if (before.frozen !== undefined) return 'frozen';
        const pending = before.cycle.nextAction;
        const resumePrompt = pending !== undefined ? `el next_action ${pending.actionId} del journal` : 'el plan del ciclo desde el journal';
        if (this.ensureController(resumePrompt) === 'custody') return 'custody';
        const r0 = readJournal(this.repoRoot, this.branch);
        if (r0.corrupt || r0.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        const gen = activeGeneration(r0.state);
        consumePendingRequests(this.repoRoot, this.branch, gen?.token ?? null);
        // P1/P2 (R4.1-R4.10): a lo sumo un side effect de bootstrap de tracks
        // por tick, ANTES de tocar jobs — mientras la cohorte está PREPARING,
        // ningún job de track se despacha (eso lo maneja `runnerTick` con los
        // `Job` ya existentes; el bootstrap de tracks es un canal separado).
        // Task 11: si `reconcileOpenJoin` ya ejecutó una mutación real este
        // mismo tick (reconcilió un `MERGE_HEAD` abierto), no se vuelve a
        // invocar `reconcileTracks` acá — a lo sumo una mutación real de
        // tracks por tick, mismo invariante que ya sostenía `reconcileTracks`
        // por sí solo antes de que existiera esta ruta temprana.
        if (!openJoin.handled) {
            const preTracks = readJournal(this.repoRoot, this.branch);
            if (!preTracks.corrupt && preTracks.state !== null) {
                // Task 9: `reconcileTracks` es `async` desde que `begin-teardown`
                // puede terminar el grupo del supervisor de un track con
                // `terminatePreviouslyOwnedGroup` (espera real de gracia,
                // R4.8) — awaitear acá es obligatorio, nunca fire-and-forget.
                await reconcileTracks(this.repoRoot, this.branch, preTracks.state, this.trackRuntime, this.cfg.maxParallelTracks);
            }
        }
        const afterRequests = readJournal(this.repoRoot, this.branch);
        if (afterRequests.state !== null && activeGeneration(afterRequests.state) === undefined
            && afterRequests.state.generations.length > 0 && afterRequests.state.cycle.status === 'IN_PROGRESS') {
            beginGeneration(this.repoRoot, this.branch);
            if (this.ensureController(resumePrompt) === 'custody') return 'custody';
        }
        // R5.2/R6.3 (Task 10): recién leído tras `consumePendingRequests` —
        // si el request `track-freeze-request` llegó en ESTE tick, `apply.ts`
        // ya lo tradujo a `freezeRequested`. `dispatch:false` corta SOLO el
        // arranque de trabajo NUEVO; el drenaje de lo ya vivo sigue intacto
        // (paso 2 del freeze — "consume/reconcilia jobs existentes").
        const freezeCheck = readJournal(this.repoRoot, this.branch);
        const freezing = !freezeCheck.corrupt && freezeCheck.state !== null
            && freezeCheck.state.freezeRequested === true && freezeCheck.state.frozen === undefined;
        runnerTick(this.repoRoot, this.branch, this.spawner, {
            reconcileGraceMs: this.cfg.reconcileGraceMs, stallObservationMs: this.cfg.jobStallObservationMs, dispatch: !freezing,
        });
        const custody = await this.superviseController();
        if (custody) return 'custody';
        if (freezing) return this.attemptFreeze();
        const r = readJournal(this.repoRoot, this.branch);
        const gate = computeGate(r.state, r.corrupt, this.fingerprintNow);
        const liveJobs = r.state === null ? 1 : Object.values(r.state.jobs).filter((j) => LIVE.includes(j.executionState)).length;
        if (gate.pass && liveJobs === 0) {   // gate verde YA implica cero vivos; doble cinturon (R4.5)
            const s = r.state!;
            const terminated = await this.terminateAllGenerationsConfirmed(s);
            if (!terminated.ok) {
                enterCustody(this.repoRoot, this.branch, `no se pudo terminar con identidad confirmada la generacion ${terminated.n} antes de COMPLETE`);
                return 'custody';
            }
            s.cycle.status = 'COMPLETE';
            s.cycle.completedAt = new Date().toISOString();
            writeJournal(this.repoRoot, this.branch, s);
            appendEvent(this.repoRoot, this.branch, { kind: 'cycle-complete' });
            return 'complete';
        }
        return 'continue';
    }

    /** Termina, con identidad CONFIRMADA (jamás un `kill(pid)` crudo), toda
     *  generación de `s` que todavía tenga un `processRef`/`wrapperRef` vivo
     *  — muta `s` en memoria (incluye marcar `state = 'terminated'`) pero
     *  JAMÁS persiste por sí sola: el caller combina esta mutación con la
     *  suya propia (`cycle.status = 'COMPLETE'` o `frozen = {...}`) en UN
     *  solo `writeJournal` (R1.3 — dos escrituras secuenciales sobre el
     *  mismo objeto violarían el CAS por revisión de `writeJournal`).
     *  Compartida entre el camino COMPLETE y el camino FROZEN (Task 10): el
     *  mismo requisito ("ningún controller administrado sigue vivo") aplica
     *  a ambos. */
    private async terminateAllGenerationsConfirmed(s: JournalState): Promise<{ ok: true } | { ok: false; n: number }> {
        for (const generation of s.generations) {
            for (const ref of [generation.processRef, generation.wrapperRef]) {
                // Los tests pueden ejecutar el wrapper in-process; nunca
                // enviar una senial al propio supervisor.
                if (ref?.pid === process.pid) continue;
                if (ref === undefined || groupIsGone(ref.processGroup)) continue;
                const confirmed = await terminateGroupConfirmed(ref, { termGraceMs: this.cfg.termGraceMs, killGraceMs: this.cfg.killGraceMs });
                if (!confirmed) return { ok: false, n: generation.n };
            }
            generation.state = 'terminated';
        }
        return { ok: true };
    }

    /** Paso 2-6 del freeze (R5.2/R6.3, Task 10 — paso 1 "deja de despachar"
     *  ya lo hizo `dispatch:false` en `runnerTick`, arriba en `tick()`):
     *  fail-closed en cada paso — cualquier hecho todavía no demostrable
     *  simplemente pospone (`'continue'`, el próximo tick reintenta), JAMÁS
     *  fuerza `frozen` sobre evidencia incompleta. Solo cuando los 4 hechos
     *  restantes (cero vivos, gate local verde, worktree/index limpios,
     *  generación propia terminada CONFIRMADA) son TODOS demostrables se
     *  persiste `frozenHeadSha` + el marcador `frozen` — en el MISMO
     *  `writeJournal` que la terminación de generación de arriba. */
    private async attemptFreeze(): Promise<TickOutcome> {
        const r = readJournal(this.repoRoot, this.branch);
        if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        const s = r.state;
        const liveJobs = Object.values(s.jobs).filter((j) => LIVE.includes(j.executionState)).length;
        if (liveJobs > 0) return 'continue';                         // paso 2: drenando todavía
        const gate = computeTrackGate(s, false, this.fingerprintNow);
        if (!gate.pass) return 'continue';                           // paso 3: gate local todavía rojo
        if (!isWorktreeClean(this.repoRoot)) return 'continue';      // paso 4: worktree/index todavía sucios
        const terminated = await this.terminateAllGenerationsConfirmed(s);   // paso 5
        if (!terminated.ok) {
            enterCustody(this.repoRoot, this.branch, `no se pudo terminar con identidad confirmada la generacion ${terminated.n} antes de FROZEN (R5.2/R6.3)`);
            return 'custody';
        }
        s.frozen = { headSha: headSha(this.repoRoot), at: new Date().toISOString() };   // paso 4/6: SHA congelado, durable
        writeJournal(this.repoRoot, this.branch, s);
        appendEvent(this.repoRoot, this.branch, { kind: 'track-frozen', headSha: s.frozen.headSha });
        return 'frozen';   // paso 6 ("libera el lock y sale"): runSupervisorLoop trata 'frozen' igual que 'complete'
    }

    /** true => custodia (el caller NO libera lock ni sale). */
    private async superviseController(): Promise<boolean> {
        const r = readJournal(this.repoRoot, this.branch);
        if (r.corrupt || r.state === null) throw new Error('journal corrupto (R1.6)');
        const s = r.state;
        const gen = activeGeneration(s);
        if (gen?.processRef === undefined) return false;         // sin controlador propio: nada que supervisar
        if (this.lastGenerationToken !== gen.token) {
            this.lastGenerationToken = gen.token;
            this.lastActivity = null;
        }
        const adapter = adapterFor(this.cfg.provider);
        const heartbeatAgeMs = Date.now() - Date.parse(s.controllerHeartbeatAt ?? gen.launchedAt);
        const snap = adapter.activity(gen.processRef);
        const key = JSON.stringify(snap);
        if (this.lastActivity === null || this.lastActivity.key !== key) {
            this.lastActivity = { key, changedAt: Date.now() };
        }
        const activityFrozenMs = Date.now() - this.lastActivity.changedAt;
        const decision = decideStall(
            { heartbeatAgeMs, activityFrozenMs, safeToReplace: adapter.safeToReplace(gen.processRef) },
            { heartbeatTimeoutMs: this.cfg.heartbeatTimeoutMs, activityWindowMs: this.cfg.activityWindowMs },
        );
        if (decision === 'healthy') { this.backoff.reset(); return false; }
        if (decision === 'suspected-stall-observe') {
            if (gen.state !== 'controller-suspected-stall') {
                gen.state = 'controller-suspected-stall';        // SOLO observacion (R4.2)
                writeJournal(this.repoRoot, this.branch, s);
                appendEvent(this.repoRoot, this.branch, { kind: 'controller-suspected-stall', n: gen.n });
            }
            return false;
        }
        if (decision === 'custody-blocked') {
            enterCustody(this.repoRoot, this.branch, 'doble senial de stall sin safeToReplace positivo del adapter (R4.2b)');
            return true;
        }
        // resolve-generation
        const resolved = await resolveGeneration(this.repoRoot, this.branch, adapter, { termGraceMs: this.cfg.termGraceMs, killGraceMs: this.cfg.killGraceMs });
        if (resolved === 'custody-blocked') return true;
        if (this.backoff.exhausted()) {
            enterCustody(this.repoRoot, this.branch, 'tope de relanzamientos por hora alcanzado (R4.3)');
            return true;
        }
        if (Date.now() < this.relaunchNotBefore) return false;   // esperando backoff, auditando
        beginGeneration(this.repoRoot, this.branch);
        const nextAction = readJournal(this.repoRoot, this.branch).state!.cycle.nextAction;
        const prompt = nextAction !== undefined ? `el next_action ${nextAction.actionId} del journal` : 'el plan del ciclo desde el journal';
        const launched = this.ensureController(prompt);
        if (launched === 'custody') return true;
        if (launched === 'ok') {
            this.backoff.recordRelaunch();
            this.relaunchNotBefore = Date.now() + this.backoff.nextMs();
        }
        return false;
    }
}

/** Foreground, visible, terminable (R2.4): sin daemons. SIGINT/SIGTERM libera
 *  el lock y sale; COMPLETE => auto-exit liberando lock y terminando la
 *  generacion propia (cero huerfanos). */
export async function runSupervisorLoop(
    repoRoot: string, branch: string, cfg: SupervisorConfig,
    spawner: WrapperSpawner = defaultWrapperSpawner(), trackRuntime?: TrackRuntime,
): Promise<void> {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal ausente o corrupto: corre `awm watch --init` primero');
    verifyBranchInvariant(repoRoot, r.state.branch);
    if (r.state.cycle.status === 'COMPLETE') return;
    const handle = acquireLock(repoRoot);
    let shutdownRequested = false;
    let wakeSleep: (() => void) | null = null;
    let safeToRelease = false;
    const onSignal = () => { shutdownRequested = true; wakeSleep?.(); };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const sup = new Supervisor(repoRoot, branch, cfg, spawner, trackRuntime);
    try {
        const s0 = readJournal(repoRoot, branch).state!;
        if (activeGeneration(s0) === undefined) {
            beginGeneration(repoRoot, branch);
        }
        for (;;) {
            if (shutdownRequested) break;
            const out = await sup.tick();
            // 'frozen' (Task 10): mismo camino de salida que 'complete' —
            // drenar ownership y liberar el lock, el track ya cumplió su
            // freeze y no debe seguir despachando ni corriendo su loop.
            if (out === 'complete' || out === 'frozen') break;
            // 'custody': NO liberar lock, NO salir — seguir auditando (R4.5)
            await new Promise<void>((resolve) => {
                let settled = false;
                const finish = () => { if (!settled) { settled = true; clearTimeout(timer); wakeSleep = null; resolve(); } };
                const timer = setTimeout(finish, cfg.tickMs);
                wakeSleep = finish;
            });
        }
        // En shutdown explicito, drenar ownership ANTES de liberar el lock. En
        // COMPLETE, tick() ya hizo exactamente esta confirmacion antes de
        // persistir el estado terminal; el loop solo verifica el invariante.
        collectControllerGeneration(repoRoot, branch);
        const sEnd = readJournal(repoRoot, branch).state!;
        for (const g of sEnd.generations) {
            if (controllerGenerationHasUnresolvedClaim(repoRoot, branch, g)) {
                throw new Error(`ownership retenido: generacion ${g.n} tiene claim sin identidad ni resultado`);
            }
            for (const ref of [g.processRef, g.wrapperRef]) {
                if (ref?.pid === process.pid) continue;
                if (ref === undefined || groupIsGone(ref.processGroup)) continue;
                const confirmed = await terminateGroupConfirmed(ref, { termGraceMs: cfg.termGraceMs, killGraceMs: cfg.killGraceMs });
                if (!confirmed) throw new Error(`ownership retenido: generacion ${g.n} sigue viva o su identidad es indemostrable`);
            }
            g.state = 'terminated';
        }
        if (shutdownRequested) writeJournal(repoRoot, branch, sEnd);
        safeToRelease = true;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        if (safeToRelease) releaseLock(repoRoot, handle);
    }
}
