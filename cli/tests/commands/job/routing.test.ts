import { emptyState } from '../../../src/core/journal/types';
import { observeRoutingAttempt, reserveRoutingAttempt, routingReport } from '../../../src/core/model-policy/journal';

const envelope = { schema: 'routing-envelope/v1' as const, runtime: { target: 'codex', kind: 'native', version: '1', accountScopeDigest: '0'.repeat(64) }, role: 'implementer', requestedProfile: 'mechanical' as const, effectiveProfile: 'mechanical' as const, resolved: { selector: { kind: 'model' as const, id: 'm' }, effort: { kind: 'explicit' as const, value: 'medium' } }, outcome: 'native' as const, unavailableEvidence: [], policyDigest: 'a'.repeat(64), capabilityDigest: 'b'.repeat(64), planDigest: 'c'.repeat(64), executionDigest: 'd'.repeat(64) };

test('routing report remains read-only across an observed attempt', () => {
    const reserved = reserveRoutingAttempt(emptyState('main'), { obligationId: 'o1', lineageId: 'l1', envelope, fingerprint: 'e'.repeat(64) }, '2026-09-17T00:00:00.000Z');
    const observed = observeRoutingAttempt(reserved.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-id' }, '2026-09-17T00:01:00.000Z');
    expect(routingReport(observed)).toMatchObject({ attempts: 1, byState: { active: 1 } });
    expect(observed.routingAttempts![0].nativeAgentId).toBe('native-id');
});
