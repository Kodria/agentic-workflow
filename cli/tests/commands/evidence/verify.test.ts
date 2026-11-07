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

describe('awm evidence verify (RF-3.9, RF-E.1)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-verify-'));
    git(root, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'alpha\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '-qm', 'init']);
  });

  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  async function writeReceipt(argv: string[] = [process.execPath, '-e', 'process.exit(0)']): Promise<string> {
    const result = await runEvidenceRun({ root, argv });
    expect(result.receiptPath).toMatch(/\.json$/);
    return result.receiptPath!;
  }

  test('reports match on unchanged tree/argv/cwd and exits 0', async () => {
    const receiptPath = await writeReceipt();
    const verified = runEvidenceVerify({ root, receiptPath });
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual({ status: 'match' });
  });

  test('reports mismatch after a contentDigest-affecting edit', async () => {
    const receiptPath = await writeReceipt();
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'beta\n');
    const verified = runEvidenceVerify({ root, receiptPath });
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
    const receiptPath = await writeReceipt();
    const raw = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    raw.exitCode = 42; // break integrity without resealing
    fs.writeFileSync(receiptPath, JSON.stringify(raw, null, 2) + '\n');
    const verified = runEvidenceVerify({ root, receiptPath });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/integrity|absent|invalid|tamper/i);
  });

  test('symlink receipt path fails closed as mismatch/absent', async () => {
    const receiptPath = await writeReceipt();
    const link = path.join(root, 'receipt-link.json');
    fs.symlinkSync(receiptPath, link);
    const verified = runEvidenceVerify({ root, receiptPath: link });
    expect(verified.code).toBe(2);
    const body = JSON.parse(verified.stdout);
    expect(body.status).toBe('mismatch');
    expect(body.reason).toMatch(/symlink|absent|invalid/i);
  });
});
