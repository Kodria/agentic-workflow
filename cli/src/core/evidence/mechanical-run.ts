/**
 * MechanicalRunEvidence — integrity-bound command-run receipts (RF-3.1+).
 *
 * Distinct from CycleEvidenceV1 (`awm evidence capture`): this schema records
 * argv/cwd/exit/duration for reviewer contrast via `awm evidence run` /
 * `awm evidence verify`. Sensors never write this format (RF-3.2).
 *
 * Equivalence contract (RF-3.4 / RF-3.9): candidate contentDigest + recorded
 * argv/cwd/scope. Environment variables that affect tool output are **out of
 * band** — they are not hashed into contentDigest and are not compared by
 * verify. Controllers that need env-sensitive gates MUST re-execute or pass
 * env via explicit argv.
 *
 * Scope (S4-BQ-1): `--paths` patterns are picomatch globs expanded against the
 * candidate worktree before digesting. An empty expansion (vacuous scope) fails
 * closed — never an empty-set SHA-256 that would false-match after edits.
 */
/// <reference path="../../types/picomatch-posix.d.ts" />
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import picomatch from 'picomatch/posix';
import { writeFileAtomicDurable } from '../atomic-file';
import { execGit } from '../changes/git-env';
import { redactArgv, redactText } from '../journal/redact';

/** Same picomatch options as sensor input digests (`dot` + POSIX classes). */
const SCOPE_MATCH_OPTIONS = { dot: true, posix: true } as const;

export const MECHANICAL_RUN_SCHEMA = 'mechanical-run-evidence/v1' as const;
export const RESULT_SUMMARY_MAX_BYTES = 4096;
const DIGEST_HEX = /^[a-f0-9]{64}$/;
const DIGEST_SHA = /^sha256:[a-f0-9]{64}$/;
const COMMIT_OR_EMPTY = /^(?:[a-f0-9]{40}|)$/;
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_ARGV = 256;
const MAX_ARGV_BYTES = 1024 * 1024;
const MAX_DIGEST_FILE_BYTES = 1024 * 1024;
/** Paths under this prefix never enter candidate contentDigest (runtime evidence). */
const EVIDENCE_RUNTIME_PREFIX = '.awm/evidence';

export type MechanicalRunScope = {
  declared: string[];
  resolved: string[];
};

export type MechanicalRunCandidate = {
  headCommit: string;
  contentDigest: string;
};

export type MechanicalRunEvidence = {
  schema: typeof MECHANICAL_RUN_SCHEMA;
  id: string;
  ranAt: string;
  durationMs: number;
  candidate: MechanicalRunCandidate;
  argv: string[];
  cwd: string;
  exitCode: number;
  resultSummary: string;
  scope: MechanicalRunScope;
  integrityDigest: string;
};

export type MechanicalRunBody = Omit<MechanicalRunEvidence, 'integrityDigest'>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, label: string, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} has unsupported fields`);
}

function sha256Prefixed(payload: string): string {
  return `sha256:${crypto.createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

function canonicalBody(body: MechanicalRunBody): string {
  return JSON.stringify({
    schema: body.schema,
    id: body.id,
    ranAt: body.ranAt,
    durationMs: body.durationMs,
    candidate: {
      headCommit: body.candidate.headCommit,
      contentDigest: body.candidate.contentDigest,
    },
    argv: body.argv,
    cwd: body.cwd,
    exitCode: body.exitCode,
    resultSummary: body.resultSummary,
    scope: {
      declared: [...body.scope.declared],
      resolved: [...body.scope.resolved],
    },
  });
}

/** Integrity digest over the canonical payload excluding integrityDigest (RF-3.7). */
export function computeIntegrityDigest(body: MechanicalRunBody): string {
  if (!body || typeof body !== 'object') throw new Error('integrity body must be an object');
  return sha256Prefixed(canonicalBody(body));
}

function assertSafeRepoRel(value: string, label: string): string {
  if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

function validateScope(value: unknown): MechanicalRunScope {
  const scope = record(value, 'scope');
  keys(scope, 'scope', ['declared', 'resolved']);
  if (!Array.isArray(scope.declared) || !Array.isArray(scope.resolved)) throw new Error('scope paths must be arrays');
  if (scope.declared.length > 4096 || scope.resolved.length > 4096) throw new Error('scope is unbounded');
  const declared = scope.declared.map((p, i) => {
    if (typeof p !== 'string') throw new Error(`scope.declared[${i}] must be a string`);
    return assertSafeRepoRel(p, `scope.declared[${i}]`);
  });
  const resolved = scope.resolved.map((p, i) => {
    if (typeof p !== 'string') throw new Error(`scope.resolved[${i}] must be a string`);
    return assertSafeRepoRel(p, `scope.resolved[${i}]`);
  });
  return { declared, resolved };
}

/** Strict durable-boundary validator (RF-3.1 / RF-3.6 / RF-3.7 / RF-E.1). */
export function validateMechanicalRunEvidence(input: unknown): MechanicalRunEvidence {
  const value = record(input, 'mechanical run evidence');
  keys(value, 'mechanical run evidence', [
    'schema', 'id', 'ranAt', 'durationMs', 'candidate', 'argv', 'cwd', 'exitCode', 'resultSummary', 'scope', 'integrityDigest',
  ]);
  if (value.schema !== MECHANICAL_RUN_SCHEMA) throw new Error('mechanical run evidence schema must be mechanical-run-evidence/v1');
  if (typeof value.id !== 'string' || !DIGEST_HEX.test(value.id)) throw new Error('id must be a SHA-256 hex digest');
  if (typeof value.ranAt !== 'string' || !ISO_Z.test(value.ranAt) || Number.isNaN(Date.parse(value.ranAt)) || new Date(value.ranAt).toISOString() !== value.ranAt) {
    throw new Error('ranAt must be a canonical ISO timestamp');
  }
  if (typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0) {
    throw new Error('durationMs must be a non-negative integer');
  }
  const candidate = record(value.candidate, 'candidate');
  keys(candidate, 'candidate', ['headCommit', 'contentDigest']);
  if (typeof candidate.headCommit !== 'string' || !COMMIT_OR_EMPTY.test(candidate.headCommit)) {
    throw new Error('candidate.headCommit must be a 40-hex commit or empty');
  }
  if (typeof candidate.contentDigest !== 'string' || !DIGEST_SHA.test(candidate.contentDigest)) {
    throw new Error('candidate.contentDigest must be sha256:<hex>');
  }
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.length > MAX_ARGV
    || value.argv.some((a) => typeof a !== 'string' || a.includes('\0') || a.length > 65536)
    || value.argv.reduce((n, a) => n + Buffer.byteLength(a, 'utf8'), 0) > MAX_ARGV_BYTES) {
    throw new Error('argv is invalid or unbounded');
  }
  if (typeof value.cwd !== 'string' || value.cwd.length === 0 || value.cwd.length > 4096 || /[\r\n\0]/.test(value.cwd)) {
    throw new Error('cwd is invalid');
  }
  if (typeof value.exitCode !== 'number' || !Number.isSafeInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255) {
    throw new Error('exitCode must be an integer 0–255');
  }
  if (typeof value.resultSummary !== 'string') throw new Error('resultSummary must be a string');
  if (Buffer.byteLength(value.resultSummary, 'utf8') > RESULT_SUMMARY_MAX_BYTES) {
    throw new Error('resultSummary exceeds size bound');
  }
  const scope = validateScope(value.scope);
  if (typeof value.integrityDigest !== 'string' || !DIGEST_SHA.test(value.integrityDigest)) {
    throw new Error('integrityDigest must be sha256:<hex>');
  }
  const body: MechanicalRunBody = {
    schema: MECHANICAL_RUN_SCHEMA,
    id: value.id,
    ranAt: value.ranAt,
    durationMs: value.durationMs,
    candidate: { headCommit: candidate.headCommit, contentDigest: candidate.contentDigest },
    argv: [...value.argv] as string[],
    cwd: value.cwd,
    exitCode: value.exitCode,
    resultSummary: value.resultSummary,
    scope,
  };
  const expected = computeIntegrityDigest(body);
  if (value.integrityDigest !== expected) throw new Error('integrityDigest mismatch (tampered or corrupt receipt)');
  return { ...body, integrityDigest: expected };
}

const AUTHORIZATION_TOKEN = /^(authorization)$/i;
const AUTHORIZATION_INLINE = /^(authorization\s*[:=]\s*)(.+)$/i;

/**
 * Redact secret-shaped argv for durable receipts (RF-3.4).
 * Reuses journal redactArgv for --token=/--password=/--api-key= family, then
 * additionally blanks AUTHORIZATION-like header tokens.
 */
export function redactMechanicalArgv(argv: string[]): string[] {
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== 'string')) throw new Error('argv must be string[]');
  const base = redactArgv(argv);
  const out: string[] = [];
  for (let i = 0; i < base.length; i++) {
    const arg = base[i]!;
    const inline = AUTHORIZATION_INLINE.exec(arg);
    if (inline) {
      out.push(`${inline[1]}[REDACTED]`);
      continue;
    }
    if (AUTHORIZATION_TOKEN.test(arg) && i + 1 < base.length) {
      out.push(arg);
      out.push('[REDACTED]');
      i++;
      continue;
    }
    // Header form often arrives as a single `-H` value: "Authorization: Bearer …"
    if (/authorization\s*[:=]/i.test(arg)) {
      out.push(arg.replace(/(authorization\s*[:=]\s*)(.+)$/i, '$1[REDACTED]'));
      continue;
    }
    out.push(arg);
  }
  return out;
}

export function boundResultSummary(stdout: string, stderr: string): string {
  const merged = [stdout, stderr].filter((s) => s.length > 0).join('\n');
  const redacted = redactText(merged);
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.length <= RESULT_SUMMARY_MAX_BYTES) return redacted;
  return bytes.subarray(0, RESULT_SUMMARY_MAX_BYTES).toString('utf8');
}

function isEvidenceRuntimePath(repoRel: string): boolean {
  const norm = repoRel.split(path.sep).join('/');
  return norm === EVIDENCE_RUNTIME_PREFIX || norm.startsWith(`${EVIDENCE_RUNTIME_PREFIX}/`);
}

function listCandidatePaths(root: string): string[] {
  try {
    const out = execGit(root, ['ls-files', '-co', '--exclude-standard', '-z'], { stderr: 'ignore' });
    return out.split('\0').filter((p) => p.length > 0 && !isEvidenceRuntimePath(p));
  } catch {
    throw new Error('candidate contentDigest unavailable: git enumeration failed');
  }
}

function hashPathContribution(root: string, repoRel: string): string {
  const abs = path.join(root, repoRel);
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) {
      return `symlink:${fs.readlinkSync(abs)}`;
    }
    if (!st.isFile()) return `special:${st.mode}`;
    if (st.size > MAX_DIGEST_FILE_BYTES) return `oversize:${st.size}`;
    return `file:${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}

/**
 * Expand declared scope patterns (exact paths and/or picomatch globs) to real
 * repo-relative candidate paths. Fails closed when the expansion is empty (S4-BQ-1).
 */
export function resolveScopePaths(root: string, patterns: readonly string[]): string[] {
  if (typeof root !== 'string' || root.length === 0) throw new Error('scope root must be a non-empty string');
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error('scope patterns must be a non-empty string[]');
  }
  if (patterns.some((p) => typeof p !== 'string' || p.length === 0 || p.includes('\0'))) {
    throw new Error('scope patterns must be non-empty strings');
  }
  const rootReal = fs.realpathSync(root);
  const candidates = listCandidatePaths(rootReal).map((p) => p.split(path.sep).join('/'));
  const matchers = patterns.map((pattern) => {
    const norm = pattern.split(path.sep).join('/');
    return picomatch(norm, { ...SCOPE_MATCH_OPTIONS });
  });
  const matched = new Set<string>();
  for (const repoRel of candidates) {
    if (matchers.some((m) => m(repoRel))) matched.add(repoRel);
  }
  if (matched.size === 0) {
    throw new Error('scope expansion is empty (vacuous/unresolved --paths); refusing empty-set contentDigest');
  }
  return [...matched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Worktree content digest for candidate identity (RF-3.6). Shared by
 * `evidence run` (seal) and `evidence verify` (recompute). Env is intentionally
 * excluded (see module header). When `scopePaths` is provided it is treated as
 * already-resolved repo-rel paths OR as patterns to expand (via resolveScopePaths);
 * empty expansion fails closed (S4-BQ-1).
 */
export function computeCandidateContentDigest(root: string, scopePaths?: readonly string[]): string {
  if (typeof root !== 'string' || root.length === 0) throw new Error('contentDigest root must be a non-empty string');
  const rootReal = fs.realpathSync(root);
  let paths: string[];
  if (scopePaths === undefined) {
    paths = listCandidatePaths(rootReal).map((p) => p.split(path.sep).join('/'));
  } else {
    // Expand globs / validate non-empty intersection with the candidate set.
    paths = resolveScopePaths(rootReal, scopePaths);
  }
  paths = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const hash = crypto.createHash('sha256');
  for (const repoRel of paths) {
    hash.update(`${repoRel}\0${hashPathContribution(rootReal, repoRel)}\0`);
  }
  return `sha256:${hash.digest('hex')}`;
}

export function resolveHeadCommit(root: string): string {
  try {
    const commit = execGit(root, ['rev-parse', 'HEAD'], { stderr: 'ignore' }).trim();
    return /^[a-f0-9]{40}$/.test(commit) ? commit : '';
  } catch {
    return '';
  }
}

function safeDirectory(directory: string, label: string): string {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`unsafe evidence ${label} directory symlink or non-directory`);
  return fs.realpathSync(directory);
}

function assertNoSymlinkChain(root: string): void {
  let current = root;
  for (const segment of ['.awm', 'evidence', 'runs']) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing to use symlinked evidence store path ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function ensureRunsIgnore(runsDir: string): void {
  const file = path.join(runsDir, '.gitignore');
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('refusing to use symlinked evidence runs .gitignore');
    if (stat.isFile() && fs.readFileSync(file, 'utf8') === '*\n') return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  writeFileAtomicDurable(file, '*\n', 0o644);
}

/** Seal + persist under `.awm/evidence/runs/` (0600, self-ignored `*`) — RF-3.4. */
export function writeMechanicalRunEvidence(root: string, evidence: unknown): string {
  if (typeof root !== 'string' || root.length === 0) throw new Error('evidence root must be a non-empty string');
  const valid = validateMechanicalRunEvidence(evidence);
  const safeRoot = safeDirectory(root, 'root');
  assertNoSymlinkChain(safeRoot);
  let directory = safeRoot;
  for (const segment of ['.awm', 'evidence', 'runs']) {
    directory = path.join(directory, segment);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    directory = safeDirectory(directory, segment);
  }
  assertNoSymlinkChain(safeRoot);
  ensureRunsIgnore(directory);
  const file = path.join(directory, `${valid.id}.json`);
  writeFileAtomicDurable(file, JSON.stringify(valid, null, 2) + '\n', 0o600);
  fs.chmodSync(file, 0o600);
  return file;
}

export function sealMechanicalRunEvidence(input: Omit<MechanicalRunBody, 'id' | 'schema'> & { schema?: typeof MECHANICAL_RUN_SCHEMA }): MechanicalRunEvidence {
  const withoutId: Omit<MechanicalRunBody, 'id'> = {
    schema: MECHANICAL_RUN_SCHEMA,
    ranAt: input.ranAt,
    durationMs: input.durationMs,
    candidate: input.candidate,
    argv: input.argv,
    cwd: input.cwd,
    exitCode: input.exitCode,
    resultSummary: input.resultSummary,
    scope: input.scope,
  };
  const id = crypto.createHash('sha256').update(JSON.stringify(withoutId)).digest('hex');
  const body: MechanicalRunBody = { ...withoutId, id };
  return { ...body, integrityDigest: computeIntegrityDigest(body) };
}

export function readMechanicalRunEvidenceFile(filePath: string): MechanicalRunEvidence {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('receipt path is required');
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('receipt path must be a regular file (symlink refused)');
  const raw = fs.readFileSync(filePath);
  if (raw.length > 1024 * 1024) throw new Error('receipt exceeds size bound');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new Error('receipt is not valid UTF-8 JSON');
  }
  return validateMechanicalRunEvidence(parsed);
}
