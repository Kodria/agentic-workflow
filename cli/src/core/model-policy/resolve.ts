import { createHash } from 'crypto';
import type { PlanDiagnostic } from '../plan/types';
import { capabilityReceiptDigest, receiptIsCurrent, routingDiagnostic, validateCapabilityReceipt } from './capabilities';
import { evaluateEventReceipt, validateEventReceipt, type EventReceipt, type EventScope } from './capabilities-v2';
import { selectionPolicyDigest } from './selection-policy-digest';
import type { ApprovedPolicy, CapabilityReceipt, ImplementerProfile, RoutingRole, RuntimeKey, Selection } from './types';
import { validateApprovedPolicy } from './validate';
import { assertVerifiedValidPlanReport } from '../plan/validate';
import type { PlanValidationReport } from '../plan/types';
import type { RoutingIncident } from '../journal/types';

export type SelectionResolution = { state: 'resolved'; selection: Selection; effectiveProfile: ImplementerProfile | 'full'; outcome: 'native' | 'degraded'; policyDigest: string; capabilityDigest: string; unavailableEvidence: string[]; nativeAgentType?: string; fallbackReason?: string } | { state: 'blocked'; diagnostics: PlanDiagnostic[] };
export type ResolveSelectionInput = { role: RoutingRole; requestedProfile: ImplementerProfile | 'full'; policy?: ApprovedPolicy; capabilities?: CapabilityReceipt; eventReceipt?: EventReceipt; eventScope?: EventScope; circuitIncidents?: readonly RoutingIncident[]; runtime: RuntimeKey; now: Date };
export type ResolveEventSelectionInput = { role: RoutingRole; requestedProfile: ImplementerProfile | 'full'; policy?: ApprovedPolicy; receipt?: unknown; scope: EventScope; now: Date; circuitReason?: 'PROVIDER_REJECTED' | 'SELECTION_MISMATCH' | 'PROVENANCE_MISSING' };

/** Event-scoped v2 evidence has no clock expiry. It is never converted into a
 * v1 approval or promoted to backend-model proof. */
export function resolveEventSelection(input: ResolveEventSelectionInput): SelectionResolution {
    if (!input || typeof input !== 'object' || !input.scope || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new Error('event selection requires scope and finite clock');
    if (!['implementer', 'specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'architecture', 'track-a-qa', 'track-b-qa', 'controller', 'documentation', 'retro', 'finishing'].includes(input.role)) throw new Error('event selection role is invalid');
    if (!['mechanical', 'integration', 'judgment', 'full'].includes(input.requestedProfile)) throw new Error('event selection profile is invalid');
    if (!input.policy) return blocked('ROUTING_POLICY_ABSENT', 'An approved routing policy is required.');
    if (!input.receipt) return blocked('ROUTING_CAPABILITY_ABSENT', 'Native event enrollment is absent.');
    let policy: ApprovedPolicy;
    try { policy = validateApprovedPolicy(input.policy); } catch { return blocked('ROUTING_POLICY_INVALID', 'Approved routing policy is corrupt.'); }
    const mapping = policy.content.mappings.find(row => row.target === input.scope.runtime.target && row.runtimeKind === input.scope.runtime.kind);
    if (!mapping) return blocked('ROUTING_POLICY_MAPPING_ABSENT', 'Approved policy has no exact target/runtime mapping.');
    const effectiveProfile = input.role === 'implementer' ? input.requestedProfile : 'full';
    const wanted = effectiveProfile === 'full' ? mapping.fullCapability : mapping.profiles[effectiveProfile];
    let receipt: ReturnType<typeof validateEventReceipt>;
    try { receipt = validateEventReceipt(input.receipt); } catch { return blocked('ROUTING_CAPABILITY_INVALID', 'Native event enrollment is corrupt.'); }
    let currentness: ReturnType<typeof evaluateEventReceipt>;
    try { currentness = evaluateEventReceipt(receipt, input.scope, wanted, selectionPolicyDigest(mapping, wanted), input.now); }
    catch { return blocked('ROUTING_CAPABILITY_INVALID', 'Native event enrollment or scope is invalid.'); }
    if (currentness.state === 'drift') return blocked(`ROUTING_${currentness.reason}`, `Native event enrollment is not current: ${currentness.reason}.`);
    const claim = receipt.claims.find(item => equal(item.selection, wanted));
    if (!claim) return blocked('ROUTING_SELECTION_UNENROLLED', 'Approved selection has no native event enrollment.');
    if (input.scope.runtime.target === 'claude-code' && !claim.nativeAgentType) return blocked('ROUTING_AGENT_TYPE_UNVERIFIED', 'Claude native agent type is not bound to the enrolled selection.');
    if (claim.actualModel === 'unverified') {
        if (!mapping.degradation.allowMissingObservedIdentity) return blocked('ROUTING_OBSERVED_IDENTITY_UNAVAILABLE', 'Actual backend model is unverified and policy does not permit operational routing.');
        return { state: 'resolved', selection: wanted, effectiveProfile, outcome: 'degraded', policyDigest: policy.contentDigest,
            capabilityDigest: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), unavailableEvidence: ['observedModelEvidence'], ...(claim.nativeAgentType ? { nativeAgentType: claim.nativeAgentType } : {}) };
    }
    if (wanted.selector.kind !== 'model' || claim.actualModel.id !== wanted.selector.id) return blocked('ROUTING_SELECTION_MISMATCH', 'Native backend model does not match the approved selection.');
    return { state: 'resolved', selection: wanted, effectiveProfile, outcome: 'native', policyDigest: policy.contentDigest,
        capabilityDigest: createHash('sha256').update(JSON.stringify(receipt)).digest('hex'), unavailableEvidence: [], ...(claim.nativeAgentType ? { nativeAgentType: claim.nativeAgentType } : {}) };
}
export function resolveEventWithFallback(input: ResolveEventSelectionInput): SelectionResolution {
    const preferred = resolveEventSelection(input);
    if ((preferred.state === 'resolved' && !input.circuitReason) || input.role !== 'implementer' || input.requestedProfile === 'full') return preferred;
    const full = resolveEventSelection({ ...input, role: 'code-quality-reviewer', requestedProfile: 'full' });
    const reason = input.circuitReason ?? (preferred.state === 'blocked' ? preferred.diagnostics[0].code : 'PROVENANCE_MISSING');
    if (full.state === 'blocked') return blocked('ROUTING_FALLBACK_UNAVAILABLE', `Optimized route ${reason} and full fallback ${full.diagnostics[0].code}; enroll the missing selection with awm model-policy setup.`);
    return { ...full, effectiveProfile: 'full', outcome: 'degraded', fallbackReason: reason };
}
export function resolveEscalatedSelection(input: ResolveSelectionInput & { requestedProfile: ImplementerProfile; expectedEffort: 'medium' | 'high' | 'runtime-default' }): SelectionResolution {
    if (!input || input.role !== 'implementer' || !['medium', 'high', 'runtime-default'].includes(input.expectedEffort)) throw new Error('escalated selection requires an implementer and a supported effort');
    const selected = resolveConfiguredSelection(input);
    if (selected.state === 'blocked') return selected;
    if (selected.fallbackReason) return selected;
    const effort = selected.selection.effort;
    if (input.expectedEffort === 'runtime-default') return effort.kind === 'runtime-default' ? selected : blocked('ROUTING_ESCALATION_EFFORT_UNAVAILABLE', 'The approved selected effort does not match runtime-default escalation.');
    if (input.requestedProfile !== 'judgment') return effort.kind === 'explicit' && effort.value === input.expectedEffort ? selected : blocked('ROUTING_ESCALATION_EFFORT_UNAVAILABLE', 'The approved selected effort does not match the next lineage escalation.');
    if (effort.kind === 'explicit' && effort.value === 'medium' && input.expectedEffort === 'medium') return selected;
    const full = resolveConfiguredSelection({ ...input, role: 'code-quality-reviewer', requestedProfile: 'full' });
    if (full.state === 'blocked') return full;
    const sameModel = full.selection.selector.kind === selected.selection.selector.kind && full.selection.selector.id === selected.selection.selector.id;
    if (!sameModel || full.selection.effort.kind !== 'explicit' || full.selection.effort.value !== 'high') return blocked('ROUTING_ESCALATION_EFFORT_UNAVAILABLE', 'Judgment high requires the same approved full-capability model at explicit high effort.');
    if (effort.kind === 'explicit' && effort.value === 'high') return selected;
    if (effort.kind === 'explicit' && effort.value === 'medium' && input.expectedEffort === 'high') return { ...full, effectiveProfile: 'judgment' };
    return blocked('ROUTING_ESCALATION_EFFORT_UNAVAILABLE', 'The approved selected effort does not match the next lineage escalation.');
}
export type V1Resolution = { state: 'not-required'; reason: 'v1-without-opt-in' } | SelectionResolution;
export type DispatchResolution = V1Resolution;
export type ResolveDispatchInput = Omit<ResolveSelectionInput, 'requestedProfile'> & { plan: Extract<PlanValidationReport, { state: 'valid' }>; sliceId?: string; optInV1: boolean };
function resolveConfiguredSelection(input: ResolveSelectionInput): SelectionResolution {
    if (input.eventReceipt !== undefined || input.eventScope !== undefined) {
        if (!input.eventReceipt || !input.eventScope) return blocked('ROUTING_EVENT_SCOPE_MISSING', 'Event-scoped routing requires both a receipt and local scope.');
        const mapping = input.policy?.content.mappings.find(item => item.target === input.eventScope?.runtime.target && item.runtimeKind === input.eventScope?.runtime.kind);
        const wanted = mapping && input.role === 'implementer' && input.requestedProfile !== 'full' ? mapping.profiles[input.requestedProfile] : undefined;
        const incident = wanted && input.circuitIncidents?.find(item => item.target === input.eventScope?.runtime.target
            && equal(item.selection, wanted)
            && ['PROVIDER_REJECTED', 'SELECTION_MISMATCH', 'PROVENANCE_MISSING'].includes(item.reasonCode));
        const circuitReason = incident?.reasonCode as ResolveEventSelectionInput['circuitReason'];
        return resolveEventWithFallback({ role: input.role, requestedProfile: input.requestedProfile, policy: input.policy, receipt: input.eventReceipt, scope: input.eventScope, now: input.now, circuitReason });
    }
    return resolveSelection(input);
}
/** Resolve only from the immutable validator report; a reopened plan may never
 * provide a routing profile after validation. */
export function resolveDispatch(input: ResolveDispatchInput): DispatchResolution {
    if (!input || typeof input !== 'object' || !input.plan) throw new Error('resolveDispatch requires a plan');
    assertVerifiedValidPlanReport(input.plan);
    const local = ['implementer', 'specification-reviewer', 'code-quality-reviewer'].includes(input.role);
    if (input.plan.schema === 'compact-slices/v1') {
        if (input.sliceId !== undefined && !input.plan.manifest.slices.some(slice => slice.id === input.sliceId)) throw new Error('routing slice does not exist in the validated plan');
        if (local && typeof input.sliceId !== 'string') throw new Error('local routing requires a slice');
        return resolveV1Dispatch(input);
    }
    if (input.role !== 'implementer') {
        if (local && (typeof input.sliceId !== 'string' || !input.plan.manifest.slices.some(slice => slice.id === input.sliceId))) throw new Error('local routing requires a valid slice');
        if (!local && input.sliceId !== undefined) throw new Error('slice is only valid for local routing');
        return resolveConfiguredSelection({ ...input, requestedProfile: 'full' });
    }
    if (typeof input.sliceId !== 'string' || input.sliceId.length === 0) throw new Error('implementer routing requires a slice');
    const slice = input.plan.manifest.slices.find(candidate => candidate.id === input.sliceId);
    if (!slice) throw new Error('routing slice does not exist in the validated plan');
    return resolveConfiguredSelection({ ...input, requestedProfile: (slice as unknown as { implementerProfile: ImplementerProfile }).implementerProfile });
}
export function resolveV1Dispatch(input: Omit<ResolveSelectionInput, 'requestedProfile'> & { plan: Extract<PlanValidationReport, { state: 'valid' }>; optInV1: boolean }): V1Resolution {
    if (!input.plan || input.plan.schema !== 'compact-slices/v1') throw new Error('resolveV1Dispatch requires an authenticated v1 plan report');
    assertVerifiedValidPlanReport(input.plan);
    if (!input.optInV1) return { state: 'not-required', reason: 'v1-without-opt-in' };
    return resolveConfiguredSelection({ ...input, requestedProfile: 'full' });
}
function equal(left: Selection, right: Selection): boolean { return left.selector.kind === right.selector.kind && left.selector.id === right.selector.id && left.effort.kind === right.effort.kind && (left.effort.kind !== 'explicit' || left.effort.value === (right.effort as { kind: 'explicit'; value: string }).value); }
function blocked(code: string, message: string): SelectionResolution { return { state: 'blocked', diagnostics: [routingDiagnostic(code, message)] }; }
export function resolveSelection(input: ResolveSelectionInput): SelectionResolution {
    if (!input || typeof input !== 'object' || !input.runtime || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new Error('resolveSelection requires a runtime and finite clock');
    if (!['implementer', 'specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'architecture', 'track-a-qa', 'track-b-qa', 'controller', 'documentation', 'retro', 'finishing'].includes(input.role)) throw new Error('resolveSelection role is invalid');
    if (!['mechanical', 'integration', 'judgment', 'full'].includes(input.requestedProfile)) throw new Error('resolveSelection requestedProfile is invalid');
    if (!input.policy) return blocked('ROUTING_POLICY_ABSENT', 'A digest-bound approved routing policy is required.');
    if (!input.capabilities) return blocked('ROUTING_CAPABILITY_ABSENT', 'A current capability receipt is required.');
    let policy: ApprovedPolicy; let capabilities: CapabilityReceipt;
    try { policy = validateApprovedPolicy(input.policy); } catch { return blocked('ROUTING_POLICY_INVALID', 'Approved routing policy is corrupt.'); }
    try { capabilities = validateCapabilityReceipt(input.capabilities); } catch { return blocked('ROUTING_CAPABILITY_INVALID', 'Capability receipt is corrupt.'); }
    if (!receiptIsCurrent(capabilities, input.runtime, input.now)) return blocked('ROUTING_CAPABILITY_RUNTIME_MISMATCH', 'Capability receipt does not match the current runtime or is stale.');
    const mapping = policy.content.mappings.find(row => row.target === input.runtime.target && row.runtimeKind === input.runtime.kind);
    if (!mapping) return blocked('ROUTING_POLICY_MAPPING_ABSENT', 'Approved policy has no exact target/runtime mapping.');
    const effectiveProfile = input.role === 'implementer' ? input.requestedProfile : 'full';
    const wanted = effectiveProfile === 'full' ? mapping.fullCapability : mapping.profiles[effectiveProfile];
    let selection = wanted; const unavailableEvidence: string[] = []; let outcome: 'native' | 'degraded' = 'native';
    // Surrendering the model means the runtime picks, so the only safe landing
    // place is the attested runtime default, and it must be the approved full
    // capability. Surrendering the EFFORT is a narrower loss and is handled
    // separately below: collapsing to fullCapability there would throw away a
    // model override the runtime demonstrably honours.
    const degradeModel = (): SelectionResolution | undefined => {
        const state = capabilities.capabilities.modelOverride;
        if (state === 'supported') return undefined;
        if (state === 'unverified') return blocked('ROUTING_MODEL_OVERRIDE_UNAVAILABLE', 'modelOverride is unverified.');
        if (!mapping.degradation.allowMissingModelOverride || !capabilities.runtimeDefaultSelection || !equal(capabilities.runtimeDefaultSelection, mapping.fullCapability)) return blocked('ROUTING_MODEL_OVERRIDE_UNAVAILABLE', 'modelOverride is unavailable and no matching approved full default is attested.');
        selection = mapping.fullCapability; outcome = 'degraded'; unavailableEvidence.push('modelOverride'); return undefined;
    };
    // Degrading effort surrenders the effort component ONLY, keeping the routed
    // model. On a runtime where the model can be overridden but reasoning effort
    // cannot — effort belongs to the agent definition, not the invocation — the
    // alternative was to route every profile to the full-capability model, so a
    // mechanical slice would quietly run the judgment model while the diagnostic
    // spoke only of effort. That is the silent defaulting the consumer reference
    // forbids. The model at runtime-default effort must itself be attested.
    const degradeEffort = (): SelectionResolution | undefined => {
        const state = capabilities.capabilities.effortOverride;
        if (state === 'supported') return undefined;
        if (state === 'unverified') return blocked('ROUTING_EFFORT_OVERRIDE_UNAVAILABLE', 'effortOverride is unverified.');
        if (!mapping.degradation.allowMissingEffortOverride) return blocked('ROUTING_EFFORT_OVERRIDE_UNAVAILABLE', 'effortOverride is unavailable and the mapping does not allow degrading it.');
        const degraded: Selection = { selector: selection.selector, effort: { kind: 'runtime-default' } };
        if (!capabilities.runtimeDefaultSelection || !capabilities.availableSelections.some(candidate => equal(candidate, degraded))) return blocked('ROUTING_EFFORT_OVERRIDE_UNAVAILABLE', 'effortOverride is unavailable and the routed model at runtime-default effort is not attested.');
        selection = degraded; outcome = 'degraded'; unavailableEvidence.push('effortOverride'); return undefined;
    };
    const model = degradeModel(); if (model) return model;
    if (selection.effort.kind === 'explicit') { const effort = degradeEffort(); if (effort) return effort; }
    // availableSelections is the receipt's attestation of what can actually be
    // chosen, so it is checked on the FINAL selection, after any degradation
    // rewrote it. Checking it first forced a runtime that cannot honour explicit
    // effort to attest selections it could never run, purely to reach the
    // degradation that would then discard them — the honest receipt was the one
    // that failed.
    if (!capabilities.availableSelections.some(candidate => equal(candidate, selection))) return blocked('ROUTING_SELECTION_UNAVAILABLE', 'Approved selection is not currently available; no substitute is allowed.');
    // A runtime-default effort is only meaningful if the receipt declares what the
    // runtime default is. It need NOT equal this selection: requiring that made
    // every per-profile selection unreachable on a runtime whose default model
    // differs, even with modelOverride attested supported and the selection
    // itself attested available. Attesting `haiku at runtime-default effort` is
    // precisely the statement that the model may be overridden while effort is
    // left alone.
    if (selection.effort.kind === 'runtime-default' && !capabilities.runtimeDefaultSelection) return blocked('ROUTING_SELECTION_UNAVAILABLE', 'Runtime-default selection is not explicitly attested.');
    if (capabilities.capabilities.observedModelEvidence !== 'supported') {
        if (!mapping.degradation.allowMissingObservedIdentity) return blocked('ROUTING_OBSERVED_IDENTITY_UNAVAILABLE', 'Observed model identity is required and unavailable.');
        outcome = 'degraded'; unavailableEvidence.push('observedModelEvidence');
    }
    return { state: 'resolved', selection, effectiveProfile, outcome, policyDigest: policy.contentDigest, capabilityDigest: capabilityReceiptDigest(capabilities), unavailableEvidence };
}
