import fs from 'fs';
import os from 'os';
import path from 'path';
import { cycleEvidenceFixture } from '../../helpers/evidence-fixtures';
import { writeCycleEvidence } from '../../../src/core/evidence/store';

describe('cycle evidence store', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('durably replaces one observation for the same opaque cycle id', () => {
    const evidence = cycleEvidenceFixture();
    writeCycleEvidence(root, evidence);
    writeCycleEvidence(root, { ...evidence, qa: { ...evidence.qa, fixes: 0 } });
    const dir = path.join(root, '.awm', 'evidence', 'cycles');
    expect(fs.readdirSync(dir)).toEqual([`${evidence.cycleId}.json`]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${evidence.cycleId}.json`), 'utf8')).qa.fixes).toBe(0);
  });

  test('rejects symlinked evidence ancestors without writing outside root', () => {
    if (process.platform === 'win32') return;
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-outside-'));
    fs.symlinkSync(outside, path.join(root, '.awm'));
    expect(() => writeCycleEvidence(root, cycleEvidenceFixture())).toThrow(/symlink/);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
