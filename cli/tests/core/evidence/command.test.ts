import fs from 'fs';
import os from 'os';
import path from 'path';
import { runEvidenceCapture } from '../../../src/commands/evidence';
import { PLAN_STATES } from '../../../src/core/evidence/types';

const completeJournal = { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] };

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

  test('sin el marker de docs, el estado vivo seria docs_pending — se remapea a retro_pending en la evidencia', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# Plan\n<!-- awm-qa-complete: 2026-08-23 -->\n- [x] Task 1\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: completeJournal, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('retro_pending');
  });

  test('lee el marker awm-docs-complete del plan — sin awm-qa-complete, docsComplete solo alcanza para retro_pending', () => {
    // Discrimina de verdad: si el parser NO leyera awm-docs-complete, este plan (sin qa-complete,
    // sin retro-complete) clasificaria qa_pending por conteo de tasks. Si SI lo lee, va directo a
    // retro_pending — la unica forma de que este resultado ocurra es que el marker se haya parseado.
    fs.writeFileSync(path.join(root, 'plan.md'), '# Plan\n<!-- awm-docs-complete: 2026-08-23 -->\n- [x] Task 1\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: completeJournal, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('retro_pending');
  });

  test('no deja que un awm-docs-complete de otro release clasifique el release actual', () => {
    // Mismo patron que el test analogo de qa/retro: el marker debe respetar el scoping por release.
    fs.writeFileSync(path.join(root, 'plan.md'), '# plan\n<!-- awm-docs-complete: Release A / #86 -->\n\n## Delivery order\n1. **Release A / #86:** dashboard\n2. **Release B / #87:** evidence\n\n- [x] Release B task\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: { journalId: 'ignored', cycle: { status: 'COMPLETE', startedAt: '2026-08-22T10:00:00.000Z', completedAt: '2026-08-22T10:00:01.000Z' }, tasks: [], verdicts: [], fixes: [], jobs: {}, cycleVerificationPlan: [] }, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('qa_pending');
  });

  test('no filtra docs_pending al registro durable de evidencia', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# Plan\n<!-- awm-qa-complete: 2026-08-23 -->\n- [x] Task 1\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: completeJournal, ledger: [] });

    expect(result.code).toBe(0);
    expect(PLAN_STATES).not.toContain('docs_pending');
    const state = JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state;
    expect(PLAN_STATES).toContain(state);
  });

  test('con docs y retro completos el estado sigue siendo executed', () => {
    fs.writeFileSync(path.join(root, 'plan.md'), '# Plan\n<!-- awm-qa-complete: 2026-08-23 -->\n<!-- awm-docs-complete: 2026-08-23 -->\n<!-- awm-retro-complete: 2026-08-23 -->\n- [x] Task 1\n');
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: completeJournal, ledger: [] });

    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('executed');
  });

  test('un marker sin cerrar y muy largo no cuelga el parseo (ReDoS)', () => {
    // Regresion: el regex original tenia \s* adyacente al grupo lazo [^\r\n]*?,
    // lo que producia backtracking catastrofico ante una linea larga sin "-->".
    const unterminated = `<!-- awm-qa-complete: ${' '.repeat(200000)}`;
    fs.writeFileSync(path.join(root, 'plan.md'), `# Plan\n${unterminated}\n- [x] Task 1\n`);
    const start = Date.now();
    const result = runEvidenceCapture(root, 'plan.md', { repositoryIdentity: 'git@example.test:team/repository.git', journal: completeJournal, ledger: [] });
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(1000);
    expect(result.code).toBe(0);
    // linea sin cerrar: el marker no matchea, y sin awm-qa-complete el plan
    // no llega a docs_pending/retro_pending por conteo de tasks (1/1 completa).
    expect(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'cycles', result.stdout.trim() + '.json'), 'utf8')).plan.state).toBe('qa_pending');
  });
});
