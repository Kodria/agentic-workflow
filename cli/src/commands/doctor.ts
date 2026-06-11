// src/commands/doctor.ts
import { Command } from 'commander';
import pc from 'picocolors';
import { gatherContext } from '../core/diagnostics/context';
import { runChecks } from '../core/diagnostics/checks';
import { CheckReport, CheckResult } from '../core/diagnostics/types';

function glyph(status: CheckResult['status']): string {
    if (status === 'ok') return pc.green('✔');
    if (status === 'warn') return pc.yellow('⚠');
    return pc.red('✖');
}

function remedyText(r: CheckResult): string {
    if (r.remedy.kind === 'command') return pc.dim(`→ ${r.remedy.value}`);
    if (r.remedy.kind === 'skill') return pc.dim(`→ skill: ${r.remedy.value}`);
    return '';
}

function line(r: CheckResult): string {
    const rem = remedyText(r);
    const det = r.detail ? pc.dim(` (${r.detail})`) : '';
    return `  ${glyph(r.status)} ${r.label}${det}${rem ? '   ' + rem : ''}`;
}

export function renderReport(report: CheckReport): string {
    const lines: string[] = [];
    lines.push(pc.bold('AWM · harness status'));
    lines.push('');
    lines.push('Machine (global)');
    for (const r of report.results.filter((x) => x.level === 'machine')) lines.push(line(r));
    lines.push('');
    if (report.hasProject) {
        lines.push(`Project: ${report.projectName ?? ''}`.trimEnd());
        for (const r of report.results.filter((x) => x.level === 'project')) lines.push(line(r));
    } else {
        lines.push(pc.dim('(no project in cwd)'));
    }
    lines.push('');
    const actions = report.results.filter((r) => r.remedy.kind !== 'none').length;
    const status = report.overall === 'healthy' ? pc.green('healthy') : pc.red('degraded');
    lines.push(`status: ${status} · ${actions} suggested actions`);
    return lines.join('\n');
}

export interface RunDoctorOptions {
    json?: boolean;
    cwd?: string;
}

export function runDoctor(opts: RunDoctorOptions = {}): number {
    let report: CheckReport;
    try {
        report = runChecks(gatherContext({ cwd: opts.cwd }));
    } catch (err) {
        process.stderr.write(`awm doctor: internal error: ${(err as Error).message}\n`);
        return 2;
    }
    if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
        process.stdout.write(renderReport(report) + '\n');
    }
    return report.overall === 'healthy' ? 0 : 1;
}

export function registerDoctorCommand(program: Command): void {
    program.command('doctor')
        .description('Read-only dashboard of the AWM harness state (machine + project)')
        .option('--json', 'Emit the diagnostic report as JSON')
        .action((options: { json?: boolean }) => {
            process.exitCode = runDoctor({ json: options.json });
        });
}
