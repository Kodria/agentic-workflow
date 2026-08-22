import { cycleEvidenceFixture } from '../../helpers/evidence-fixtures';
import { validateCycleEvidence } from '../../../src/core/evidence/types';

describe('CycleEvidenceV1 validation', () => {
  test('accepts the minimal privacy-preserving durable observation', () => {
    expect(validateCycleEvidence(cycleEvidenceFixture())).toEqual(cycleEvidenceFixture());
  });

  test.each([
    ['unknown fields', { extra: 'raw prose' }],
    ['absolute plan refs', { plan: { ref: '/Users/alice/plans/current.md', state: 'executed' } }],
    ['raw prose', { qa: { findings: 1, fixes: 1, signatures: ['found alice failed a secret prompt'] } }],
    ['host identities', { pr: { provider: 'github', number: 42, repository: 'alice/private' } }],
    ['invalid retry totals', { tasks: [{ id: 'task-1', attempts: 2, retries: 0 }] }],
  ])('rejects %s', (_label, patch) => {
    expect(() => validateCycleEvidence({ ...cycleEvidenceFixture(), ...patch })).toThrow();
  });

  test('permits every dashboard plan state and an absent PR', () => {
    for (const state of ['active', 'blocked', 'qa_pending', 'retro_pending', 'executed', 'legacy_unverifiable']) {
      const evidence = cycleEvidenceFixture();
      delete (evidence as { pr?: unknown }).pr;
      expect(validateCycleEvidence({ ...evidence, plan: { ...evidence.plan, state } }).pr).toBeUndefined();
    }
  });
});
