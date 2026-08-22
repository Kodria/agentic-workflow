import fs from 'fs';
import os from 'os';
import path from 'path';
import { runEvidenceCapture } from '../../../src/commands/evidence';

describe('evidence capture CLI boundary', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-command-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('returns exit 2 for a missing or invalid plan', () => {
    expect(runEvidenceCapture(root, undefined).code).toBe(2);
    expect(runEvidenceCapture(root, '../secret.md').code).toBe(2);
  });

  test('returns exactly the captured cycle id on success', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n');
    expect(runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] }, ledger: [] })).toEqual(expect.objectContaining({ code: 0, stdout: expect.stringMatching(/^[a-f0-9]{64}\n$/) }));
  });

  test('uses the first attempted gate evaluation instead of final satisfaction', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], cycleVerificationPlan: [{ id: 'gate', kind: 'test', satisfiedBy: 'retry' }], jobs: { first: { id: 'first', satisfies: ['gate'], verdict: 'fail' }, retry: { id: 'retry', satisfies: ['gate'], attemptOf: 'first', verdict: 'pass' } } }, ledger: [] });
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).gates.firstEvaluationsPassed).toEqual([false]);
  });

  test('uses the first review verdict rather than satisfiedBy final verdict', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], fixes: [], cycleVerificationPlan: [{ id: 'review-gate', kind: 'review', satisfiedBy: 'final' }], jobs: {}, verdicts: [{ id: 'first', obligationId: 'review-gate', result: 'fail', fingerprint: 'review-gate', receivedAt: '2026-08-22T10:00:00.000Z' }, { id: 'final', obligationId: 'review-gate', result: 'pass', fingerprint: 'review-gate', receivedAt: '2026-08-22T10:00:01.000Z' }] }, ledger: [] });
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).gates.firstEvaluationsPassed).toEqual([false]);
  });
});
