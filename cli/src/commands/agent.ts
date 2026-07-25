// src/commands/agent.ts
//
// `awm agent list|disable` — inspect and manage which agent targets AWM
// currently manages (preferences.enabledAgents / defaultAgent). Disabling an
// agent only touches AWM's own bookkeeping (preferences.json); it never
// deletes the agent's provider files (hooks, skills, AGENTS.md, …) — those
// stay in place, matching R19's "provider state outlives AWM management"
// guarantee. Re-enabling is `awm init --agent <agent>`.
import { Command } from 'commander';
import pc from 'picocolors';
import { AGENT_TARGETS, AgentTarget, isAgentTarget, providerFor } from '../providers';
import { getPreferences, savePreferences } from '../utils/config';

export type AgentRow = {
    id: AgentTarget;
    label: string;
    enabled: boolean;
    default: boolean;
};

/** Every known agent target, tagged with this machine's enabled/default state. */
export function listAgents(): AgentRow[] {
    const prefs = getPreferences();
    return AGENT_TARGETS.map((id) => ({
        id,
        label: providerFor(id).label,
        enabled: prefs.enabledAgents.includes(id),
        default: prefs.defaultAgent === id,
    }));
}

/**
 * Disables `agent` in AWM's own bookkeeping only (preferences.json's
 * enabledAgents). Never touches the agent's provider files.
 *
 * Refuses to disable the current default without a `replacement` (must
 * itself remain enabled after the change) — AWM always needs a default agent
 * to fall back to for commands that don't specify `--agent`.
 */
export function disableAgent(agent: AgentTarget, replacement?: AgentTarget): void {
    if (!isAgentTarget(agent)) {
        throw new Error(`Invalid agent target: ${String(agent)}`);
    }
    const prefs = getPreferences();
    if (!prefs.enabledAgents.includes(agent)) {
        throw new Error(`${agent} is not enabled`);
    }
    if (prefs.defaultAgent === agent && replacement === undefined) {
        throw new Error('Cannot disable the default agent; pass --default <agent>');
    }
    if (replacement !== undefined && !isAgentTarget(replacement)) {
        throw new Error(`Invalid replacement agent target: ${String(replacement)}`);
    }

    const enabledAgents = prefs.enabledAgents.filter((candidate) => candidate !== agent);
    const defaultAgent = replacement ?? prefs.defaultAgent;
    if (!enabledAgents.includes(defaultAgent)) {
        throw new Error(`Replacement default ${defaultAgent} must remain enabled`);
    }
    savePreferences({ ...prefs, enabledAgents, defaultAgent });
}

export function registerAgentCommand(program: Command): void {
    const agent = program.command('agent').description('Manage which agent targets AWM tracks');

    agent.command('list')
        .description('List every agent target and this machine\'s enabled/default state')
        .option('--json', 'Emit the agent list as JSON')
        .action((options: { json?: boolean }) => {
            const rows = listAgents();
            if (options.json) {
                process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
                return;
            }
            for (const row of rows) {
                const marker = row.default ? pc.cyan(' (default)') : '';
                const state = row.enabled ? pc.green('enabled') : pc.dim('disabled');
                process.stdout.write(`  ${row.id.padEnd(12)} ${state}${marker}\n`);
            }
        });

    agent.command('disable <agent>')
        .description('Stop AWM from managing <agent> (preferences only — provider files are untouched)')
        .option('--default <agent>', 'Replacement default agent, required when disabling the current default')
        .action((agentArg: string, options: { default?: string }) => {
            if (!isAgentTarget(agentArg)) {
                console.error(pc.red(`Invalid agent "${agentArg}". Use: ${AGENT_TARGETS.join(', ')}.`));
                process.exitCode = 1;
                return;
            }
            let replacement: AgentTarget | undefined;
            if (options.default !== undefined) {
                if (!isAgentTarget(options.default)) {
                    console.error(pc.red(`Invalid --default "${options.default}". Use: ${AGENT_TARGETS.join(', ')}.`));
                    process.exitCode = 1;
                    return;
                }
                replacement = options.default;
            }
            try {
                disableAgent(agentArg, replacement);
                console.log(pc.green(`✓ ${agentArg} disabled.`));
            } catch (e) {
                console.error(pc.red(`✗ ${(e as Error).message}`));
                process.exitCode = 1;
            }
        });
}
