// Loop foreground (R4.4/R4.5): tick = apply -> collect/spawn -> stall -> gate.
// COMPLETE exige gate verde (que exige cero vivos): drenaje ANTES de declarar.
// Custodia BLOCKED: el loop sigue, el lock NO se libera, nada se mata.
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { computeFingerprint } from '../../core/journal/fingerprint';
import { adapterFor } from '../../core/journal/adapter';
import { groupIsGone, terminateGroupConfirmed } from '../../core/journal/process';
import { computeGate, FingerprintNow } from '../job/gate';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';
import { consumePendingRequests } from './apply';
import { runnerTick, WrapperSpawner, defaultWrapperSpawner } from './runner';
import { decideStall, Backoff, beginGeneration, activeGeneration, launchControllerGeneration, resolveGeneration, enterCustody } from './generations';

export interface SupervisorConfig {
    provider: string;
    heartbeatTimeoutMs: number;
    activityWindowMs: number;
    tickMs: number;
    termGraceMs: number;
    killGraceMs: number;
    reconcileGraceMs: number;
    jobStallObservationMs: number;   // R3.5: umbral observacional de suspected-stall por job (nunca mata nada)
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
};

export type TickOutcome = 'continue' | 'custody' | 'complete';

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export class Supervisor {
    private backoff = new Backoff();
    private relaunchNotBefore = 0;
    private lastActivity: { key: string; changedAt: number } | null = null;

    constructor(
        private repoRoot: string,
        private branch: string,
        private cfg: SupervisorConfig,
        private spawner: WrapperSpawner,
    ) {}

    private fingerprintNow: FingerprintNow = (argv, paths, cwd) => {
        try { return computeFingerprint(this.repoRoot, argv, paths, cwd).fingerprint; }
        catch { return null; }   // no recomputable => el gate NO certifica (fail-closed)
    };

    async tick(): Promise<TickOutcome> {
        const r0 = readJournal(this.repoRoot, this.branch);
        if (r0.corrupt || r0.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        verifyBranchInvariant(this.repoRoot, r0.state.branch);   // R1.1: rama clavada
        const gen = activeGeneration(r0.state);
        consumePendingRequests(this.repoRoot, this.branch, gen?.token ?? null);
        runnerTick(this.repoRoot, this.branch, this.spawner, { reconcileGraceMs: this.cfg.reconcileGraceMs, stallObservationMs: this.cfg.jobStallObservationMs });
        const custody = await this.superviseController();
        if (custody) return 'custody';
        const r = readJournal(this.repoRoot, this.branch);
        const gate = computeGate(r.state, r.corrupt, this.fingerprintNow);
        const liveJobs = r.state === null ? 1 : Object.values(r.state.jobs).filter((j) => LIVE.includes(j.executionState)).length;
        if (gate.pass && liveJobs === 0) {   // gate verde YA implica cero vivos; doble cinturon (R4.5)
            const s = r.state!;
            for (const generation of s.generations) {
                if (generation.processRef === undefined || groupIsGone(generation.processRef.processGroup)) continue;
                const confirmed = await terminateGroupConfirmed(generation.processRef, { termGraceMs: this.cfg.termGraceMs, killGraceMs: this.cfg.killGraceMs });
                if (!confirmed) {
                    enterCustody(this.repoRoot, this.branch, `no se pudo terminar con identidad confirmada la generacion ${generation.n} antes de COMPLETE`);
                    return 'custody';
                }
                generation.state = 'terminated';
            }
            s.cycle.status = 'COMPLETE';
            s.cycle.completedAt = new Date().toISOString();
            writeJournal(this.repoRoot, this.branch, s);
            appendEvent(this.repoRoot, this.branch, { kind: 'cycle-complete' });
            return 'complete';
        }
        return 'continue';
    }

    /** true => custodia (el caller NO libera lock ni sale). */
    private async superviseController(): Promise<boolean> {
        const r = readJournal(this.repoRoot, this.branch);
        if (r.corrupt || r.state === null) throw new Error('journal corrupto (R1.6)');
        const s = r.state;
        const gen = activeGeneration(s);
        if (gen?.processRef === undefined) return false;         // sin controlador propio: nada que supervisar
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
        launchControllerGeneration(this.repoRoot, this.branch, this.cfg.provider, prompt);
        this.backoff.recordRelaunch();
        this.relaunchNotBefore = Date.now() + this.backoff.nextMs();
        return false;
    }
}

/** Foreground, visible, terminable (R2.4): sin daemons. SIGINT/SIGTERM libera
 *  el lock y sale; COMPLETE => auto-exit liberando lock y terminando la
 *  generacion propia (cero huerfanos). */
export async function runSupervisorLoop(repoRoot: string, branch: string, cfg: SupervisorConfig, spawner: WrapperSpawner = defaultWrapperSpawner()): Promise<void> {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal ausente o corrupto: corre `awm watch --init` primero');
    verifyBranchInvariant(repoRoot, r.state.branch);
    const handle = acquireLock(repoRoot);
    let shutdownRequested = false;
    let wakeSleep: (() => void) | null = null;
    let safeToRelease = false;
    const onSignal = () => { shutdownRequested = true; wakeSleep?.(); };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const sup = new Supervisor(repoRoot, branch, cfg, spawner);
    try {
        const s0 = readJournal(repoRoot, branch).state!;
        if (activeGeneration(s0) === undefined) {
            beginGeneration(repoRoot, branch);
            const prompt = s0.cycle.nextAction !== undefined ? `el next_action ${s0.cycle.nextAction.actionId} del journal` : 'el plan del ciclo desde el journal';
            launchControllerGeneration(repoRoot, branch, cfg.provider, prompt);
        }
        for (;;) {
            if (shutdownRequested) break;
            const out = await sup.tick();
            if (out === 'complete') break;
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
        const sEnd = readJournal(repoRoot, branch).state!;
        for (const g of sEnd.generations) {
            if (g.processRef === undefined || groupIsGone(g.processRef.processGroup)) continue;
            const confirmed = await terminateGroupConfirmed(g.processRef, { termGraceMs: cfg.termGraceMs, killGraceMs: cfg.killGraceMs });
            if (!confirmed) throw new Error(`ownership retenido: generacion ${g.n} sigue viva o su identidad es indemostrable`);
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
