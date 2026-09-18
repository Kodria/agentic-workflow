import { computeGate } from '../../../src/commands/job/gate';
import { emptyState } from '../../../src/core/journal/types';

test('routed evidence cannot certify against a legacy journal without its attempt', () => {
    const state = emptyState('main');
    state.verdicts.push({ id: 'v1', obligationId: 'o1', result: 'pass', detail: '', receivedAt: 'now', fingerprint: 'fp', argv: [], paths: [], cwd: '.', routingAttemptId: 'missing' });
    expect(computeGate(state, false, () => 'fp').reasons).toContainEqual(expect.objectContaining({ category: 'routing-evidence' }));
});
