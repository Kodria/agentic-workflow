import { Command } from 'commander';
import pc from 'picocolors';
import path from 'path';
import os from 'os';
import { confirm, isCancel } from '@clack/prompts';
import { getPreferences } from '../../utils/config';
import { installHook } from './install';
import { uninstallHook } from './uninstall';
import { computeHookStatus } from './status';
import type { AgentTarget } from '../../providers';

const DEFAULT_REGISTRY_ROOT = path.join(os.homedir(), '.awm/cli-source');

export function registerHooksCommand(program: Command): void {
    const hooks = program.command('hooks').description('Manage SessionStart bootstrap hooks');

    hooks.command('install')
        .description('Install the AWM bootstrap hook into the target harness')
        .option('-t, --target <target>', 'Target harness (claude-code only in this version)', 'claude-code')
        .option('-y, --yes', 'Skip interactive confirmations', false)
        .action(async (options: { target?: string; yes?: boolean }) => {
            const agent = (options.target ?? 'claude-code') as AgentTarget;
            const prefs = getPreferences();

            try {
                const result = installHook({
                    agent,
                    registryRoot: DEFAULT_REGISTRY_ROOT,
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
                console.log(`                  ${result.scriptsDir}/run-hook.cmd`);
                console.log(`                  ${result.scriptsDir}/using-awm.md → registry/skills/using-awm/SKILL.md`);
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
                console.log(pc.yellow('  ⚠ Restart Claude Code to activate the hook in existing sessions.'));
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });

    hooks.command('uninstall')
        .description('Remove the AWM bootstrap hook')
        .option('-t, --target <target>', 'Target harness (claude-code only in this version)', 'claude-code')
        .option('-y, --yes', 'Skip interactive confirmations', false)
        .action(async (options: { target?: string; yes?: boolean }) => {
            const agent = (options.target ?? 'claude-code') as AgentTarget;

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
        .option('-t, --target <target>', 'Target harness (claude-code only in this version)', 'claude-code')
        .action((options: { target?: string }) => {
            const agent = (options.target ?? 'claude-code') as AgentTarget;
            try {
                const result = computeHookStatus(agent);
                const symbol = (ok: boolean) => ok ? pc.green('✓') : pc.red('✗');
                console.log('');
                console.log(`  Bootstrap skill:    ${symbol(result.checks.bootstrapSkill.ok)} ${result.checks.bootstrapSkill.detail}`);
                console.log(`  Session-start:      ${symbol(result.checks.sessionStartScript.ok)} ${result.checks.sessionStartScript.detail}`);
                console.log(`  Run-hook wrapper:   ${symbol(result.checks.runHookWrapper.ok)} ${result.checks.runHookWrapper.detail}`);
                console.log(`  Settings entry:     ${symbol(result.checks.settingsEntry.ok)} ${result.checks.settingsEntry.detail}`);
                console.log('');
                const overall = result.overall === 'HEALTHY' ? pc.green(result.overall) :
                                result.overall === 'NOT_INSTALLED' ? pc.yellow(result.overall) :
                                pc.red(result.overall);
                console.log(`  Status: ${overall}`);
                if (result.overall !== 'HEALTHY') {
                    process.exit(1);
                }
            } catch (e: any) {
                console.error(pc.red(`✗ ${e.message}`));
                process.exit(1);
            }
        });
}
