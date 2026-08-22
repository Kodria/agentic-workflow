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
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], cycleVerificationPlan: [{ id: 'gate', kind: 'test', satisfiedBy: 'retry' }], jobs: { first: { id: 'first', satisfies: ['gate'], verdict: 'fail', phaseTimestamps: { received: '2026-08-22T10:00:00.000Z' } }, retry: { id: 'retry', satisfies: ['gate'], attemptOf: 'first', verdict: 'pass', phaseTimestamps: { received: '2026-08-22T10:00:01.000Z' } } } }, ledger: [] });
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).gates.firstEvaluationsPassed).toEqual([false]);
  });

  test('orders independent root evaluations by durable timestamp then id', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:03.000Z' }, tasks: [], verdicts: [], fixes: [], cycleVerificationPlan: [{ id: 'gate', kind: 'test', satisfiedBy: 'late-pass' }], jobs: { late: { id: 'late-pass', satisfies: ['gate'], verdict: 'pass', phaseTimestamps: { received: '2026-08-22T10:00:02.000Z' } }, early: { id: 'early-fail', satisfies: ['gate'], verdict: 'fail', phaseTimestamps: { received: '2026-08-22T10:00:01.000Z' } } } }, ledger: [] });
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).gates.firstEvaluationsPassed).toEqual([false]);
  });

  test('uses the first review verdict rather than satisfiedBy final verdict', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], fixes: [], cycleVerificationPlan: [{ id: 'review-gate', kind: 'review', satisfiedBy: 'final' }], jobs: {}, verdicts: [{ id: 'first', obligationId: 'review-gate', result: 'fail', fingerprint: 'review-gate', receivedAt: '2026-08-22T10:00:00.000Z' }, { id: 'final', obligationId: 'review-gate', result: 'pass', fingerprint: 'review-gate', receivedAt: '2026-08-22T10:00:01.000Z' }] }, ledger: [] });
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).gates.firstEvaluationsPassed).toEqual([false]);
  });

  test('derives retro_pending from completed checklist tasks and the QA marker in the plan file', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n<!-- awm-qa-complete: 2026-08-22 -->\n- [x] Build\n- [X] Verify\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] }, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('retro_pending');
  });

  test('uses a blocked journal state over completed plan markers', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n<!-- awm-qa-complete: 2026-08-22 -->\n<!-- awm-retro-complete: 2026-08-22 -->\n- [x] Build\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'BLOCKED', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] }, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('blocked');
  });

  test('does not let Release A markers classify a multi-release plan whose current Release B has no lifecycle markers', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n<!-- awm-qa-complete: Release A / #86 -->\n<!-- awm-retro-complete: Release A / #86 -->\n\n## Delivery order\n1. **Release A / #86:** dashboard\n2. **Release B / #87:** evidence\n\n- [x] Release B task\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] }, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('qa_pending');
  });

  test('rejects a malformed checklist instead of silently classifying a plan', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n- [z] Unknown state\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] }, ledger: [] });

    expect(result).toEqual(expect.objectContaining({ code: 2, error: expect.stringMatching(/invalid checklist/i) }));
  });
});
