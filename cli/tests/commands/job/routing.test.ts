import { emptyState } from '../../../src/core/journal/types';
import { observeRoutingAttempt, reserveRoutingAttempt, routingReport } from '../../../src/core/model-policy/journal';
import { routingApproval, routingEnvelope } from '../../helpers/routing-approval';

test('routing report remains read-only across an observed attempt', () => {
    const reserved = reserveRoutingAttempt(emptyState('main'), { obligationId: 'o1', lineageId: 'l1', envelope: routingEnvelope, fingerprint: 'e'.repeat(64), approval: routingApproval }, '2026-09-17T00:00:00.000Z');
    const observed = observeRoutingAttempt(reserved.state, { attemptId: reserved.attemptId, nativeAgentId: 'native-id' }, '2026-09-17T00:01:00.000Z');
    expect(routingReport(observed)).toMatchObject({ attempts: 1, byState: { active: 1 } });
    expect(observed.routingAttempts![0].nativeAgentId).toBe('native-id');
});
