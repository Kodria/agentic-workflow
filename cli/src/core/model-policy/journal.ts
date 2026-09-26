import crypto from 'crypto';
import { isRoutingEnvelope, isRoutingSelection, isWellFormedState, type JournalState, type RoutingEnvelopeRecord, type RoutingSelection } from '../journal/types';
import type { ApprovedPolicy, CapabilityReceipt, RoutingRole } from './types';
import { resolveEscalatedSelection, resolveEventWithFallback, resolveSelection } from './resolve';
import { validateRuntimeKey } from './capabilities';
import type { EventReceipt, EventScope } from './capabilities-v2';

type ApprovalSnapshot = { policy?: ApprovedPolicy; capabilities?: CapabilityReceipt; eventReceipt?: EventReceipt; eventScope?: EventScope; checkedAt: Date };

function assertTimestamp(value: string): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('routing timestamp is invalid'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value !== null && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`; } return JSON.stringify(value); }
function digest(value: unknown): string { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function clone(state: JournalState): JournalState { const next = structuredClone(state); if (!Array.isArray(next.routingAttempts)) next.routingAttempts = []; return next; }
function noteRoutingIncident(state: JournalState, target: string, selection: RoutingSelection, reasonCode: string, at: string, fallback: boolean, sameObligationAlreadyCounted = false): void {
    if (!/^[A-Z0-9_]{3,64}$/.test(reasonCode)) throw new Error('routing incident reason is invalid');
    state.routingIncidents ??= [];
    // One incident/alert per selected route in a run even if later failures
    // refine the cause; retain the first actionable reason.
    const id = crypto.createHash('sha256').update(`${state.journalId}\0${state.cycle.startedAt}\0${target}\0${canonical(selection)}`).digest('hex').slice(0, 24);
    const prior = state.routingIncidents.find(item => item.id === id);
    if (prior) { prior.affectedObligations += Number(!sameObligationAlreadyCounted); prior.fallbackCount += Number(fallback); prior.blockedCount += Number(!fallback); prior.lastAt = at; return; }
    if (state.routingIncidents.length >= 4096) throw new Error('routing incident limit exhausted');
    state.routingIncidents.push({ schema: 'routing-incident/v1', id, runStartedAt: state.cycle.startedAt, target, selection: structuredClone(selection), reasonCode,
        firstAt: at, lastAt: at, affectedObligations: 1, fallbackCount: Number(fallback), blockedCount: Number(!fallback), alertState: 'pending' });
}
export function reserveRoutingAttempt(state: JournalState, input: { obligationId: string; lineageId: string; envelope: RoutingEnvelopeRecord; fingerprint: string; approval?: () => ApprovalSnapshot }, now: string): { state: JournalState; attemptId: string } {
    assertTimestamp(now); if (!isWellFormedState(state) || !input || typeof input.obligationId !== 'string' || input.obligationId.length === 0 || input.obligationId.length > 128 || typeof input.lineageId !== 'string' || input.lineageId.length === 0 || input.lineageId.length > 128 || !isRoutingEnvelope(input.envelope) || !/^[a-f0-9]{64}$/.test(input.fingerprint)) throw new Error('routing reservation is invalid');
    const next = clone(state); const envelopeDigest = digest(input.envelope); const existing = next.routingAttempts!.find(item => item.lineageId === input.lineageId && item.obligationId === input.obligationId && item.envelopeDigest === envelopeDigest && item.fingerprint === input.fingerprint && ['reserved', 'active'].includes(item.state));
    if (existing) return { state: next, attemptId: existing.id };
    if (input.envelope.role === 'implementer' && input.envelope.sliceId === undefined) throw new Error('routing implementer requires a slice');
    next.implementationLineages ??= [];
    const priorLineage = next.implementationLineages.find(lineage => lineage.id === input.lineageId);
    if (input.envelope.role === 'implementer' && priorLineage === undefined) next.implementationLineages.push({ id: input.lineageId, obligationId: input.obligationId, sliceId: input.envelope.sliceId!, planDigest: input.envelope.planDigest, executionDigest: input.envelope.executionDigest, initialProfile: input.envelope.requestedProfile as 'mechanical' | 'integration' | 'judgment', initialEffort: input.envelope.resolved.effort.kind === 'runtime-default' ? 'runtime-default' : input.envelope.resolved.effort.value === 'high' ? 'high' : 'medium', attempts: 0 });
    if (priorLineage !== undefined && (priorLineage.obligationId !== input.obligationId || priorLineage.planDigest !== input.envelope.planDigest || priorLineage.executionDigest !== input.envelope.executionDigest || priorLineage.sliceId !== input.envelope.sliceId || priorLineage.initialProfile !== input.envelope.requestedProfile)) throw new Error('routing lineage binding mismatch');
    const attempts = next.routingAttempts!.filter(item => item.lineageId === input.lineageId && item.envelope.role === 'implementer');
    if (input.envelope.role === 'implementer' && next.routingAttempts!.some(item => item.lineageId !== input.lineageId
        && item.envelope.sliceId === input.envelope.sliceId && ['reserved', 'active', 'unknown'].includes(item.state)))
        throw new Error('routing slice already has a live attempt');
    if (input.envelope.role === 'implementer' && attempts.length >= 3) throw new Error('routing implementation budget exhausted');
    if (attempts.some(item => item.state === 'interrupted')) {
        const interrupted = attempts[0];
        if (attempts.length !== 1 || interrupted.state !== 'interrupted' || !interrupted.interruption
            || input.envelope.effectiveProfile !== interrupted.envelope.effectiveProfile
            || canonical(input.envelope.resolved) !== canonical(interrupted.envelope.resolved)
            || input.envelope.policyDigest !== interrupted.envelope.policyDigest)
            throw new Error('routing V2 interruption permits only one identical replacement selection');
    }
    const fullFallback = input.envelope.role === 'implementer' && input.envelope.effectiveProfile === 'full';
    if (fullFallback && attempts.some(item => item.envelope.effectiveProfile === 'full')) throw new Error('routing full fallback cannot recursively retry a lineage');
    if (fullFallback && attempts.length > 0) {
        const previous = attempts[attempts.length - 1];
        if (previous.state !== 'blocked' || previous.verdict !== 'inconclusive'
            || !['PROVIDER_REJECTED', 'SELECTION_MISMATCH', 'PROVENANCE_MISSING'].includes(previous.reasonCode ?? ''))
            throw new Error('routing full fallback requires a terminal native routing failure');
    }
    if (input.envelope.role === 'implementer') {
        const initial = input.envelope.requestedProfile;
        if (initial === 'full') throw new Error('routing implementer profile is invalid');
        if (!fullFallback) {
            const expected = resolveLineageEscalation(next, input.lineageId, initial);
            const actualEffort = input.envelope.resolved.effort.kind === 'explicit' ? input.envelope.resolved.effort.value : 'runtime-default';
            const judgmentHighAfterIntegration = expected.profile === 'judgment' && expected.effort === 'medium' && actualEffort === 'high' && attempts.length > 0 && attempts[attempts.length - 1].envelope.effectiveProfile === 'integration';
            if (input.envelope.effectiveProfile !== expected.profile || (actualEffort !== expected.effort && !judgmentHighAfterIntegration)) throw new Error('routing effective escalation mismatch');
        }
    }
    const approval = input.approval?.();
    if (!approval) throw new Error('routing reservation requires current approval');
    if ((approval.eventReceipt || approval.eventScope) && (!approval.eventReceipt || !approval.eventScope || canonical(approval.eventScope.runtime) !== canonical(input.envelope.runtime))) throw new Error('routing reservation event scope mismatch');
    const selectionInput = { role: input.envelope.role as RoutingRole, requestedProfile: input.envelope.role === 'implementer' ? input.envelope.effectiveProfile : 'full' as const, runtime: validateRuntimeKey(input.envelope.runtime), policy: approval.policy, capabilities: approval.capabilities, eventReceipt: approval.eventReceipt, eventScope: approval.eventScope, circuitIncidents: next.routingIncidents, now: approval.checkedAt };
    const mapping = approval.policy?.content.mappings.find(item => item.target === input.envelope.runtime.target && item.runtimeKind === input.envelope.runtime.kind);
    const optimizedSelection = mapping && input.envelope.role === 'implementer' && input.envelope.requestedProfile !== 'full' ? mapping.profiles[input.envelope.requestedProfile] : undefined;
    const circuitReason = optimizedSelection && next.routingIncidents?.find(item => item.target === input.envelope.runtime.target && canonical(item.selection) === canonical(optimizedSelection)
        && ['PROVIDER_REJECTED', 'SELECTION_MISMATCH', 'PROVENANCE_MISSING'].includes(item.reasonCode))?.reasonCode as 'PROVIDER_REJECTED' | 'SELECTION_MISMATCH' | 'PROVENANCE_MISSING' | undefined;
    const resolved = input.envelope.role === 'implementer' && input.envelope.effectiveProfile === 'judgment' && input.envelope.resolved.effort.kind === 'explicit' && input.envelope.resolved.effort.value === 'high'
        ? resolveEscalatedSelection({ ...selectionInput, role: 'implementer', requestedProfile: 'judgment', expectedEffort: 'high' })
        : approval.eventReceipt && approval.eventScope
            ? resolveEventWithFallback({ role: selectionInput.role, requestedProfile: input.envelope.role === 'implementer' ? fullFallback ? input.envelope.requestedProfile : input.envelope.effectiveProfile : 'full', policy: approval.policy, receipt: approval.eventReceipt, scope: approval.eventScope, now: approval.checkedAt, circuitReason })
            : resolveSelection(selectionInput);
    if (fullFallback && (resolved.state !== 'resolved' || !resolved.fallbackReason)) throw new Error('routing full fallback requires a current optimized-route failure');
    if (resolved.state !== 'resolved' || resolved.effectiveProfile !== input.envelope.effectiveProfile || canonical(resolved.selection) !== canonical(input.envelope.resolved) || resolved.policyDigest !== input.envelope.policyDigest || resolved.capabilityDigest !== input.envelope.capabilityDigest || resolved.outcome !== input.envelope.outcome || canonical(resolved.unavailableEvidence) !== canonical(input.envelope.unavailableEvidence) || resolved.nativeAgentType !== input.envelope.nativeAgentType) throw new Error('routing reservation approval mismatch');
    const attempt = attempts.length + 1; const id = `route-${crypto.createHash('sha256').update(`${input.lineageId}\0${attempt}\0${envelopeDigest}\0${input.fingerprint}`).digest('hex').slice(0, 24)}`;
    next.routingAttempts!.push({ schema: 'routing-attempt/v1', id, obligationId: input.obligationId, lineageId: input.lineageId, attempt, envelope: structuredClone(input.envelope), envelopeDigest, fingerprint: input.fingerprint, state: 'reserved', reservedAt: now, ...(approval.eventReceipt ? { nativeEvidenceRequired: true as const } : {}), ...(resolved.state === 'resolved' && resolved.fallbackReason ? { reasonCode: resolved.fallbackReason } : {}) });
    if (resolved.state === 'resolved' && resolved.fallbackReason) {
        const mapping = approval.policy?.content.mappings.find(item => item.target === input.envelope.runtime.target && item.runtimeKind === input.envelope.runtime.kind);
        if (!mapping || input.envelope.role !== 'implementer' || input.envelope.requestedProfile === 'full') throw new Error('routing fallback lacks approved optimized selection');
        const sameObligationAlreadyCounted = attempts.some(item => item.obligationId === input.obligationId && item.state === 'blocked' && item.reasonCode === resolved.fallbackReason);
        noteRoutingIncident(next, input.envelope.runtime.target, mapping.profiles[input.envelope.requestedProfile], resolved.fallbackReason, now, true, sameObligationAlreadyCounted);
    }
    const lineage = next.implementationLineages.find(candidate => candidate.id === input.lineageId); if (lineage !== undefined) lineage.attempts = attempt;
    return { state: next, attemptId: id };
}
export function observeRoutingAttempt(state: JournalState, input: { attemptId: string; nativeAgentId: string; observed?: RoutingSelection; observedBackendModel?: string; unavailableReason?: string; nativeEventDigest?: string }, now: string): JournalState {
    assertTimestamp(now); if (!isWellFormedState(state) || !input || typeof input.attemptId !== 'string' || input.attemptId.length === 0 || typeof input.nativeAgentId !== 'string' || input.nativeAgentId.length === 0 || input.nativeAgentId.length > 128 || (input.observed !== undefined && !isRoutingSelection(input.observed)) || (input.observedBackendModel !== undefined && (typeof input.observedBackendModel !== 'string' || input.observedBackendModel.length === 0 || input.observedBackendModel.length > 128 || input.nativeEventDigest === undefined)) || (input.unavailableReason !== undefined && (typeof input.unavailableReason !== 'string' || input.unavailableReason.length === 0 || input.unavailableReason.length > 128))) throw new Error('routing observation is invalid'); const next = clone(state); const attempt = next.routingAttempts!.find(item => item.id === input.attemptId); if (!attempt) throw new Error('routing attempt is unknown'); if (attempt.state === 'active') { if (attempt.nativeAgentId === input.nativeAgentId && canonical(attempt.observed) === canonical(input.observed) && attempt.observedBackendModel === input.observedBackendModel) return next; throw new Error('routing observation is immutable'); }
    if (attempt.state === 'blocked') {
        const mismatch = input.observed !== undefined && canonical(input.observed) !== canonical(attempt.envelope.resolved);
        const reason = mismatch ? 'SELECTION_MISMATCH' : ['PROVIDER_REJECTED', 'PROVENANCE_MISSING'].includes(input.unavailableReason ?? '') ? input.unavailableReason : undefined;
        if (attempt.nativeAgentId === input.nativeAgentId && canonical(attempt.observed) === canonical(input.observed) && reason === attempt.reasonCode) return next;
        throw new Error('routing observation is immutable');
    }
    if (attempt.state !== 'reserved') throw new Error('routing attempt cannot be observed');
    if (input.nativeEventDigest !== undefined) {
        if (!/^[a-f0-9]{64}$/.test(input.nativeEventDigest) || next.routingAttempts!.some(item => item.id !== attempt.id
            && (item.nativeEventDigest === input.nativeEventDigest || (item.nativeEvidenceRequired && item.nativeAgentId === input.nativeAgentId))))
            throw new Error('native routing event was already consumed');
        attempt.nativeEventDigest = input.nativeEventDigest;
    }
    attempt.nativeAgentId = input.nativeAgentId; if (input.observed) attempt.observed = structuredClone(input.observed); if (input.observedBackendModel) attempt.observedBackendModel = input.observedBackendModel;
    const mismatch = input.observed !== undefined && canonical(input.observed) !== canonical(attempt.envelope.resolved);
    const unavailable = input.unavailableReason === 'PROVIDER_REJECTED' || input.unavailableReason === 'PROVENANCE_MISSING';
    if (mismatch || unavailable) {
        const reason = mismatch ? 'SELECTION_MISMATCH' : input.unavailableReason as 'PROVIDER_REJECTED' | 'PROVENANCE_MISSING';
        attempt.state = 'blocked'; attempt.verdict = 'inconclusive'; attempt.reasonCode = reason;
        // Agent-supplied negative evidence may conservatively trip a breaker,
        // but never mints or renews native capability evidence.
        noteRoutingIncident(next, attempt.envelope.runtime.target, attempt.envelope.resolved, reason, now, false);
    } else { attempt.state = 'active'; if (input.unavailableReason) attempt.reasonCode = input.unavailableReason; }
    return next;
}
/** Computes, but never persists, the only permitted implementation retry.
 * A live/unknown attempt is custody, not an escalation opportunity.  Judgment
 * high is an effort escalation of the same approved judgment capability. */
export function resolveLineageEscalation(state: JournalState, lineageId: string, initial: 'mechanical' | 'integration' | 'judgment'): { profile: 'mechanical' | 'integration' | 'judgment'; effort: 'medium' | 'high' | 'runtime-default' } {
    if (!isWellFormedState(state) || typeof lineageId !== 'string' || lineageId.length === 0) throw new Error('routing lineage is invalid');
    const attempts = (state.routingAttempts ?? []).filter((attempt) => attempt.lineageId === lineageId && attempt.envelope.role === 'implementer').sort((left, right) => left.attempt - right.attempt);
    if (attempts.some((attempt) => ['reserved', 'active', 'unknown'].includes(attempt.state))) throw new Error('routing lineage has a live or unknown attempt');
    if (attempts.length === 0) {
        const lineage = state.implementationLineages?.find(candidate => candidate.id === lineageId);
        return { profile: initial, effort: lineage?.initialEffort ?? 'medium' };
    }
    const last = attempts[attempts.length - 1];
    if (last.state === 'interrupted' && last.interruption && attempts.length === 1
        && last.envelope.effectiveProfile !== 'full') {
        return { profile: last.envelope.effectiveProfile as 'mechanical' | 'integration' | 'judgment',
            effort: last.envelope.resolved.effort.kind === 'explicit'
                ? last.envelope.resolved.effort.value as 'medium' | 'high' : 'runtime-default' };
    }
    if (last.envelope.effectiveProfile === 'full') throw new Error('routing full fallback is exhausted');
    if (last.verdict === 'inconclusive' && ['PROVIDER_REJECTED', 'SELECTION_MISMATCH', 'PROVENANCE_MISSING'].includes(last.reasonCode ?? '')) {
        const lineage = state.implementationLineages?.find(candidate => candidate.id === lineageId);
        return { profile: initial, effort: lineage?.initialEffort ?? 'medium' };
    }
    if (last.verdict !== 'fail') throw new Error('routing lineage advances only after a terminal failed verdict');
    const routeEffort = last.envelope.resolved.effort.kind === 'runtime-default' ? 'runtime-default' : 'medium';
    if (last.envelope.effectiveProfile === 'mechanical') return { profile: 'integration', effort: routeEffort };
    if (last.envelope.effectiveProfile === 'integration') return { profile: 'judgment', effort: routeEffort };
    if (last.envelope.effectiveProfile === 'judgment' && last.envelope.resolved.effort.kind === 'explicit' && last.envelope.resolved.effort.value === 'medium') return { profile: 'judgment', effort: 'high' };
    throw new Error('routing lineage escalation exhausted');
}
/** Read-only operational summary. Deliberately excludes envelopes, prompts and
 * native identities: this is safe to expose in a status command. */
export function routingReport(state: JournalState): { schema: 'routing-report/v1'; attempts: number; plannedByRole: Record<string, number>; actualByRole: Record<string, number>; nativeReconciledByRole?: Record<string, number>; selections: Array<{ role: RoutingRole; configured: RoutingSelection; accepted: RoutingSelection | 'unknown'; backendModel: string | 'unknown' }>; byState: Record<string, number>; retries: number; fallbacks: number; unavailable: Record<string, number>; verdicts: Record<string, number>; administrativeRepairs: number; measurement: { configuredSelection: 'envelope-recorded'; acceptedSelection: 'not-natively-reconciled' | 'partially-reconciled' | 'natively-reconciled'; backendModel: 'unknown' | 'provider-reported'; tokenUsage: 'unknown'; savings: 'unverified' }; incidents?: Array<{ reasonCode: string; selection: RoutingSelection; affectedObligations: number; fallbackCount: number; blockedCount: number; alertState: 'pending' | 'reported' }> } {
    const attempts = state.routingAttempts ?? [];
    const plannedByRole: Record<string, number> = {}; const actualByRole: Record<string, number> = {}; const nativeReconciledByRole: Record<string, number> = {}; const byState: Record<string, number> = {}; const unavailable: Record<string, number> = {}; const verdicts: Record<string, number> = {};
    for (const attempt of attempts) {
        plannedByRole[attempt.envelope.role] = (plannedByRole[attempt.envelope.role] ?? 0) + 1;
        if (attempt.nativeAgentId !== undefined) actualByRole[attempt.envelope.role] = (actualByRole[attempt.envelope.role] ?? 0) + 1;
        if (attempt.nativeEventDigest !== undefined && ['active', 'complete'].includes(attempt.state)) nativeReconciledByRole[attempt.envelope.role] = (nativeReconciledByRole[attempt.envelope.role] ?? 0) + 1;
        byState[attempt.state] = (byState[attempt.state] ?? 0) + 1;
        for (const reason of attempt.envelope.unavailableEvidence) unavailable[reason] = (unavailable[reason] ?? 0) + 1;
        if (attempt.envelope.role === 'implementer' && attempt.envelope.effectiveProfile === 'full' && attempt.reasonCode) unavailable[attempt.reasonCode] = (unavailable[attempt.reasonCode] ?? 0) + 1;
        if (attempt.verdict !== undefined) verdicts[attempt.verdict] = (verdicts[attempt.verdict] ?? 0) + 1;
    }
    const incidents = (state.routingIncidents ?? []).map(({ reasonCode, selection, affectedObligations, fallbackCount, blockedCount, alertState }) => ({ reasonCode, selection, affectedObligations, fallbackCount, blockedCount, alertState }));
    const reconciled = Object.values(nativeReconciledByRole).reduce((total, count) => total + count, 0);
    const selections = attempts.map(attempt => ({ role: attempt.envelope.role as RoutingRole, configured: attempt.envelope.resolved,
        accepted: attempt.nativeEventDigest && ['active', 'complete'].includes(attempt.state) ? attempt.observed ?? 'unknown' as const : 'unknown' as const,
        backendModel: attempt.nativeEventDigest && ['active', 'complete'].includes(attempt.state) ? attempt.observedBackendModel ?? 'unknown' : 'unknown' }));
    return { schema: 'routing-report/v1', attempts: attempts.length, plannedByRole, actualByRole, selections,
        ...(reconciled ? { nativeReconciledByRole } : {}), byState, retries: attempts.filter((attempt) => attempt.attempt > 1).length, fallbacks: attempts.filter((attempt) => attempt.envelope.role === 'implementer' && attempt.envelope.effectiveProfile === 'full' && attempt.envelope.requestedProfile !== 'full').length, unavailable, verdicts, administrativeRepairs: attempts.filter((attempt) => attempt.administrativeRepair === true).length,
        measurement: { configuredSelection: 'envelope-recorded', acceptedSelection: reconciled === 0 ? 'not-natively-reconciled' : reconciled === attempts.length ? 'natively-reconciled' : 'partially-reconciled', backendModel: selections.some(item => item.backendModel !== 'unknown') ? 'provider-reported' : 'unknown', tokenUsage: 'unknown', savings: 'unverified' }, ...(incidents.length ? { incidents } : {}) };
}
