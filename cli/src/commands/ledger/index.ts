import { Command } from 'commander';
import { addEntry, listEntries, recurring, archiveLedger, detectBranch } from '../../core/ledger/store';
import type { LedgerEntry, Polarity, LedgerClass, Severity } from '../../core/ledger/types';

interface AddOpts {
    branch?: string; polarity: Polarity; class: LedgerClass; signature: string;
    severity: Severity; desc: string; ref?: string; phase?: string; sourceSkill?: string;
}

function archiveLabel(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
}

export function registerLedgerCommand(program: Command): void {
    const ledger = program.command('ledger').description('persistent per-branch findings ledger (working memory for harness-retro)');

    ledger
        .command('add')
        .description('append a finding or win to the current branch ledger')
        .requiredOption('--polarity <polarity>', 'win | finding')
        .requiredOption('--class <class>', 'structural | logica | proceso | seguridad')
        .requiredOption('--signature <slug>', 'dedup key for recurrence grouping')
        .requiredOption('--severity <severity>', 'blocker | important | minor | info')
        .requiredOption('--desc <text>', 'one-line description')
        .option('--ref <ref>', 'file:line or PR/commit reference')
        .option('--phase <phase>', 'lifecycle phase', 'unknown')
        .option('--source-skill <skill>', 'emitting skill', 'unknown')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: AddOpts) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            const entry: LedgerEntry = {
                ts: new Date().toISOString(),
                branch,
                phase: opts.phase ?? 'unknown',
                source_skill: opts.sourceSkill ?? 'unknown',
                polarity: opts.polarity,
                class: opts.class,
                signature: opts.signature,
                severity: opts.severity,
                desc: opts.desc,
                ref: opts.ref,
            };
            addEntry(cwd, entry);
        });

    ledger
        .command('list')
        .description('print the current branch ledger as JSON')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: { branch?: string }) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            process.stdout.write(JSON.stringify(listEntries(cwd, branch), null, 2) + '\n');
        });

    ledger
        .command('recurring')
        .description('print signature clusters with count >= min (recurrence signal)')
        .option('--min <n>', 'minimum occurrences', '2')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: { min: string; branch?: string }) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            const parsed = Number.parseInt(opts.min, 10);
            const min = Number.isNaN(parsed) || parsed < 1 ? 2 : parsed;
            process.stdout.write(JSON.stringify(recurring(cwd, branch, min), null, 2) + '\n');
        });

    ledger
        .command('archive')
        .description('rotate the current branch ledger out of the active flow')
        .option('--branch <branch>', 'override branch (default: git current branch)')
        .action((opts: { branch?: string }) => {
            const cwd = process.cwd();
            const branch = opts.branch ?? detectBranch(cwd);
            const moved = archiveLedger(cwd, branch, archiveLabel());
            if (!moved) {
                process.stderr.write(`awm ledger archive: no active ledger found for branch "${branch}" — nothing to archive\n`);
            }
            process.stdout.write(JSON.stringify({ archived: moved, branch }, null, 2) + '\n');
        });
}
