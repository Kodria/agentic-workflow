// Única fuente de tipos del journal. CONSTITUTION: estados separados, nunca
// sobrecargados; shape validation antes de usar campos deserializados.

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

export interface NextAction {
    actionId: string;
    type: string;           // ej. 'implement-task' | 'dispatch-review' | 'run-qa'
    target: string;
    preconditions: string[];
    attempt: number;
    state: 'pending' | 'in-progress';
}

export type VerificationKind = 'test' | 'lint' | 'sensors' | 'review' | 'qa' | 'interlock';
export interface VerificationItem {
    id: string;
    kind: VerificationKind;
    // Satisfecho SOLO por pass con fingerprint vigente (R1.4c): job-id para
    // kinds mecánicos; verdict-id para kind 'review'.
    satisfiedBy?: string;
}

export interface ReviewObligation { id: string; taskId: string; kind: 'spec' | 'quality'; verdictId?: string; }
export interface Verdict { id: string; obligationId: string; result: JobVerdict; detail: string; receivedAt: string; }
export interface FixObligation { id: string; verdictId: string; closed: boolean; }

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
    spawnNonce?: string;    // persistido en spawn-intent ANTES del spawn (R1.8)
    processRef?: ProcessRef;   // identidad REAL del comando (del identity sidecar)
    wrapperRef?: ProcessRef;   // identidad REAL del wrapper externo
    phaseTimestamps: Partial<Record<ExecutionState, string>>;  // RNF-T.4
    lastProgressAt?: string;
    logPath?: string;
    result?: JobResult;
    satisfies?: string;     // id de VerificationItem que este job pretende satisfacer
    attemptOf?: string;     // job-id del attempt anterior (re-claim = attempt nuevo, R1.7)
}

export interface Generation {
    n: number;
    token: string;
    state: GenerationState;
    processRef?: ProcessRef;
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
    controllerHeartbeatAt?: string;
}

export function emptyState(branch: string): JournalState {
    return {
        schema: 1, revision: 0, branch,
        cycle: { status: 'IN_PROGRESS', startedAt: new Date().toISOString() },
        cycleVerificationPlan: [], requiredVerifiers: [], generations: [], tasks: [],
        dispatches: [], jobs: {}, verdicts: [], fixes: [], appliedRequests: {},
    };
}

function isObj(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isWellFormedState(x: unknown): x is JournalState {
    if (!isObj(x)) return false;
    if (x.schema !== 1) return false;
    if (typeof x.revision !== 'number') return false;
    if (typeof x.branch !== 'string') return false;
    if (!isObj(x.cycle) || typeof (x.cycle as Record<string, unknown>).status !== 'string') return false;
    if (!Array.isArray(x.generations) || !Array.isArray(x.tasks)) return false;
    if (!Array.isArray(x.cycleVerificationPlan) || !Array.isArray(x.verdicts) || !Array.isArray(x.fixes)) return false;
    if (!Array.isArray(x.requiredVerifiers) || !Array.isArray(x.dispatches)) return false;
    if (!isObj(x.jobs) || !isObj(x.appliedRequests)) return false;
    return true;
}

export function isWellFormedProcessRef(x: unknown): x is ProcessRef {
    if (!isObj(x)) return false;
    return typeof x.pid === 'number'
        && typeof x.startTime === 'string'
        && typeof x.spawnNonce === 'string'
        && typeof x.argvDigest === 'string'
        && typeof x.processGroup === 'number'
        && typeof x.psArgsDigest === 'string';
}

export function isWellFormedJob(x: unknown): x is Job {
    if (!isObj(x)) return false;
    return typeof x.id === 'string'
        && typeof x.fingerprint === 'string'
        && typeof x.commandDigest === 'string'
        && Array.isArray(x.argv)
        && typeof x.cwd === 'string'
        && (EXECUTION_STATES as readonly string[]).includes(x.executionState as string);
}
