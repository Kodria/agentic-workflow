import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { captureCycleEvidence } from '../../core/evidence/capture';
import { writeCycleEvidence } from '../../core/evidence/store';
import { readJournal } from '../../core/journal/store';
import { detectBranch, listEntries } from '../../core/ledger/store';
import type { JournalState } from '../../core/journal/types';

function assertRepoRelativePlan(value: unknown): string {
  if (typeof value !== 'string' || !value || value.startsWith('--') || path.isAbsolute(value)
    || value.includes('\\') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('--plan requires a repo-relative path');
  }
  return value;
}

export function registerEvidenceCommand(program: Command): void {
  const evidence = program.command('evidence').description('durable privacy-preserving cycle observations');
  evidence.command('capture')
    .description('capture one local cycle observation')
    .option('--plan <path>', 'repo-relative plan path')
    .option('--pr-provider <provider>', 'github | gitlab | other')
    .option('--pr-number <number>', 'pull request number')
    .action((opts: { plan?: unknown; prProvider?: unknown; prNumber?: unknown }) => {
      const result = runEvidenceCapture(process.cwd(), opts.plan, { prProvider: opts.prProvider, prNumber: opts.prNumber });
      if (result.code === 0) process.stdout.write(result.stdout); else { process.stderr.write(`awm evidence capture: ${result.error}\n`); process.exitCode = 2; }
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
    const first = evaluated.find((job) => job.attemptOf === undefined || !evaluated.some((candidate) => candidate.id === job.attemptOf));
    return { required: true, passed: first?.verdict === 'pass' };
  });
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
    const saved = writeCycleEvidence(root, captureCycleEvidence({ root, repositoryIdentity: repositoryIdentity(root, overrides?.repositoryIdentity), planPath, journal: read.state, gates: firstEvaluationGates(read.state), ledger: overrides?.ledger ?? listEntries(root, branch), pr }));
    return { code: 0, stdout: `${saved.cycleId}\n` };
  } catch (error) { return { code: 2, stdout: '', error: (error as Error).message }; }
}
