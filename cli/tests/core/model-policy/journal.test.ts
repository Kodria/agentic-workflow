import { emptyState, isRoutingEnvelope } from '../../../src/core/journal/types';
import { observeRoutingAttempt, reserveRoutingAttempt, routingReport, resolveLineageEscalation } from '../../../src/core/model-policy/journal';
import { capabilityReceiptDigest } from '../../../src/core/model-policy/capabilities';
import { routingApproval as approval, routingEnvelope as envelope, routingSelection as selection } from '../../helpers/routing-approval';
import { selectionPolicyDigest } from '../../../src/core/model-policy/selection-policy-digest';
import { resolveEventWithFallback } from '../../../src/core/model-policy/resolve';
import type { EventReceipt } from '../../../src/core/model-policy/capabilities-v2';

describe('routing journal helpers', () => {
    it('reserves one idempotent attempt and records native observation', () => {
        const state = emptyState('main');
        const reserved = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z');
        const replay = reserveRoutingAttempt(reserved.state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:01:00.000Z');
        expect(replay.attemptId).toBe(reserved.attemptId);
        const observed = observeRoutingAttempt(replay.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-1' }, '2026-09-17T00:02:00.000Z');
        expect(observed.routingAttempts?.[0]).toMatchObject({ state: 'active', nativeAgentId: 'native-1' });
    });
    it('persists a mismatch as one alertable blocked incident without renewing capability', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope,
            fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        const attemptId = state.routingAttempts![0].id;
        const mismatched = observeRoutingAttempt(state, { attemptId, nativeAgentId: 'native-1', observed: { ...selection('high'), selector: { kind: 'model', id: 'different' } } }, '2026-09-17T00:02:00.000Z');
        expect(mismatched.routingAttempts?.[0]).toMatchObject({ state: 'blocked', verdict: 'inconclusive', reasonCode: 'SELECTION_MISMATCH' });
        expect(mismatched.routingIncidents).toMatchObject([{ reasonCode: 'SELECTION_MISMATCH', blockedCount: 1, fallbackCount: 0, alertState: 'pending' }]);
        expect(observeRoutingAttempt(mismatched, { attemptId, nativeAgentId: 'native-1', observed: { ...selection('high'), selector: { kind: 'model', id: 'different' } } }, '2026-09-17T00:03:00.000Z')).toEqual(mismatched);
        expect(state.routingIncidents).toBeUndefined();
    });
    it('persists missing native provenance as a blocked incident, not an active optimized attempt', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope,
            fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        const attemptId = state.routingAttempts![0].id;
        const missing = observeRoutingAttempt(state, { attemptId, nativeAgentId: 'native-1', unavailableReason: 'PROVENANCE_MISSING' }, '2026-09-17T00:02:00.000Z');
        expect(missing.routingAttempts?.[0]).toMatchObject({ state: 'blocked', verdict: 'inconclusive', reasonCode: 'PROVENANCE_MISSING' });
        expect(missing.routingIncidents).toMatchObject([{ reasonCode: 'PROVENANCE_MISSING', blockedCount: 1, alertState: 'pending' }]);
    });
    it('reserves a separately proved full fallback and records why optimization was skipped', () => {
        const approved = approval(); approved.policy.content.mappings[0].degradation.allowMissingObservedIdentity = true;
        const eventScope = { runtime: envelope.runtime, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) };
        const full = approved.policy.content.mappings[0].fullCapability;
        const eventReceipt: EventReceipt = { schema: 'routing-capabilities/v2', ...eventScope, recordedAt: '2026-09-17T00:00:00.000Z', claims: [{ selection: full,
            mappingDigest: selectionPolicyDigest(approved.policy.content.mappings[0], full), eventDigest: 'e'.repeat(64), source: 'codex-turn-context',
            observedAt: '2026-09-17T00:00:00.000Z', actualModel: 'unverified', tokenUsage: 'unknown' }] };
        const result = resolveEventWithFallback({ role: 'implementer', requestedProfile: 'mechanical', policy: approved.policy, receipt: eventReceipt, scope: eventScope, now: approved.checkedAt });
        if (result.state !== 'resolved') throw new Error('full fallback must resolve');
        const routed = { ...envelope, effectiveProfile: 'full' as const, resolved: full, outcome: result.outcome, unavailableEvidence: result.unavailableEvidence,
            capabilityDigest: result.capabilityDigest };
        const reserved = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: routed,
            fingerprint: 'f'.repeat(64), approval: () => ({ policy: approved.policy, eventReceipt, eventScope, checkedAt: approved.checkedAt }) }, '2026-09-17T00:00:00.000Z');
        expect(reserved.state.routingAttempts?.[0]).toMatchObject({ state: 'reserved', reasonCode: 'ROUTING_SELECTION_UNENROLLED', envelope: { effectiveProfile: 'full' } });
        expect(routingReport(reserved.state)).toMatchObject({ fallbacks: 1, unavailable: { observedModelEvidence: 1, ROUTING_SELECTION_UNENROLLED: 1 } });
        expect(reserved.state.routingIncidents).toMatchObject([{ reasonCode: 'ROUTING_SELECTION_UNENROLLED', affectedObligations: 1, fallbackCount: 1, blockedCount: 0, alertState: 'pending' }]);
        expect(routingReport(reserved.state)).toMatchObject({ incidents: [expect.objectContaining({ reasonCode: 'ROUTING_SELECTION_UNENROLLED', fallbackCount: 1, alertState: 'pending' })] });
    });
    it('reserves verified full capability after an optimized provider rejection in the same lineage', () => {
        const approved = approval(); approved.policy.content.mappings[0].degradation.allowMissingObservedIdentity = true;
        const mapping = approved.policy.content.mappings[0];
        const eventScope = { runtime: envelope.runtime, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) };
        const eventReceipt: EventReceipt = { schema: 'routing-capabilities/v2', ...eventScope, recordedAt: '2026-09-17T00:00:00.000Z', claims:
            [mapping.profiles.mechanical, mapping.fullCapability].map(selected => ({ selection: selected,
                mappingDigest: selectionPolicyDigest(mapping, selected), eventDigest: 'e'.repeat(64), source: 'codex-turn-context',
                observedAt: '2026-09-17T00:00:00.000Z', actualModel: 'unverified', tokenUsage: 'unknown' })) };
        const approvalSnapshot = () => ({ policy: approved.policy, eventReceipt, eventScope, checkedAt: approved.checkedAt });
        const preferred = resolveEventWithFallback({ role: 'implementer', requestedProfile: 'mechanical', policy: approved.policy,
            receipt: eventReceipt, scope: eventScope, now: approved.checkedAt });
        if (preferred.state !== 'resolved') throw new Error('preferred selection should be enrolled');
        const firstEnvelope = { ...envelope, outcome: preferred.outcome, unavailableEvidence: preferred.unavailableEvidence, capabilityDigest: preferred.capabilityDigest };
        const first = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: firstEnvelope,
            fingerprint: 'e'.repeat(64), approval: approvalSnapshot }, '2026-09-17T12:00:00.000Z');
        expect(first.state.routingAttempts?.[0]).toMatchObject({ nativeEvidenceRequired: true, reservedAt: '2026-09-17T12:00:00.000Z' });
        const rejected = observeRoutingAttempt(first.state, { attemptId: first.attemptId, nativeAgentId: 'native-1', unavailableReason: 'PROVIDER_REJECTED' }, '2026-09-17T12:01:00.000Z');
        const fallback = resolveEventWithFallback({ role: 'implementer', requestedProfile: 'mechanical', policy: approved.policy,
            receipt: eventReceipt, scope: eventScope, now: approved.checkedAt, circuitReason: 'PROVIDER_REJECTED' });
        if (fallback.state !== 'resolved') throw new Error('full capability should be enrolled');
        const fullEnvelope = { ...firstEnvelope, effectiveProfile: 'full' as const, resolved: fallback.selection, outcome: fallback.outcome,
            unavailableEvidence: fallback.unavailableEvidence, capabilityDigest: fallback.capabilityDigest };
        const second = reserveRoutingAttempt(rejected, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: fullEnvelope,
            fingerprint: 'f'.repeat(64), approval: approvalSnapshot }, '2026-09-17T12:02:00.000Z');
        expect(second.state.routingAttempts?.map(item => item.state)).toEqual(['blocked', 'reserved']);
        expect(routingReport(second.state)).toMatchObject({ fallbacks: 1, incidents: [expect.objectContaining({ reasonCode: 'PROVIDER_REJECTED', affectedObligations: 1, fallbackCount: 1, blockedCount: 1 })] });
    });
    it('reserves an initial mechanical attempt at its approved explicit high effort', () => {
        const high = { ...envelope, resolved: { ...envelope.resolved, effort: { kind: 'explicit' as const, value: 'high' } } };
        expect(() => reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: high, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z')).toThrow(/approval/i);
        const approved = approval();
        approved.policy.content.mappings[0].profiles.mechanical = selection('high');
        const reserved = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: high, fingerprint: 'e'.repeat(64), approval: () => approved }, '2026-09-17T00:00:00.000Z');
        expect(reserved.state.implementationLineages?.[0].initialEffort).toBe('high');
    });
    it('reserves the approved high-effort judgment profile after a failed integration attempt', () => {
        const integration = { ...envelope, requestedProfile: 'integration' as const, effectiveProfile: 'integration' as const };
        const first = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: integration, fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        first.routingAttempts![0].state = 'blocked';
        first.routingAttempts![0].verdict = 'fail';
        const judgment = { ...integration, effectiveProfile: 'judgment' as const, resolved: { ...integration.resolved, effort: { kind: 'explicit' as const, value: 'high' } } };
        const approved = approval();
        const second = reserveRoutingAttempt(first, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: { ...judgment, capabilityDigest: capabilityReceiptDigest(approved.capabilities) }, fingerprint: 'f'.repeat(64), approval: () => approved }, '2026-09-17T00:01:00.000Z').state;
        expect(second.routingAttempts?.[1].envelope.resolved).toEqual(judgment.resolved);
    });
    it('rejects judgment high without current matching approval at reservation', () => {
        const integration = { ...envelope, requestedProfile: 'integration' as const, effectiveProfile: 'integration' as const };
        const first = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: integration, fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        first.routingAttempts![0].state = 'blocked'; first.routingAttempts![0].verdict = 'fail';
        const high = { ...integration, effectiveProfile: 'judgment' as const, resolved: selection('high') };
        const input = { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: high, fingerprint: 'f'.repeat(64) };
        expect(() => reserveRoutingAttempt(first, input, '2026-09-17T00:01:00.000Z')).toThrow(/approval/i);
        const approved = approval();
        expect(() => reserveRoutingAttempt(first, { ...input, envelope: { ...high, capabilityDigest: 'b'.repeat(64) }, approval: () => approved }, '2026-09-17T00:01:00.000Z')).toThrow(/approval/i);
        const stale = { ...approved, checkedAt: new Date('2026-09-19T00:00:00.000Z') };
        expect(() => reserveRoutingAttempt(first, { ...input, envelope: { ...high, capabilityDigest: capabilityReceiptDigest(approved.capabilities) }, approval: () => stale }, '2026-09-17T00:01:00.000Z')).toThrow(/approval/i);
    });
    it('reserves judgment high after a failed judgment medium attempt without resetting the lineage', () => {
        const judgment = { ...envelope, requestedProfile: 'judgment' as const, effectiveProfile: 'judgment' as const };
        const first = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: judgment, fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        first.routingAttempts![0].state = 'blocked';
        first.routingAttempts![0].verdict = 'fail';
        const high = { ...judgment, resolved: { ...judgment.resolved, effort: { kind: 'explicit' as const, value: 'high' } } };
        const approved = approval();
        const second = reserveRoutingAttempt(first, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: { ...high, capabilityDigest: capabilityReceiptDigest(approved.capabilities) }, fingerprint: 'f'.repeat(64), approval: () => approved }, '2026-09-17T00:01:00.000Z').state;
        expect(second.routingAttempts?.[1]).toMatchObject({ attempt: 2, envelope: { effectiveProfile: 'judgment', resolved: high.resolved } });
    });
    it('rejects a fourth implementer attempt in one lineage', () => {
        let state = emptyState('main');
        for (const [index, profile] of (['mechanical', 'integration', 'judgment'] as const).entries()) { state = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: { ...envelope, effectiveProfile: profile }, fingerprint: `${'a'.repeat(63)}${index}`, approval }, '2026-09-17T00:00:00.000Z').state; state.routingAttempts![state.routingAttempts!.length - 1].state = 'blocked'; state.routingAttempts![state.routingAttempts!.length - 1].verdict = 'fail'; }
        expect(() => reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'f'.repeat(64) }, '2026-09-17T00:00:00.000Z')).toThrow(/budget/i);
    });
    it('reports routing attempts without envelope bodies or native identities', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        expect(routingReport(state)).toEqual({ schema: 'routing-report/v1', attempts: 1, plannedByRole: { implementer: 1 }, actualByRole: {}, selections: [{ role: 'implementer', configured: envelope.resolved, accepted: 'unknown', backendModel: 'unknown' }], byState: { reserved: 1 }, retries: 0, fallbacks: 0, unavailable: {}, verdicts: {}, administrativeRepairs: 0,
            measurement: { configuredSelection: 'envelope-recorded', acceptedSelection: 'not-natively-reconciled', backendModel: 'unknown', tokenUsage: 'unknown', savings: 'unverified' } });
    });
    it('reports a sealed native reconciliation separately from backend identity and savings', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope,
            fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        state.routingAttempts![0].nativeEventDigest = 'f'.repeat(64);
        state.routingAttempts![0].nativeAgentId = 'child-1';
        state.routingAttempts![0].observed = envelope.resolved;
        state.routingAttempts![0].state = 'active';
        expect(routingReport(state)).toMatchObject({ nativeReconciledByRole: { implementer: 1 },
            selections: [{ role: 'implementer', configured: envelope.resolved, accepted: envelope.resolved, backendModel: 'unknown' }],
            measurement: { acceptedSelection: 'natively-reconciled', backendModel: 'unknown', tokenUsage: 'unknown', savings: 'unverified' } });
    });
    it('reports a provider-reported Claude model only after native reconciliation', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope,
            fingerprint: 'e'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        state.routingAttempts![0].nativeEventDigest = 'f'.repeat(64);
        state.routingAttempts![0].nativeAgentId = 'child-1';
        state.routingAttempts![0].observed = envelope.resolved;
        state.routingAttempts![0].observedBackendModel = 'claude-example-model';
        state.routingAttempts![0].state = 'active';
        expect(routingReport(state)).toMatchObject({ selections: [{ backendModel: 'claude-example-model' }],
            measurement: { backendModel: 'provider-reported' } });
    });
    it('uses the exact deterministic implementation escalation sequence', () => {
        let state = emptyState('main');
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'mechanical', effort: 'medium' });
        state = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'l1', envelope, fingerprint: '1'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        state.routingAttempts![0].state = 'blocked'; state.routingAttempts![0].verdict = 'fail';
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'integration', effort: 'medium' });
        state.routingAttempts!.push({ ...state.routingAttempts![0], id: 'route-2', attempt: 2, envelope: { ...envelope, effectiveProfile: 'integration' }, state: 'blocked', verdict: 'fail' });
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'judgment', effort: 'medium' });
        state.routingAttempts!.push({ ...state.routingAttempts![0], id: 'route-3', attempt: 3, envelope: { ...envelope, effectiveProfile: 'judgment', resolved: { selector: { kind: 'model', id: 'm' }, effort: { kind: 'explicit', value: 'medium' } } }, state: 'blocked', verdict: 'fail' });
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'judgment', effort: 'high' });
        state.routingAttempts![2].envelope = { ...state.routingAttempts![2].envelope, resolved: { selector: { kind: 'model', id: 'm' }, effort: { kind: 'explicit', value: 'high' } } };
        expect(() => resolveLineageEscalation(state, 'l1', 'mechanical')).toThrow(/exhausted/i);
    });
    it('returns the initial route for a native rejection so the full fallback can resolve', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'l1', envelope,
            fingerprint: '1'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        state.routingAttempts![0].state = 'blocked';
        state.routingAttempts![0].verdict = 'inconclusive';
        state.routingAttempts![0].reasonCode = 'PROVIDER_REJECTED';
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'mechanical', effort: 'medium' });
        state.routingAttempts![0].envelope.effectiveProfile = 'full';
        expect(() => resolveLineageEscalation(state, 'l1', 'mechanical')).toThrow(/fallback|exhausted/i);
    });
    it('preserves Claude runtime-default effort across profile escalation', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'l1', envelope,
            fingerprint: '1'.repeat(64), approval }, '2026-09-17T00:00:00.000Z').state;
        state.implementationLineages![0].initialEffort = 'runtime-default';
        state.routingAttempts![0].envelope.resolved.effort = { kind: 'runtime-default' };
        state.routingAttempts![0].state = 'blocked'; state.routingAttempts![0].verdict = 'fail';
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'integration', effort: 'runtime-default' });
    });
    it('rejects hostile roles and unavailable provenance before it can reach a report', () => {
        expect(isRoutingEnvelope({ ...envelope, role: 'attacker-key' })).toBe(false);
        expect(isRoutingEnvelope({ ...envelope, unavailableEvidence: ['secret=leak'] })).toBe(false);
    });
});
