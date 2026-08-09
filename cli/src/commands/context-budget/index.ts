import { Command } from 'commander';
import pc from 'picocolors';
import { checkBudget, estimateTokens, CONFIG_FILE, DEFAULT_FILES, BudgetReport } from './budget';

const KB = (bytes: number) => `${(bytes / 1024).toFixed(0)}KB`;

/**
 * Exit code. `over` exits 1 so a caller that wants a hard gate can have one — but the
 * skill that invokes this (writing-plans, Context Budget Gate) deliberately does not
 * treat it as one. It runs at the last attended moment and presents a choice; blocking
 * would strand the unattended runs this whole design exists to protect.
 */
export function exitCodeFor(report: BudgetReport): number {
    return report.status === 'over' ? 1 : 0;
}

export function formatReport(report: BudgetReport): string {
    const tokens = `~${estimateTokens(report.totalBytes)}k tokens`;
    const breakdown = report.breakdown.map(b => `${b.file} ${KB(b.bytes)}`).join(', ');

    if (report.status === 'unmeasurable') {
        // Ni verde ni alarma: no hay nada que reportar todavia, y decir "0KB fijado"
        // seria afirmar una medicion que no ocurrio.
        return `${pc.dim('·')}  Nothing to measure yet: none of ${DEFAULT_FILES.join(', ')} exists.\n`
            + `   These are written by an agent session (\`awm init\` lists them as pending).\n`
            + `   Re-run this once they exist — pinning a budget of 0 would report every\n`
            + `   later run as over budget.\n`;
    }
    if (report.status === 'pinned') {
        return `${pc.green('✔')}  Context budget pinned at ${KB(report.totalBytes)} (${tokens} per session).\n`
            + `   ${breakdown}\n`
            + `   Saved to ${CONFIG_FILE} — commit it. Growth past this point will report here.\n`;
    }
    if (report.status === 'within') {
        return `${pc.green('✔')}  Context budget OK: ${KB(report.totalBytes)} of ${KB(report.maxBytes)} (${tokens} per session).\n`
            + `   ${breakdown}\n`;
    }
    const over = report.totalBytes - report.maxBytes;
    return `${pc.yellow('⚠')}  Context budget exceeded: ${KB(report.totalBytes)} vs ${KB(report.maxBytes)} `
        + `(over by ${KB(over)}).\n`
        + `   ${breakdown}\n`
        + `   These files are injected into EVERY session — ${tokens} spent before any code is read.\n\n`
        + `   Decide now, while you are here:\n`
        + `     1. Prune  — cheapest moment: that context is already loaded and you are\n`
        + `                 choosing what matters for the work about to start.\n`
        + `     2. Raise  — edit "maxBytes" in ${CONFIG_FILE}; a reviewed decision to keep\n`
        + `                 paying for this in every future session.\n`
        + `     3. Accept — proceed and note it in the plan.\n`;
}

export function registerContextBudgetCommand(program: Command): void {
    program
        .command('context-budget')
        .description('check the size of the files injected into every agent session')
        .option('--json', 'emit the report as JSON')
        .option('--cwd <path>', 'directory to measure (default: current)')
        .action((opts) => {
            const report = checkBudget(opts.cwd ?? process.cwd());
            process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : formatReport(report));
            const code = exitCodeFor(report);
            if (code !== 0) process.exit(code);
        });
}
