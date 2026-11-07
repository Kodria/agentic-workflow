import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { Command } from 'commander';
import { captureCycleEvidence } from '../../core/evidence/capture';
import { writeCycleEvidence } from '../../core/evidence/store';
import {
  boundResultSummary,
  computeCandidateContentDigest,
  readMechanicalRunEvidenceFile,
  redactMechanicalArgv,
  resolveHeadCommit,
  sealMechanicalRunEvidence,
  writeMechanicalRunEvidence,
} from '../../core/evidence/mechanical-run';
import { readJournal } from '../../core/journal/store';
import { detectBranch, listEntries } from '../../core/ledger/store';
import type { JournalState } from '../../core/journal/types';
import { classifyPlanState, type PlanState } from '../../core/dashboard/plan-state';
import type { CycleEvidencePlanState } from '../../core/evidence/types';

function assertRepoRelativePlan(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('--') || path.isAbsolute(value)
    || value.includes('\\') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('--plan requires a repo-relative path');
  }
  return value;
}

function currentRelease(lines: readonly string[]): string | undefined {
  const releases = lines.flatMap((line) => {
    const match = /^\s*\d+\.\s+\*\*Release\s+([A-Za-z0-9][A-Za-z0-9_-]*)\s*\/\s*#\d+:\*\*/.exec(line);
    return match ? [match[1]] : [];
  });
  return releases.length > 1 ? releases.at(-1) : undefined;
}

function marker(lines: readonly string[], name: 'awm-qa-complete' | 'awm-docs-complete' | 'awm-retro-complete', release: string | undefined): boolean {
  // Split into two non-overlapping alternatives (no-colon vs colon) so no `\s*`
  // ever sits directly adjacent to the lazy `[^\r\n]*?` group — that adjacency
  // is what turns a long unterminated marker line into catastrophic backtracking.
  const expression = new RegExp(`^\\s*<!--\\s*${name}(?:\\s*-->\\s*$|\\s*:[^\\r\\n]*?-->\\s*$)`);
  if (release === undefined) return lines.some((line) => expression.test(line));
  const releaseExpression = new RegExp(`\\bRelease\\s+${release.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
  return lines.some((line) => expression.test(line) && releaseExpression.test(line));
}

/** `docs_pending` es un estado vivo del dashboard; el registro durable no lo conoce (schema 1). */
function forEvidence(state: PlanState): CycleEvidencePlanState {
  return state === 'docs_pending' ? 'retro_pending' : state;
}

/** Reads only structural lifecycle syntax; plan prose never crosses into evidence. */
function planState(root: string, planPath: string, journal: JournalState): CycleEvidencePlanState {
  const file = path.join(root, planPath);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('--plan must reference a regular file');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)); } catch { throw new Error('--plan must be valid UTF-8'); }
  if (source.includes('\0')) throw new Error('--plan must not contain NUL bytes');
  let fenced = false;
  let total = 0;
  let completed = 0;
  const visibleLines: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    visibleLines.push(line);
    if (!/^\s*[-*+]\s+\[/.test(line)) continue;
    const candidate = /^\s*[-*+]\s+\[([^\]])\](?:\s+(.*))?$/.exec(line);
    if (!candidate) throw new Error('--plan contains an invalid checklist task');
    if ((candidate[1] !== ' ' && candidate[1] !== 'x' && candidate[1] !== 'X') || !candidate[2]?.trim()) throw new Error('--plan contains an invalid checklist task');
    total += 1;
    if (candidate[1] === 'x' || candidate[1] === 'X') completed += 1;
  }
  if (fenced) throw new Error('--plan contains an unclosed fenced block');
  const status = journal.cycle?.status;
  if (status !== 'IN_PROGRESS' && status !== 'COMPLETE' && status !== 'BLOCKED') throw new Error('journal cycle status is invalid');
  const release = currentRelease(visibleLines);
  return forEvidence(classifyPlanState({
    ...(status === 'IN_PROGRESS' ? { journal: { state: 'active' } } : status === 'BLOCKED' ? { journal: { state: 'blocked' } } : {}),
    markers: {
      qaComplete: marker(visibleLines, 'awm-qa-complete', release),
      docsComplete: marker(visibleLines, 'awm-docs-complete', release),
      retroComplete: marker(visibleLines, 'awm-retro-complete', release),
    },
    tasks: { total, completed },
  }));
}

export function registerEvidenceCommand(program: Command): void {
  const evidence = program.command('evidence').description('durable privacy-preserving cycle observations and mechanical run receipts');
  evidence.command('capture')
    .description('capture one local cycle observation')
    .option('--plan <path>', 'repo-relative plan path')
    .option('--pr-provider <provider>', 'github | gitlab | other')
    .option('--pr-number <number>', 'pull request number')
    .action((opts: { plan?: unknown; prProvider?: unknown; prNumber?: unknown }) => {
      const result = runEvidenceCapture(process.cwd(), opts.plan, { prProvider: opts.prProvider, prNumber: opts.prNumber });
      if (result.code === 0) process.stdout.write(result.stdout); else { process.stderr.write(`awm evidence capture: ${result.error}\n`); process.exitCode = 2; }
    });

  evidence.command('run')
    .description('run a command and write a MechanicalRunEvidence receipt (not CycleEvidenceV1)')
    .option('--cwd <dir>', 'working directory (absolute or repo-relative)', '.')
    .option('--paths <globs...>', 'optional declared scope paths recorded on the receipt')
    .argument('<cmd...>', 'command after --')
    .action(async (cmd: string[], opts: { cwd?: string; paths?: string[] }) => {
      const result = await runEvidenceRun({ root: process.cwd(), argv: cmd, cwd: opts.cwd, declaredScope: opts.paths });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.code;
    });

  evidence.command('verify')
    .description('verify a MechanicalRunEvidence receipt against the current candidate')
    .argument('<receipt-path>', 'path to a MechanicalRunEvidence JSON file')
    .argument('[expectCmd...]', 'optional expected argv after -- for argv contrast')
    .action((receiptPath: string, expectCmd: string[]) => {
      const result = runEvidenceVerify({
        root: process.cwd(),
        receiptPath,
        ...(expectCmd.length > 0 ? { expectArgv: expectCmd } : {}),
      });
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.code;
    });
}

function firstEvaluationGates(state: JournalState): Array<{ required: true; passed: boolean }> {
  return state.cycleVerificationPlan.map((gate) => {
    if (gate.kind === 'review') {
      const verdict = state.verdicts.filter((candidate) => candidate.obligationId === gate.id)
        .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.id.localeCompare(right.id))[0];
      return { required: true, passed: verdict?.result === 'pass' };
    }
    const evaluated = Object.values(state.jobs).filter((job) => job.satisfies?.includes(gate.id));
    const first = evaluated.filter((job) => job.attemptOf === undefined || !evaluated.some((candidate) => candidate.id === job.attemptOf))
      .sort((left, right) => jobTimestamp(left).localeCompare(jobTimestamp(right)) || left.id.localeCompare(right.id))[0];
    return { required: true, passed: first?.verdict === 'pass' };
  });
}

function jobTimestamp(job: JournalState['jobs'][string]): string {
  const timestamp = job.result?.endedAt ?? job.phaseTimestamps.received ?? job.phaseTimestamps.exited;
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) throw new Error(`gate job ${job.id} lacks a durable evaluation timestamp`);
  return timestamp;
}

function repositoryIdentity(root: string, supplied: unknown): string {
  if (supplied !== undefined) {
    if (typeof supplied !== 'string' || !supplied || supplied.length > 4096 || /[\r\n]/.test(supplied)) throw new Error('repository identity is invalid');
    return supplied;
  }
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim();
    if (!remote || remote.length > 4096 || /[\r\n]/.test(remote)) throw new Error('invalid');
    return remote;
  } catch { throw new Error('repository identity unavailable: configure remote.origin.url'); }
}

export function runEvidenceCapture(root: string, plan: unknown, overrides?: { repositoryIdentity?: unknown; journal?: unknown; ledger?: unknown; prProvider?: unknown; prNumber?: unknown }): { code: 0 | 2; stdout: string; error?: string } {
  try {
    const planPath = assertRepoRelativePlan(plan);
    if (!fs.existsSync(path.join(root, planPath))) throw new Error('--plan must reference an existing file');
    const branch = detectBranch(root);
    const read = overrides?.journal === undefined ? readJournal(root, branch) : { corrupt: false, state: overrides.journal as JournalState };
    if (read.corrupt || !read.state) throw new Error('current journal is unavailable or corrupt');
    let pr: { provider: unknown; number: unknown } | undefined;
    if (overrides?.prProvider !== undefined || overrides?.prNumber !== undefined) {
      if (overrides.prProvider === undefined || overrides.prNumber === undefined || typeof overrides.prNumber !== 'string' || !/^\d+$/.test(overrides.prNumber)) throw new Error('--pr-provider and --pr-number must be supplied together');
      pr = { provider: overrides.prProvider, number: Number(overrides.prNumber) };
    }
    const saved = writeCycleEvidence(root, captureCycleEvidence({ root, repositoryIdentity: repositoryIdentity(root, overrides?.repositoryIdentity), planPath, journal: read.state, gates: firstEvaluationGates(read.state), ledger: overrides?.ledger ?? listEntries(root, branch), pr, planState: planState(root, planPath, read.state) }));
    return { code: 0, stdout: `${saved.cycleId}\n` };
  } catch (error) { return { code: 2, stdout: '', error: (error as Error).message }; }
}

const MAX_CAPTURE_BYTES = 64 * 1024;

function resolveRunCwd(root: string, cwdOption: string | undefined): string {
  const rootReal = fs.realpathSync(root);
  if (cwdOption === undefined || cwdOption === '.' || cwdOption === '') return rootReal;
  const candidate = path.isAbsolute(cwdOption) ? cwdOption : path.join(rootReal, cwdOption);
  const real = fs.realpathSync(candidate);
  const rel = path.relative(rootReal, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('--cwd must resolve under the repository root');
  return real;
}

function captureChild(argv: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('command argv is required');
  if (argv.some((a) => typeof a !== 'string' || a.includes('\0'))) throw new Error('argv is invalid');
  const [exe, ...args] = argv;
  return new Promise((resolve) => {
    const child = spawn(exe!, args, { cwd, shell: false, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const take = (chunks: Buffer[], seen: { n: number }, chunk: Buffer): void => {
      if (seen.n >= MAX_CAPTURE_BYTES) return;
      const piece = chunk.subarray(0, MAX_CAPTURE_BYTES - seen.n);
      chunks.push(Buffer.from(piece));
      seen.n += piece.length;
    };
    const stdoutSeen = { n: 0 };
    const stderrSeen = { n: 0 };
    child.stdout?.on('data', (chunk: Buffer) => { take(stdoutChunks, stdoutSeen, chunk); stdoutBytes = stdoutSeen.n; });
    child.stderr?.on('data', (chunk: Buffer) => { take(stderrChunks, stderrSeen, chunk); stderrBytes = stderrSeen.n; });
    const finish = (exitCode: number) => resolve({
      exitCode,
      stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
      stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
    });
    child.on('error', () => finish(127));
    child.on('exit', (code) => finish(typeof code === 'number' && code >= 0 && code <= 255 ? code : 1));
  });
}

export type EvidenceRunResult = {
  code: number;
  stdout: string;
  stderr: string;
  receiptPath?: string;
};

/** Execute argv and persist MechanicalRunEvidence (RF-3.1 / RF-3.4 / RF-5.1). */
export async function runEvidenceRun(input: {
  root: string;
  argv: string[];
  cwd?: string;
  declaredScope?: string[];
  resolvedScope?: string[];
}): Promise<EvidenceRunResult> {
  try {
    if (!input || typeof input.root !== 'string' || input.root.length === 0) throw new Error('root is required');
    if (!Array.isArray(input.argv) || input.argv.length === 0) throw new Error('argv is required');
    const rootReal = fs.realpathSync(input.root);
    const cwd = resolveRunCwd(rootReal, input.cwd);
    const declared = Array.isArray(input.declaredScope) ? input.declaredScope : [];
    const resolved = Array.isArray(input.resolvedScope) ? input.resolvedScope : declared;
    const started = Date.now();
    const ranAt = new Date(started).toISOString();
    const child = await captureChild(input.argv, cwd);
    const durationMs = Math.max(0, Date.now() - started);
    const contentDigest = computeCandidateContentDigest(rootReal, resolved.length > 0 ? resolved : undefined);
    const sealed = sealMechanicalRunEvidence({
      ranAt,
      durationMs,
      candidate: { headCommit: resolveHeadCommit(rootReal), contentDigest },
      argv: redactMechanicalArgv(input.argv),
      cwd,
      exitCode: child.exitCode,
      resultSummary: boundResultSummary(child.stdout, child.stderr),
      scope: { declared, resolved },
    });
    const receiptPath = writeMechanicalRunEvidence(rootReal, sealed);
    return { code: child.exitCode, stdout: `${receiptPath}\n`, stderr: '', receiptPath };
  } catch (error) {
    return { code: 2, stdout: '', stderr: `awm evidence run: ${(error as Error).message}\n` };
  }
}

export type EvidenceVerifyResult = { code: 0 | 2; stdout: string; stderr: string };

/** Contrast a MechanicalRunEvidence receipt with the current candidate (RF-3.9 / RF-E.1). */
export function runEvidenceVerify(input: {
  root: string;
  receiptPath: string;
  expectArgv?: string[];
  expectCwd?: string;
}): EvidenceVerifyResult {
  const mismatch = (reason: string): EvidenceVerifyResult => ({
    code: 2,
    stdout: `${JSON.stringify({ status: 'mismatch', reason })}\n`,
    stderr: '',
  });
  try {
    if (!input || typeof input.root !== 'string' || typeof input.receiptPath !== 'string') {
      return mismatch('absent');
    }
    const rootReal = fs.realpathSync(input.root);
    let evidence;
    try {
      evidence = readMechanicalRunEvidenceFile(input.receiptPath);
    } catch (error) {
      const message = (error as Error).message;
      if (/symlink/i.test(message)) return mismatch('symlink');
      if (/integrity/i.test(message)) return mismatch('integrity');
      return mismatch('absent');
    }
    const expectedCwd = input.expectCwd !== undefined ? resolveRunCwd(rootReal, input.expectCwd) : rootReal;
    let recordedCwd: string;
    try {
      recordedCwd = fs.realpathSync(evidence.cwd);
    } catch {
      return mismatch('cwd');
    }
    if (recordedCwd !== expectedCwd) return mismatch('cwd');
    if (input.expectArgv !== undefined) {
      const expected = redactMechanicalArgv(input.expectArgv);
      if (expected.length !== evidence.argv.length || expected.some((token, i) => token !== evidence.argv[i])) {
        return mismatch('argv');
      }
    }
    const scopePaths = evidence.scope.resolved.length > 0 ? evidence.scope.resolved : undefined;
    const currentDigest = computeCandidateContentDigest(rootReal, scopePaths);
    if (currentDigest !== evidence.candidate.contentDigest) return mismatch('contentDigest');
    return { code: 0, stdout: `${JSON.stringify({ status: 'match' })}\n`, stderr: '' };
  } catch (error) {
    return mismatch(/integrity/i.test((error as Error).message) ? 'integrity' : 'absent');
  }
}
