import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { MECHANICAL_RUN_SCHEMA, computeCandidateContentDigest, validateMechanicalRunEvidence } from '../../../src/core/evidence/mechanical-run';
import { runEvidenceRun } from '../../../src/commands/evidence';
import { posixOnly } from '../../helpers/platform';

const mockRunStructuredCommand = jest.fn();
const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
  runCommand: (...args: unknown[]) => mockRunCommand(...args),
  runStructuredCommand: (...args: unknown[]) => mockRunStructuredCommand(...args),
}));

const mockChangedFiles = jest.fn();
const mockChangedDeletedFiles = jest.fn();
jest.mock('../../../src/commands/sensors/changed', () => {
  const actual = jest.requireActual('../../../src/commands/sensors/changed');
  return {
    ...actual,
    changedFiles: (...args: unknown[]) => mockChangedFiles(...args),
    changedDeletedFiles: (...args: unknown[]) => mockChangedDeletedFiles(...args),
  };
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listMechanicalRuns(root: string): string[] {
  const dir = path.join(root, '.awm', 'evidence', 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
}

function listChangeReceipts(root: string): string[] {
  const dir = path.join(root, '.awm', 'sensors', 'runs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^[0-9a-f]{40}\.json$/.test(n));
}

describe('awm evidence run (RF-3.1, RF-3.4, RF-3.5, RF-5.1)', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-run-'));
    git(root, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(root, 'hello.txt'), 'hi\n');
    git(root, ['add', 'hello.txt']);
    git(root, ['commit', '-qm', 'init']);
  });

  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('writes MechanicalRunEvidence under .awm/evidence/runs with durationMs ≥ 0', async () => {
    const result = await runEvidenceRun({ root, argv: [process.execPath, '-e', 'process.stdout.write("ok"); process.exit(0)'] });
    expect(result.code).toBe(0);
    const files = listMechanicalRuns(root);
    expect(files).toHaveLength(1);
    const receipt = validateMechanicalRunEvidence(JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'runs', files[0]!), 'utf8')));
    expect(receipt.schema).toBe(MECHANICAL_RUN_SCHEMA);
    expect(receipt.durationMs).toBeGreaterThanOrEqual(0);
    expect(receipt.exitCode).toBe(0);
    expect(receipt.argv[0]).toBe(process.execPath);
  });

  test('does not write CycleEvidenceV1 under .awm/evidence/cycles', async () => {
    await runEvidenceRun({ root, argv: [process.execPath, '-e', 'process.exit(0)'] });
    const cycles = path.join(root, '.awm', 'evidence', 'cycles');
    expect(fs.existsSync(cycles) ? fs.readdirSync(cycles) : []).toEqual([]);
  });

  test('redacts secret-shaped argv tokens in the durable receipt (RF-3.4)', async () => {
    await runEvidenceRun({
      root,
      argv: [process.execPath, '-e', 'process.exit(0)', '--token=literal-secret', '--password=pw'],
    });
    const files = listMechanicalRuns(root);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'runs', files[0]!), 'utf8'));
    expect(receipt.argv.join('\0')).not.toMatch(/literal-secret|\bpw\b/);
    expect(receipt.argv).toEqual(expect.arrayContaining([expect.stringMatching(/--token=\[REDACTED\]/)]));
  });

  test('bounds resultSummary and does not persist full unbounded stdout (RF-3.4)', async () => {
    const blob = 'Z'.repeat(50_000);
    await runEvidenceRun({
      root,
      argv: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(blob)}); process.exit(0)`],
    });
    const files = listMechanicalRuns(root);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'runs', files[0]!), 'utf8'));
    expect(typeof receipt.resultSummary).toBe('string');
    expect(Buffer.byteLength(receipt.resultSummary, 'utf8')).toBeLessThanOrEqual(4096);
  });

  test('non-zero command exit still writes a receipt with that exitCode', async () => {
    const result = await runEvidenceRun({
      root,
      argv: [process.execPath, '-e', 'process.exit(7)'],
    });
    expect(result.code).toBe(7);
    const files = listMechanicalRuns(root);
    expect(files).toHaveLength(1);
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '.awm', 'evidence', 'runs', files[0]!), 'utf8'));
    expect(receipt.exitCode).toBe(7);
  });

  test('evidence run alone does not create a Change Record receipt (RF-3.5)', async () => {
    await runEvidenceRun({ root, argv: [process.execPath, '-e', 'process.exit(0)'] });
    expect(listChangeReceipts(root)).toEqual([]);
  });

  test('unsafe scope fails closed without executing argv (no side effects)', async () => {
    const marker = path.join(root, 'side-effect.txt');
    const result = await runEvidenceRun({
      root,
      argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'); process.exit(0)`],
      declaredScope: ['foo/../hello.txt'],
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/scope|safe|relative|path|\.\./i);
    expect(fs.existsSync(marker)).toBe(false);
    expect(listMechanicalRuns(root)).toEqual([]);
  });

  test('contentDigest reflects pre-run candidate when argv mutates scoped files (RF-3.6)', async () => {
    const before = computeCandidateContentDigest(root, ['hello.txt']);
    const result = await runEvidenceRun({
      root,
      argv: [process.execPath, '-e', "require('fs').writeFileSync('hello.txt','mutated-by-child\\n'); process.exit(0)"],
      declaredScope: ['hello.txt'],
    });
    expect(result.code).toBe(0);
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath!, 'utf8'));
    expect(receipt.candidate.contentDigest).toBe(before);
    expect(fs.readFileSync(path.join(root, 'hello.txt'), 'utf8')).toBe('mutated-by-child\n');
  });

  test('hung command is bounded by captureChild timeout (RF robustness)', async () => {
    const started = Date.now();
    const result = await runEvidenceRun({
      root,
      argv: [process.execPath, '-e', 'setTimeout(() => {}, 60_000)'],
      timeoutMs: 200,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(15_000);
    expect(result.code).not.toBe(0);
    expect(result.receiptPath).toBeDefined();
    const receipt = JSON.parse(fs.readFileSync(result.receiptPath!, 'utf8'));
    expect(receipt.exitCode).toBeGreaterThan(0);
  }, 20_000);

  posixOnly('B2: captureChild timeout kills the grandchild, not only the direct child', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-kill-tree-'));
    const beat = path.join(dir, 'beat');
    const workerSrc = `
      const fs = require('fs');
      setInterval(() => fs.writeFileSync(${JSON.stringify(beat)}, String(Date.now())), 30);
      setTimeout(() => {}, 60_000);
    `;
    const parentSrc = `
      const { spawn } = require('child_process');
      spawn(process.execPath, ['-e', ${JSON.stringify(workerSrc)}], { stdio: 'ignore' });
      setTimeout(() => {}, 60_000);
    `;
    try {
      const started = Date.now();
      const result = await runEvidenceRun({
        root,
        argv: [process.execPath, '-e', parentSrc],
        timeoutMs: 400,
      });
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(result.code).not.toBe(0);

      const until = async (pred: () => boolean, ms = 2_000): Promise<boolean> => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (pred()) return true;
          await new Promise((r) => setTimeout(r, 40));
        }
        return false;
      };
      expect(await until(() => fs.existsSync(beat))).toBe(true);
      const atKill = fs.readFileSync(beat, 'utf8');
      const stillBeating = await until(() => fs.readFileSync(beat, 'utf8') !== atKill, 1_000);
      expect(stillBeating).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('sensors must not emit MechanicalRunEvidence (RF-3.2 / RF-3.8)', () => {
  let project: string;
  let home: string;

  function writeSensorFixture() {
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-sensors-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-evidence-sensors-home-'));
    process.env.HOME = home;
    process.env.AWM_HOME = path.join(home, '.awm');
    fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
    const registry = path.join(process.env.AWM_HOME, 'registries', 'baseline', 'sensor-packs', 'js-ts');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, 'eslint.config.awm.mjs'), 'export default []');
    fs.writeFileSync(path.join(process.env.AWM_HOME, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '^10.0.0' } }));
    fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
    fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(registry, 'pack.json'), JSON.stringify({
      schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
      coverage: {
        schemaVersion: 1,
        classes: {
          lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix', command: 'awm sensors init' } },
        },
      },
      sensors: {
        lint: {
          fast: true,
          applicability: { allFiles: ['package.json'] },
          variants: [{
            id: 'eslint-10', priority: 1, certifiedRange: '>=10 <11',
            requirements: { tool: 'eslint', toolRange: '>=10 <11', runtime: 'node', runtimeRange: '>=0' },
            assets: ['eslint.config.awm.mjs'], formatter: 'generic',
            probe: { kind: 'package-script-present', script: 'lint' },
            command: { executable: 'live-eslint', resolution: 'node-modules-bin', args: ['.'] },
            inputs: ['src/**/*.ts'],
          }],
        },
      },
    }));
    fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
      schemaVersion: 2, pack: 'js-ts', registryRoot: path.join(home, '.awm', 'registries', 'baseline'), sensors: {
        lint: {
          enabled: true, fast: true, variantId: 'eslint-10',
          command: { executable: 'stale', resolution: 'node-modules-bin', args: ['.'] },
          assets: ['eslint.config.awm.mjs'],
          inputs: ['src/**/*.ts'],
          initializedCompatibility: {
            state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10',
            toolVersion: '10.0.0', runtimeVersion: process.versions.node, certifiedRange: '>=10 <11', evidence: [],
          },
        },
      },
    }));
    git(project, ['init', '-q', '-b', 'main']);
    git(project, ['add', '-A']);
    git(project, ['commit', '-qm', 'init']);
  }

  beforeEach(() => {
    jest.resetModules();
    mockRunStructuredCommand.mockReset();
    mockRunCommand.mockReset();
    mockChangedFiles.mockReset();
    mockChangedDeletedFiles.mockReset();
    const { ok } = require('../sensors/exec-fixtures');
    mockRunStructuredCommand.mockResolvedValue(ok());
    mockRunCommand.mockResolvedValue(ok());
    mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
    mockChangedDeletedFiles.mockReturnValue({ files: [] });
    writeSensorFixture();
  });

  afterEach(() => {
    delete process.env.HOME;
    delete process.env.AWM_HOME;
    if (project) fs.rmSync(project, { recursive: true, force: true });
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  test('RF-3.2: normal sensors run (slice + full) writes zero MechanicalRunEvidence files', async () => {
    const { runSensors } = require('../../../src/commands/sensors/run');
    await runSensors({ cwd: project, slice: true });
    expect(listMechanicalRuns(project)).toEqual([]);
    await runSensors({ cwd: project });
    expect(listMechanicalRuns(project)).toEqual([]);
  });

  test('RF-3.8: runSensors({ readOnly: true }) writes zero run receipts and zero cache files', async () => {
    const { runSensors } = require('../../../src/commands/sensors/run');
    await runSensors({ cwd: project, useCache: true, readOnly: true });
    expect(listMechanicalRuns(project)).toEqual([]);
    const runsDir = path.join(project, '.awm', 'sensors', 'runs');
    const cacheAfter = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((n: string) => n.startsWith('cache-')) : [];
    expect(cacheAfter).toEqual([]);
  });
});
