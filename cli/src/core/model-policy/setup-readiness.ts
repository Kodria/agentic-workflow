import type { AgentTarget } from '../../providers';
import type { EffectivePolicy, PolicyMapping } from './types';
import { readBoundedCandidate } from './store';
import { receiptIsCurrent, storedCapabilityPath, validateCapabilityReceipt } from './capabilities';
import { parseJsonNoDuplicate } from '../plan/json';
import { readStoredEventReceipt } from './event-store';
import { evaluateEventReceipt } from './capabilities-v2';
import { selectionPolicyDigest } from './selection-policy-digest';

export type RoutingSetupGuidance =
    | { target: AgentTarget; runtimeKind: string; state: 'needs-evidence'; command: string }
    | { target: AgentTarget; runtimeKind: string; state: 'coverage-only' }
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

/** Passive diagnostics can check sealed coverage, but only dispatch recomputes
 * runtime/account/config fingerprints. No provider process runs here. */
function locallyEnrolledEvent(mapping: PolicyMapping, now: Date, reader: typeof readStoredEventReceipt): 'absent' | 'covered' | 'uncovered' | 'invalid' {
    if (mapping.target !== 'codex' && mapping.target !== 'claude-code') return 'absent';
    try {
        const stored = reader({ target: mapping.target, kind: mapping.runtimeKind, version: '0.0.0', accountScopeDigest: '0'.repeat(64) });
        if (stored.state !== 'present') return stored.state;
        const receipt = stored.receipt;
        if (receipt.runtime.target !== mapping.target || receipt.runtime.kind !== mapping.runtimeKind) return 'uncovered';
        const scope = { runtime: receipt.runtime, binaryDigest: receipt.binaryDigest, configDigest: receipt.configDigest };
        const selections = [...Object.values(mapping.profiles), mapping.fullCapability];
        return selections.every(selected => {
            const current = evaluateEventReceipt(receipt, scope, selected, selectionPolicyDigest(mapping, selected), now);
            if (current.state !== 'current') return false;
            const claim = receipt.claims.find(item => JSON.stringify(item.selection) === JSON.stringify(selected));
            return claim !== undefined && (claim.actualModel !== 'unverified' || mapping.degradation.allowMissingObservedIdentity);
        }) ? 'covered' : 'uncovered';
    } catch { return 'invalid'; }
}

export function routingSetupGuidance(policy: EffectivePolicy, now: Date = new Date(), deps: { readStoredEventReceipt?: typeof readStoredEventReceipt } = {}): RoutingSetupGuidance[] {
    if (!policy || typeof policy !== 'object' || !('state' in policy)) throw new Error('routing policy state is invalid');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('routing setup clock must be finite');
    if (policy.state === 'absent') return [];
    if (policy.state === 'invalid') {
        if (typeof policy.reason !== 'string' || policy.reason.length === 0 || policy.reason.length > 4096) throw new Error('routing policy invalid reason is malformed');
        return [{ state: 'policy-invalid', reason: policy.reason }];
    }
    if (policy.state !== 'approved' || !policy.policy || !Array.isArray(policy.policy.content?.mappings)) throw new Error('approved routing policy state is malformed');
    return policy.policy.content.mappings.flatMap<RoutingSetupGuidance>(mapping => {
        if (typeof mapping.target !== 'string' || typeof mapping.runtimeKind !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(mapping.runtimeKind)) throw new Error('routing policy mapping is malformed');
        const event = locallyEnrolledEvent(mapping, now, deps.readStoredEventReceipt ?? readStoredEventReceipt);
        if (event === 'covered') return [{ target: mapping.target, runtimeKind: mapping.runtimeKind, state: 'coverage-only' as const }];
        if (event === 'absent' && locallyCurrentReceipt(mapping, now)) return [];
        return [{ target: mapping.target, runtimeKind: mapping.runtimeKind, state: 'needs-evidence' as const, command: `awm model-policy setup --provider ${mapping.target} --json` }];
    });
}
