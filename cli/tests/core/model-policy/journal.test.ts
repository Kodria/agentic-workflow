import { emptyState, isRoutingEnvelope } from '../../../src/core/journal/types';
import { observeRoutingAttempt, reserveRoutingAttempt, routingReport, resolveLineageEscalation } from '../../../src/core/model-policy/journal';

const envelope = { schema: 'routing-envelope/v1' as const, runtime: { target: 'codex', kind: 'native', version: '1', accountScopeDigest: '0'.repeat(64) }, role: 'implementer', sliceId: 'S1', requestedProfile: 'mechanical' as const, effectiveProfile: 'mechanical' as const, resolved: { selector: { kind: 'model' as const, id: 'm' }, effort: { kind: 'explicit' as const, value: 'medium' } }, outcome: 'native' as const, unavailableEvidence: [], policyDigest: 'a'.repeat(64), capabilityDigest: 'b'.repeat(64), planDigest: 'c'.repeat(64), executionDigest: 'd'.repeat(64) };

describe('routing journal helpers', () => {
    it('reserves one idempotent attempt and records native observation', () => {
        const state = emptyState('main');
        const reserved = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z');
        const replay = reserveRoutingAttempt(reserved.state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:01:00.000Z');
        expect(replay.attemptId).toBe(reserved.attemptId);
        const observed = observeRoutingAttempt(replay.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-1' }, '2026-09-17T00:02:00.000Z');
        expect(observed.routingAttempts?.[0]).toMatchObject({ state: 'active', nativeAgentId: 'native-1' });
    });
    it('reserves an initial mechanical attempt at its approved explicit high effort', () => {
        const high = { ...envelope, resolved: { ...envelope.resolved, effort: { kind: 'explicit' as const, value: 'high' } } };
        const reserved = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: high, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z');
        expect(reserved.state.routingAttempts?.[0].envelope.resolved).toEqual(high.resolved);
        expect(reserved.state.implementationLineages?.[0].initialEffort).toBe('high');
    });
    it('reserves the approved high-effort judgment profile after a failed integration attempt', () => {
        const integration = { ...envelope, requestedProfile: 'integration' as const, effectiveProfile: 'integration' as const };
        const first = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: integration, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z').state;
        first.routingAttempts![0].state = 'blocked';
        first.routingAttempts![0].verdict = 'fail';
        const judgment = { ...integration, effectiveProfile: 'judgment' as const, resolved: { ...integration.resolved, effort: { kind: 'explicit' as const, value: 'high' } } };
        const second = reserveRoutingAttempt(first, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: judgment, fingerprint: 'f'.repeat(64) }, '2026-09-17T00:01:00.000Z').state;
        expect(second.routingAttempts?.[1].envelope.resolved).toEqual(judgment.resolved);
    });
    it('reserves judgment high after a failed judgment medium attempt without resetting the lineage', () => {
        const judgment = { ...envelope, requestedProfile: 'judgment' as const, effectiveProfile: 'judgment' as const };
        const first = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: judgment, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z').state;
        first.routingAttempts![0].state = 'blocked';
        first.routingAttempts![0].verdict = 'fail';
        const high = { ...judgment, resolved: { ...judgment.resolved, effort: { kind: 'explicit' as const, value: 'high' } } };
        const second = reserveRoutingAttempt(first, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: high, fingerprint: 'f'.repeat(64) }, '2026-09-17T00:01:00.000Z').state;
        expect(second.routingAttempts?.[1]).toMatchObject({ attempt: 2, envelope: { effectiveProfile: 'judgment', resolved: high.resolved } });
    });
    it('rejects a fourth implementer attempt in one lineage', () => {
        let state = emptyState('main');
        for (const [index, profile] of (['mechanical', 'integration', 'judgment'] as const).entries()) { state = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: { ...envelope, effectiveProfile: profile }, fingerprint: `${'a'.repeat(63)}${index}` }, '2026-09-17T00:00:00.000Z').state; state.routingAttempts![state.routingAttempts!.length - 1].state = 'blocked'; state.routingAttempts![state.routingAttempts!.length - 1].verdict = 'fail'; }
        expect(() => reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'f'.repeat(64) }, '2026-09-17T00:00:00.000Z')).toThrow(/budget/i);
    });
    it('reports routing attempts without envelope bodies or native identities', () => {
        const state = reserveRoutingAttempt(emptyState('main'), { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z').state;
        expect(routingReport(state)).toEqual({ schema: 'routing-report/v1', attempts: 1, plannedByRole: { implementer: 1 }, actualByRole: {}, byState: { reserved: 1 }, retries: 0, fallbacks: 0, unavailable: {}, verdicts: {}, administrativeRepairs: 0 });
    });
    it('uses the exact deterministic implementation escalation sequence', () => {
        let state = emptyState('main');
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'mechanical', effort: 'medium' });
        state = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'l1', envelope, fingerprint: '1'.repeat(64) }, '2026-09-17T00:00:00.000Z').state;
        state.routingAttempts![0].state = 'blocked'; state.routingAttempts![0].verdict = 'fail';
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'integration', effort: 'medium' });
        state.routingAttempts!.push({ ...state.routingAttempts![0], id: 'route-2', attempt: 2, envelope: { ...envelope, effectiveProfile: 'integration' }, state: 'blocked', verdict: 'fail' });
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'judgment', effort: 'medium' });
        state.routingAttempts!.push({ ...state.routingAttempts![0], id: 'route-3', attempt: 3, envelope: { ...envelope, effectiveProfile: 'judgment', resolved: { selector: { kind: 'model', id: 'm' }, effort: { kind: 'explicit', value: 'medium' } } }, state: 'blocked', verdict: 'fail' });
        expect(resolveLineageEscalation(state, 'l1', 'mechanical')).toEqual({ profile: 'judgment', effort: 'high' });
        state.routingAttempts![2].envelope = { ...state.routingAttempts![2].envelope, resolved: { selector: { kind: 'model', id: 'm' }, effort: { kind: 'explicit', value: 'high' } } };
        expect(() => resolveLineageEscalation(state, 'l1', 'mechanical')).toThrow(/exhausted/i);
    });
    it('rejects hostile roles and unavailable provenance before it can reach a report', () => {
        expect(isRoutingEnvelope({ ...envelope, role: 'attacker-key' })).toBe(false);
        expect(isRoutingEnvelope({ ...envelope, unavailableEvidence: ['secret=leak'] })).toBe(false);
    });
});
