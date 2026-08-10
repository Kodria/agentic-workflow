// src/commands/init.ts
import fs from 'fs';
import { Command } from 'commander';
import pc from 'picocolors';
import { renderReport } from './doctor';
import { gatherContext } from '../core/diagnostics/context';
import { discoverAllBundles } from '../core/bundles';
import {
    contentRoots, listRegistries, seedBaselineRegistry, capabilityRoot,
    assertSyncedRegistriesUsable,
} from '../core/registries';
import { runInitSteps } from '../core/init/orchestrator';
import { defaultActions } from '../core/init/steps';
import {
    InitStepsFailedError, buildInitFailureOutput, transactionNote,
    type InitFailureTransaction,
} from '../core/init/failure';
import { planInitMutationTargets } from '../core/init/mutation-targets';
import { gatherProviderFacts, assertClaudeBaselinePreserved } from '../core/init/provider-facts';
import { beginBackupSession } from '../core/install-transaction';
import { assertProviderSupported } from '../core/provider-version';
import type { InitOutcome, InitActions, StepResult } from '../core/init/types';
import type { AgentTarget } from '../providers';
import { requireAgentTarget } from '../providers';
import { noteWindowsCaveat } from '../core/paths';
import { enableAgent, loadPreferences, savePreferences } from '../utils/config';

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
// Failure reporting
// ---------------------------------------------------------------------------

/**
 * Single exit point for every failed `awm init`. Honours `--json`'s contract on
 * the error path — the whole point of the flag for a headless bootstrap is to
 * learn WHICH step failed — and, in human mode, renders the same evidence
 * through the normal init dashboard instead of discarding it.
 *
 * stdout carries the machine-readable document (JSON mode) or the dashboard
 * (human mode); stderr always carries the one-line summary plus the
 * transaction verdict, so `2>&1`-free scripts still see a reason.
 */
function reportInitFailure(o: {
    error: Error;
    outcome?: InitOutcome;
    transaction?: InitFailureTransaction;
    json?: boolean;
}): number {
    const payload = buildInitFailureOutput({
        error: o.error,
        outcome: o.outcome,
        transaction: o.transaction,
    });

    if (o.json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    } else if (o.outcome) {
        process.stdout.write(renderInitOutcome(o.outcome) + '\n');
    }

    process.stderr.write(`awm init: ${payload.error}\n`);
    process.stderr.write(`awm init: ${payload.transaction.note}\n`);
    return 2;
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
    /** Injectable seam over the real Codex-version gate (core/provider-version.ts). Tests override to avoid shelling out. */
    assertProviderSupported?: typeof assertProviderSupported;
}

export async function runInit(opts: RunInitOptions = {}): Promise<number> {
    // Fires at most once per `awm init` run (native Windows only) — this is
    // the single emission point; `renderReport`/`renderInitOutcome` below do
    // NOT also embed it (that used to triple-fire the same text: once here,
    // once in the "Initial state" render, once in "Final state"). In `--json`
    // mode it goes to stderr instead of stdout: stdout must stay pure JSON for
    // `awm init --yes --json > init.json` (documented in core-acceptance.md
    // CORE-03) — a stray banner ahead of the `{` broke that contract on every
    // native-Windows `--json` run.
    if (opts.json) {
        noteWindowsCaveat((m) => process.stderr.write(pc.dim(`ℹ ${m}`) + '\n'));
    } else {
        noteWindowsCaveat((m) => console.log(pc.dim(`ℹ ${m}`)));
    }

    const cwd = opts.cwd ?? process.cwd();
    const agent: AgentTarget = opts.agent === undefined ? 'claude-code' : requireAgentTarget(opts.agent);

    // R2: gate BEFORE anything is read or written — an unsupported provider
    // version must never touch preferences.json or any provider file.
    const gate = opts.assertProviderSupported ?? assertProviderSupported;
    try {
        gate(agent);
    } catch (error) {
        process.stderr.write(`awm init: ${(error as Error).message}\n`);
        return 2;
    }

    // #7 / R11: make init the source of truth for the default agent, but never
    // clobber an existing explicit default on a bare re-init (`opts.agent`
    // undefined) — only ENABLE the resolved agent into enabledAgents. On a
    // machine with no preferences yet, `loadPreferences(agent)` proposes
    // `{ defaultAgent: agent, enabledAgents: [agent], ... }` as the seed.
    const loaded = loadPreferences(agent);
    const nextPreferences = opts.agent === undefined
        ? loaded.prefs
        : enableAgent(loaded.prefs, agent);

    // R19: Claude's baseline is read-only from every OTHER agent's init run —
    // snapshotted before any write, compared after every step ran. Only meaningful
    // when THIS run targets a different agent: a claude-code init run is expected
    // to change claude-code's own managed paths (that's the point of running it),
    // so the guard would otherwise misfire on the CLI's own default/most common
    // path — every fresh `awm init` (no --agent) genuinely mutates its baseline
    // and would incorrectly be flagged as a violation.
    const beforeClaudeFacts = agent === 'claude-code' ? null : gatherProviderFacts('claude-code');

    let outcome: InitOutcome;
    // Populated as soon as each becomes available, so the failure reporter can
    // emit whatever evidence THIS run got far enough to produce.
    let pipelineOutcome: InitOutcome | undefined;
    let transaction: InitFailureTransaction | undefined;

    try {
        const mergedActions: InitActions = {
            ...defaultActions,
            ...(opts.actions ?? {}),
        };

        // Enumerate every path this run may write to and open one backup
        // session covering the whole init (preferences + every machine/project
        // step) BEFORE calling anything else — including `seedBaselineRegistry`,
        // whose `resolveBaseRemote()` incidentally reads preferences.json and
        // (on a machine with none yet) would otherwise auto-vivify it with
        // stock defaults ahead of our own write, corrupting the "before"
        // snapshot rollback restores to. Uses whatever bundle content already
        // exists on disk right now (before this run's own registry sync).
        // Known narrow gap: on a truly first-ever init (no prior registry
        // clone at all), the bundle artifacts this SAME run freshly clones and
        // installs can't be named yet at this point, so a failure later in
        // that exact run won't roll those specific artifacts back — every
        // other target (preferences, hook, injection, previously-installed
        // bundle content) is covered.
        const preSyncBundles = discoverAllBundles();
        const mutationTargets = planInitMutationTargets({
            cwd,
            agent,
            bundles: preSyncBundles,
        });
        const backup = beginBackupSession(mutationTargets);

        try {
            savePreferences(nextPreferences);

            seedBaselineRegistry();
            if (listRegistries().some((r) => !fs.existsSync(r.contentRoot))) {
                // `syncRegistries()` reports per-registry failures as RESULTS,
                // never as throws (core/registries.ts) — swallowing them here
                // let an unavailable registry degrade silently into some later
                // step's failure instead of being reported as its own cause.
                assertSyncedRegistriesUsable((await mergedActions.syncCache()) ?? []);
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
                enabledAgents: nextPreferences.enabledAgents,
                installMethod: 'symlink',
                registryRoot: capabilityRoot('hooks') ?? '',
                contentDir: contentRoots()[0] ?? '',
                sensorPacksRoot: capabilityRoot('sensor-packs') ?? '',
                confirmExtensions,
                machineOnly: !!opts.machineOnly,
                actions: mergedActions,
            });
            pipelineOutcome = outcome;
            if (outcome.failed > 0) {
                // Typed so the outcome — the only record of WHICH step failed
                // and why — survives the rollback below and reaches the
                // reporter. A bare Error here is what made `--json` emit
                // nothing on the one path that most needed it.
                throw new InitStepsFailedError(outcome);
            }

            if (beforeClaudeFacts) {
                assertClaudeBaselinePreserved(beforeClaudeFacts, gatherProviderFacts('claude-code'));
            }

            backup.commit();
            outcome.transactionId = backup.transactionId;
            outcome.modifiedFiles = backup.targetPaths;
        } catch (error) {
            // Rollback is best-effort and must never mask the original failure
            // (same policy as applyInstallPlan's own rollback loop): the
            // operator needs the step that failed, not the restore that also did.
            let rollbackError: string | undefined;
            try {
                backup.rollback();
            } catch (e) {
                rollbackError = e instanceof Error ? e.message : String(e);
            }
            transaction = {
                committed: false,
                rolledBack: rollbackError === undefined,
                transactionId: backup.transactionId,
                restoredFiles: backup.targetPaths,
                ...(rollbackError === undefined ? {} : { rollbackError }),
                note: transactionNote(rollbackError === undefined),
            };
            throw error;
        }
    } catch (err) {
        // The typed error carries its own outcome (so it stays self-sufficient
        // for any caller of runInit); `pipelineOutcome` covers the other way a
        // run can fail *after* the pipeline produced one — e.g. the R19
        // Claude-baseline assertion.
        return reportInitFailure({
            error: err as Error,
            outcome: err instanceof InitStepsFailedError ? err.outcome : pipelineOutcome,
            transaction,
            json: opts.json,
        });
    }

    // `result` distinguishes `ok` from `degraded` in the JSON; the EXIT CODE does
    // not, on purpose (D-008).
    //
    // `degraded` used to exit `1`. It does not mean init failed — it means the
    // harness still has `pending` steps, which is the NORMAL outcome of a first run:
    // `CONSTITUTION.md` and `AGENTS.md` are written by an agent session, not by the
    // CLI. So a run where nothing broke reported failure, and `awm init --yes && …`
    // died under `set -e` — in the one command whose entire job is bootstrapping a
    // script. Three independent readers called it a bug before it was one; the docs
    // had grown a warning box asking people to ignore the exit code.
    //
    // The exit code now answers "did init do its job?". "Is the harness fully
    // healthy?" is `awm doctor`'s question, and `result` still carries it here for
    // any consumer that wants to branch on it.
    const result = outcome.after.overall === 'healthy' ? 'ok' : 'degraded';

    if (opts.json) {
        process.stdout.write(JSON.stringify({ result, ...outcome }, null, 2) + '\n');
    } else {
        process.stdout.write(renderInitOutcome(outcome) + '\n');
    }

    return 0;
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
        .option('--json', 'Emit the InitOutcome as JSON — on success and on failure (failed steps + rollback)')
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
