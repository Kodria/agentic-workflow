import { Command } from 'commander';
import pc from 'picocolors';
import { preflight, PreflightReport } from './checks';

/**
 * Exit code. Anything but `ready` exits 1.
 *
 * Unlike `awm sensors run` — which exits 0 on `not_certified` because exit 2 is a
 * blocking error in Claude Code hooks — preflight is never a hook. It is invoked
 * explicitly by a phase gate, so the exit code can carry the verdict and the caller
 * does not have to remember to read a field out of JSON.
 */
export function exitCodeFor(report: PreflightReport): number {
    return report.status === 'ready' ? 0 : 1;
}

export function formatReport(report: PreflightReport): string {
    // Computed from the actual ids present, not hardcoded to the widest id THIS
    // report happens to have — a fixed literal here silently misaligns the moment a
    // longer `PreflightCheck['id']` is added (confirmed: 'sensors-baseline', at 16
    // chars, broke a hardcoded 9-char pad).
    const idWidth = Math.max(0, ...report.checks.map(c => c.id.length));
    const lines = report.checks.map(c =>
        `  ${c.ok ? pc.green('✔') : pc.red('✘')}  ${c.id.padEnd(idWidth)} ${c.detail}`
        + (c.remedy ? `\n       ${pc.dim('→ ' + c.remedy)}` : ''),
    );

    if (report.status === 'ready') {
        return `${pc.green('✔')}  Harness ready — this project can be gated.\n${lines.join('\n')}\n`;
    }
    const headline = report.status === 'not_configured'
        ? `${pc.red('✘')}  AWM is not configured in this project.`
        : `${pc.red('✘')}  Harness degraded — it declares sensors it cannot run.`;

    return `${headline}\n${lines.join('\n')}\n\n`
        + `   ${pc.bold('Do not hand this off to an unattended run.')} Every quality phase downstream\n`
        + `   (implementer, reviewers, post-qa) consumes \`awm sensors run\`. With the harness in\n`
        + `   this state the gate reports on checks that never ran, and nobody finds out until a\n`
        + `   bad change is already merged.\n`;
}

export function registerPreflightCommand(program: Command): void {
    program
        .command('preflight')
        .description('verify the project harness can actually gate before development starts')
        .option('--json', 'emit the report as JSON')
        .option('--cwd <path>', 'project directory to check (default: current)')
        .action((opts) => {
            const report = preflight(opts.cwd ?? process.cwd());
            process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : formatReport(report));
            const code = exitCodeFor(report);
            if (code !== 0) process.exit(code);
        });
}
