import { Command } from 'commander';
import pc from 'picocolors';
import { preflight, PreflightReport } from './checks';

/**
 * Exit code. Anything but `ready` exits 1.
 *
 * `awm sensors run` exits zero only for an empirical `pass`; preflight mirrors that
 * binary-gate rule for its own `ready` status. It is invoked explicitly by a phase
 * gate, so the exit code carries the verdict and the caller need not infer it from
 * a field in JSON.
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
        `  ${c.advisory === true ? pc.yellow('⚠') : c.ok ? pc.green('✔') : pc.red('✘')}  ${c.id.padEnd(idWidth)} ${c.detail}`
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
        .option('--verify-sensors', 'run the complete sensor gate before unattended execution')
        .option('--cwd <path>', 'project directory to check (default: current)')
        .action(async (opts) => {
            const report = await preflight(opts.cwd ?? process.cwd(), { verifySensors: opts.verifySensors === true });
            process.stdout.write(opts.json ? JSON.stringify(report, null, 2) + '\n' : formatReport(report));
            const code = exitCodeFor(report);
            // `process.exit()` may truncate the JSON written immediately above when
            // stdout is a pipe (CI, an API consumer, or a shell capture). Preserve
            // the semantic exit code while allowing Node to flush the report.
            if (code !== 0) process.exitCode = code;
        });
}
