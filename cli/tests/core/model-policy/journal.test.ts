import { emptyState } from '../../../src/core/journal/types';
import { observeRoutingAttempt, reserveRoutingAttempt } from '../../../src/core/model-policy/journal';

const envelope = { schema: 'routing-envelope/v1' as const, role: 'implementer', requestedProfile: 'mechanical', effectiveProfile: 'mechanical', policyDigest: 'a'.repeat(64), capabilityDigest: 'b'.repeat(64), planDigest: 'c'.repeat(64), executionDigest: 'd'.repeat(64) };

describe('routing journal helpers', () => {
    it('reserves one idempotent attempt and records native observation', () => {
        const state = emptyState('main');
        const reserved = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z');
        const replay = reserveRoutingAttempt(reserved.state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:01:00.000Z');
        expect(replay.attemptId).toBe(reserved.attemptId);
        const observed = observeRoutingAttempt(replay.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-1' }, '2026-09-17T00:02:00.000Z');
        expect(observed.routingAttempts?.[0]).toMatchObject({ state: 'active', nativeAgentId: 'native-1' });
    });
    it('rejects a fourth implementer attempt in one lineage', () => {
        let state = emptyState('main');
        for (const [index, profile] of ['mechanical', 'integration', 'judgment'].entries()) state = reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope: { ...envelope, effectiveProfile: profile }, fingerprint: `${'a'.repeat(63)}${index}` }, '2026-09-17T00:00:00.000Z').state;
        expect(() => reserveRoutingAttempt(state, { obligationId: 'impl:S1', lineageId: 'lineage:S1', envelope, fingerprint: 'f'.repeat(64) }, '2026-09-17T00:00:00.000Z')).toThrow(/budget/i);
    });
});
