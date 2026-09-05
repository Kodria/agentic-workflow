// Única fuente de tipos del journal. CONSTITUTION: estados separados, nunca
// sobrecargados; shape validation antes de usar campos deserializados.

import crypto from 'crypto';
import { TRACK_PHASES, JOIN_STRATEGY_NO_FF } from '../tracks/types';
import type { CohortPhase, TrackPhase, JoinStrategy } from '../tracks/types';

export const EXECUTION_STATES = [
    'received', 'spawn-intent', 'claimed', 'running',
    'exited', 'cancel-requested', 'cancelled', 'orphaned',
] as const;
export type ExecutionState = typeof EXECUTION_STATES[number];

export type ObservationState = 'progressing' | 'suspected-stall';
export type JobVerdict = 'pass' | 'fail' | 'inconclusive';
export type CycleStatus = 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED';

export const GENERATION_STATES = [
    'active', 'controller-suspected-stall', 'terminated', 'superseded',
] as const;
export type GenerationState = typeof GENERATION_STATES[number];

/** Identidad COMPLETA (R2.1): pid + startTime + nonce + digest del argv que
 *  NOSOTROS pasamos + process group + digest de `ps -o args=` capturado en el
 *  spawn. Toda validación de vida/señal compara la tupla entera. */
export interface ProcessRef {
    pid: number;
    startTime: string;      // de ps -o lstart — nunca PID solo
    spawnNonce: string;
    argvDigest: string;     // sha del argv estructurado que spawneamos
    processGroup: number;
    psArgsDigest: string;   // sha de `ps -o args=` observado tras el spawn
}

/** Debe permanecer sincronizado con el union type `CohortPhase` de
 *  `../tracks/types` — ese módulo no exporta un const array propio (a
 *  diferencia de TRACK_PHASES), así que replicamos la lista SOLO para shape
 *  validation en el journal (nunca para lógica de protocolo, que vive en
 *  tracks/protocol.ts). */
const COHORT_PHASES = [
    'PREPARING', 'ACTIVE', 'JOINING', 'FINAL_QA',
    'FINAL_INTEGRATION', 'FINAL_INTERLOCK', 'COMPLETE',
    'FALLBACK_PENDING', 'SERIAL', 'BLOCKED',
] as const;

/** Chequeo EN TIEMPO DE COMPILACION, no runtime: si `CohortPhase` gana un
 *  miembro que `COHORT_PHASES` no cubre, `ActualArray[number]` deja de
 *  cubrir `Expected` y `Exclude<Expected, ActualArray[number]>` deja de ser
 *  `never` — tsc falla aca con el miembro faltante en el mensaje, en vez de
 *  dejar un gap silencioso en isWellFormedState. La direccion inversa (un
 *  string en COHORT_PHASES que NO es un CohortPhase valido) ya la cubre el
 *  constraint `ActualArray extends readonly Expected[]` del propio generic:
 *  `typeof COHORT_PHASES` no calzaria y tsc fallaria en el uso de abajo. */
type AssertCovers<Expected extends string, ActualArray extends readonly Expected[]> =
    [Exclude<Expected, ActualArray[number]>] extends [never] ? true : ['missing from COHORT_PHASES', Exclude<Expected, ActualArray[number]>];
const _cohortPhasesComplete: AssertCovers<CohortPhase, typeof COHORT_PHASES> = true;

/** Identidad y proveniencia de un journal de track (R9.1/R9.2): a qué plan
 *  pertenece, qué tasks ejecuta y sobre qué base/plan-digest se declaró. */
export interface TrackContext {
    trackId: string;
    taskIds: string[];
    planDigest: string;
    baseSha: string;
    planJournalId: string;
}

/** Referencia del supervisor de plan a un track (R9.2/R9.7): identidad
 *  completa del worktree/branch, fencing token y readiness nonce — nunca
 *  parciales, igual que ProcessRef exige la tupla completa (R2.1). */
export interface TrackRef {
    trackId: string;
    worktreePath: string;
    branch: string;
    ownership: string[];
    sharedResources: string[];
    dependsOn: string[];
    fencingToken: string;
    phase: TrackPhase;
    readinessNonce: string;
    readinessAt?: string;
    frozenHeadSha?: string;
    supervisorIntent?: { nonce: string; argv: string[]; claimPath: string };
    supervisorProcessRef?: ProcessRef;
    joinIntent?: {
        expectedPlanHeadSha: string;
        expectedTrackHeadSha: string;
        strategy: JoinStrategy;
    };
    teardownIntent?: {
        worktreePath: string;
        branch: string;
        supervisorNonce?: string;
    };
    joinedCommitSha?: string;
    blockedReason?: string;
    /** El controller pidió integrar este track (`awm track join`). Puramente declarativo,
     *  igual que `freezeRequested` en el journal de un track: quien decide si eso mueve la
     *  fase es el reducer puro (`reconcileProtocol`, observación `join-requested`), nunca el
     *  consumo transaccional de la request. Persistido para que el pedido sobreviva a un
     *  crash entre "request consumida" y "fase avanzada". */
    joinRequested?: boolean;
    /** El controller pidió desmontar este track (`awm track remove`). El consumo de la
     *  request solo persiste esta intención; la reconciliación decide sus efectos. */
    teardownRequested?: boolean;
}

export interface NextAction {
    actionId: string;
    type: string;           // ej. 'implement-task' | 'dispatch-review' | 'run-qa'
    target: string;
    preconditions: string[];
    attempt: number;
    state: 'pending' | 'in-progress';
}

export type VerificationKind = 'test' | 'lint' | 'sensors' | 'review' | 'qa' | 'interlock' | 'track-integration';
const VERIFICATION_KINDS: readonly VerificationKind[] = ['test', 'lint', 'sensors', 'review', 'qa', 'interlock', 'track-integration'];
export interface VerificationItem {
    id: string;
    kind: VerificationKind;
    // Satisfecho SOLO por pass con fingerprint vigente (R1.4c): job-id para
    // kinds mecánicos; verdict-id para kind 'review'.
    satisfiedBy?: string;
}

export interface ReviewObligation { id: string; taskId: string; kind: 'spec' | 'quality'; verdictId?: string; }
export interface Verdict {
    id: string;
    obligationId: string;
    result: JobVerdict;
    detail: string;
    receivedAt: string;
    fingerprint: string;
    argv: string[];
    paths: string[];
    cwd: string;
}
export interface FixObligation { id: string; verdictId: string; closed: boolean; }
export interface RequestProblem { file: string; kind: 'corrupt' | 'rejected'; detail: string; at: string; }
export interface CustodyDecision { at: string; decision: 'resume'; reason: string; generationToken: string; }

export interface TaskEntity {
    id: string;
    title: string;
    status: 'pending' | 'in-progress' | 'done';
    attempts: number;
    verificationPlan: VerificationItem[];
    reviewObligations: ReviewObligation[];
    createdAt?: string;     // para wall time por task (RNF-T.4); ausente => 'unobservable'
    completedAt?: string;
}

export interface DispatchRecord { id: string; taskId: string; at: string; }

export interface JobResult { exitCode: number; endedAt: string; resultPath: string; }
export interface Job {
    id: string;
    fingerprint: string;
    commandDigest: string;
    argv: string[];         // ya redactado por el emisor (R2.3)
    cwd: string;            // cwd relativo REAL declarado en la request (R3.4)
    paths: string[];        // globs DECLARADOS (para recomputar vigencia, R3.4/RF-2.8)
    expandedPaths: string[];// expansión persistida al momento del fingerprint
    executionState: ExecutionState;
    observationState: ObservationState;
    verdict?: JobVerdict;
    spawnNonce?: string;    // persistido en spawn-intent ANTES del spawn (R1.8);
                            // tambien puede respaldarse post-hoc en reconcile.ts
                            // al adoptar un resultado via processRef.spawnNonce,
                            // para que export.ts pueda ubicar la evidencia
    processRef?: ProcessRef;   // identidad REAL del comando (del identity sidecar)
    wrapperRef?: ProcessRef;   // identidad REAL del wrapper externo
    phaseTimestamps: Partial<Record<ExecutionState, string>>;  // RNF-T.4
    lastProgressAt?: string;   // ultima vez que el log del job crecio/mtime avanzo (R3.5, observacional)
    logPath?: string;
    result?: JobResult;
    satisfies?: string[];   // ids de VerificationItem que este job pretende satisfacer (R7 Task 12: migra
                            // aditivamente de string a array — un job puede satisfacer VARIOS items del
                            // ciclo a la vez, ej. el job canónico de integración final satisface todos
                            // los `track-integration:*` simultáneamente; store.ts normaliza legacy)
    attemptOf?: string;     // job-id del attempt anterior (re-claim = attempt nuevo, R1.7)
}

export interface Generation {
    n: number;
    token: string;
    state: GenerationState;
    controllerJobId?: string; // intent durable del wrapper que lanza al controller
    spawnNonce?: string;
    provider?: string;
    resumePrompt?: string;
    processRef?: ProcessRef;
    wrapperRef?: ProcessRef;
    launchedAt: string;
}

export type RequestOutcome = 'applied' | 'rejected-stale-generation' | 'rejected-digest-mismatch' | 'rejected-secret';
export interface AppliedRequest {
    requestId: string;
    idempotencyKey: string;
    payloadDigest: string;
    outcome: RequestOutcome;
    resultRef?: string;     // ej. job-id creado — permite regenerar el ack (R1.3)
}

export interface JournalState {
    schema: 1;
    revision: number;
    journalId: string;         // identidad estable del journal (R9.1); legacy la recibe determinista (R9.3)
    branch: string;
    cycle: { status: CycleStatus; startedAt: string; completedAt?: string; nextAction?: NextAction; blockedReason?: string };
    cycleVerificationPlan: VerificationItem[];   // QA + interlock a nivel ciclo (R1.4b)
    requiredVerifiers: VerificationKind[];       // detectados mecánicamente en watch --init (R1.4b)
    generations: Generation[];
    tasks: TaskEntity[];
    dispatches: DispatchRecord[];                // despachos REALES (RNF-T.8)
    jobs: Record<string, Job>;
    verdicts: Verdict[];
    fixes: FixObligation[];
    appliedRequests: Record<string, AppliedRequest>;  // por requestId (los alias duplican entrada)
    requestProblems: RequestProblem[];                // corrupcion/rechazos de contenido bloquean el gate
    custodyDecisions?: CustodyDecision[];             // compatible con journals previos; decisiones humanas auditadas
    controllerHeartbeatAt?: string;
    tracks?: TrackRef[];                              // solo presente en el journal del PLAN que orquesta tracks (R9.2)
    trackContext?: TrackContext;                      // solo presente en el journal de un TRACK individual (R9.1)
    cohortPhase?: CohortPhase;
    cohortBaseSha?: string;
    // R6.2/R6.3/C7 (Task 11): HEAD REAL y AVANZANTE de la rama del plan a
    // medida que cada join serial se acepta — DISTINTO de `cohortBaseSha`
    // (que es el commit ESTÁTICO del que todos los tracks forkearon, usado
    // solo para diffs de ownership post-hoc, ver `runFreezeTrack` en
    // `watch/tracks.ts`). Antes del primer merge exitoso, coincide con
    // `cohortBaseSha` (`toProtocol` cae a ese valor si este campo todavía es
    // `undefined`); tras cada `accept-merge`, pasa a ser el SHA del commit de
    // merge recién creado — el siguiente `persist-join-intent` de la cohorte
    // usa ESTE valor como su `expectedPlanHeadSha`, nunca el base original.
    cohortPlanHeadSha?: string;
    // Espejo persistente de `CohortProtocol.fallbackReason` — mismo criterio que
    // `cohortPlanHeadSha`/`globalQaHeadSha`/`finalIntegrationJobId`: `reconcileProtocol` lo
    // fija en el protocolo, pero `reconcileTracks` reconstruye el protocolo con `toProtocol`
    // en CADA vuelta de su loop, así que un campo sin espejo acá se pierde antes de la
    // siguiente iteración. Sin esto, el `prepare-failed:<trackId>` que `reconcileProtocol`
    // calcula era inalcanzable por construcción y `enter-serial` siempre caía al genérico
    // `'prepare-failed'` — la causa quedaba solo en el evento `track-effect-failed`,
    // obligando a correlacionar hacia atrás en vez de leerla en la degradación misma.
    cohortFallbackReason?: string;
    trackIntegration?: { argv: string[]; paths: string[]; planDigest: string };
    // R7/C3/C4 (Task 12): espejo persistente de `CohortProtocol.globalQaHeadSha`/
    // `finalIntegrationJobId` (`core/tracks/types.ts`, ya definidos desde Task 1) —
    // `watch/tracks.ts::toProtocol`/`applyProtocolToState` los traduce en ambos
    // sentidos. Sin esto, un restart perdería la evidencia de que el QA global o
    // la integración final ya pasaron y repetiría el efecto (`request-global-qa`/
    // `request-final-integration`) desde cero en vez de avanzar la cohorte.
    globalQaHeadSha?: string;
    finalIntegrationJobId?: string;
    // R7.2/C3 (Task 12): autoreporte del controller del PLAN ("ya corrí QA,
    // corregí hallazgos y comiteé en este HEAD") vía `track-finalize-request`
    // — PLAN-scoped (a diferencia de `frozen`, que es de un track individual).
    // Nunca se confía ciegamente: el driver de `request-global-qa` re-verifica
    // independientemente HEAD real + árbol limpio antes de aceptarlo (mismo
    // criterio fail-closed que el freeze de Task 10 aplica al autoreporte de
    // un track).
    qaFinalizeRequested?: { headSha: string; at: string };
    // R5.2/R6.3/R6.4 (Task 10): SOLO presentes en el journal de UN TRACK
    // individual — el supervisor del PLAN jamás los escribe directamente
    // (emite `track-freeze-request` al journal del track vía el mismo canal
    // durable de requests; el propio supervisor del track hace las 6
    // observaciones reales y las persiste acá, en SU journal). `freezeRequested`
    // marca que el track debe dejar de despachar trabajo nuevo; `frozen` solo
    // se persiste una vez que gate local + worktree limpio + cero jobs vivos +
    // generación propia terminada (confirmada) son TODOS demostrables.
    freezeRequested?: boolean;
    frozen?: { headSha: string; at: string };
    // R5.7/C5 (Task 10): SOLO presente en el journal del PLAN — evidencia
    // post-hoc de que un track ya congelado tocó una clase de recurso global
    // fuera de su ownership declarado. Un `awm watch` posterior sobre este
    // plan debe leer esto y correr serial, aunque el análisis declarativo de
    // independencia (T4) haya dicho que podía paralelizar.
    cohortParallelInvalidatedBy?: string[];
}

export function emptyState(branch: string): JournalState {
    return {
        schema: 1, revision: 0, journalId: `j-${crypto.randomUUID()}`, branch,
        cycle: {
            status: 'IN_PROGRESS', startedAt: new Date().toISOString(),
            nextAction: { actionId: 'bootstrap-cycle', type: 'plan-cycle', target: 'cycle', preconditions: [], attempt: 0, state: 'pending' },
        },
        cycleVerificationPlan: [], requiredVerifiers: [], generations: [], tasks: [],
        dispatches: [], jobs: {}, verdicts: [], fixes: [], appliedRequests: {}, requestProblems: [], custodyDecisions: [],
    };
}

function isObj(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isWellFormedState(x: unknown): x is JournalState {
    if (!isObj(x)) return false;
    if (x.schema !== 1) return false;
    if (typeof x.revision !== 'number') return false;
    if (typeof x.journalId !== 'string' || x.journalId.length === 0) return false;
    if (typeof x.branch !== 'string') return false;
    if (!isObj(x.cycle) || !['IN_PROGRESS', 'COMPLETE', 'BLOCKED'].includes(String(x.cycle.status))
        || typeof x.cycle.startedAt !== 'string'
        || (x.cycle.completedAt !== undefined && typeof x.cycle.completedAt !== 'string')
        || (x.cycle.blockedReason !== undefined && typeof x.cycle.blockedReason !== 'string')
        || (x.cycle.nextAction !== undefined && !isWellFormedNextAction(x.cycle.nextAction))
        || (x.cycle.status === 'IN_PROGRESS' && x.cycle.nextAction === undefined)) return false;
    if (!Array.isArray(x.generations) || !Array.isArray(x.tasks)) return false;
    if (!Array.isArray(x.cycleVerificationPlan) || !Array.isArray(x.verdicts) || !Array.isArray(x.fixes)) return false;
    if (!Array.isArray(x.requiredVerifiers) || !x.requiredVerifiers.every((kind) => VERIFICATION_KINDS.includes(kind as VerificationKind))
        || !Array.isArray(x.dispatches) || !x.dispatches.every(isWellFormedDispatch)) return false;
    if (!isObj(x.jobs) || !Object.values(x.jobs).every(isWellFormedJob)) return false;
    if (!isObj(x.appliedRequests) || !Object.values(x.appliedRequests).every(isWellFormedAppliedRequest)) return false;
    if (!Array.isArray(x.requestProblems) || !x.requestProblems.every(isWellFormedRequestProblem)) return false;
    if (x.custodyDecisions !== undefined && (!Array.isArray(x.custodyDecisions) || !x.custodyDecisions.every(isWellFormedCustodyDecision))) return false;
    if (!x.generations.every(isWellFormedGeneration) || !x.tasks.every(isWellFormedTask)) return false;
    if (!x.cycleVerificationPlan.every(isWellFormedVerificationItem)) return false;
    if (!x.verdicts.every(isWellFormedVerdict) || !x.fixes.every(isWellFormedFix)) return false;
    if (x.tracks !== undefined && (!Array.isArray(x.tracks) || !x.tracks.every(isWellFormedTrackRef))) return false;
    if (x.trackContext !== undefined && !isWellFormedTrackContext(x.trackContext)) return false;
    if (x.cohortPhase !== undefined && !(COHORT_PHASES as readonly string[]).includes(String(x.cohortPhase))) return false;
    if (x.cohortBaseSha !== undefined && typeof x.cohortBaseSha !== 'string') return false;
    if (x.cohortPlanHeadSha !== undefined && typeof x.cohortPlanHeadSha !== 'string') return false;
    if (x.cohortFallbackReason !== undefined && typeof x.cohortFallbackReason !== 'string') return false;
    if (x.trackIntegration !== undefined && !isWellFormedTrackIntegration(x.trackIntegration)) return false;
    if (x.freezeRequested !== undefined && typeof x.freezeRequested !== 'boolean') return false;
    if (x.frozen !== undefined && !(isObj(x.frozen) && typeof x.frozen.headSha === 'string' && typeof x.frozen.at === 'string')) return false;
    if (x.cohortParallelInvalidatedBy !== undefined && !strings(x.cohortParallelInvalidatedBy)) return false;
    if (x.globalQaHeadSha !== undefined && typeof x.globalQaHeadSha !== 'string') return false;
    if (x.finalIntegrationJobId !== undefined && typeof x.finalIntegrationJobId !== 'string') return false;
    if (x.qaFinalizeRequested !== undefined
        && !(isObj(x.qaFinalizeRequested) && typeof x.qaFinalizeRequested.headSha === 'string' && typeof x.qaFinalizeRequested.at === 'string')) return false;
    return true;
}

function isWellFormedNextAction(x: unknown): x is NextAction {
    return isObj(x) && typeof x.actionId === 'string' && typeof x.type === 'string' && typeof x.target === 'string'
        && strings(x.preconditions) && typeof x.attempt === 'number'
        && (x.state === 'pending' || x.state === 'in-progress');
}

function isWellFormedDispatch(x: unknown): x is DispatchRecord {
    return isObj(x) && typeof x.id === 'string' && typeof x.taskId === 'string' && typeof x.at === 'string';
}

function strings(x: unknown): x is string[] {
    return Array.isArray(x) && x.every((item) => typeof item === 'string');
}

function isWellFormedVerificationItem(x: unknown): x is VerificationItem {
    return isObj(x) && typeof x.id === 'string'
        && VERIFICATION_KINDS.includes(x.kind as VerificationKind)
        && (x.satisfiedBy === undefined || typeof x.satisfiedBy === 'string');
}

function isWellFormedReviewObligation(x: unknown): x is ReviewObligation {
    return isObj(x) && typeof x.id === 'string' && typeof x.taskId === 'string'
        && (x.kind === 'spec' || x.kind === 'quality')
        && (x.verdictId === undefined || typeof x.verdictId === 'string');
}

function isWellFormedTask(x: unknown): x is TaskEntity {
    return isObj(x) && typeof x.id === 'string' && typeof x.title === 'string'
        && ['pending', 'in-progress', 'done'].includes(String(x.status))
        && typeof x.attempts === 'number'
        && Array.isArray(x.verificationPlan) && x.verificationPlan.every(isWellFormedVerificationItem)
        && Array.isArray(x.reviewObligations) && x.reviewObligations.every(isWellFormedReviewObligation);
}

function isWellFormedGeneration(x: unknown): x is Generation {
    return isObj(x) && typeof x.n === 'number' && typeof x.token === 'string'
        && (GENERATION_STATES as readonly string[]).includes(String(x.state))
        && typeof x.launchedAt === 'string'
        && (x.controllerJobId === undefined || typeof x.controllerJobId === 'string')
        && (x.spawnNonce === undefined || typeof x.spawnNonce === 'string')
        && (x.provider === undefined || typeof x.provider === 'string')
        && (x.resumePrompt === undefined || typeof x.resumePrompt === 'string')
        && (x.processRef === undefined || isWellFormedProcessRef(x.processRef))
        && (x.wrapperRef === undefined || isWellFormedProcessRef(x.wrapperRef));
}

function isWellFormedVerdict(x: unknown): x is Verdict {
    return isObj(x) && typeof x.id === 'string' && typeof x.obligationId === 'string'
        && ['pass', 'fail', 'inconclusive'].includes(String(x.result))
        && typeof x.detail === 'string' && typeof x.receivedAt === 'string'
        && typeof x.fingerprint === 'string' && strings(x.argv) && strings(x.paths) && typeof x.cwd === 'string';
}

function isWellFormedFix(x: unknown): x is FixObligation {
    return isObj(x) && typeof x.id === 'string' && typeof x.verdictId === 'string' && typeof x.closed === 'boolean';
}

function isWellFormedAppliedRequest(x: unknown): x is AppliedRequest {
    return isObj(x) && typeof x.requestId === 'string' && typeof x.idempotencyKey === 'string'
        && typeof x.payloadDigest === 'string'
        && ['applied', 'rejected-stale-generation', 'rejected-digest-mismatch', 'rejected-secret'].includes(String(x.outcome))
        && (x.resultRef === undefined || typeof x.resultRef === 'string');
}

function isWellFormedRequestProblem(x: unknown): x is RequestProblem {
    return isObj(x) && typeof x.file === 'string' && (x.kind === 'corrupt' || x.kind === 'rejected')
        && typeof x.detail === 'string' && typeof x.at === 'string';
}

function isWellFormedCustodyDecision(x: unknown): x is CustodyDecision {
    return isObj(x) && typeof x.at === 'string' && x.decision === 'resume'
        && typeof x.reason === 'string' && typeof x.generationToken === 'string';
}

export function isWellFormedProcessRef(x: unknown): x is ProcessRef {
    if (!isObj(x)) return false;
    return typeof x.pid === 'number' && Number.isInteger(x.pid) && x.pid > 0
        && typeof x.startTime === 'string'
        && typeof x.spawnNonce === 'string'
        && typeof x.argvDigest === 'string'
        && typeof x.processGroup === 'number' && Number.isInteger(x.processGroup) && x.processGroup > 0
        && typeof x.psArgsDigest === 'string';
}

export function isWellFormedJob(x: unknown): x is Job {
    if (!isObj(x)) return false;
    return typeof x.id === 'string'
        && typeof x.fingerprint === 'string'
        && typeof x.commandDigest === 'string'
        && strings(x.argv)
        && typeof x.cwd === 'string'
        && strings(x.paths)
        && strings(x.expandedPaths)
        && (x.observationState === 'progressing' || x.observationState === 'suspected-stall')
        && isObj(x.phaseTimestamps) && Object.entries(x.phaseTimestamps).every(([state, at]) =>
            (EXECUTION_STATES as readonly string[]).includes(state) && typeof at === 'string')
        && (x.verdict === undefined || ['pass', 'fail', 'inconclusive'].includes(String(x.verdict)))
        && (x.spawnNonce === undefined || typeof x.spawnNonce === 'string')
        && (x.processRef === undefined || isWellFormedProcessRef(x.processRef))
        && (x.wrapperRef === undefined || isWellFormedProcessRef(x.wrapperRef))
        && (x.lastProgressAt === undefined || typeof x.lastProgressAt === 'string')
        && (x.logPath === undefined || typeof x.logPath === 'string')
        && (x.result === undefined || (isObj(x.result) && typeof x.result.exitCode === 'number'
            && typeof x.result.endedAt === 'string' && typeof x.result.resultPath === 'string'))
        && (x.satisfies === undefined || strings(x.satisfies))
        && (x.attemptOf === undefined || typeof x.attemptOf === 'string')
        && (EXECUTION_STATES as readonly string[]).includes(x.executionState as string);
}

function isWellFormedTrackContext(x: unknown): x is TrackContext {
    return isObj(x) && typeof x.trackId === 'string' && x.trackId.length > 0
        && strings(x.taskIds)
        && typeof x.planDigest === 'string'
        && typeof x.baseSha === 'string'
        && typeof x.planJournalId === 'string' && x.planJournalId.length > 0;
}

function isWellFormedSupervisorIntent(x: unknown): x is NonNullable<TrackRef['supervisorIntent']> {
    return isObj(x) && typeof x.nonce === 'string' && x.nonce.length > 0
        && strings(x.argv) && typeof x.claimPath === 'string';
}

function isWellFormedJoinIntent(x: unknown): x is NonNullable<TrackRef['joinIntent']> {
    return isObj(x) && typeof x.expectedPlanHeadSha === 'string' && typeof x.expectedTrackHeadSha === 'string'
        && x.strategy === JOIN_STRATEGY_NO_FF;
}

function isWellFormedTeardownIntent(x: unknown): x is NonNullable<TrackRef['teardownIntent']> {
    return isObj(x) && typeof x.worktreePath === 'string' && typeof x.branch === 'string'
        && (x.supervisorNonce === undefined || typeof x.supervisorNonce === 'string');
}

/** Shape completa (R9.2/R9.7): fencingToken y readinessNonce nunca vacios —
 *  igual criterio que ProcessRef, la identidad es todo-o-nada. */
function isWellFormedTrackRef(x: unknown): x is TrackRef {
    if (!isObj(x)) return false;
    return typeof x.trackId === 'string' && x.trackId.length > 0
        && typeof x.worktreePath === 'string' && x.worktreePath.length > 0
        && typeof x.branch === 'string' && x.branch.length > 0
        && strings(x.ownership) && strings(x.sharedResources) && strings(x.dependsOn)
        && typeof x.fencingToken === 'string' && x.fencingToken.length > 0
        && (TRACK_PHASES as readonly string[]).includes(x.phase as string)
        && typeof x.readinessNonce === 'string' && x.readinessNonce.length > 0
        && (x.readinessAt === undefined || typeof x.readinessAt === 'string')
        && (x.frozenHeadSha === undefined || typeof x.frozenHeadSha === 'string')
        && (x.supervisorIntent === undefined || isWellFormedSupervisorIntent(x.supervisorIntent))
        && (x.supervisorProcessRef === undefined || isWellFormedProcessRef(x.supervisorProcessRef))
        && (x.joinIntent === undefined || isWellFormedJoinIntent(x.joinIntent))
        && (x.teardownIntent === undefined || isWellFormedTeardownIntent(x.teardownIntent))
        && (x.teardownRequested === undefined || typeof x.teardownRequested === 'boolean')
        && (x.joinedCommitSha === undefined || typeof x.joinedCommitSha === 'string')
        && (x.blockedReason === undefined || typeof x.blockedReason === 'string');
}

function isWellFormedTrackIntegration(x: unknown): x is NonNullable<JournalState['trackIntegration']> {
    return isObj(x) && strings(x.argv) && strings(x.paths) && typeof x.planDigest === 'string';
}
