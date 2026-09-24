import path from 'path';
import { validatePlanFile } from '../../core/plan/validate';
import { validateRuntimeKey } from '../../core/model-policy/capabilities';
import { readStoredEventReceipt } from '../../core/model-policy/event-store';
import { queryLocalEventScope } from '../../core/model-policy/local-event-scope';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { activeRequestProblems, type AdmissionContext, type JournalState } from '../../core/journal/types';
import { groupIsGone, refIsAlive } from '../../core/journal/process';
import { isWatchProvider, isControllerAutonomy, type ControllerAutonomy } from '../../core/journal/adapter';
import { controllerGenerationHasUnresolvedClaim } from './generations';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';
import { admissionForConfig, recoveryWhitelistBlocker, DEFAULT_SUPERVISOR_CONFIG, type DispatchAdmission, type RoutingIdentity } from './supervisor';

export interface RecoverAdmissionInput {
    provider: string;
    routingIdentity: RoutingIdentity;
    controllerAutonomy: ControllerAutonomy;
    generationToken?: string;
    reason: string;
}

function contextFor(input: RecoverAdmissionInput): AdmissionContext {
    if (!isWatchProvider(input.provider)) throw new Error('provider de recovery invalido');
    if (!isControllerAutonomy(input.controllerAutonomy)) throw new Error('postura del controller invalida');
    if (!input.routingIdentity) throw new Error('runtime de recovery requerido');
    const runtime = validateRuntimeKey({ target: input.provider, ...input.routingIdentity });
    return { provider: input.provider, runtime: { kind: runtime.kind, version: runtime.version, accountScopeDigest: runtime.accountScopeDigest }, controllerAutonomy: input.controllerAutonomy };
}

function sameContext(a: AdmissionContext, b: AdmissionContext): boolean {
    return a.provider === b.provider && a.controllerAutonomy === b.controllerAutonomy
        && a.runtime?.kind === b.runtime?.kind && a.runtime?.version === b.runtime?.version
        && a.runtime?.accountScopeDigest === b.runtime?.accountScopeDigest;
}

function admissionCustodyCause(reason: string | undefined): 'currentness' | 'sensors' | undefined {
    if (!reason || (reason.match(/ADMISSION_[A-Z_]+/g) ?? []).length !== 1) return undefined;
    const old = reason.startsWith('admisión compacta desatendida bloqueada antes de dispatch: ');
    if ((old || reason.startsWith('admisión currentness no verificable tras 3 reintentos: '))
        && reason.includes('ADMISSION_CURRENTNESS_BLOCKED:')) return 'currentness';
    if ((old || reason.startsWith('admisión sensors no verificable tras 3 reintentos: '))
        && reason.includes('ADMISSION_SENSORS_BLOCKED:')) return 'sensors';
    return undefined;
}

function assertNoAmbiguousWork(repoRoot: string, branch: string, state: JournalState): void {
    if (activeRequestProblems(state).length > 0) throw new Error('recovery bloqueado: request rechazada o corrupta activa');
    for (const generation of state.generations) {
        if (controllerGenerationHasUnresolvedClaim(repoRoot, branch, generation)) throw new Error('recovery bloqueado: claim de controller sin identidad demostrable');
        for (const ref of [generation.processRef, generation.wrapperRef]) {
            if (ref && (refIsAlive(ref) || !groupIsGone(ref.processGroup))) throw new Error('recovery bloqueado: controller vivo o ambiguo');
        }
    }
    for (const job of Object.values(state.jobs)) {
        if (!['exited', 'cancelled'].includes(job.executionState)) throw new Error(`recovery bloqueado: job ${job.id} activo o ambiguo`);
        for (const ref of [job.processRef, job.wrapperRef]) {
            if (ref && (refIsAlive(ref) || !groupIsGone(ref.processGroup))) throw new Error(`recovery bloqueado: job ${job.id} vivo o ambiguo`);
        }
    }
}

/** Explicit offline transition. The journal record is the authoritative audit;
 * the event is supplementary, so retry after a crash cannot duplicate the
 * state transition or silently discard the original custody reason. */
export async function recoverAdmissionCustody(
    repoRoot: string, branch: string, input: RecoverAdmissionInput,
    dispatchAdmission?: DispatchAdmission,
): Promise<'recovered' | 'already-recovered'> {
    if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot) || typeof branch !== 'string' || branch.length === 0
        || !input || typeof input !== 'object' || typeof input.reason !== 'string'
        || input.reason.trim().length === 0 || input.reason.length > 1024
        || (input.generationToken !== undefined && (typeof input.generationToken !== 'string' || input.generationToken.length === 0))) {
        throw new Error('parametros de recovery invalidos');
    }
    const context = contextFor(input);
    const lock = acquireLock(repoRoot);
    try {
        const read = readJournal(repoRoot, branch);
        if (read.corrupt || !read.state || read.state.schema !== 2 || !read.state.planBinding) throw new Error('recovery requiere journal schema-2 vigente');
        const state = read.state;
        verifyBranchInvariant(repoRoot, state.branch);
        const previous = state.admissionRecoveries?.at(-1);
        if (state.cycle.status === 'IN_PROGRESS' && previous
            && previous.reason === input.reason && previous.generationToken === input.generationToken
            && sameContext(previous.context, context)) return 'already-recovered';
        if (state.cycle.status !== 'BLOCKED' || !admissionCustodyCause(state.cycle.blockedReason)) {
            throw new Error('recovery solo admite custodia causada por admisión currentness o sensores');
        }
        const latest = state.generations.at(-1);
        if (latest?.token !== input.generationToken || (latest === undefined && input.generationToken !== undefined)) {
            throw new Error('generation de recovery no es la vigente');
        }
        if (latest?.provider && latest.provider !== context.provider) throw new Error('provider de generation no coincide con identidad de recovery');
        if (state.admissionContext && !sameContext(state.admissionContext, context)) throw new Error('identidad de runtime o postura no coincide con la admisión original');
        assertNoAmbiguousWork(repoRoot, branch, state);
        const prospective = structuredClone(state);
        prospective.cycle.status = 'IN_PROGRESS';
        prospective.cycle.blockedReason = undefined;
        const independentBlocker = recoveryWhitelistBlocker(prospective);
        if (independentBlocker) throw new Error(`recovery bloqueado por causa independiente: ${independentBlocker}`);
        const binding = state.planBinding;
        if (!binding) throw new Error('binding del plan ausente');
        const plan = validatePlanFile(binding.path, repoRoot);
        if (plan.state !== 'valid' || plan.planDigest !== binding.digest || plan.schema !== binding.schema
            || (binding.executionDigest !== undefined && plan.executionDigest !== binding.executionDigest)) {
            throw new Error('binding del plan alterado: recovery denegado');
        }
        // A v1 plan does not ask the admission engine to evaluate routing.
        // Recovery still promises a current native receipt for the asserted
        // provider/runtime, so check its machine seal and live local scope
        // explicitly; an operator assertion alone is not evidence.
        const runtime = validateRuntimeKey({ target: context.provider, ...context.runtime! });
        const stored = readStoredEventReceipt(runtime);
        if (stored.state !== 'present') throw new Error(`recibo nativo ausente o invalido para ${context.provider}: ejecuta awm model-policy setup --provider ${context.provider}`);
        const local = await queryLocalEventScope(repoRoot, context.provider, runtime.kind);
        if (local.state !== 'current' || local.scope.runtime.target !== runtime.target
            || local.scope.runtime.kind !== runtime.kind || local.scope.runtime.version !== runtime.version
            || local.scope.runtime.accountScopeDigest !== runtime.accountScopeDigest
            || stored.receipt.runtime.target !== runtime.target || stored.receipt.runtime.kind !== runtime.kind
            || stored.receipt.runtime.version !== runtime.version || stored.receipt.runtime.accountScopeDigest !== runtime.accountScopeDigest
            || stored.receipt.binaryDigest !== local.scope.binaryDigest || stored.receipt.configDigest !== local.scope.configDigest
            || Date.parse(stored.receipt.recordedAt) > Date.now()) {
            throw new Error(`recibo nativo no coincide con runtime/cuenta local de ${context.provider}`);
        }
        const cfg = { ...DEFAULT_SUPERVISOR_CONFIG, provider: context.provider,
            routingIdentity: context.runtime, controllerAutonomy: context.controllerAutonomy };
        const report = await (dispatchAdmission ?? admissionForConfig(repoRoot, branch, cfg))();
        if (report.state !== 'admitted' || report.planState !== 'valid' || report.executionMode !== 'desatendido'
            || report.journal !== 'current' || report.currentness !== 'current' || report.sensors !== 'pass'
            || (report.planDigest !== undefined && report.planDigest !== binding.digest)) {
            throw new Error(`admisión estricta todavía bloqueada: ${report.diagnostics.map(item => `${item.code}: ${item.message}`).join('; ')}`);
        }
        const candidate = structuredClone(state);
        candidate.admissionRecoveries ??= [];
        candidate.admissionRecoveries.push({ at: new Date().toISOString(), reason: input.reason,
            blockedReason: state.cycle.blockedReason!, generationToken: input.generationToken,
            context, planDigest: binding.digest,
            assertion: state.admissionContext ? 'recorded' : 'legacy-operator-asserted' });
        candidate.admissionContext = context;
        candidate.admissionRetry = undefined;
        candidate.cycle.status = 'IN_PROGRESS';
        candidate.cycle.blockedReason = undefined;
        // Existing generations and nextAction remain untouched. The next watch
        // tick performs strict admission again before reconciling either.
        writeJournal(repoRoot, branch, candidate);
        appendEvent(repoRoot, branch, { kind: 'admission-recovered', generationToken: input.generationToken,
            reason: input.reason, blockedReason: state.cycle.blockedReason, planDigest: binding.digest });
        return 'recovered';
    } finally { releaseLock(repoRoot, lock); }
}
