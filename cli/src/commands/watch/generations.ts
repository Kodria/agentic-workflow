// State machine de generaciones (R4.2/R4.2b/R4.3): el silencio NUNCA autoriza
// kill; custodia BLOCKED conserva lock y ownership (el loop de supervisor.ts
// sigue vivo auditando — jamas sale dejando un vivo sin duenio).
import crypto from 'crypto';
import fs from 'fs';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { refIsAlive, groupIsGone, terminateGroupConfirmed, argvDigest } from '../../core/journal/process';
import { adapterFor } from '../../core/journal/adapter';
import { logsDir } from '../../core/journal/paths';
import { claimPath, identityPath, resultPath } from '../job/exec-wrapper';
import { defaultWrapperSpawner, WrapperSpawner } from './runner';
import type { ControllerAdapter, SafeToReplace } from '../../core/journal/adapter';
import { isWellFormedProcessRef } from '../../core/journal/types';
import type { Generation, Job, JournalState } from '../../core/journal/types';

/** Lectura obligatoria del journal (patron repetido en todo este archivo):
 *  el supervisor jamas opera sobre corrupcion (R1.6) — falla ruidoso, nunca
 *  sigue con un estado indemostrable. */
function requireState(repoRoot: string, branch: string): JournalState {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
    return r.state;
}

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
    const s = requireState(repoRoot, branch);
    for (const g of s.generations) {
        if (g.state === 'active' || g.state === 'controller-suspected-stall') g.state = 'superseded';
    }
    const gen: Generation = {
        n: s.generations.length + 1,
        token: crypto.randomBytes(8).toString('hex'),
        state: 'active', launchedAt: new Date().toISOString(),
    };
    s.generations.push(gen);
    s.controllerHeartbeatAt = undefined; // el heartbeat pertenece al fencing token anterior
    writeJournal(repoRoot, branch, s);
    appendEvent(repoRoot, branch, { kind: 'generation-begun', n: gen.n });
    return gen;
}

function promptForGeneration(gen: Generation): string {
    return `${gen.resumePrompt}\nGeneracion activa: ${gen.token}. Incluye --generation ${gen.token} en cada comando awm job.`;
}

/** Persiste el intent completo ANTES de delegarlo al wrapper. El wrapper usa
 * claim exclusivo por (controllerJobId, spawnNonce), por lo que reemitir este
 * mismo intent tras un crash nunca lanza dos controllers. */
export function launchControllerGeneration(
    repoRoot: string,
    branch: string,
    provider: string,
    resumePrompt: string,
    spawner: WrapperSpawner = defaultWrapperSpawner(),
): void {
    const s = requireState(repoRoot, branch);
    const gen = activeGeneration(s);
    if (gen === undefined) throw new Error('no hay generacion activa para lanzar');
    gen.controllerJobId = gen.controllerJobId ?? `controller-gen-${gen.n}`;
    gen.spawnNonce = gen.spawnNonce ?? crypto.randomBytes(8).toString('hex');
    gen.provider = gen.provider ?? provider;
    gen.resumePrompt = gen.resumePrompt ?? resumePrompt;
    writeJournal(repoRoot, branch, s);
    const argv = adapterFor(gen.provider).launchArgv(promptForGeneration(gen));
    const job: Job = {
        id: gen.controllerJobId, fingerprint: `generation:${gen.token}`, commandDigest: `generation:${gen.token}`,
        argv, cwd: '.', paths: [], expandedPaths: [], executionState: 'spawn-intent',
        observationState: 'progressing', spawnNonce: gen.spawnNonce,
        phaseTimestamps: { 'spawn-intent': gen.launchedAt },
    };
    const wrapperRef = spawner(job, gen.spawnNonce, logsDir(repoRoot, branch), repoRoot);
    if (wrapperRef !== undefined) {
        const afterSpawn = requireState(repoRoot, branch);
        const same = afterSpawn.generations.find((candidate) => candidate.token === gen.token);
        if (same !== undefined) same.wrapperRef = wrapperRef;
        writeJournal(repoRoot, branch, afterSpawn);
    }
    appendEvent(repoRoot, branch, { kind: 'generation-launch-requested', provider: gen.provider, n: gen.n });
}

/** Adopta la identidad que el wrapper externo persistio. Nunca inventa PID y
 * valida que el sidecar corresponda exactamente al intent de la generacion. */
export function collectControllerGeneration(repoRoot: string, branch: string): boolean {
    const s = requireState(repoRoot, branch);
    const gen = activeGeneration(s);
    if (gen?.controllerJobId === undefined || gen.spawnNonce === undefined) return false;
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(identityPath(logsDir(repoRoot, branch), gen.controllerJobId, gen.spawnNonce), 'utf8')); }
    catch { return false; }
    if (typeof parsed !== 'object' || parsed === null) return false;
    const identity = parsed as { jobId?: unknown; nonce?: unknown; wrapper?: unknown; command?: unknown };
    if (identity.jobId !== gen.controllerJobId || identity.nonce !== gen.spawnNonce
        || !isWellFormedProcessRef(identity.wrapper) || !isWellFormedProcessRef(identity.command)
        || identity.wrapper.spawnNonce !== gen.spawnNonce || identity.command.spawnNonce !== gen.spawnNonce
        || gen.provider === undefined || gen.resumePrompt === undefined
        || identity.command.argvDigest !== argvDigest(adapterFor(gen.provider).launchArgv(promptForGeneration(gen)))) return false;
    const changed = gen.wrapperRef?.pid !== identity.wrapper.pid || gen.processRef?.pid !== identity.command.pid;
    gen.wrapperRef = identity.wrapper;
    gen.processRef = identity.command;
    if (changed) {
        writeJournal(repoRoot, branch, s);
        appendEvent(repoRoot, branch, { kind: 'generation-launched', provider: gen.provider, pid: gen.processRef.pid, n: gen.n });
    }
    return true;
}

export function controllerGenerationHasUnresolvedClaim(repoRoot: string, branch: string, gen: Generation): boolean {
    if (gen.controllerJobId === undefined || gen.spawnNonce === undefined || gen.processRef !== undefined) return false;
    const logs = logsDir(repoRoot, branch);
    return fs.existsSync(claimPath(logs, gen.controllerJobId, gen.spawnNonce))
        && !fs.existsSync(resultPath(logs, gen.controllerJobId, gen.spawnNonce));
}

/** Recupera tanto crash-before-spawn como crash-after-spawn-before-journal.
 * Claim sin identidad queda ambiguo y se conserva bajo custodia tras la gracia;
 * nunca se resuelve lanzando otro token/nonce a ciegas. */
export function ensureControllerGeneration(
    repoRoot: string,
    branch: string,
    provider: string,
    resumePrompt: string,
    spawner: WrapperSpawner,
    ambiguityGraceMs: number,
): void {
    if (collectControllerGeneration(repoRoot, branch)) return;
    let gen = activeGeneration(requireState(repoRoot, branch));
    if (gen === undefined) return;
    if (gen.processRef !== undefined || gen.wrapperRef !== undefined) return;
    if (gen.controllerJobId === undefined || gen.spawnNonce === undefined) {
        launchControllerGeneration(repoRoot, branch, provider, resumePrompt, spawner);
        return;
    }
    const logs = logsDir(repoRoot, branch);
    if (fs.existsSync(resultPath(logs, gen.controllerJobId, gen.spawnNonce))) {
        enterCustody(repoRoot, branch, `controller ${gen.n} termino sin identidad adoptable: decision explicita requerida`);
        return;
    }
    const claim = claimPath(logs, gen.controllerJobId, gen.spawnNonce);
    if (fs.existsSync(claim)) {
        let claimAgeMs = Number.POSITIVE_INFINITY;
        try { claimAgeMs = Date.now() - fs.statSync(claim).mtimeMs; } catch { /* si no se puede probar reciente, falla cerrado */ }
        if (claimAgeMs > ambiguityGraceMs) {
            enterCustody(repoRoot, branch, `claim de controller ${gen.n} sin identidad demostrable: custodia`);
        }
        return;
    }
    // El intent ya estaba durable pero el spawn no ocurrio: es seguro reemitir
    // exactamente el mismo nonce. Si el wrapper original solo estaba demorado,
    // su claim wx arbitra cual de ambos ejecuta.
    launchControllerGeneration(repoRoot, branch, gen.provider ?? provider, gen.resumePrompt ?? resumePrompt, spawner);
}

/** Custodia (R4.5): ciclo BLOCKED con razon auditada. QUIEN NO HACE NADA:
 *  no mata, no relanza, no libera lock — el loop sigue vivo auditando. */
export function enterCustody(repoRoot: string, branch: string, reason: string): void {
    const s = requireState(repoRoot, branch);
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
    const gen = activeGeneration(requireState(repoRoot, branch));
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
