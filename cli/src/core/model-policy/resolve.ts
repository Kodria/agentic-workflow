import type { PlanDiagnostic } from '../plan/types';
import { capabilityReceiptDigest, receiptIsCurrent, routingDiagnostic } from './capabilities';
import type { ApprovedPolicy, CapabilityReceipt, ImplementerProfile, RoutingRole, RuntimeKey, Selection } from './types';

export type SelectionResolution = { state: 'resolved'; selection: Selection; effectiveProfile: ImplementerProfile | 'full'; outcome: 'native' | 'degraded'; policyDigest: string; capabilityDigest: string; unavailableEvidence: string[] } | { state: 'blocked'; diagnostics: PlanDiagnostic[] };
export type ResolveSelectionInput = { role: RoutingRole; requestedProfile: ImplementerProfile | 'full'; policy?: ApprovedPolicy; capabilities?: CapabilityReceipt; runtime: RuntimeKey; now: Date };
function equal(left: Selection, right: Selection): boolean { return left.selector.kind === right.selector.kind && left.selector.id === right.selector.id && left.effort.kind === right.effort.kind && (left.effort.kind !== 'explicit' || left.effort.value === (right.effort as { kind: 'explicit'; value: string }).value); }
function blocked(code: string, message: string): SelectionResolution { return { state: 'blocked', diagnostics: [routingDiagnostic(code, message)] }; }
export function resolveSelection(input: ResolveSelectionInput): SelectionResolution {
    if (!input || typeof input !== 'object' || !input.runtime || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) throw new Error('resolveSelection requires a runtime and finite clock');
    if (!input.policy) return blocked('ROUTING_POLICY_ABSENT', 'A digest-bound approved routing policy is required.');
    if (!input.capabilities) return blocked('ROUTING_CAPABILITY_ABSENT', 'A current capability receipt is required.');
    if (!receiptIsCurrent(input.capabilities, input.runtime, input.now)) return blocked('ROUTING_CAPABILITY_RUNTIME_MISMATCH', 'Capability receipt does not match the current runtime or is stale.');
    const mapping = input.policy.content.mappings.find(row => row.target === input.runtime.target && row.runtimeKind === input.runtime.kind);
    if (!mapping) return blocked('ROUTING_POLICY_MAPPING_ABSENT', 'Approved policy has no exact target/runtime mapping.');
    const effectiveProfile = input.role === 'implementer' ? input.requestedProfile : 'full';
    const wanted = effectiveProfile === 'full' ? mapping.fullCapability : mapping.profiles[effectiveProfile];
    if (!input.capabilities.availableSelections.some(candidate => equal(candidate, wanted))) return blocked('ROUTING_SELECTION_UNAVAILABLE', 'Approved selection is not currently available; no substitute is allowed.');
    let selection = wanted; const unavailableEvidence: string[] = []; let outcome: 'native' | 'degraded' = 'native';
    const canDegrade = (capability: 'modelOverride' | 'effortOverride', allowed: boolean, code: string): SelectionResolution | undefined => {
        const state = input.capabilities!.capabilities[capability];
        if (state === 'supported') return undefined;
        if (state === 'unverified') return blocked(code, `${capability} is unverified.`);
        if (!allowed || !input.capabilities!.runtimeDefaultSelection || !equal(input.capabilities!.runtimeDefaultSelection, mapping.fullCapability)) return blocked(code, `${capability} is unavailable and no matching approved full default is attested.`);
        selection = mapping.fullCapability; outcome = 'degraded'; unavailableEvidence.push(capability); return undefined;
    };
    const model = canDegrade('modelOverride', mapping.degradation.allowMissingModelOverride, 'ROUTING_MODEL_OVERRIDE_UNAVAILABLE'); if (model) return model;
    const effort = canDegrade('effortOverride', mapping.degradation.allowMissingEffortOverride, 'ROUTING_EFFORT_OVERRIDE_UNAVAILABLE'); if (effort) return effort;
    if (input.capabilities.capabilities.observedModelEvidence !== 'supported') {
        if (!mapping.degradation.allowMissingObservedIdentity) return blocked('ROUTING_OBSERVED_IDENTITY_UNAVAILABLE', 'Observed model identity is required and unavailable.');
        outcome = 'degraded'; unavailableEvidence.push('observedModelEvidence');
    }
    return { state: 'resolved', selection, effectiveProfile, outcome, policyDigest: input.policy.contentDigest, capabilityDigest: capabilityReceiptDigest(input.capabilities), unavailableEvidence };
}
