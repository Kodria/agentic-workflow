import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { cycleEvidenceFixture } from '../../helpers/evidence-fixtures';
import { posixOnly } from '../../helpers/platform';
import {
  MECHANICAL_RUN_SCHEMA,
  computeCandidateContentDigest,
  computeIntegrityDigest,
  redactMechanicalArgv,
  resolveScopePaths,
  validateMechanicalRunEvidence,
  writeMechanicalRunEvidence,
  type MechanicalRunEvidence,
} from '../../../src/core/evidence/mechanical-run';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function validBody(overrides: Partial<MechanicalRunEvidence> = {}): Omit<MechanicalRunEvidence, 'integrityDigest'> {
  const base: Omit<MechanicalRunEvidence, 'integrityDigest'> = {
    schema: MECHANICAL_RUN_SCHEMA,
    id: 'a'.repeat(64),
    ranAt: '2026-11-06T12:00:00.000Z',
    durationMs: 12,
    candidate: {
      headCommit: 'b'.repeat(40),
      contentDigest: `sha256:${'c'.repeat(64)}`,
    },
    argv: ['node', '-e', 'process.exit(0)'],
    cwd: '/tmp/repo',
    exitCode: 0,
    resultSummary: 'ok',
    scope: { declared: [], resolved: [] },
  };
  return { ...base, ...overrides, candidate: { ...base.candidate, ...(overrides.candidate ?? {}) }, scope: { ...base.scope!, ...(overrides.scope ?? {}) } };
}

function sealed(overrides: Partial<MechanicalRunEvidence> = {}): MechanicalRunEvidence {
  const body = validBody(overrides);
  return { ...body, integrityDigest: computeIntegrityDigest(body) };
}

describe('MechanicalRunEvidence schema / integrity (RF-3.1, RF-3.6, RF-3.7, RF-E.1)', () => {
  test('accepts a sealed receipt with candidate headCommit + contentDigest', () => {
    const evidence = sealed();
    expect(validateMechanicalRunEvidence(evidence)).toEqual(evidence);
    expect(evidence.schema).toBe('mechanical-run-evidence/v1');
    expect(evidence.candidate.headCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.candidate.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.integrityDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test('rejects CycleEvidenceV1 shape (distinct schema id)', () => {
    expect(() => validateMechanicalRunEvidence(cycleEvidenceFixture())).toThrow(/schema|mechanical/i);
  });

  test('rejects missing integrityDigest', () => {
    const body = validBody();
    expect(() => validateMechanicalRunEvidence(body)).toThrow(/integrity/i);
  });

  test('rejects tampered payload whose integrityDigest no longer matches (RF-E.1)', () => {
    const evidence = sealed({ resultSummary: 'clean' });
    const tampered = { ...evidence, exitCode: 99 };
    expect(() => validateMechanicalRunEvidence(tampered)).toThrow(/integrity|mismatch|tamper/i);
  });

  test('allows empty headCommit when unavailable', () => {
    const evidence = sealed({ candidate: { headCommit: '', contentDigest: `sha256:${'d'.repeat(64)}` } });
    expect(validateMechanicalRunEvidence(evidence).candidate.headCommit).toBe('');
  });
});

describe('argv redaction and result bounds (RF-3.4)', () => {
  test('redacts --token= / --password= / --api-key= values', () => {
    expect(redactMechanicalArgv(['tool', '--token=secret', '--password=p', '--api-key=k'])).toEqual([
      'tool',
      '--token=[REDACTED]',
      '--password=[REDACTED]',
      '--api-key=[REDACTED]',
    ]);
  });

  test('redacts AUTHORIZATION-like argv tokens', () => {
    const out = redactMechanicalArgv(['curl', '-H', 'Authorization: Bearer super-secret-token']);
    expect(out.join(' ')).not.toMatch(/super-secret-token/);
    expect(out.some((t) => /REDACTED/i.test(t) || /Authorization/i.test(t))).toBe(true);
  });

  test('redacts Authorization Bearer token split across three argv tokens (RF-3.4)', () => {
    const out = redactMechanicalArgv(['curl', '-H', 'Authorization', 'Bearer', 'super-secret-token']);
    expect(out.join('\0')).not.toMatch(/super-secret-token/);
    expect(out.join('\0')).not.toMatch(/Bearer/i);
    expect(out).toEqual(['curl', '-H', 'Authorization', '[REDACTED]', '[REDACTED]']);
  });

  test('resultSummary longer than the bound is rejected by validate', () => {
    const huge = 'x'.repeat(16_384);
    expect(() => validateMechanicalRunEvidence(sealed({ resultSummary: huge }))).toThrow(/resultSummary|bound|size/i);
  });
});

describe('store under .awm/evidence/runs (RF-3.4)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mech-store-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('writes JSON + self-ignoring * gitignore (0600 on POSIX)', () => {
    const evidence = sealed();
    const file = writeMechanicalRunEvidence(root, evidence);
    expect(file).toBe(path.join(root, '.awm', 'evidence', 'runs', `${evidence.id}.json`));
    expect(fs.readFileSync(path.join(root, '.awm', 'evidence', 'runs', '.gitignore'), 'utf8')).toBe('*\n');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).schema).toBe(MECHANICAL_RUN_SCHEMA);
  });

  posixOnly('fails closed on symlink store ancestors', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mech-outside-'));
    fs.mkdirSync(path.join(root, '.awm'));
    fs.symlinkSync(outside, path.join(root, '.awm', 'evidence'));
    expect(() => writeMechanicalRunEvidence(root, sealed())).toThrow(/symlink/i);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('contentDigest helper shared by run+verify (RF-3.6)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-mech-digest-'));
    git(root, ['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'one\n');
    git(root, ['add', 'tracked.txt']);
    git(root, ['commit', '-qm', 'init']);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test('changes when a content-affecting file is edited', () => {
    const before = computeCandidateContentDigest(root);
    expect(before).toMatch(/^sha256:[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'two\n');
    const after = computeCandidateContentDigest(root);
    expect(after).not.toBe(before);
  });

  test('excludes .awm/evidence runtime subtree from the digest', () => {
    const before = computeCandidateContentDigest(root);
    fs.mkdirSync(path.join(root, '.awm', 'evidence', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(root, '.awm', 'evidence', 'runs', 'noise.json'), '{"x":1}\n');
    expect(computeCandidateContentDigest(root)).toBe(before);
  });

  test('S4-BQ-1: glob scope expands to real paths so edits change the digest', () => {
    const resolved = resolveScopePaths(root, ['*.txt']);
    const before = computeCandidateContentDigest(root, resolved);
    expect(before).toMatch(/^sha256:[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'edited\n');
    expect(computeCandidateContentDigest(root, resolved)).not.toBe(before);
  });

  test('S4-BQ-1: vacuous/unresolved scope fails closed (no empty-set digest)', () => {
    expect(() => resolveScopePaths(root, ['no-such-*.xyz'])).toThrow(/scope|empty|unresolved|vacuous/i);
    expect(() => resolveScopePaths(root, ['literally-missing.txt'])).toThrow(/scope|empty|unresolved|vacuous/i);
    expect(() => computeCandidateContentDigest(root, [])).toThrow(/scope|empty|unresolved|vacuous/i);
  });

  test('resolved literal file[1].txt does not also digest file1.txt (path-as-glob)', () => {
    fs.writeFileSync(path.join(root, 'file1.txt'), 'one\n');
    fs.writeFileSync(path.join(root, 'file[1].txt'), 'bracket\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-qm', 'both']);
    const resolved = ['file[1].txt'];
    const before = computeCandidateContentDigest(root, resolved);
    fs.writeFileSync(path.join(root, 'file1.txt'), 'mutated-sibling\n');
    expect(computeCandidateContentDigest(root, resolved)).toBe(before);
    fs.writeFileSync(path.join(root, 'file[1].txt'), 'mutated-bracket\n');
    expect(computeCandidateContentDigest(root, resolved)).not.toBe(before);
  });
});
