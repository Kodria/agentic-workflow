import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { activeRequestProblems, isWellFormedState, type JournalState, type RoutingSelection } from '../../core/journal/types';
import { readJournal, writeJournal, appendEvent } from '../../core/journal/store';
import { logsDir, requestsDir } from '../../core/journal/paths';
import { claimPath, identityPath, resultPath } from '../job/exec-wrapper';
import { groupIsGone, refIsAlive } from '../../core/journal/process';
import { controllerGenerationHasUnresolvedClaim } from './generations';
import { acquireLock, releaseLock, verifyBranchInvariant } from './lock';
import { validatePlanFile } from '../../core/plan/validate';
import { readEffectivePolicy } from '../../core/model-policy/store';
import { readStoredEventReceipt } from '../../core/model-policy/event-store';
import { queryLocalEventScope } from '../../core/model-policy/local-event-scope';
import { resolveEventSelection } from '../../core/model-policy/resolve';
import { validateRuntimeKey } from '../../core/model-policy/capabilities';

export const V2_STALL_REASON = 'doble senial de stall sin safeToReplace positivo del adapter (R4.2b)';

export interface HistoricalV2Rollouts {
    codexHome: string; parentRollout: string; childRollout: string;
    parentThreadId: string; childThreadId: string; cliVersion: string; selection: RoutingSelection;
}

/** Reads only bounded native metadata and lifecycle markers. The digest seals
 * the inspected bytes without persisting a prompt or rollout body. */
export function inspectHistoricalV2Rollouts(input: HistoricalV2Rollouts): { evidenceDigest: string } {
    if (!input || typeof input !== 'object' || !path.isAbsolute(input.codexHome)
        || !path.isAbsolute(input.parentRollout) || !path.isAbsolute(input.childRollout)
        || !/^[A-Za-z0-9_-]{1,128}$/.test(input.parentThreadId)
        || !/^[A-Za-z0-9_-]{1,128}$/.test(input.childThreadId)
        || !/^\d+\.\d+\.\d+$/.test(input.cliVersion)
        || input.selection?.selector.kind !== 'model' || input.selection.effort.kind !== 'explicit')
        throw new Error('historical V2 rollout identity is invalid');
    const root = path.resolve(input.codexHome, 'sessions');
    function read(file: string): { raw: Buffer; events: Array<Record<string, unknown>> } {
        const resolved = path.resolve(file);
        if (!resolved.startsWith(root + path.sep) || fs.realpathSync(resolved) !== resolved)
            throw new Error('historical V2 rollout path is outside native sessions or unsafe');
        const stat = fs.lstatSync(resolved);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
            throw new Error('historical V2 rollout is unsafe or too large');
        const raw = fs.readFileSync(resolved);
        if (raw.length !== stat.size) throw new Error('historical V2 rollout changed while reading');
        const lines = raw.toString('utf8').trimEnd().split('\n');
        if (lines.length === 0 || lines.length > 10000) throw new Error('historical V2 rollout event count is invalid');
        const events = lines.map(line => JSON.parse(line) as Record<string, unknown>);
        return { raw, events };
    }
    const parent = read(input.parentRollout);
    const child = read(input.childRollout);
    const payload = (event: Record<string, unknown>): Record<string, unknown> => {
        if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('historical V2 rollout payload is invalid');
        return event.payload as Record<string, unknown>;
    };
    const metadata = (events: Array<Record<string, unknown>>, id: string): Record<string, unknown> => {
        const metas = events.filter(event => event.type === 'session_meta');
        if (metas.length !== 1) throw new Error('historical V2 session metadata is ambiguous');
        const meta = payload(metas[0]);
        if (meta.id !== id || meta.cli_version !== input.cliVersion) throw new Error('historical V2 session identity or version mismatch');
        return meta;
    };
    metadata(parent.events, input.parentThreadId);
    const childMeta = metadata(child.events, input.childThreadId);
    const source = childMeta.source as { subagent?: { thread_spawn?: { parent_thread_id?: unknown } } } | undefined;
    if (source?.subagent?.thread_spawn?.parent_thread_id !== input.parentThreadId)
        throw new Error('historical V2 parent-child link mismatch');
    for (const events of [parent.events, child.events]) {
        const turns = events.filter(event => event.type === 'turn_context');
        if (turns.length === 0 || turns.some(event => payload(event).multi_agent_version !== 'v2'))
            throw new Error('historical native version is not V2');
    }
    const childTurns = child.events.filter(event => event.type === 'turn_context');
    const configuredEffort = input.selection.effort.kind === 'explicit' ? input.selection.effort.value : undefined;
    if (childTurns.length !== 2 || childTurns.some(event => {
        const turn = payload(event);
        return turn.model !== input.selection.selector.id || turn.effort !== configuredEffort;
    })) throw new Error('historical child configured selection changed');
    const lifecycle = child.events.filter(event => event.type === 'event_msg').map(event => payload(event).type);
    if (lifecycle.filter(type => type === 'task_started').length !== 2
        || lifecycle.filter(type => type === 'task_complete').length !== 1
        || lifecycle.lastIndexOf('task_complete') > lifecycle.lastIndexOf('task_started')
        || lifecycle.some(type => type === 'task_cancelled'))
        throw new Error('historical V2 child continuation is terminal or lifecycle ambiguous');
    const evidenceDigest = crypto.createHash('sha256').update(parent.raw).update('\0').update(child.raw).digest('hex');
    return { evidenceDigest };
}

export interface V2InterruptionInput {
    attemptId: string;
    nativeAgentId: string;
    parentThreadId: string;
    dispatchId: string;
    jobId: string;
    jobFingerprint: string;
    planDigest: string;
    executionDigest: string;
    policyDigest: string;
    capabilityDigest: string;
    generationToken: string;
    evidenceDigest: string;
    reason: string;
    at: string;
}

export interface RecoverV2InterruptionInput {
    attemptId: string; nativeAgentId: string; parentThreadId: string;
    dispatchId: string; jobId: string; jobFingerprint: string;
    generationToken: string; planDigest: string; executionDigest: string;
    parentRollout: string; childRollout: string; reason: string;
    codexHome?: string;
    checkOnly?: boolean;
}

function assertNoOpenRollout(file: string): void {
    const result = spawnSync('lsof', ['-t', file], { encoding: 'utf8', timeout: 5000 });
    if (result.error || result.status !== 1 || result.stdout.trim().length > 0)
        throw new Error('native Codex rollout has a live owner or lsof is unavailable');
}

function assertNoExecutionClaims(repoRoot: string, branch: string, state: JournalState, jobId: string, generationToken: string): void {
    if (activeRequestProblems(state).length > 0) throw new Error('historical request conflict is unresolved');
    const latest = state.generations.at(-1);
    if (!latest || latest.token !== generationToken || latest.state !== 'terminated'
        || !latest.controllerJobId || !latest.spawnNonce || !latest.processRef || !latest.wrapperRef)
        throw new Error('historical controller generation identity is incomplete');
    for (const generation of state.generations) {
        if (controllerGenerationHasUnresolvedClaim(repoRoot, branch, generation))
            throw new Error('controller has an unresolved claim');
        for (const ref of [generation.processRef, generation.wrapperRef]) {
            if (ref && (refIsAlive(ref) || !groupIsGone(ref.processGroup)))
                throw new Error('controller executor is live or process group is ambiguous');
        }
    }
    for (const job of Object.values(state.jobs)) {
        if (job.id !== jobId && !['exited', 'cancelled'].includes(job.executionState))
            throw new Error('another job remains active or ambiguous');
        for (const ref of [job.processRef, job.wrapperRef]) {
            if (ref && (refIsAlive(ref) || !groupIsGone(ref.processGroup)))
                throw new Error('job executor is live or process group is ambiguous');
        }
    }
    const logs = logsDir(repoRoot, branch);
    const stat = fs.lstatSync(logs);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('job sidecar directory is unsafe');
    if (fs.readdirSync(logs).some(name => name === jobId || name.startsWith(`${jobId}.`)))
        throw new Error('received job has a claim, identity, result or other sidecar: never-started unproven');
    const readSidecar = (file: string): Record<string, unknown> => {
        const sidecar = fs.lstatSync(file);
        if (!sidecar.isFile() || sidecar.isSymbolicLink() || sidecar.size > 16 * 1024)
            throw new Error('controller sidecar is unsafe or oversized');
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('controller sidecar is invalid');
        return parsed as Record<string, unknown>;
    };
    const claim = readSidecar(claimPath(logs, latest.controllerJobId, latest.spawnNonce));
    const identity = readSidecar(identityPath(logs, latest.controllerJobId, latest.spawnNonce));
    if (claim.jobId !== latest.controllerJobId || claim.nonce !== latest.spawnNonce
        || claim.wrapperPid !== latest.wrapperRef.pid || identity.jobId !== latest.controllerJobId
        || identity.nonce !== latest.spawnNonce || JSON.stringify(identity.wrapper) !== JSON.stringify(latest.wrapperRef)
        || JSON.stringify(identity.command) !== JSON.stringify(latest.processRef))
        throw new Error('controller claim or identity sidecar does not match journal nonce and process');
    // A controller result, if present, does not certify the child turn.
    const controllerResult = resultPath(logs, latest.controllerJobId, latest.spawnNonce);
    if (fs.existsSync(controllerResult)) readSidecar(controllerResult);
    const pendingDir = requestsDir(repoRoot, branch);
    for (const name of fs.readdirSync(pendingDir)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(pendingDir, name);
        const fileStat = fs.lstatSync(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 256 * 1024)
            throw new Error('pending request artifact is unsafe');
        const envelope = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (typeof envelope.requestId !== 'string' || typeof envelope.generationToken !== 'string'
            || (!state.appliedRequests[envelope.requestId]
                && (envelope.generationToken !== generationToken || envelope.kind !== 'job-request')))
            throw new Error('pending request has ambiguous ownership');
    }
}

/** Public offline recovery. Every mutable decision is made under the single
 * physical-worktree lock; one atomic journal write is the commit point. */
export async function recoverInterruptedV2Attempt(repoRoot: string, branch: string, input: RecoverV2InterruptionInput): Promise<'recovered' | 'already-recovered' | 'ready'> {
    if (!path.isAbsolute(repoRoot) || typeof branch !== 'string' || !branch || !input
        || !path.isAbsolute(input.parentRollout) || !path.isAbsolute(input.childRollout))
        throw new Error('V2 recovery arguments are invalid');
    const lock = acquireLock(repoRoot);
    try {
        const read = readJournal(repoRoot, branch);
        if (read.corrupt || !read.state) throw new Error('V2 recovery journal is absent or corrupt');
        const state = read.state;
        verifyBranchInvariant(repoRoot, state.branch);
        const route = state.routingAttempts?.find(item => item.id === input.attemptId);
        if (!route || route.nativeAgentId !== input.nativeAgentId || route.envelope.runtime.target !== 'codex')
            throw new Error('V2 recovery native route identity mismatch');
        const plan = state.planBinding && validatePlanFile(state.planBinding.path, repoRoot);
        if (!plan || plan.state !== 'valid' || plan.schema !== 'compact-slices/v2'
            || plan.planDigest !== input.planDigest || plan.executionDigest !== input.executionDigest
            || state.planBinding?.digest !== input.planDigest || state.planBinding.executionDigest !== input.executionDigest)
            throw new Error('V2 recovery plan binding is not current');
        const runtime = validateRuntimeKey(route.envelope.runtime);
        const policy = readEffectivePolicy(repoRoot);
        if (policy.state !== 'approved' || policy.policy.contentDigest !== route.envelope.policyDigest)
            throw new Error('V2 recovery approved policy drift');
        const stored = readStoredEventReceipt(runtime);
        if (stored.state !== 'present') throw new Error('V2 recovery native capability receipt is missing or invalid');
        const local = await queryLocalEventScope(repoRoot, runtime.target, runtime.kind);
        if (local.state !== 'current' || JSON.stringify(local.scope.runtime) !== JSON.stringify(runtime)
            || local.scope.binaryDigest !== stored.receipt.binaryDigest
            || local.scope.configDigest !== stored.receipt.configDigest)
            throw new Error('V2 recovery native runtime identity is not current');
        const resolved = resolveEventSelection({ role: 'implementer', requestedProfile: route.envelope.effectiveProfile,
            policy: policy.policy, receipt: stored.receipt, scope: local.scope, now: new Date() });
        if (resolved.state !== 'resolved' || JSON.stringify(resolved.selection) !== JSON.stringify(route.envelope.resolved)
            || resolved.policyDigest !== route.envelope.policyDigest
            || resolved.outcome !== route.envelope.outcome)
            throw new Error('V2 recovery selection or capability drift');
        assertNoExecutionClaims(repoRoot, branch, state, input.jobId, input.generationToken);
        assertNoOpenRollout(input.parentRollout);
        assertNoOpenRollout(input.childRollout);
        const native = inspectHistoricalV2Rollouts({ codexHome: input.codexHome ?? path.join(os.homedir(), '.codex'),
            parentRollout: input.parentRollout, childRollout: input.childRollout,
            parentThreadId: input.parentThreadId, childThreadId: input.nativeAgentId,
            cliVersion: runtime.version, selection: route.observed ?? route.envelope.resolved });
        const prior = route.interruption;
        const transition = retireInterruptedV2Attempt(state, { attemptId: input.attemptId,
            nativeAgentId: input.nativeAgentId, parentThreadId: input.parentThreadId,
            dispatchId: input.dispatchId, jobId: input.jobId, jobFingerprint: input.jobFingerprint,
            generationToken: input.generationToken, planDigest: input.planDigest, executionDigest: input.executionDigest,
            policyDigest: route.envelope.policyDigest, capabilityDigest: route.envelope.capabilityDigest,
            evidenceDigest: native.evidenceDigest, reason: input.reason, at: prior?.at ?? new Date().toISOString() });
        if (transition.outcome === 'already-recovered') return 'already-recovered';
        if (input.checkOnly) return 'ready';
        // Recheck external ownership immediately before the only durable write.
        assertNoExecutionClaims(repoRoot, branch, state, input.jobId, input.generationToken);
        assertNoOpenRollout(input.parentRollout);
        assertNoOpenRollout(input.childRollout);
        writeJournal(repoRoot, branch, transition.state);
        appendEvent(repoRoot, branch, { kind: 'native-v2-interruption-recovered', attemptId: input.attemptId,
            dispatchId: input.dispatchId, jobId: input.jobId, evidenceDigest: native.evidenceDigest });
        return 'recovered';
    } finally { releaseLock(repoRoot, lock); }
}

function validInput(input: V2InterruptionInput): boolean {
    if (!input || typeof input !== 'object') return false;
    const bounded = (value: unknown, max: number): boolean => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001F\u007F]/.test(value);
    const digest = (value: unknown): boolean => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    return [input.attemptId, input.nativeAgentId, input.parentThreadId, input.dispatchId, input.jobId, input.generationToken].every(value => bounded(value, 128))
        && [input.jobFingerprint, input.planDigest, input.executionDigest, input.policyDigest, input.capabilityDigest, input.evidenceDigest].every(digest)
        && bounded(input.reason, 512) && input.reason.trim().length > 0
        && typeof input.at === 'string' && Number.isFinite(Date.parse(input.at));
}

/** Pure, schema-checked transition. The caller must prove native custody and
 * received-job sidecars under the exclusive supervisor lock before invoking. */
export function retireInterruptedV2Attempt(state: JournalState, input: V2InterruptionInput): { state: JournalState; outcome: 'recovered' | 'already-recovered' } {
    if (!isWellFormedState(state) || !validInput(input)) throw new Error('V2 interruption input or journal is invalid');
    if (state.schema !== 2 || state.planBinding?.schema !== 'compact-slices/v2'
        || state.planBinding.executionMode !== 'desatendido'
        || state.planBinding.digest !== input.planDigest || state.planBinding.executionDigest !== input.executionDigest)
        throw new Error('V2 interruption plan binding drift');
    const route = state.routingAttempts?.find(item => item.id === input.attemptId);
    const linked = state.dispatches.find(item => item.id === input.dispatchId);
    const job = state.jobs[input.jobId];
    const task = state.tasks.find(item => item.id === route?.envelope.sliceId);
    if (!route || route.envelope.role !== 'implementer' || route.nativeEvidenceRequired !== true
        || route.nativeAgentId !== input.nativeAgentId || route.nativeEventDigest === undefined
        || route.observed === undefined || route.envelope.planDigest !== input.planDigest
        || route.envelope.executionDigest !== input.executionDigest || route.envelope.policyDigest !== input.policyDigest
        || route.envelope.capabilityDigest !== input.capabilityDigest || route.verdict !== undefined
        || !route.reservationRequestId || state.appliedRequests[route.reservationRequestId]?.outcome !== 'applied'
        || state.appliedRequests[route.reservationRequestId]?.resultRef !== route.id
        || !linked || linked.routingAttemptId !== route.id || linked.taskId !== route.envelope.sliceId
        || !linked.dispatchRequestId || state.appliedRequests[linked.dispatchRequestId]?.outcome !== 'applied'
        || state.appliedRequests[linked.dispatchRequestId]?.resultRef !== linked.id
        || !task || task.status !== 'in-progress' || task.attempts !== 1
        || !job || job.fingerprint !== input.jobFingerprint
        || (state.routingAttempts ?? []).some(item => item.id !== route.id && item.envelope.sliceId === task.id && ['reserved','active','unknown'].includes(item.state)))
        throw new Error('V2 interruption identity, ACK, dispatch, job or ownership mismatch');
    const interruption = { at: input.at, reason: input.reason, evidenceDigest: input.evidenceDigest,
        parentThreadId: input.parentThreadId, generationToken: input.generationToken,
        jobId: input.jobId, jobFingerprint: input.jobFingerprint, dispatchId: input.dispatchId };
    if (route.state === 'interrupted') {
        if (JSON.stringify(route.interruption) !== JSON.stringify(interruption) || job.executionState !== 'cancelled'
            || job.verdict !== undefined || state.cycle.status !== 'IN_PROGRESS')
            throw new Error('V2 interruption replay conflicts with durable transition');
        return { state: structuredClone(state), outcome: 'already-recovered' };
    }
    if (state.cycle.status !== 'BLOCKED' || state.cycle.blockedReason !== V2_STALL_REASON
        || route.state !== 'active' || job.executionState !== 'received' || job.spawnNonce !== undefined
        || job.processRef !== undefined || job.wrapperRef !== undefined || job.result !== undefined
        || job.verdict !== undefined) throw new Error('V2 interruption custody or job state is not recoverable');
    const next = structuredClone(state);
    const old = next.routingAttempts!.find(item => item.id === route.id)!;
    old.state = 'interrupted';
    old.reasonCode = 'NATIVE_V2_INTERRUPTED';
    old.interruption = interruption;
    next.jobs[input.jobId].executionState = 'cancelled';
    next.jobs[input.jobId].phaseTimestamps.cancelled = input.at;
    next.cycle.status = 'IN_PROGRESS';
    next.cycle.blockedReason = undefined;
    next.controllerWait = undefined;
    next.controllerHeartbeatAt = undefined;
    if (!isWellFormedState(next)) throw new Error('V2 interruption would create invalid journal');
    return { state: next, outcome: 'recovered' };
}
