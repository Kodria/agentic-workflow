import type { PlanDiagnostic } from '../plan/types';
import { capabilityReceiptDigest, receiptIsCurrent, routingDiagnostic, validateCapabilityReceipt } from './capabilities';
import type { ApprovedPolicy, CapabilityReceipt, ImplementerProfile, RoutingRole, RuntimeKey, Selection } from './types';
import { validateApprovedPolicy } from './validate';
import { assertVerifiedValidPlanReport } from '../plan/validate';
import type { PlanValidationReport } from '../plan/types';

export type SelectionResolution = { state: 'resolved'; selection: Selection; effectiveProfile: ImplementerProfile | 'full'; outcome: 'native' | 'degraded'; policyDigest: string; capabilityDigest: string; unavailableEvidence: string[] } | { state: 'blocked'; diagnostics: PlanDiagnostic[] };
export type ResolveSelectionInput = { role: RoutingRole; requestedProfile: ImplementerProfile | 'full'; policy?: ApprovedPolicy; capabilities?: CapabilityReceipt; runtime: RuntimeKey; now: Date };
export type V1Resolution = { state: 'not-required'; reason: 'v1-without-opt-in' } | SelectionResolution;
export type DispatchResolution = V1Resolution;
export type ResolveDispatchInput = Omit<ResolveSelectionInput, 'requestedProfile'> & { plan: Extract<PlanValidationReport, { state: 'valid' }>; sliceId?: string; optInV1: boolean };
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
        return resolveSelection({ ...input, requestedProfile: 'full' });
    }
    if (typeof input.sliceId !== 'string' || input.sliceId.length === 0) throw new Error('implementer routing requires a slice');
    const slice = input.plan.manifest.slices.find(candidate => candidate.id === input.sliceId);
    if (!slice) throw new Error('routing slice does not exist in the validated plan');
    return resolveSelection({ ...input, requestedProfile: (slice as unknown as { implementerProfile: ImplementerProfile }).implementerProfile });
}
export function resolveV1Dispatch(input: Omit<ResolveSelectionInput, 'requestedProfile'> & { plan: Extract<PlanValidationReport, { state: 'valid' }>; optInV1: boolean }): V1Resolution {
    if (!input.plan || input.plan.schema !== 'compact-slices/v1') throw new Error('resolveV1Dispatch requires an authenticated v1 plan report');
    assertVerifiedValidPlanReport(input.plan);
    if (!input.optInV1) return { state: 'not-required', reason: 'v1-without-opt-in' };
    return resolveSelection({ ...input, requestedProfile: 'full' });
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
    const canDegrade = (capability: 'modelOverride' | 'effortOverride', allowed: boolean, code: string): SelectionResolution | undefined => {
        const state = capabilities.capabilities[capability];
        if (state === 'supported') return undefined;
        if (state === 'unverified') return blocked(code, `${capability} is unverified.`);
        if (!allowed || !capabilities.runtimeDefaultSelection || !equal(capabilities.runtimeDefaultSelection, mapping.fullCapability)) return blocked(code, `${capability} is unavailable and no matching approved full default is attested.`);
        selection = mapping.fullCapability; outcome = 'degraded'; unavailableEvidence.push(capability); return undefined;
    };
    const model = canDegrade('modelOverride', mapping.degradation.allowMissingModelOverride, 'ROUTING_MODEL_OVERRIDE_UNAVAILABLE'); if (model) return model;
    if (!capabilities.availableSelections.some(candidate => equal(candidate, selection))) return blocked('ROUTING_SELECTION_UNAVAILABLE', 'Approved selection is not currently available; no substitute is allowed.');
    if (selection.effort.kind === 'runtime-default') {
        if (!capabilities.runtimeDefaultSelection || !equal(capabilities.runtimeDefaultSelection, selection)) return blocked('ROUTING_SELECTION_UNAVAILABLE', 'Runtime-default selection is not explicitly attested.');
    } else {
        const effort = canDegrade('effortOverride', mapping.degradation.allowMissingEffortOverride, 'ROUTING_EFFORT_OVERRIDE_UNAVAILABLE'); if (effort) return effort;
    }
    if (capabilities.capabilities.observedModelEvidence !== 'supported') {
        if (!mapping.degradation.allowMissingObservedIdentity) return blocked('ROUTING_OBSERVED_IDENTITY_UNAVAILABLE', 'Observed model identity is required and unavailable.');
        outcome = 'degraded'; unavailableEvidence.push('observedModelEvidence');
    }
    return { state: 'resolved', selection, effectiveProfile, outcome, policyDigest: policy.contentDigest, capabilityDigest: capabilityReceiptDigest(capabilities), unavailableEvidence };
}
