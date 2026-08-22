import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { captureCycleEvidence } from '../../core/evidence/capture';
import { writeCycleEvidence } from '../../core/evidence/store';
import { readJournal } from '../../core/journal/store';
import { detectBranch, listEntries } from '../../core/ledger/store';

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
      try {
        const root = process.cwd();
        const planPath = assertRepoRelativePlan(opts.plan);
        if (!fs.existsSync(path.join(root, planPath))) throw new Error('--plan must reference an existing file');
        const branch = detectBranch(root);
        const read = readJournal(root, branch);
        if (read.corrupt || !read.state) throw new Error('current journal is unavailable or corrupt');
        let pr: { provider: unknown; number: unknown } | undefined;
        if (opts.prProvider !== undefined || opts.prNumber !== undefined) {
          if (opts.prProvider === undefined || opts.prNumber === undefined || typeof opts.prNumber !== 'string' || !/^\d+$/.test(opts.prNumber)) throw new Error('--pr-provider and --pr-number must be supplied together');
          pr = { provider: opts.prProvider, number: Number(opts.prNumber) };
        }
        const saved = writeCycleEvidence(root, captureCycleEvidence({
          root, planPath, journal: read.state,
          gates: read.state.cycleVerificationPlan.map((gate) => ({ required: true, passed: gate.satisfiedBy !== undefined })),
          ledger: listEntries(root, branch), pr,
        }));
        process.stdout.write(`${saved.cycleId}\n`);
      } catch (error) {
        process.stderr.write(`awm evidence capture: ${(error as Error).message}\n`);
        process.exitCode = 2;
      }
    });
}
