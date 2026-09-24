// Loop foreground (R4.4/R4.5): tick = apply -> collect/spawn -> stall -> gate.
// COMPLETE exige gate verde (que exige cero vivos): drenaje ANTES de declarar.
// Custodia BLOCKED: el loop sigue, el lock NO se libera, nada se mata.
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { computeFingerprint, reconcileUnattendedRecovery } from '../../core/journal/fingerprint';
import { validatePlanFile } from '../../core/plan/validate';
import { type AdmissionReport } from '../../core/admission';
import { admitRegistryPlan } from '../../core/admission/registry-contracts';
import { readPreferences } from '../../utils/config';
import type { AdmissionInput } from '../../core/admission';
import { readEffectivePolicy } from '../../core/model-policy/store';
import { readCapabilities, validateRuntimeKey } from '../../core/model-policy/capabilities';
import { readStoredEventReceipt } from '../../core/model-policy/event-store';
import { queryLocalCodexScope } from '../../core/model-policy/local-codex-scope';
import { queryLocalEventScope } from '../../core/model-policy/local-event-scope';
import type { EventScope } from '../../core/model-policy/capabilities-v2';
import { routingReport } from '../../core/model-policy/journal';
import { adapterFor, isWatchProvider, isControllerAutonomy, type ControllerAutonomy } from '../../core/journal/adapter';
import { groupIsGone, terminateGroupConfirmed } from '../../core/journal/process';
import { computeGate, computeTrackGate, FingerprintNow } from '../job/gate';
import { isWorktreeClean, headSha } from '../../core/tracks/git';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';
import { consumePendingRequests } from './apply';
import { runnerTick, WrapperSpawner, defaultWrapperSpawner } from './runner';
import { reconcileTracks, reconcileOpenJoin, defaultTrackRuntime, TrackRuntime } from './tracks';
import { decideStall, Backoff, beginGeneration, activeGeneration, ensureControllerGeneration, collectControllerGeneration, controllerGenerationHasUnresolvedClaim, resolveGeneration, enterCustody } from './generations';
import { activeRequestProblems, MAX_ADMISSION_DEFERRALS, type AdmissionContext, type AdmissionRetry, type JournalState, type ControllerRecoveryAction } from '../../core/journal/types';
import type { CohortPhase } from '../../core/tracks/types';

/** The supervisor is only allowed to dispatch after this exact admission. */
export type DispatchAdmission = () => Promise<AdmissionReport>;

/** Runtime identity the operator asserts for unattended compact v2 dispatch. */
export type RoutingIdentity = { kind: string; version: string; accountScopeDigest: string };

export interface DispatchAdmissionDeps {
    admit?: typeof admitRegistryPlan;
    readEffectivePolicy?: typeof readEffectivePolicy;
    readCapabilities?: typeof readCapabilities;
    readStoredEventReceipt?: typeof readStoredEventReceipt;
    queryLocalCodexScope?: typeof queryLocalCodexScope;
    now?: () => Date;
}

/** #166: compact v2 admission requires the runtime identity, and the supervisor
 *  never supplied it — so `awm watch` blocked on every tick with
 *  ADMISSION_ROUTING_FACTS_REQUIRED even with every other gate green.
 *
 *  The direction of attestation is the one `plan admit`/`plan resolve` already
 *  use, and is the reason the identity is a flag rather than something derived:
 *  the OPERATOR asserts the runtime, and the receipt reader is keyed BY that
 *  assertion. Picking a runtime by hunting for a receipt would let whatever
 *  receipt happens to be on disk decide what the supervisor claims to run on. */
export function routingFacts(provider: string, identity: RoutingIdentity | undefined, cwd: string, deps: DispatchAdmissionDeps = {}): AdmissionInput['routing'] {
    if (identity === undefined) return undefined;
    const runtime = validateRuntimeKey({ target: provider, kind: identity.kind, version: identity.version, accountScopeDigest: identity.accountScopeDigest });
    const at = deps.now?.() ?? new Date();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('routing observation time must be a finite Date');
    const policy = (deps.readEffectivePolicy ?? readEffectivePolicy)(cwd);
    const capabilities = (deps.readCapabilities ?? readCapabilities)(runtime, at);
    // Fail open on neither: an unapproved policy or a non-current receipt is
    // withheld, and admission blocks on the absence rather than on a stale fact.
    return { runtime, policy: policy.state === 'approved' ? policy.policy : undefined,
        capabilities: capabilities.state === 'current' ? capabilities.receipt : undefined, now: at };
}

export function defaultDispatchAdmission(repoRoot: string, branch: string, provider: string, identity?: RoutingIdentity, deps: DispatchAdmissionDeps = {}, autonomy?: ControllerAutonomy): DispatchAdmission {
    return async () => {
        const observed = readJournal(repoRoot, branch);
        const binding = observed.state?.schema === 2 ? observed.state.planBinding : undefined;
        if (!binding || binding.executionMode !== 'desatendido') {
            return { state: 'blocked', planState: 'invalid', journal: observed.corrupt ? 'corrupt' : 'missing', currentness: 'not-checked', sensors: 'not-required', diagnostics: [{ code: 'ADMISSION_JOURNAL_BINDING_REQUIRED', message: 'Unattended dispatch requires an exact compact plan binding.' }] };
        }
        const plan = validatePlanFile(binding.path, repoRoot);
        const preferences = readPreferences();
        let routing: AdmissionInput['routing'];
        if ((provider === 'codex' || provider === 'claude-code') && identity) {
            const runtime = validateRuntimeKey({ target: provider, kind: identity.kind, version: identity.version, accountScopeDigest: identity.accountScopeDigest });
            const stored = (deps.readStoredEventReceipt ?? readStoredEventReceipt)(runtime);
            if (stored.state === 'absent') routing = routingFacts(provider, identity, repoRoot, deps);
            else {
                const at = deps.now?.() ?? new Date();
                if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error('routing observation time must be a finite Date');
                const policy = (deps.readEffectivePolicy ?? readEffectivePolicy)(repoRoot);
                routing = { runtime, policy: policy.state === 'approved' ? policy.policy : undefined, now: at };
                if (stored.state === 'invalid') routing.eventIssue = { code: 'ROUTING_CAPABILITY_INVALID', message: `Sealed native event receipt is invalid; run awm model-policy setup --provider ${provider}.` };
                else {
                    const local = await (provider === 'codex' && deps.queryLocalCodexScope ? deps.queryLocalCodexScope(repoRoot, identity.kind) : queryLocalEventScope(repoRoot, provider, identity.kind));
                    if (local.state === 'current' && JSON.stringify(local.scope.runtime) === JSON.stringify(runtime)) {
                        routing.eventReceipt = stored.receipt; routing.eventScope = local.scope;
                    } else { const reason = local.state === 'unverified' ? local.reason : 'RUNTIME_IDENTITY_MISMATCH'; routing.eventIssue = { code: `ROUTING_${reason}`, message: `${provider} runtime/account scope changed or cannot be verified (${reason}); run awm model-policy setup --provider ${provider} --json.` }; }
                }
            }
        } else routing = routingFacts(provider, identity, repoRoot, deps);
        return (deps.admit ?? admitRegistryPlan)({ plan, provider, cwd: repoRoot, enabledAgents: preferences.enabledAgents,
            executionMode: 'desatendido', requireCurrent: true, verifySensors: true,
            journalState: observed.state, journalCorrupt: observed.corrupt, planPath: binding.path,
            routing,
            controllerAutonomy: autonomy });
    };
}

/** R7/C3/C4 (Task 12) + fix post-review #2 (re-derivado desde cero tras
 *  encontrar que la justificación original no probaba lo que decía — ver
 *  finding 1 del segundo round de re-review): fases de `CohortPhase` en las
 *  que una cohorte de tracks todavía puede "ganarle la carrera" a su propio
 *  `run-final-interlock`, es decir donde el `computeGate` GENÉRICO de este
 *  mismo `tick()` (línea de abajo, calculado DESPUÉS de `runnerTick`) puede
 *  certificar pass antes de que `reconcileTracks` (que corrió ANTES de
 *  `runnerTick`, arriba en este mismo `tick()`) haya tenido chance de
 *  observar ese mismo resultado y mover `cohortPhase` a `COMPLETE`.
 *
 *  Cadena causal EXACTA, trazada contra `protocol.ts`/`tracks.ts`/`apply.ts`:
 *    1. `nextProtocolEffect` (protocol.ts) solo emite `request-final-integration`
 *       cuando `s.globalQaHeadSha !== undefined` — y ese campo se asigna
 *       (`reconcileProtocol`, observación `global-qa-pass`) EN LA MISMA
 *       transición que pone `cohortPhase = 'FINAL_INTEGRATION'`. No existe
 *       ningún camino donde `request-final-integration` se emita con
 *       `cohortPhase` todavía en `'ACTIVE'`/`'JOINING'`.
 *    2. `runRequestFinalIntegration` (tracks.ts) es quien llama a `requestJob`
 *       con `verificationKind: 'track-integration'` — el ÚNICO lugar que
 *       pide el job canónico. Por (1), esto solo puede ocurrir con
 *       `cohortPhase === 'FINAL_INTEGRATION'`.
 *    3. `apply.ts::applyRequestToState` (rama `job-request`) es quien enlaza
 *       `VerificationItem.satisfiedBy` — y lo hace a REQUEST time (job recién
 *       creado en `executionState: 'received'`, o job "equivalente" ya en
 *       vuelo), nunca esperando a que el job termine. Por (2), el primer
 *       tick en que esto puede pasar ya tiene `cohortPhase === 'FINAL_INTEGRATION'`.
 *    4. Cada tick corre COMO MÁXIMO una mutación de protocolo por invocación
 *       de `reconcileTracks` (invariante propio de esa función, ver su
 *       comment de cabecera) y esa invocación sucede ANTES de `runnerTick`
 *       (que despacha/recolecta jobs) y ANTES del `computeGate` genérico de
 *       abajo. Entonces: en el tick donde el job canónico recién enlazado
 *       pasa a `verdict: 'pass'` (recolectado por `runnerTick`, que corre
 *       DESPUÉS de que `reconcileTracks` ya intentó — y no pudo, porque el
 *       job seguía vivo — avanzar el protocolo este mismo tick), el
 *       `computeGate` genérico de abajo puede certificar `pass` con
 *       `liveJobs === 0` mientras `cohortPhase` sigue en
 *       `'FINAL_INTEGRATION'` (el job pasó, pero `finalIntegrationJobId`
 *       todavía no se asignó — eso requiere la observación `integration-pass`,
 *       que recién corre el PRÓXIMO tick). Esta es la primera fase en riesgo.
 *    5. Una vez que ese próximo tick observa `integration-pass` y mueve
 *       `cohortPhase` a `'FINAL_INTERLOCK'` (dentro de `reconcileTracks`,
 *       otra vez ANTES del `computeGate` genérico de ESE tick), el gate
 *       genérico sigue viendo el mismo job ya-pasado satisfaciendo el mismo
 *       item — sigue en riesgo de certificar en ESE tick, con `cohortPhase`
 *       todavía en `'FINAL_INTERLOCK'` (la transición real a `COMPLETE` la
 *       hace `runRunFinalInterlock`, que corre recién el tick SIGUIENTE,
 *       otra vez antes que el gate genérico de ese tick). Segunda y última
 *       fase en riesgo.
 *    6. Cuando `runRunFinalInterlock` sí corre y su propio `computeGate`
 *       interno pasa, mueve `cohortPhase` a `'COMPLETE'` SINCRÓNICAMENTE
 *       dentro de `reconcileTracks`, antes de que el gate genérico de ese
 *       mismo tick se calcule — por eso `'COMPLETE'` nunca necesita estar en
 *       este set (ya lo cubre `cohortDone` por igualdad directa).
 *
 *  Por (1)-(3): `'ACTIVE'`/`'JOINING'` NO califican. Más fuerte todavía:
 *  `registerTrackIntegrationItems` (apply.ts) agrega cada `track-integration:*`
 *  al `cycleVerificationPlan` SIN `satisfiedBy` en cuanto el track se declara
 *  (mucho antes de `ACTIVE`/`JOINING`) — mientras al menos uno siga sin
 *  `satisfiedBy`, `computeGate` (gate.ts) nunca puede dar `pass`, así que el
 *  gate genérico es estructuralmente incapaz de certificar durante
 *  `ACTIVE`/`JOINING`, con o sin este guard.
 *  `'FINAL_QA'` tampoco califica — y no es solo "no está en riesgo", es
 *  DEAD: se rastreó cada asignación a `cohortPhase` en `protocol.ts`
 *  (`initialCohort`, `reconcileProtocol`, `observeProtocolEffect`) y ese
 *  valor nunca se produce; queda en el tipo `CohortPhase` pero ninguna
 *  transición real lo alcanza.
 *  Quedan fuera por lo ya documentado en la versión anterior de este
 *  comentario (verificado de nuevo, sigue siendo cierto): `'SERIAL'` (sin
 *  camino de vuelta a COMPLETE, `nextProtocolEffect` devuelve `null`
 *  incondicional), `'BLOCKED'` (lo maneja `enterCustody` aparte),
 *  `'PREPARING'`/`'FALLBACK_PENDING'` (todavía no existe job canónico
 *  enlazable) y `'COMPLETE'` (es el destino, no una fase "todavía corriendo").
 *
 *  Las ÚNICAS dos fases donde el job canónico ya puede estar enlazado
 *  (`satisfiedBy` set) sin que la cohorte misma haya llegado a `COMPLETE`
 *  son `'FINAL_INTEGRATION'` y `'FINAL_INTERLOCK'`. */
const LIVE_COHORT_PHASES: ReadonlySet<CohortPhase> = new Set<CohortPhase>([
    'FINAL_INTEGRATION', 'FINAL_INTERLOCK',
]);

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
    routingIdentity?: RoutingIdentity;  // #166: identidad de runtime que exige la admisión compact v2
    controllerAutonomy?: ControllerAutonomy;  // #168: postura con la que el controller desatendido puede ejecutar
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

/** Single place the supervisor's config becomes its admission, so the runtime
 *  identity cannot be dropped silently between the flag and the gate (#166). */
export function admissionForConfig(repoRoot: string, branch: string, cfg: SupervisorConfig, deps: DispatchAdmissionDeps = {}): DispatchAdmission {
    return defaultDispatchAdmission(repoRoot, branch, cfg.provider, cfg.routingIdentity, deps, cfg.controllerAutonomy);
}

function admissionContextForConfig(cfg: SupervisorConfig): AdmissionContext {
    if (!isWatchProvider(cfg.provider)) throw new Error('provider de supervisor invalido');
    if (cfg.controllerAutonomy !== undefined && !isControllerAutonomy(cfg.controllerAutonomy)) throw new Error('postura del controller invalida');
    const runtime = cfg.routingIdentity === undefined ? undefined : validateRuntimeKey({ target: cfg.provider, ...cfg.routingIdentity });
    return { provider: cfg.provider,
        ...(runtime ? { runtime: { kind: runtime.kind, version: runtime.version, accountScopeDigest: runtime.accountScopeDigest } } : {}),
        ...(cfg.controllerAutonomy ? { controllerAutonomy: cfg.controllerAutonomy } : {}) };
}

function sameAdmissionContext(left: AdmissionContext, right: AdmissionContext): boolean {
    return left.provider === right.provider && left.controllerAutonomy === right.controllerAutonomy
        && left.runtime?.kind === right.runtime?.kind && left.runtime?.version === right.runtime?.version
        && left.runtime?.accountScopeDigest === right.runtime?.accountScopeDigest;
}

// 'frozen' (R5.2/R6.3, Task 10): SOLO puede ocurrir en el journal de un
// TRACK individual (nunca en el del plan) — el track terminó, con las 6
// observaciones demostrables (cero jobs vivos, gate local verde, worktree
// limpio, generación propia terminada con identidad confirmada), de
// atender un `track-freeze-request` pedido por el supervisor del plan.
/** How many consecutive ticks an inconclusive sensor verdict may defer dispatch
 *  before the supervisor says so out loud. Small: the deferral covers a verdict
 *  still settling, not one that never will. */
export const MAX_SENSOR_DEFERRALS = MAX_ADMISSION_DEFERRALS;
export const ADMISSION_RETRY_DELAY_MS = 5000;

function transientAdmission(report: AdmissionReport): AdmissionRetry['kind'] | undefined {
    // Currentness and sensors are evaluated before journalStatus, so their
    // blocked reports legitimately carry journal=not-required. The caller
    // verifies the bound journal identity independently before deferring.
    if (report.state !== 'blocked' || report.executionMode !== 'desatendido'
        || report.planState !== 'valid' || !['not-required', 'current'].includes(report.journal)
        || report.diagnostics.length !== 1) return undefined;
    if (report.currentness === 'unverifiable' && report.sensors === 'not-required'
        && report.diagnostics[0].code === 'ADMISSION_CURRENTNESS_BLOCKED') return 'currentness';
    if (report.currentness === 'current' && report.sensors === 'not-certified'
        && report.diagnostics[0].code === 'ADMISSION_SENSORS_BLOCKED') return 'sensors';
    return undefined;
}

export type TickOutcome = 'continue' | 'custody' | 'complete' | 'frozen';

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export function recoveryWhitelistBlocker(state: JournalState): string | undefined {
    if (state.cycle.status === 'BLOCKED') {
        return state.cycle.blockedReason === 'recovery no autorizado: hay conflictos durables de requests'
            ? 'hay conflictos durables de requests' : 'el ciclo está bloqueado';
    }
    if (activeRequestProblems(state).length > 0) return 'hay conflictos durables de requests';
    // Pending work is the normal reason to launch (or retry launching) the
    // controller.  It is not recovery evidence and therefore cannot turn a
    // transient launch failure into permanent custody.  Conversely, once a
    // non-empty task set claims completion, missing required evidence is an
    // unsafe recovery fact and must remain fail-closed.
    if (state.tasks.length === 0 || state.tasks.some(task => task.status !== 'done')) return undefined;
    const verificationItems = [...state.cycleVerificationPlan, ...state.tasks.flatMap(task => task.verificationPlan)];
    for (const required of state.requiredVerifiers) {
        const requiredItems = verificationItems.filter(item => item.kind === required);
        if (requiredItems.length === 0 || requiredItems.some(item => item.satisfiedBy === undefined)) return `falta evidencia del verificador requerido: ${required}`;
    }
    return undefined;
}

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
        private dispatchAdmission: DispatchAdmission = admissionForConfig(repoRoot, branch, cfg),
        private autoBeginGeneration = false,
    ) {
        this.trackRuntime = trackRuntime ?? defaultTrackRuntime(repoRoot, branch, { termGraceMs: cfg.termGraceMs, killGraceMs: cfg.killGraceMs });
    }

    private fingerprintNow: FingerprintNow = (argv, paths, cwd) => {
        try { return computeFingerprint(this.repoRoot, argv, paths, cwd).fingerprint; }
        catch { return null; }   // no recomputable => el gate NO certifica (fail-closed)
    };

    private ensureController(action: ControllerRecoveryAction): 'ok' | 'deferred' | 'custody' {
        if (Date.now() < this.relaunchNotBefore) return 'deferred';
        if (this.backoff.exhausted()) {
            enterCustody(this.repoRoot, this.branch, 'tope de intentos de launch/relaunch por hora alcanzado (R4.3)');
            return 'custody';
        }
        try {
            ensureControllerGeneration(this.repoRoot, this.branch, this.cfg.provider, action, this.spawner, this.cfg.reconcileGraceMs, this.cfg.controllerAutonomy);
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
        let before0 = readJournal(this.repoRoot, this.branch);
        if (before0.corrupt || before0.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        // Historical/schema-1 journals are intentionally readable by migration
        // commands, never executable.  Do this before controller recovery,
        // request consumption, tracks, or runner reconciliation: each can cause
        // a dispatch directly or indirectly.
        if (before0.state.schema !== 2 || !before0.state.planBinding) return 'custody';
        // COMPLETE is terminal, not a recovery attempt. It cannot dispatch and
        // must retain its normal no-op result even if old work evidence is no
        // longer reconstructible.
        if (before0.state.cycle.status === 'COMPLETE') return 'complete';
        // A historical custody cannot be silently converted into another
        // cause on a later tick. Only the locked offline recovery may resume.
        if (before0.state.cycle.status === 'BLOCKED') return 'custody';
        const assertedContext = admissionContextForConfig(this.cfg);
        if (before0.state.admissionContext && !sameAdmissionContext(before0.state.admissionContext, assertedContext)) {
            enterCustody(this.repoRoot, this.branch, 'identidad de admisión cambió al reiniciar: provider/runtime/postura');
            return 'custody';
        }
        if (!before0.state.admissionContext && assertedContext.runtime && assertedContext.controllerAutonomy) {
            before0.state.admissionContext = assertedContext;
            writeJournal(this.repoRoot, this.branch, before0.state);
            before0 = readJournal(this.repoRoot, this.branch);
            if (before0.corrupt || !before0.state) throw new Error('journal no verificable tras vincular identidad de admisión');
        }
        // Full sensor admission belongs to the launch boundary. Once that
        // generation has a durable controller launch intent, RED edits are
        // normal work, not a new pre-dispatch baseline. Preserve binding
        // checks while it runs; the next generation gets a fresh admission.
        const binding = before0.state.planBinding;
        if (!binding) throw new Error('binding compacto ausente tras lectura del journal');
        const launched = activeGeneration(before0.state);
        const ownedLaunch = launched !== undefined && (launched.processRef !== undefined || launched.wrapperRef !== undefined
            || controllerGenerationHasUnresolvedClaim(this.repoRoot, this.branch, launched));
        const generationAdmitted = launched?.controllerJobId !== undefined && launched.launchArgvDigest !== undefined && ownedLaunch;
        if (generationAdmitted) {
            const plan = validatePlanFile(binding.path, this.repoRoot);
            if (plan.state !== 'valid' || plan.planDigest !== binding.digest || plan.schema !== binding.schema
                || (binding.executionDigest !== undefined && plan.executionDigest !== binding.executionDigest)) {
                enterCustody(this.repoRoot, this.branch, 'binding del plan alterado durante generacion admitida');
                return 'custody';
            }
            if (binding.schema === 'compact-slices/v2') {
                const asserted = assertedContext.runtime;
                if (!asserted) {
                    enterCustody(this.repoRoot, this.branch, 'runtime de routing ausente durante generacion v2');
                    return 'custody';
                }
                const expected = validateRuntimeKey({ target: assertedContext.provider, ...asserted });
                let local: Awaited<ReturnType<typeof queryLocalEventScope>>;
                try { local = await queryLocalEventScope(this.repoRoot, expected.target, expected.kind); }
                catch (error) {
                    enterCustody(this.repoRoot, this.branch, `runtime local no verificable: ${(error as Error).message}`);
                    return 'custody';
                }
                if (local.state !== 'current' || JSON.stringify(local.scope.runtime) !== JSON.stringify(expected)) {
                    enterCustody(this.repoRoot, this.branch, 'runtime local cambió durante generacion admitida');
                    return 'custody';
                }
                const stored = readStoredEventReceipt(expected);
                if (stored.state === 'invalid' || (stored.state === 'present' &&
                    (stored.receipt.binaryDigest !== local.scope.binaryDigest || stored.receipt.configDigest !== local.scope.configDigest))) {
                    enterCustody(this.repoRoot, this.branch, 'recibo nativo cambió durante generacion admitida');
                    return 'custody';
                }
                if (stored.state === 'absent' && readCapabilities(expected, new Date()).state !== 'current') {
                    enterCustody(this.repoRoot, this.branch, 'capacidades de routing no verificables durante generacion admitida');
                    return 'custody';
                }
            }
        }
        if (!generationAdmitted && before0.state.admissionRetry && Date.now() < Date.parse(before0.state.admissionRetry.nextRetryAt)) return 'continue';
        // A controller can create jobs and runnerTick can start them. Both are
        // downstream of the same full compact unattended admission, so it must
        // complete before any reconciliation path that could dispatch either.
        if (!generationAdmitted) {
            let admission: AdmissionReport;
            try { admission = await this.dispatchAdmission(); }
            catch (error) {
                enterCustody(this.repoRoot, this.branch, `admisión desatendida no verificable: ${(error as Error).message}`);
                return 'custody';
            }
            if (admission.state !== 'admitted' || admission.executionMode !== 'desatendido'
                || admission.currentness !== 'current' || admission.sensors !== 'pass' || admission.journal !== 'current') {
                const kind = transientAdmission(admission);
                if (kind) {
                    const plan = validatePlanFile(binding.path, this.repoRoot);
                    if (plan.state !== 'valid' || plan.planDigest !== binding.digest || plan.schema !== binding.schema
                        || (binding.executionDigest !== undefined && plan.executionDigest !== binding.executionDigest)
                        || (admission.planDigest !== undefined && admission.planDigest !== binding.digest)) {
                        enterCustody(this.repoRoot, this.branch, 'binding del plan alterado durante admisión transitoria');
                        return 'custody';
                    }
                    const prior = before0.state.admissionRetry;
                    const attempts = (prior?.attempts ?? 0) + 1;
                    if (attempts <= MAX_ADMISSION_DEFERRALS) {
                        const now = Date.now();
                        before0.state.admissionRetry = { kind, attempts, firstAt: prior?.firstAt ?? new Date(now).toISOString(), nextRetryAt: new Date(now + ADMISSION_RETRY_DELAY_MS).toISOString() };
                        writeJournal(this.repoRoot, this.branch, before0.state);
                        appendEvent(this.repoRoot, this.branch, { kind: 'admission-retry', cause: kind, attempts, retryAfterMs: ADMISSION_RETRY_DELAY_MS });
                        return 'continue';
                    }
                    enterCustody(this.repoRoot, this.branch, `admisión ${kind} no verificable tras ${MAX_ADMISSION_DEFERRALS} reintentos: ${admission.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('; ')}`);
                    return 'custody';
                }
                enterCustody(this.repoRoot, this.branch, `admisión compacta desatendida bloqueada antes de dispatch: ${admission.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('; ')}`);
                return 'custody';
            }
            // An incomplete assertion can be repaired while the cycle is
            // still waiting. Bind it only after an admitted observation, never
            // on an early currentness/sensor response that has not reached the
            // provider, runtime and autonomy gates yet.
            if (!before0.state.admissionContext) {
                before0.state.admissionContext = assertedContext;
                writeJournal(this.repoRoot, this.branch, before0.state);
                before0 = readJournal(this.repoRoot, this.branch);
                if (before0.corrupt || !before0.state) throw new Error('journal no verificable tras vincular admisión completa');
            }
            if (before0.state.admissionRetry) {
                before0.state.admissionRetry = undefined;
                writeJournal(this.repoRoot, this.branch, before0.state);
                before0 = readJournal(this.repoRoot, this.branch);
                if (before0.corrupt || !before0.state) throw new Error('journal no verificable tras resolver reintento de admisión');
            }
        }
        let recoveryResumeAction: ControllerRecoveryAction | undefined;
        // Schema-2 custody is reconciled before any controller launch.  This is
        // read-only: existing active jobs are reused, never re-requested.
        if (before0.state.schema === 2 && before0.state.planBinding) {
            const whitelistBlocker = recoveryWhitelistBlocker(before0.state);
            if (whitelistBlocker) {
                enterCustody(this.repoRoot, this.branch, `recovery no autorizado: ${whitelistBlocker}`);
                return 'custody';
            }
            const activeJobIds = Object.values(before0.state.jobs)
                .filter(job => LIVE.includes(job.executionState) || job.executionState === 'orphaned').map(job => job.id);
            const staleJob = Object.values(before0.state.jobs).filter(job => LIVE.includes(job.executionState) || job.executionState === 'orphaned').some(job => {
                try { return computeFingerprint(this.repoRoot, job.argv, job.paths, job.cwd).fingerprint !== job.fingerprint; }
                catch { return true; }
            });
            const boundPlan = validatePlanFile(before0.state.planBinding.path, this.repoRoot);
            const planChanged = boundPlan.state !== 'valid' || boundPlan.planDigest !== before0.state.planBinding.digest || boundPlan.schema !== before0.state.planBinding.schema;
            const passed = (id: string | undefined): boolean => {
                if (!id) return false;
                const job = before0.state!.jobs[id];
                return job !== undefined && job.verdict === 'pass' && !staleJob;
            };
            const verificationItems = [...before0.state.cycleVerificationPlan, ...before0.state.tasks.flatMap(task => task.verificationPlan)];
            const tests = verificationItems.filter(item => item.kind === 'test');
            const sensorItems = verificationItems.filter(item => item.kind === 'sensors');
            // `computeGate` is the single authority for every verification
            // kind (review, QA and interlock included). Reuse its evidence
            // semantics instead of maintaining a weaker recovery subset.
            const evidenceGate = computeGate(before0.state, false, this.fingerprintNow);
            const terminalTaskClaims = before0.state.tasks.length > 0 && before0.state.tasks.every(task => task.status === 'done');
            const unresolvedVerification = terminalTaskClaims && evidenceGate.reasons.some(reason => [
                'dangling-reference', 'unsatisfied-plan', 'adverse-verdict',
                'stale-fingerprint', 'open-obligation', 'open-fix',
            ].includes(reason.category));
            const hasStaleReview = before0.state.verdicts.some(verdict => verdict.fingerprint === '' || (verdict.argv.length > 0 && (() => {
                try { return computeFingerprint(this.repoRoot, verdict.argv, verdict.paths, verdict.cwd).fingerprint !== verdict.fingerprint; } catch { return true; }
            })()));
            // Keep the same fail-closed review/fix semantics as job/gate.ts:
            // missing required kinds, dangling verdict references, adverse
            // verdicts, and an adverse verdict without a closed fix all stop
            // recovery before a controller can create more work.
            const verdictById = new Map(before0.state.verdicts.map(verdict => [verdict.id, verdict]));
            const openReviewOrFix = (terminalTaskClaims && before0.state.tasks.some(task => {
                const obligations = task.reviewObligations;
                return !(['spec', 'quality'] as const).every(kind => obligations.some(obligation => obligation.kind === kind))
                    || obligations.some(obligation => {
                        const verdict = obligation.verdictId === undefined ? undefined : verdictById.get(obligation.verdictId);
                        return verdict === undefined || verdict.result !== 'pass';
                    });
            })) || before0.state.verdicts.some(verdict => verdict.result !== 'pass'
                && !before0.state!.fixes.some(fix => fix.verdictId === verdict.id && fix.closed));
            const recovery = reconcileUnattendedRecovery({
                journal: before0.state, journalCorrupt: false, plan: before0.state.planBinding,
                git: staleJob || planChanged ? 'changed' : 'current', activeJobIds,
                tests: !terminalTaskClaims || tests.length === 0 || tests.every(item => passed(item.satisfiedBy)) ? 'pass' : 'missing',
                sensors: !terminalTaskClaims || sensorItems.length === 0 || sensorItems.every(item => passed(item.satisfiedBy)) ? 'pass' : 'missing',
                verdicts: hasStaleReview ? 'stale' : (openReviewOrFix || unresolvedVerification) ? 'missing' : 'current',
            });
            appendEvent(this.repoRoot, this.branch, { kind: 'unattended-recovery', nextAction: recovery.nextAction, activeJobIds: recovery.activeJobIds, diagnostics: recovery.diagnostics });
            if (recovery.state !== 'ready') {
                const staleReasons = terminalTaskClaims ? evidenceGate.reasons.filter(reason => reason.category === 'stale-fingerprint') : [];
                const remedy = staleReasons.length > 0
                    ? `; stale-fingerprint: ${staleReasons.map(reason => reason.detail).join('; ')}. Re-ejecutar verificaciones mediante awm job request con generation, paths y satisfies originales, y repetir reviews independientes cuando corresponda; no repetir watch/rebind ni actualizar fingerprints de PASS históricos`
                    : '';
                enterCustody(this.repoRoot, this.branch, `recovery no autorizado: ${recovery.diagnostics.join(', ')}${remedy}`);
                return 'custody';
            }
            recoveryResumeAction = { schema: 'controller-recovery/v1', kind: recovery.nextAction === 'reconcile-active-jobs' ? 'reconcile-active-jobs' : 'resume-next-action' };
        }
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
        if (this.autoBeginGeneration && activeGeneration(before) === undefined) beginGeneration(this.repoRoot, this.branch);
        const pending = before.cycle.nextAction;
        const resumeAction: ControllerRecoveryAction = recoveryResumeAction ?? { schema: 'controller-recovery/v1', kind: pending !== undefined ? 'resume-next-action' : 'resume-cycle' };
        if (this.ensureController(resumeAction) === 'custody') return 'custody';
        const r0 = readJournal(this.repoRoot, this.branch);
        if (r0.corrupt || r0.state === null) throw new Error('journal corrupto: el supervisor no opera sobre corrupcion (R1.6)');
        const gen = activeGeneration(r0.state);
        let eventScope: EventScope | undefined;
        if ((this.cfg.provider === 'codex' || this.cfg.provider === 'claude-code') && this.cfg.routingIdentity) {
            const asserted = validateRuntimeKey({ target: this.cfg.provider, ...this.cfg.routingIdentity });
            const event = readStoredEventReceipt(asserted);
            if (event.state === 'present') {
                const local = await queryLocalEventScope(this.repoRoot, asserted.target, asserted.kind);
                if (local.state === 'current' && JSON.stringify(local.scope.runtime) === JSON.stringify(asserted)) eventScope = local.scope;
            }
        }
        consumePendingRequests(this.repoRoot, this.branch, gen?.token ?? null, eventScope);
        const alertRead = readJournal(this.repoRoot, this.branch);
        if (alertRead.corrupt || !alertRead.state) throw new Error('routing alert cannot read durable journal');
        const pendingAlerts = alertRead.state.routingIncidents?.filter(item => item.alertState === 'pending') ?? [];
        if (pendingAlerts.length > 0) {
            for (const incident of pendingAlerts) {
                const alert = { id: incident.id, reasonCode: incident.reasonCode, selection: incident.selection,
                    fallbackCount: incident.fallbackCount, remedy: `awm model-policy setup --provider ${incident.target} --json` };
                process.stderr.write(`AWM routing alert ${JSON.stringify(alert)}\n`);
                appendEvent(this.repoRoot, this.branch, { kind: 'routing-incident', ...alert });
                incident.alertState = 'reported';
            }
            writeJournal(this.repoRoot, this.branch, alertRead.state);
        }
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
        // R7/C3 (Task 12): mientras la cohorte corre el job canónico de
        // integración final o espera el interlock, NADIE debe relanzar el
        // controller — `runRequestFinalIntegration`/`runRunFinalInterlock`
        // (watch/tracks.ts) ya pausaron esa generación explícitamente
        // (R7.3/C3) precisamente para que el árbol quede quieto durante esa
        // ventana; sin este guard, esta misma rama la revivía en el mismo
        // tick (o el siguiente) apenas la generación quedaba `terminated`,
        // exactamente la mutación concurrente que la pausa buscaba evitar.
        const finalizing = afterRequests.state?.cohortPhase === 'FINAL_INTEGRATION' || afterRequests.state?.cohortPhase === 'FINAL_INTERLOCK';
        if (!finalizing && afterRequests.state !== null && activeGeneration(afterRequests.state) === undefined
            && afterRequests.state.generations.length > 0 && afterRequests.state.cycle.status === 'IN_PROGRESS') {
            // The current tick used its launched generation's admission. A
            // replacement must wait until the next tick's full admission.
            if (generationAdmitted) return 'continue';
            beginGeneration(this.repoRoot, this.branch);
            if (this.ensureController(resumeAction) === 'custody') return 'custody';
        }
        // R5.2/R6.3 (Task 10): recién leído tras `consumePendingRequests` —
        // si el request `track-freeze-request` llegó en ESTE tick, `apply.ts`
        // ya lo tradujo a `freezeRequested`. `dispatch:false` corta SOLO el
        // arranque de trabajo NUEVO; el drenaje de lo ya vivo sigue intacto
        // (paso 2 del freeze — "consume/reconcilia jobs existentes").
        const freezeCheck = readJournal(this.repoRoot, this.branch);
        const freezing = !freezeCheck.corrupt && freezeCheck.state !== null
            && freezeCheck.state.freezeRequested === true && freezeCheck.state.frozen === undefined;
        // Reconcile controller ownership and, if needed, freshly admit its
        // replacement before runnerTick can launch received jobs.
        const supervision = await this.superviseController();
        if (supervision === 'custody') return 'custody';
        runnerTick(this.repoRoot, this.branch, this.spawner, {
            reconcileGraceMs: this.cfg.reconcileGraceMs, stallObservationMs: this.cfg.jobStallObservationMs,
            dispatch: !freezing && supervision === 'ok',
        });
        if (freezing) return this.attemptFreeze();
        const r = readJournal(this.repoRoot, this.branch);
        const gate = computeGate(r.state, r.corrupt, this.fingerprintNow, r.absent);
        const liveJobs = r.state === null ? 1 : Object.values(r.state.jobs).filter((j) => LIVE.includes(j.executionState)).length;
        // R7/C3/C4 (Task 12): un journal de PLAN con cohorte de tracks NUNCA
        // declara `cycle.status = COMPLETE` por este camino genérico mientras
        // la cohorte no llegó ELLA MISMA a `cohortPhase === 'COMPLETE'` — sin
        // este guard, `computeGate` certifica en cuanto el job canónico de
        // integración se REQUIERE (apply.ts enlaza `satisfiedBy` al crear el
        // job, antes de que termine) y pasa, ganándole la carrera al propio
        // `run-final-interlock` (watch/tracks.ts): el ciclo se declararía
        // COMPLETE mientras `cohortPhase` sigue en FINAL_INTEGRATION/
        // FINAL_INTERLOCK, los tracks nunca llegan a JOINED y
        // `integration.lock` queda retenido para siempre (este mismo check,
        // arriba en `tick()`, corta el loop apenas ve `cycle.status ===
        // COMPLETE` y jamás vuelve a llamar `reconcileTracks`).
        //
        // Fix post-review: la primera versión de este guard usaba
        // `(tracks?.length ?? 0) >= 2` como único criterio de "gobernada" —
        // pero el array `tracks` NUNCA se vacía ni se acorta cuando la
        // cohorte cae a fallback SERIAL (Task 9: los tracks quedan
        // `REMOVED`/`DECLARED` en el array, ver `track-bootstrap-crash.test.ts`),
        // y `protocol.ts` no tiene (ni debe inventarse acá — single-authority)
        // ningún camino de SERIAL de vuelta a COMPLETE. Con el criterio viejo,
        // CUALQUIER plan cuya cohorte degradara a SERIAL quedaba
        // PERMANENTEMENTE incapaz de completar su ciclo por este único lugar
        // del código que fija `cycle.status = 'COMPLETE'`. El criterio
        // correcto no es "¿existe un array de tracks?" sino "¿está la
        // cohorte, AHORA MISMO, en una fase viva del ciclo de vida paralelo
        // que todavía podría adelantarse a su propio interlock?"
        // (`LIVE_COHORT_PHASES`, arriba). Una cohorte en SERIAL, BLOCKED,
        // PREPARING o FALLBACK_PENDING — o un journal sin cohorte real — sigue
        // el camino de siempre, sin cambios, igual que si nunca hubiera
        // tenido tracks.
        const cohortGoverned = r.state !== null && (r.state.tracks?.length ?? 0) >= 2
            && r.state.cohortPhase !== undefined && LIVE_COHORT_PHASES.has(r.state.cohortPhase);
        const cohortDone = !cohortGoverned || r.state!.cohortPhase === 'COMPLETE';
        if (gate.pass && liveJobs === 0 && cohortDone) {   // gate verde YA implica cero vivos; doble cinturon (R4.5)
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

    /** Deferred ownership drains existing jobs but never starts new work. */
    private async superviseController(): Promise<'ok' | 'deferred' | 'custody'> {
        const r = readJournal(this.repoRoot, this.branch);
        if (r.corrupt || r.state === null) throw new Error('journal corrupto (R1.6)');
        const s = r.state;
        const gen = activeGeneration(s);
        // Track worktrees may be driven by the plan controller without a
        // local generation. The canonical final-integration job also runs
        // after the plan controller is deliberately paused. An existing but
        // unadopted launch is different: claim recovery/backoff must never
        // dispatch received jobs under that generation.
        if (gen === undefined) return s.trackContext || s.cohortPhase === 'FINAL_INTEGRATION'
            || s.cohortPhase === 'FINAL_INTERLOCK' ? 'ok' : 'deferred';
        if (gen.processRef === undefined) return 'deferred';
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
        const safeToReplace = adapter.safeToReplace(gen.processRef);
        // A dead process with proven identity is not healthy merely because
        // its last heartbeat was recent. Resolve it before any new job starts.
        const decision = snap === null && safeToReplace === 'safe' ? 'resolve-generation' : decideStall(
            { heartbeatAgeMs, activityFrozenMs, safeToReplace },
            { heartbeatTimeoutMs: this.cfg.heartbeatTimeoutMs, activityWindowMs: this.cfg.activityWindowMs },
        );
        if (decision === 'healthy') { this.backoff.reset(); return 'ok'; }
        if (decision === 'suspected-stall-observe') {
            if (gen.state !== 'controller-suspected-stall') {
                gen.state = 'controller-suspected-stall';        // SOLO observacion (R4.2)
                writeJournal(this.repoRoot, this.branch, s);
                appendEvent(this.repoRoot, this.branch, { kind: 'controller-suspected-stall', n: gen.n });
            }
            return 'ok';
        }
        if (decision === 'custody-blocked') {
            enterCustody(this.repoRoot, this.branch, 'doble senial de stall sin safeToReplace positivo del adapter (R4.2b)');
            return 'custody';
        }
        // resolve-generation
        const resolved = await resolveGeneration(this.repoRoot, this.branch, adapter, { termGraceMs: this.cfg.termGraceMs, killGraceMs: this.cfg.killGraceMs });
        if (resolved === 'custody-blocked') return 'custody';
        if (this.backoff.exhausted()) {
            enterCustody(this.repoRoot, this.branch, 'tope de relanzamientos por hora alcanzado (R4.3)');
            return 'custody';
        }
        if (Date.now() < this.relaunchNotBefore) return 'deferred';   // esperando backoff, auditando
        // This is a different controller generation, even though the tick
        // began under the old one's admission. Do not reuse that admission
        // after RED edits, runtime drift, or a currentness change.
        let replacementAdmission: AdmissionReport;
        try { replacementAdmission = await this.dispatchAdmission(); }
        catch (error) {
            enterCustody(this.repoRoot, this.branch, `admisión de reemplazo no verificable: ${(error as Error).message}`);
            return 'custody';
        }
        if (replacementAdmission.state !== 'admitted' || replacementAdmission.executionMode !== 'desatendido'
            || replacementAdmission.currentness !== 'current' || replacementAdmission.sensors !== 'pass'
            || replacementAdmission.journal !== 'current') {
            enterCustody(this.repoRoot, this.branch, `admisión de reemplazo bloqueada antes de dispatch: ${replacementAdmission.diagnostics.map(d => `${d.code}: ${d.message}`).join('; ')}`);
            return 'custody';
        }
        beginGeneration(this.repoRoot, this.branch);
        const nextAction = readJournal(this.repoRoot, this.branch).state!.cycle.nextAction;
        const action: ControllerRecoveryAction = { schema: 'controller-recovery/v1', kind: nextAction !== undefined ? 'resume-next-action' : 'resume-cycle' };
        const launched = this.ensureController(action);
        if (launched === 'custody') return 'custody';
        if (launched === 'ok') {
            this.backoff.recordRelaunch();
            this.relaunchNotBefore = Date.now() + this.backoff.nextMs();
        }
        return launched === 'deferred' ? 'deferred' : 'ok';
    }
}

/** Foreground, visible, terminable (R2.4): sin daemons. SIGINT/SIGTERM libera
 *  el lock y sale; COMPLETE => auto-exit liberando lock y terminando la
 *  generacion propia (cero huerfanos). */
export type SupervisorLoopOutcome = 'complete' | 'frozen' | 'stopped';

export async function runSupervisorLoop(
    repoRoot: string, branch: string, cfg: SupervisorConfig,
    spawner: WrapperSpawner = defaultWrapperSpawner(), trackRuntime?: TrackRuntime,
    dispatchAdmission?: DispatchAdmission,
): Promise<SupervisorLoopOutcome> {
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) {
        throw new Error(r.absent && !r.corrupt
            ? 'journal ausente: corre `awm watch --init --plan <plan>` primero'
            : 'journal corrupto o ilegible: inspecciona .awm/journal antes de continuar');
    }
    if (r.state.schema !== 2 || !r.state.planBinding) {
        throw new Error('journal legacy o sin binding compacto: `awm watch` no puede ejecutar ni despachar trabajo');
    }
    verifyBranchInvariant(repoRoot, r.state.branch);
    if (r.state.cycle.status === 'COMPLETE') return 'complete';
    const handle = acquireLock(repoRoot);
    let shutdownRequested = false;
    let wakeSleep: (() => void) | null = null;
    let safeToRelease = false;
    let terminal: SupervisorLoopOutcome = 'stopped';
    const onSignal = () => { shutdownRequested = true; wakeSleep?.(); };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const sup = new Supervisor(repoRoot, branch, cfg, spawner, trackRuntime, dispatchAdmission, true);
    try {
        for (;;) {
            if (shutdownRequested) break;
            const out = await sup.tick();
            // 'frozen' (Task 10): mismo camino de salida que 'complete' —
            // drenar ownership y liberar el lock, el track ya cumplió su
            // freeze y no debe seguir despachando ni corriendo su loop.
            if (out === 'complete' || out === 'frozen') {
                terminal = out;
                const finalState = readJournal(repoRoot, branch);
                if (!finalState.corrupt && finalState.state?.routingIncidents?.length) process.stderr.write(`AWM final routing summary ${JSON.stringify(routingReport(finalState.state))}\n`);
                break;
            }
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
        return terminal;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        if (safeToRelease) releaseLock(repoRoot, handle);
    }
}
