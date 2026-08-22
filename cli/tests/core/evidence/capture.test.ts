import { captureCycleEvidence } from '../../../src/core/evidence/capture';

describe('captureCycleEvidence', () => {
  test('derives counts and opaque signatures without journal prose or identities', () => {
    const evidence = captureCycleEvidence({
      root: process.cwd(),
      planPath: 'plans/release.md',
      journal: {
        cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:10.000Z' },
        journalId: 'local-repository-identity',
        tasks: [{ id: 'task-a', attempts: 3 }],
        verdicts: [{ result: 'fail', fingerprint: 'unsafe-input', detail: 'Alice saw secret prompt', receivedAt: '2026-08-22T10:00:05.000Z' }],
        fixes: [{ verdictId: 'v1', closed: true }],
      },
      gates: [{ required: true, passed: true }],
      ledger: [{ signature: 'unsafe-input', polarity: 'win', ts: '2026-08-22T10:00:06.000Z' }],
      pr: { provider: 'github', number: 12 },
    });

    expect(evidence).toMatchObject({
      schema: 1, cycleState: 'completed', durationMs: 10_000,
      plan: { ref: 'plans/release.md' }, tasks: [{ id: 'task-a', attempts: 3, retries: 2 }],
      qa: { findings: 1, fixes: 1 }, gates: { required: 1, firstEvaluationsPassed: [true], firstPass: true },
      pr: { provider: 'github', number: 12 },
    });
    expect(evidence.cycleId).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.qa.signatures[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.cures[0]).toMatchObject({ signature: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(evidence.cures[0].signature).toBe(evidence.qa.signatures[0]);
    expect(JSON.stringify(evidence)).not.toContain('Alice');
    expect(JSON.stringify(evidence)).not.toContain('secret prompt');
  });

  test('derives cycle identity from repository identity, never journal identity', () => {
    const source = {
      planPath: 'plans/release.md', journal: { journalId: 'repository-identity', cycle: { status: 'BLOCKED', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [] }, gates: [], ledger: [],
    };
    const first = captureCycleEvidence({ ...source, root: process.cwd() });
    const second = captureCycleEvidence({ ...source, root: process.cwd(), journal: { ...source.journal, journalId: 'different-journal-identity' } });
    expect(first.cycleId).toBe(second.cycleId);
    expect(first.cycleState).toBe('blocked');
  });
});
