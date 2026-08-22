export const cycleEvidenceFixture = () => ({
  schema: 1,
  cycleId: 'a'.repeat(64),
  startedAt: '2026-08-22T10:00:00.000Z',
  endedAt: '2026-08-22T10:01:00.000Z',
  durationMs: 60_000,
  cycleState: 'completed' as const,
  plan: { ref: 'plans/current.md', state: 'executed' as const },
  tasks: [{ id: 'task-1', attempts: 2, retries: 1 }],
  qa: { findings: 1, fixes: 1, signatures: ['b'.repeat(64)] },
  gates: { required: 1, firstEvaluationsPassed: 1, firstPass: true },
  cures: [{ signature: 'c'.repeat(64), curedAt: '2026-08-22T10:00:30.000Z' }],
});
