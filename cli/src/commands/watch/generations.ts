// State machine de generaciones (R4.2/R4.2b/R4.3): el silencio NUNCA autoriza
// kill; custodia BLOCKED conserva lock y ownership (el loop de supervisor.ts
// sigue vivo auditando — jamas sale dejando un vivo sin duenio).
import crypto from 'crypto';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { refIsAlive, groupIsGone, terminateGroupConfirmed, spawnStructured } from '../../core/journal/process';
import { adapterFor } from '../../core/journal/adapter';
import type { ControllerAdapter, SafeToReplace } from '../../core/journal/adapter';
import type { Generation, JournalState, ProcessRef } from '../../core/journal/types';

export type StallDecision = 'healthy' | 'suspected-stall-observe' | 'custody-blocked' | 'resolve-generation';
export interface StallSignals { heartbeatAgeMs: number; activityFrozenMs: number; safeToReplace: SafeToReplace; }
export interface StallConfig { heartbeatTimeoutMs: number; activityWindowMs: number; }

/** Doble senial + senial positiva del adapter (design R4.2/R4.2b):
 *  - solo heartbeat vencido => observar (suspected-stall), JAMAS matar;
 *  - doble senial sin 'safe' del adapter => custodia BLOCKED sin matar;
 *  - doble senial + 'safe' => recien ahi resolver la generacion. */
export function decideStall(signals: StallSignals, cfg: StallConfig): StallDecision {
    if (signals.heartbeatAgeMs < cfg.heartbeatTimeoutMs) return 'healthy';
    if (signals.activityFrozenMs < cfg.activityWindowMs) return 'suspected-stall-observe';
    if (signals.safeToReplace !== 'safe') return 'custody-blocked';
    return 'resolve-generation';
}

const BACKOFF_MS = [60000, 300000, 900000];
const MAX_RELAUNCHES_PER_HOUR = 6;

export class Backoff {
    private idx = -1;
    private stamps: number[] = [];
    nextMs(): number {
        this.idx = Math.min(this.idx + 1, BACKOFF_MS.length - 1);
        return BACKOFF_MS[this.idx];
    }
    reset(): void { this.idx = -1; }
    recordRelaunch(): void { this.stamps.push(Date.now()); }
    exhausted(): boolean {
        const hourAgo = Date.now() - 3600000;
        this.stamps = this.stamps.filter((t) => t > hourAgo);
        return this.stamps.length >= MAX_RELAUNCHES_PER_HOUR;
    }
}

export function activeGeneration(s: JournalState): Generation | undefined {
    return s.generations.find((g) => g.state === 'active' || g.state === 'controller-suspected-stall');
}

/** Emite generacion N+1: toda anterior queda superseded (fencing). NO lanza el
 *  proceso aqui — launchControllerGeneration lo hace con el adapter. */
export function beginGeneration(repoRoot: string, branch: string): Generation {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    for (const g of s.generations) {
        if (g.state === 'active' || g.state === 'controller-suspected-stall') g.state = 'superseded';
    }
    const gen: Generation = {
        n: s.generations.length + 1,
        token: crypto.randomBytes(8).toString('hex'),
        state: 'active', launchedAt: new Date().toISOString(),
    };
    s.generations.push(gen);
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-begun', n: gen.n });
    return gen;
}

export function launchControllerGeneration(repoRoot: string, branch: string, provider: string, resumePrompt: string): ProcessRef {
    const adapter = adapterFor(provider);
    const argv = adapter.launchArgv(resumePrompt);
    const { ref } = spawnStructured(argv, repoRoot, crypto.randomBytes(8).toString('hex'));
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    const gen = activeGeneration(s);
    if (gen !== undefined) gen.processRef = ref;
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-launched', provider, pid: ref.pid });
    return ref;
}

/** Custodia (R4.5): ciclo BLOCKED con razon auditada. QUIEN NO HACE NADA:
 *  no mata, no relanza, no libera lock — el loop sigue vivo auditando. */
export function enterCustody(repoRoot: string, branch: string, reason: string): void {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const s = r.state;
    if (s.cycle.status !== 'BLOCKED' || s.cycle.blockedReason !== reason) {
        s.cycle.status = 'BLOCKED';
        s.cycle.blockedReason = reason;
        writeJournal(repoRoot, branch, s);
        appendEvent(repoRoot, branch, { kind: 'custody-blocked', reason });
    }
}

export type ResolveOutcome = 'proven-dead' | 'terminated-confirmed' | 'custody-blocked';

/** Resolucion de la generacion vigente (R4.2b). Con los adapters de R1,
 *  'safe' solo ocurre con muerte probada; la escalera queda para adapters
 *  que puedan observar llamadas en vuelo. */
export async function resolveGeneration(repoRoot: string, branch: string, adapter: ControllerAdapter, grace: { termGraceMs: number; killGraceMs: number }): Promise<ResolveOutcome> {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    const gen = activeGeneration(r.state);
    if (gen?.processRef === undefined) return 'proven-dead';   // nunca se lanzo: relanzar es seguro
    const ref = gen.processRef;
    if (adapter.safeToReplace(ref) !== 'safe') {
        enterCustody(repoRoot, branch, 'stall confirmado pero el adapter no afirma safeToReplace: custodia sin matar (R4.2b)');
        return 'custody-blocked';
    }
    // muerte confirmada sin intervencion nuestra: no corresponde marcarla
    // 'terminated' aca, porque nadie la mato (esa transicion es solo para la
    // rama con kill real, mas abajo). Queda 'active' hasta el proximo
    // beginGeneration exitoso, que la supersede al relanzar. CAVEAT para
    // Task 18 (superviseController): beginGeneration esta gateado por
    // backoff/relanzamiento — si el backoff se agota, el loop entra en
    // custodia SIN llamar beginGeneration, y esta generacion queda 'active'
    // en el journal indefinidamente (superseded, nunca terminated, cuando
    // eventualmente se relance). Hoy es inerte (ningun consumidor lee
    // generation.state para reportar), pero cualquier futuro consumidor de
    // observabilidad debe cruzar con cycle.status, no confiar en
    // generation.state === 'active' como "puede seguir vivo un proceso".
    if (!refIsAlive(ref) && groupIsGone(ref.processGroup)) return 'proven-dead';
    // vivo + safe positivo (adapters futuros): SIGTERM -> gracia -> SIGKILL, confirmando
    const confirmed = await terminateGroupConfirmed(ref, grace);
    if (!confirmed) {
        enterCustody(repoRoot, branch, 'terminacion inconfirmable: custodia (R4.2b caso c)');
        return 'custody-blocked';
    }
    const s = readJournal(repoRoot, branch).state!;
    const g = activeGeneration(s);
    if (g !== undefined) g.state = 'terminated';
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-terminated-confirmed', n: g?.n });
    return 'terminated-confirmed';
}
