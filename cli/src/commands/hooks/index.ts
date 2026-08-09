import { Command } from 'commander';
import { pendingTrustGuidance } from './trust-guidance';
import pc from 'picocolors';
import { confirm, isCancel } from '@clack/prompts';
import { getPreferences } from '../../utils/config';
import { installHook } from './install';
import { uninstallHook } from './uninstall';
import { computeHookStatus } from './status';
import { AGENT_TARGETS, AgentTarget, getHookConfig, providerFor } from '../../providers';
import { capabilityRoot } from '../../core/registries';

const HOOK_TARGETS = AGENT_TARGETS.filter((a) => getHookConfig(a));

/**
 * `hooks` nacio con `-t, --target` y el resto del CLI (`add`, `remove`, `sync`,
 * `update`, `doctor`) usa `-a, --agent`. La asimetria se cobro una corrida real del
 * playbook: `awm hooks status --agent codex` fallaba con `unknown option`. Se acepta
 * `--agent` como alias en vez de renombrar, para no romper a quien ya scriptea
 * `--target`. Ver D-010.
 */
function resolveHookTarget(options: { target?: string; agent?: string }): AgentTarget {
    return (options.agent ?? options.target ?? 'claude-code') as AgentTarget;
}

function targetOptionDescription(): string {
    return `Target harness (${HOOK_TARGETS.join('|')})`;
}

export function registerHooksCommand(program: Command): void {
    const hooks = program.command('hooks').description('Manage SessionStart bootstrap hooks');

    hooks.command('install')
        .description('Install the AWM bootstrap hook into the target harness')
        .option('-t, --target <target>', targetOptionDescription(), 'claude-code')
        .option('-a, --agent <agent>', 'Alias de --target, por simetria con el resto del CLI')
        .option('-y, --yes', 'Skip interactive confirmations', false)
        .action(async (options: { target?: string; agent?: string; yes?: boolean }) => {
            const agent = resolveHookTarget(options);
            const prefs = getPreferences();

            const hooksRoot = capabilityRoot('hooks');
            if (!hooksRoot) {
                console.error(pc.red('No configured registry provides hooks/ — run `awm update` first.'));
                process.exit(1);
            }

            try {
                const result = installHook({
                    agent,
                    registryRoot: hooksRoot,
                    installMethod: prefs.installMethod
                });

                if (result.status === 'already-up-to-date') {
                    console.log(pc.green('✓ Hook already installed and up-to-date.'));
                    return;
                }

                console.log('');
                console.log(pc.green('✓ AWM bootstrap hook installed.'));
                console.log('');
                console.log(`  Scripts:        ${result.scriptsDir}/session-start`);
                if (agent === 'claude-code') {
                    console.log(`                  ${result.scriptsDir}/run-hook.cmd`);
                    console.log(`                  ${result.scriptsDir}/using-awm.md → ~/.awm/registries/baseline/skills/using-awm/SKILL.md`);
                }
                console.log('');
                console.log(`  Settings file:  ${result.settingsPath}`);
                if (result.backupPath) {
                    console.log(`  Backup:         ${result.backupPath}`);
                }
                console.log('');
                console.log('  Active on:      startup | /clear | /compact');
                console.log('');
                console.log(`  Verify:         ${pc.cyan('awm hooks status')}`);
                console.log(`  Remove:         ${pc.cyan('awm hooks uninstall')}`);
                console.log('');
                console.log(pc.yellow(`  ⚠ Restart ${providerFor(agent).label} to activate the hook in existing sessions.`));
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });

    hooks.command('uninstall')
        .description('Remove the AWM bootstrap hook')
        .option('-t, --target <target>', targetOptionDescription(), 'claude-code')
        .option('-a, --agent <agent>', 'Alias de --target, por simetria con el resto del CLI')
        .option('-y, --yes', 'Skip interactive confirmations', false)
        .action(async (options: { target?: string; agent?: string; yes?: boolean }) => {
            const agent = resolveHookTarget(options);

            if (!options.yes && process.stdin.isTTY) {
                const ok = await confirm({ message: 'Remove AWM bootstrap hook from settings.json?' });
                if (isCancel(ok) || ok !== true) {
                    console.log('Cancelled.');
                    return;
                }
            }

            try {
                const result = uninstallHook({ agent });
                if (result.status === 'not-installed') {
                    console.log(pc.yellow('No AWM hook entry found. Nothing to uninstall.'));
                    return;
                }
                console.log(pc.green('✓ AWM bootstrap hook removed.'));
                if (result.backupPath) {
                    console.log(`  Backup: ${result.backupPath}`);
                }
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });

    hooks.command('status')
        .description('Check the bootstrap hook installation status')
        .option('-t, --target <target>', targetOptionDescription(), 'claude-code')
        .option('-a, --agent <agent>', 'Alias de --target, por simetria con el resto del CLI')
        .action((options: { target?: string; agent?: string }) => {
            const agent = resolveHookTarget(options);
            try {
                const result = computeHookStatus(agent);
                const symbol = (ok: boolean) => ok ? pc.green('✓') : pc.red('✗');
                console.log('');
                if (result.checks.bootstrapSkill) {
                    console.log(`  Bootstrap skill:    ${symbol(result.checks.bootstrapSkill.ok)} ${result.checks.bootstrapSkill.detail}`);
                }
                console.log(`  Session-start:      ${symbol(result.checks.sessionStartScript.ok)} ${result.checks.sessionStartScript.detail}`);
                if (result.checks.runHookWrapper) {
                    console.log(`  Run-hook wrapper:   ${symbol(result.checks.runHookWrapper.ok)} ${result.checks.runHookWrapper.detail}`);
                }
                console.log(`  Settings entry:     ${symbol(result.checks.settingsEntry.ok)} ${result.checks.settingsEntry.detail}`);
                if (result.trust) {
                    const trustSymbol = result.trust === 'healthy' ? pc.green('✓') : result.trust === 'stale' ? pc.red('✗') : pc.yellow('…');
                    console.log(`  Trust:              ${trustSymbol} ${result.trust}`);
                }
                console.log('');
                const overall = result.overall === 'HEALTHY' ? pc.green(result.overall) :
                                result.overall === 'NOT_INSTALLED' || result.overall === 'PENDING_TRUST'
                                    ? pc.yellow(result.overall)
                                    : pc.red(result.overall);
                console.log(`  Status: ${overall}`);
                if (result.overall === 'PENDING_TRUST') {
                    for (const line of pendingTrustGuidance(agent)) console.log(pc.dim(`  ${line}`));
                }
                // PENDING_TRUST no sale 1: no hay nada roto que arreglar, y salir 1 en
                // toda instalacion recien hecha convertiria el comando en ruido.
                if (result.overall !== 'HEALTHY' && result.overall !== 'PENDING_TRUST') {
                    process.exit(1);
                }
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });
}
