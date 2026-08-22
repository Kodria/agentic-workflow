// src/commands/doctor.ts
import { Command } from 'commander';
import pc from 'picocolors';
import { gatherContext } from '../core/diagnostics/context';
import { computeProviderOverall } from '../core/diagnostics/checks';
import { CheckReport, CheckResult, ProviderCheck, ProviderCheckState, ProviderDiagnosticReport } from '../core/diagnostics/types';
import { platformLabel, isWindowsNative, WINDOWS_KNOWN_GAP } from '../core/paths';
// `readPreferences`, no `getPreferences`: este comando esta documentado como
// read-only y el segundo auto-vivifica el archivo. Ver la nota en config.ts.
import { readPreferences } from '../utils/config';
import { resolveAgentTargets } from '../core/agent-targets';
import { collectDashboardSnapshot } from '../core/dashboard/collect';
import { resolveHtmlTarget, writeHtmlAtomically } from '../core/dashboard/write-html';

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
    lines.push(pc.dim(`  platform: ${platformLabel()}`));
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

// --- Task 9: per-provider report rendering ---------------------------------
//
// Separate from renderReport/CheckReport above (which `init.ts` still uses,
// unchanged, for its before/after machine+project display). `doctor`'s own
// text/JSON output is provider-centric.

const CHECK_LABELS: Record<ProviderCheck['id'], string> = {
    'binary.version': 'binary/version',
    'skills.global': 'global skills',
    'agents.native': 'native agents',
    'workflows.global': 'global workflows',
    'context.global': 'global context',
    'hook.trust': 'hook SessionStart',
    'guidance.project': 'project guidance',
    'constitution.delivery': 'constitution delivery',
};

const OK_STATES: ProviderCheckState[] = ['supported', 'healthy', 'shared', 'delivered'];
const PENDING_STATES: ProviderCheckState[] = ['pending', 'pending-trust'];
const WARN_STATES: ProviderCheckState[] = ['stale'];

function providerGlyph(state: ProviderCheckState): string {
    if (OK_STATES.includes(state)) return pc.green('✔');
    if (PENDING_STATES.includes(state)) return pc.yellow('◷');
    if (WARN_STATES.includes(state)) return pc.yellow('⚠');
    return pc.red('✖');
}

function providerCheckDetail(check: ProviderCheck): string {
    if (check.id === 'binary.version' && check.target) return pc.dim(` (${check.target})`);
    if (check.state === 'pending-trust') return pc.dim(' (pending trust)');
    if (check.detail) return pc.dim(` (${check.detail})`);
    return '';
}

function providerCheckRemedy(check: ProviderCheck): string {
    return check.remediationCode ? pc.dim(`   → ${check.remediationCode}`) : '';
}

function providerCheckLine(check: ProviderCheck): string {
    return `  ${providerGlyph(check.state)} ${CHECK_LABELS[check.id]}${providerCheckDetail(check)}${providerCheckRemedy(check)}`;
}

export function renderProviderReport(report: ProviderDiagnosticReport): string {
    const lines: string[] = [];
    lines.push(pc.bold('AWM · harness status'));
    lines.push(pc.dim(`  platform: ${platformLabel()}`));
    // Advisory only, native Windows only. This is the text rendered by the
    // real `awm doctor` command (`runDoctor` below) — the diagnostics surface
    // an operator actually goes looking at for platform-specific detail.
    // `init`/`update`/`sync` also note it once each, at the top of their own
    // run (`runInit`/`runUpdateCore`/`runSyncCore`), independently of this.
    if (isWindowsNative()) lines.push(pc.dim(`  ${WINDOWS_KNOWN_GAP.replace(/\n\s*/g, ' ')}`));
    lines.push('');
    for (const provider of report.providers) {
        lines.push(`Provider: ${provider.label} ${pc.dim(`(${provider.tier})`)}`);
        for (const check of provider.checks) lines.push(providerCheckLine(check));
        lines.push('');
    }
    const status = report.overall === 'healthy' ? pc.green('healthy') : pc.red('degraded');
    lines.push(`status: ${status}`);
    return lines.join('\n');
}

export interface RunDoctorOptions {
    json?: boolean;
    full?: boolean;
    html?: string;
    force?: boolean;
    cwd?: string;
    /** Comma-separated agent subset (R12/R13) — defaults to every enabled agent. */
    agent?: string;
    /** Injectable seam over `resolveAgentTargets` (core/agent-targets.ts) — tests spy on this
     *  to observe which targets `doctor` resolved. The resolved list drives which providers'
     *  `.providers[]` rows `gatherContext` builds (Task 9). */
    resolveTargets?: typeof resolveAgentTargets;
}

export function runDoctor(opts: RunDoctorOptions = {}): number {
    const invalid = (message: string): number => { process.stderr.write(`awm doctor: ${message}\n`); return 2; };
    const htmlRequested = opts.html !== undefined;
    if (opts.json && opts.full) return invalid('--json cannot be combined with --full');
    if (opts.json && htmlRequested) return invalid('--json cannot be combined with --html');
    if (opts.full && htmlRequested) return invalid('--full cannot be combined with --html');
    if (opts.force && !htmlRequested) return invalid('--force requires --html');
    if (opts.full || htmlRequested) {
        try {
            const cwd = opts.cwd ?? process.cwd();
            const target = htmlRequested ? resolveHtmlTarget({ cwd, target: opts.html!, force: opts.force }) : undefined;
            const snapshot = collectDashboardSnapshot({ cwd, now: new Date().toISOString() });
            if (opts.full) process.stdout.write([
                `AWM dashboard · ${snapshot.overall}`,
                `Project: ${snapshot.project.label}`,
                ...snapshot.sections.flatMap((section) => [
                    `${section.id}: ${section.availability} (${section.items.length})`,
                    ...section.items.map((item) => `  ${item.state} ${item.id} · ${item.label}${item.remediation ? ` → ${item.remediation}` : ''}`),
                ]),
            ].join('\n') + '\n');
            if (htmlRequested) {
                const body = `<html><body><pre>${JSON.stringify(snapshot, null, 2).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>\n`;
                writeHtmlAtomically({ target: target!, html: body });
                process.stdout.write(`${target}\n`);
            }
            return snapshot.overall === 'healthy' ? 0 : 1;
        } catch (error) { return invalid((error as Error).message); }
    }
    const resolveTargets = opts.resolveTargets ?? resolveAgentTargets;

    // Validates --agent separately from the general diagnostic gathering below:
    // an unknown or disabled agent is a normal input-validation failure (the
    // user typo'd or forgot `awm init --agent <x>`), not an "internal error" —
    // give it its own clear message rather than lumping it under the generic
    // internal-error catch further down.
    let targets: ReturnType<typeof resolveAgentTargets>;
    try {
        const prefs = readPreferences();
        targets = resolveTargets({ prefs, explicit: opts.agent });
    } catch (err) {
        process.stderr.write(`awm doctor: ${(err as Error).message}\n`);
        return 2;
    }

    let report: ProviderDiagnosticReport;
    try {
        const ctx = gatherContext({ cwd: opts.cwd, agents: targets });
        const providers = ctx.providers ?? [];
        report = { providers, overall: computeProviderOverall(providers) };
    } catch (err) {
        process.stderr.write(`awm doctor: internal error: ${(err as Error).message}\n`);
        return 2;
    }
    if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
        process.stdout.write(renderProviderReport(report) + '\n');
    }
    return report.overall === 'healthy' ? 0 : 1;
}

export function registerDoctorCommand(program: Command): void {
    program.command('doctor')
        .description('Read-only dashboard of the AWM harness state, per provider')
        .option('--json', 'Emit the diagnostic report as JSON')
        .option('--full', 'Emit the full dashboard snapshot')
        .option('--html <file>', 'Write the dashboard snapshot as HTML')
        .option('--force', 'Allow replacing an existing HTML file')
        .option('-a, --agent <agent>', 'Target agent subset (comma-separated); defaults to every enabled agent')
        .action((options: { json?: boolean; full?: boolean; html?: string; force?: boolean; agent?: string }) => {
            process.exitCode = runDoctor({ json: options.json, full: options.full, html: options.html, force: options.force, agent: options.agent });
        });
}
