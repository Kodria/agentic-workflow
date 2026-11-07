import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { runEvidenceRun, runEvidenceVerify } from '../../../src/commands/evidence';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('awm evidence verify (RF-3.9 / P7, RF-E.1)', () => {
  let root: string;
  const defaultArgv = () => [process.execPath, '-e', 'process.exit(0)'];

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-verify-'));
    git(root, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'alpha\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '-qm', 'init']);
  });

  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  async function writeReceipt(argv: string[] = defaultArgv()): Promise<string> {
    const result = await runEvidenceRun({ root, argv });
    expect(result.receiptPath).toMatch(/\.json$/);
    return result.receiptPath!;
  }

  test('reports match on unchanged tree/cwd + matching expected argv and exits 0', async () => {
    const argv = defaultArgv();
    const receiptPath = await writeReceipt(argv);
    const verified = runEvidenceVerify({ root, receiptPath, expectArgv: argv });
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual({ status: 'match' });
  });

  test('omit expected argv → mismatch fail-closed (never match on tree/cwd alone) (RF-3.9 / P7)', async () => {
    const receiptPath = await writeReceipt();
    const verified = runEvidenceVerify({ root, receiptPath });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/argv|expected/i);
  });

  test('S4-NQ-2: empty expectArgv array → mismatch fail-closed', async () => {
    const receiptPath = await writeReceipt();
    const verified = runEvidenceVerify({ root, receiptPath, expectArgv: [] });
    expect(verified.code).toBe(2);
    expect(JSON.parse(verified.stdout)).toEqual(expect.objectContaining({
      status: 'mismatch',
      reason: expect.stringMatching(/argv|expected/i),
    }));
  });

  test('S4-BQ-1: glob --paths scope — edit under matched files → verify mismatch (not vacuous false-match)', async () => {
    const argv = defaultArgv();
    const run = await runEvidenceRun({ root, argv, declaredScope: ['*.txt'] });
    expect(run.code).toBe(0);
    expect(run.receiptPath).toBeDefined();
    const receipt = JSON.parse(fs.readFileSync(run.receiptPath!, 'utf8'));
    expect(receipt.scope.resolved.length).toBeGreaterThan(0);
    expect(receipt.scope.resolved).toEqual(expect.arrayContaining(['tracked.txt']));
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed-under-glob\n');
    const verified = runEvidenceVerify({ root, receiptPath: run.receiptPath!, expectArgv: argv });
    expect(verified.code).toBe(2);
    expect(JSON.parse(verified.stdout).reason).toMatch(/contentDigest|candidate/i);
  });

  test('A2: new file matching declared glob after seal → verify scope mismatch (not false match)', async () => {
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'a.test.ts'), 'export const t = 1;\n');
    git(root, ['add', 'tests']);
    git(root, ['commit', '-qm', 'tests']);
    const argv = defaultArgv();
    const run = await runEvidenceRun({ root, argv, declaredScope: ['tests/**'] });
    expect(run.code).toBe(0);
    expect(run.receiptPath).toBeDefined();
    fs.writeFileSync(path.join(root, 'tests', 'b.test.ts'), 'export const u = 2;\n');
    const verified = runEvidenceVerify({ root, receiptPath: run.receiptPath!, expectArgv: argv });
    expect(verified.code).toBe(2);
    expect(JSON.parse(verified.stdout)).toEqual(expect.objectContaining({
      status: 'mismatch',
      reason: 'scope',
    }));
  });

  test('S4-BQ-1: unresolved glob scope refuses the run (fail closed)', async () => {
    const run = await runEvidenceRun({
      root,
      argv: defaultArgv(),
      declaredScope: ['does-not-match-*.xyz'],
    });
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(/scope|empty|unresolved|vacuous/i);
    expect(fs.existsSync(path.join(root, '.awm', 'evidence', 'runs'))
      ? fs.readdirSync(path.join(root, '.awm', 'evidence', 'runs')).filter((n) => n.endsWith('.json'))
      : []).toEqual([]);
  });

  test('S4-NQ-1: run --cwd <sub> then verify without override matches via receipt cwd', async () => {
    const sub = path.join(root, 'pkg');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'nested.txt'), 'n\n');
    git(root, ['add', 'pkg']);
    git(root, ['commit', '-qm', 'nested']);
    const argv = defaultArgv();
    const run = await runEvidenceRun({ root, argv, cwd: 'pkg' });
    expect(run.code).toBe(0);
    const receipt = JSON.parse(fs.readFileSync(run.receiptPath!, 'utf8'));
    expect(fs.realpathSync(receipt.cwd)).toBe(fs.realpathSync(sub));
    const verified = runEvidenceVerify({ root, receiptPath: run.receiptPath!, expectArgv: argv });
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual({ status: 'match' });
  });

  test('S4-NQ-1: verify --cwd override that disagrees with receipt → cwd mismatch', async () => {
    const sub = path.join(root, 'pkg');
    fs.mkdirSync(sub);
    const argv = defaultArgv();
    const run = await runEvidenceRun({ root, argv, cwd: 'pkg' });
    expect(run.code).toBe(0);
    const verified = runEvidenceVerify({
      root,
      receiptPath: run.receiptPath!,
      expectArgv: argv,
      expectCwd: '.',
    });
    expect(verified.code).toBe(2);
    expect(JSON.parse(verified.stdout).reason).toMatch(/cwd/i);
  });

  test('reports mismatch after a contentDigest-affecting edit', async () => {
    const argv = defaultArgv();
    const receiptPath = await writeReceipt(argv);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'beta\n');
    const verified = runEvidenceVerify({ root, receiptPath, expectArgv: argv });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/contentDigest|candidate/i);
  });

  test('reports mismatch when expected argv diverges from the receipt (RF-3.9)', async () => {
    const receiptPath = await writeReceipt([process.execPath, '-e', 'process.exit(0)', '--flag=a']);
    const verified = runEvidenceVerify({
      root,
      receiptPath,
      expectArgv: [process.execPath, '-e', 'process.exit(0)', '--flag=b'],
    });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/argv/i);
  });

  test('tampered integrity is treated as absent/mismatch, never match (RF-E.1)', async () => {
    const argv = defaultArgv();
    const receiptPath = await writeReceipt(argv);
    const raw = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    raw.exitCode = 42; // break integrity without resealing
    fs.writeFileSync(receiptPath, JSON.stringify(raw, null, 2) + '\n');
    const verified = runEvidenceVerify({ root, receiptPath, expectArgv: argv });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/integrity|absent|invalid|tamper/i);
  });

  test('symlink receipt path fails closed as mismatch/absent', async () => {
    const argv = defaultArgv();
    const receiptPath = await writeReceipt(argv);
    const link = path.join(root, 'receipt-link.json');
    fs.symlinkSync(receiptPath, link);
    const verified = runEvidenceVerify({ root, receiptPath: link, expectArgv: argv });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/symlink|absent|invalid/i);
  });
});
