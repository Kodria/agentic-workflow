// src/commands/init.ts
import fs from 'fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { renderReport } from './doctor';
import { gatherContext } from '../core/diagnostics/context';
import { discoverAllBundles } from '../core/bundles';
import { contentRoots, listRegistries, seedBaselineRegistry, capabilityRoot } from '../core/registries';
import { runInitSteps } from '../core/init/orchestrator';
import { defaultActions } from '../core/init/steps';
import type { InitOutcome, InitActions, StepResult } from '../core/init/types';
import type { AgentTarget } from '../providers';
import { warnIfUnsupportedPlatform } from '../core/paths';
import { getPreferences, savePreferences, preferencesExist } from '../utils/config';

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

    // --- Initial state ---
    lines.push(pc.bold('Initial state'));
    lines.push(renderReport(o.before));
    lines.push('');

    // --- Actions ---
    lines.push(pc.bold('Actions'));
    for (const s of o.steps) {
        const det = s.detail ? pc.dim(` ${s.detail}`) : '';
        const err = s.error ? pc.red(` [${s.error}]`) : '';
        lines.push(`  ${stepGlyph(s.action)} ${s.id}${det}${err}`);
    }
    lines.push('');

    // --- Final state ---
    lines.push(pc.bold('Final state'));
    lines.push(renderReport(o.after));
    lines.push('');

    // --- Summary ---
    const pendingCount = o.pending;
    const status = o.after.overall === 'healthy' ? pc.green('healthy') : pc.red('degraded');
    lines.push(`status: ${status} · ${pendingCount} steps require an agent (skills above)`);

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

    // #7: make init the source of truth for the default agent. Persist the resolved
    // agent so later `awm add`/`awm sync` (which read preferences.defaultAgent) target
    // the right agent instead of stamping the static default. Do NOT clobber an existing
    // explicit preference on a bare re-init: only write when an agent was passed via -a,
    // or when no preferences file exists yet.
    if (opts.agent != null || !preferencesExist()) {
        savePreferences({ ...getPreferences(), defaultAgent: agent });
    }

    let outcome: InitOutcome;
    try {
        const mergedActions: InitActions = {
            ...defaultActions,
            ...(opts.actions ?? {}),
        };

        seedBaselineRegistry();
        if (listRegistries().some((r) => !fs.existsSync(r.contentRoot))) {
            await mergedActions.syncCache();
        }

        const bundles = discoverAllBundles();
        const ctx = gatherContext({ cwd, bundles, agent });

        // In machineOnly mode, null out the project context so project steps are skipped
        const effectiveCtx = opts.machineOnly
            ? { ...ctx, project: null }
            : ctx;

        const confirmExtensions = makeConfirmExtensions(!!opts.yes);

        outcome = await runInitSteps({
            cwd,
            ctx: effectiveCtx,
            bundles,
            agent,
            installMethod: 'symlink',
            registryRoot: capabilityRoot('hooks') ?? '',
            contentDir: contentRoots()[0] ?? '',
            sensorPacksRoot: capabilityRoot('sensor-packs') ?? '',
            confirmExtensions,
            actions: mergedActions,
        });
    } catch (err) {
        process.stderr.write(`awm init: internal error: ${(err as Error).message}\n`);
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
// Extension confirmation factory
// ---------------------------------------------------------------------------

/**
 * Builds the extension-confirmation callback. The non-`--yes` path opens a clack
 * `multiselect`; clack crashes ("Cannot read properties of undefined (reading
 * 'disabled')") when handed an empty options array, so we short-circuit empty
 * `proposed` BEFORE importing/invoking it (#1, greenfield dirs detect no signals).
 */
export function makeConfirmExtensions(
    yes: boolean,
): (proposed: string[], signals: string[]) => Promise<string[]> {
    if (yes) return async (proposed: string[]) => proposed;
    return async (proposed: string[], signals: string[]) => {
        if (proposed.length === 0) return [];
        const { multiselect, isCancel } = await import('@clack/prompts');
        const choice = await multiselect({
            message: `Extensions detected (${signals.join(', ')}) — activate?`,
            options: proposed.map((p) => ({ value: p, label: p })),
            initialValues: proposed,
            required: false,
        });
        if (isCancel(choice)) return [];
        return choice as string[];
    };
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
            warnIfUnsupportedPlatform((m) => console.warn(pc.yellow(`⚠ ${m}`)));
            const code = await runInit({
                yes: options.yes,
                agent: options.agent,
                machineOnly: options.machineOnly,
                json: options.json,
            });
            process.exitCode = code;
        });
}
