// src/commands/init.ts
import { Command } from 'commander';
import pc from 'picocolors';
import { renderReport } from './doctor';
import { gatherContext } from '../core/diagnostics/context';
import { runChecks } from '../core/diagnostics/checks';
import { discoverBundles, REGISTRY_CONTENT_DIR } from '../core/bundles';
import { REGISTRY_DIR } from '../core/registry';
import { runInitSteps } from '../core/init/orchestrator';
import { defaultActions } from '../core/init/steps';
import type { InitOutcome, InitActions, StepResult } from '../core/init/types';
import type { AgentTarget } from '../providers';
import path from 'path';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function stepGlyph(action: StepResult['action']): string {
    if (action === 'applied') return pc.green('✔');
    if (action === 'pending') return pc.yellow('◷');
    if (action === 'failed') return pc.red('✖');
    return pc.dim('·');
}

export function renderInitOutcome(o: InitOutcome): string {
    const lines: string[] = [];

    lines.push(pc.bold('AWM · init'));
    lines.push('');

    // --- Estado inicial ---
    lines.push(pc.bold('Estado inicial'));
    lines.push(renderReport(o.before));
    lines.push('');

    // --- Acciones ---
    lines.push(pc.bold('Acciones'));
    for (const s of o.steps) {
        const det = s.detail ? pc.dim(` ${s.detail}`) : '';
        const err = s.error ? pc.red(` [${s.error}]`) : '';
        lines.push(`  ${stepGlyph(s.action)} ${s.id}${det}${err}`);
    }
    lines.push('');

    // --- Estado final ---
    lines.push(pc.bold('Estado final'));
    lines.push(renderReport(o.after));
    lines.push('');

    // --- Summary ---
    const pendingCount = o.pending;
    if (pendingCount > 0) {
        lines.push(pc.yellow(`${pendingCount} pasos requieren un agente`));
    } else {
        lines.push(pc.green('0 pasos requieren un agente'));
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// RunInit
// ---------------------------------------------------------------------------

export interface RunInitOptions {
    cwd?: string;
    yes?: boolean;
    json?: boolean;
    machineOnly?: boolean;
    agent?: string;
    actions?: Partial<InitActions>;
}

export async function runInit(opts: RunInitOptions = {}): Promise<number> {
    const cwd = opts.cwd ?? process.cwd();
    const agent: AgentTarget = (opts.agent as AgentTarget) ?? 'claude-code';

    let outcome: InitOutcome;
    try {
        const bundles = discoverBundles();
        const ctx = gatherContext({ cwd, bundles });

        // In machineOnly mode, null out the project context so project steps are skipped
        const effectiveCtx = opts.machineOnly
            ? { ...ctx, project: null }
            : ctx;

        const mergedActions: InitActions = {
            ...defaultActions,
            ...(opts.actions ?? {}),
        };

        // confirmExtensions: with --yes auto-confirm all proposed; without --yes also auto-confirm
        // (no @clack/prompts in non-interactive mode per spec)
        const confirmExtensions = async (proposed: string[]): Promise<string[]> => proposed;

        outcome = await runInitSteps({
            cwd,
            ctx: effectiveCtx,
            bundles,
            agent,
            installMethod: 'symlink',
            registryRoot: REGISTRY_DIR,
            contentDir: REGISTRY_CONTENT_DIR,
            confirmExtensions,
            actions: mergedActions,
        });
    } catch (err) {
        process.stderr.write(`awm init: error interno: ${(err as Error).message}\n`);
        return 2;
    }

    if (opts.json) {
        process.stdout.write(JSON.stringify(outcome, null, 2) + '\n');
    } else {
        process.stdout.write(renderInitOutcome(outcome) + '\n');
    }

    return outcome.after.overall === 'healthy' ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Commander registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
    program.command('init')
        .description('Bootstrap the AWM harness on this machine / project (idempotent)')
        .option('-y, --yes', 'Skip confirmation prompts')
        .option('-a, --agent <agent>', 'Target agent (default: claude-code)')
        .option('--machine-only', 'Only run machine-level steps (skip project steps)')
        .option('--json', 'Emit the InitOutcome as JSON')
        .action(async (options: { yes?: boolean; agent?: string; machineOnly?: boolean; json?: boolean }) => {
            const code = await runInit({
                yes: options.yes,
                agent: options.agent,
                machineOnly: options.machineOnly,
                json: options.json,
            });
            process.exitCode = code;
        });
}
