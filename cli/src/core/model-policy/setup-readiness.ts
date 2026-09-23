import type { AgentTarget } from '../../providers';
import type { EffectivePolicy, PolicyMapping } from './types';
import { readBoundedCandidate } from './store';
import { receiptIsCurrent, storedCapabilityPath, validateCapabilityReceipt } from './capabilities';
import { parseJsonNoDuplicate } from '../plan/json';

export type RoutingSetupGuidance =
    | { target: AgentTarget; runtimeKind: string; state: 'needs-evidence'; command: string }
    | { state: 'policy-invalid'; reason: string };

/** Local guidance only: no provider process, inference, approval or filesystem write. */
function locallyCurrentReceipt(mapping: PolicyMapping, now: Date): boolean {
    try {
        const raw = readBoundedCandidate(storedCapabilityPath(mapping.target, mapping.runtimeKind));
        if (raw === null) return false;
        const receipt = validateCapabilityReceipt(parseJsonNoDuplicate(raw));
        const caps = receipt.capabilities;
        return receipt.runtime.target === mapping.target && receipt.runtime.kind === mapping.runtimeKind
            && receiptIsCurrent(receipt, receipt.runtime, now)
            && caps.nativeSubagents === 'supported' && caps.modelOverride === 'supported' && caps.effortOverride === 'supported'
            && (caps.observedModelEvidence === 'supported' || mapping.degradation.allowMissingObservedIdentity);
    } catch { return false; }
}

export function routingSetupGuidance(policy: EffectivePolicy, now: Date = new Date()): RoutingSetupGuidance[] {
    if (!policy || typeof policy !== 'object' || !('state' in policy)) throw new Error('routing policy state is invalid');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('routing setup clock must be finite');
    if (policy.state === 'absent') return [];
    if (policy.state === 'invalid') {
        if (typeof policy.reason !== 'string' || policy.reason.length === 0 || policy.reason.length > 4096) throw new Error('routing policy invalid reason is malformed');
        return [{ state: 'policy-invalid', reason: policy.reason }];
    }
    if (policy.state !== 'approved' || !policy.policy || !Array.isArray(policy.policy.content?.mappings)) throw new Error('approved routing policy state is malformed');
    return policy.policy.content.mappings.flatMap(mapping => {
        if (typeof mapping.target !== 'string' || typeof mapping.runtimeKind !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(mapping.runtimeKind)) throw new Error('routing policy mapping is malformed');
        if (locallyCurrentReceipt(mapping, now)) return [];
        return [{ target: mapping.target, runtimeKind: mapping.runtimeKind, state: 'needs-evidence' as const, command: `awm model-policy discover --provider ${mapping.target} --json` }];
    });
}
