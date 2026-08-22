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
    ['non-canonical timestamp', { startedAt: '2026-08-22T10:00:00Z' }],
  ])('rejects %s', (_label, patch) => {
    expect(() => validateCycleEvidence({ ...cycleEvidenceFixture(), ...patch })).toThrow();
  });

  test('stores first gate evaluations as booleans, not an aggregate count', () => {
    const evidence = cycleEvidenceFixture();
    expect(validateCycleEvidence({ ...evidence, gates: { required: 2, firstEvaluationsPassed: [true, false], firstPass: false } }).gates.firstEvaluationsPassed).toEqual([true, false]);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])('rejects a non-finite or negative duration: %p', (durationMs) => {
    const evidence = cycleEvidenceFixture();
    expect(() => validateCycleEvidence({
      ...evidence,
      startedAt: evidence.endedAt,
      durationMs,
    })).toThrow('durationMs must be a non-negative integer');
  });

  test.each([
    ['task attempts', (evidence: ReturnType<typeof cycleEvidenceFixture>) => ({ ...evidence, tasks: [{ ...evidence.tasks[0], attempts: -1 }] })],
    ['task retries', (evidence: ReturnType<typeof cycleEvidenceFixture>) => ({ ...evidence, tasks: [{ ...evidence.tasks[0], retries: -1 }] })],
    ['QA findings', (evidence: ReturnType<typeof cycleEvidenceFixture>) => ({ ...evidence, qa: { ...evidence.qa, findings: -1 } })],
    ['QA fixes', (evidence: ReturnType<typeof cycleEvidenceFixture>) => ({ ...evidence, qa: { ...evidence.qa, fixes: -1 } })],
    ['required gates', (evidence: ReturnType<typeof cycleEvidenceFixture>) => ({ ...evidence, gates: { ...evidence.gates, required: -1 } })],
  ])('rejects a negative %s count', (_label, patch) => {
    expect(() => validateCycleEvidence(patch(cycleEvidenceFixture()))).toThrow('must be a non-negative integer');
  });

  test('permits every dashboard plan state and an absent PR', () => {
    for (const state of ['active', 'blocked', 'qa_pending', 'retro_pending', 'executed', 'legacy_unverifiable']) {
      const evidence = cycleEvidenceFixture();
      delete (evidence as { pr?: unknown }).pr;
      expect(validateCycleEvidence({ ...evidence, plan: { ...evidence.plan, state } }).pr).toBeUndefined();
    }
  });
});
