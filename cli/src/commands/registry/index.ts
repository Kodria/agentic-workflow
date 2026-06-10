// cli/src/commands/registry/index.ts
import fs from 'fs';
import { Command } from 'commander';
import { intro, outro, confirm, isCancel, spinner, multiselect, select } from '@clack/prompts';
import pc from 'picocolors';
import { listRegistries, contentRoots, BASE_CONTENT_DIR } from '../../core/registries';
import { discoverSkills, discoverWorkflows, discoverAgents } from '../../core/discovery';
import { discoverAllBundles } from '../../core/bundles';
import { reconcileAllSkillLinks } from '../../core/skill-integrity';
import { regenerateGlobalContext } from '../../core/context/regenerate';
import { addRegistry } from './add';
import { removeRegistry } from './remove';
import { overrideStatus } from './status';
import { getPreferences } from '../../utils/config';
import { findProjectRoot } from '../../core/profile';
import { AgentTarget, PROVIDERS } from '../../providers';
import { bundlesInRegistry, installBundlesFromRegistry } from './install-bundles';

export function registerRegistryCommand(program: Command): void {
    const reg = program.command('registry').description('manage additional content registries (team/personal)');

    reg.command('add <remote>')
        .description('clone an additional registry (git URL or local path) and register it')
        .option('--name <name>', 'registry name (default: repo basename)')
        .option('--install-all', 'install every bundle from the new registry for the default agent')
        .option('--no-install', 'skip the bundle install offer')
        .action(async (remote: string, options: { name?: string; installAll?: boolean; install?: boolean }) => {
            intro(pc.bgCyan(pc.black(' AWM - Add Registry ')));
            const s = spinner();
            s.start('Cloning and validating registry...');
            const result = await addRegistry(remote, options.name);
            if (!result.ok) {
                s.stop('Failed.');
                console.error(pc.red(result.error));
                process.exit(1);
            }
            s.stop(`Registry ${pc.cyan(result.name)} added at ${result.contentRoot}`);
            try {
                regenerateGlobalContext();
            } catch {
                // context regeneration must not abort a successful add
            }

            // Bundle install offer — failure NEVER reverts the add.
            try {
                const available = bundlesInRegistry(result.contentRoot);
                if (available.length > 0) {
                    const prefs = getPreferences();
                    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
                    const interactive = process.stdout.isTTY && process.stdin.isTTY;

                    let selection: string[] | 'all' | null = null;
                    let agents: AgentTarget[] = [prefs.defaultAgent];

                    if (options.install === false) {
                        selection = null;
                    } else if (options.installAll) {
                        selection = 'all';
                    } else if (interactive) {
                        const picked = await multiselect({
                            message: `Install bundles from ${result.name}?`,
                            options: available.map((b) => ({ value: b, label: b })),
                            required: false,
                        });
                        if (!isCancel(picked) && (picked as string[]).length > 0) {
                            selection = picked as string[];
                            const agentPick = await select({
                                message: 'Target agent',
                                initialValue: prefs.defaultAgent,
                                options: Object.keys(PROVIDERS).map((a) => ({ value: a, label: a })),
                            });
                            if (!isCancel(agentPick)) agents = [agentPick as AgentTarget];
                            else selection = null;
                        }
                    }

                    if (selection) {
                        for (const r of installBundlesFromRegistry(result.contentRoot, selection, agents, projectRoot)) {
                            for (const line of r.installed) console.log(pc.green(`  ✓ ${line}`));
                            for (const sk of r.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${sk}`));
                        }
                    } else if (options.install !== false && !interactive) {
                        console.log(pc.dim(`  Bundles available: ${available.join(', ')}`));
                        console.log(pc.dim(`  Install with: awm add <bundle> --agent <agent>`));
                    }
                }
            } catch (e) {
                console.warn(pc.yellow(`  ⚠  Bundle install failed (registry add is intact): ${e instanceof Error ? e.message : String(e)}`));
            }

            outro(`✅ Run ${pc.cyan('awm list')} to see the new content.`);
        });

    reg.command('list')
        .description('list configured additional registries')
        .action(() => {
            const regs = listRegistries();
            if (regs.length === 0) {
                console.log(pc.dim('No additional registries. Add one with `awm registry add <git-url>`.'));
                return;
            }
            const earlier: string[] = fs.existsSync(BASE_CONTENT_DIR) ? [BASE_CONTENT_DIR] : [];
            for (const r of regs) {
                if (!fs.existsSync(r.contentRoot)) {
                    console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.yellow("missing on disk — run 'awm update'")}`);
                    // Push before continue so overrides declared against this missing registry
                    // are correctly shown as "sin efecto" (orphan) rather than "active".
                    earlier.push(r.contentRoot);
                    continue;
                }
                try {
                    const counts = [
                        `${discoverSkills([r.contentRoot]).length} skills`,
                        `${discoverAllBundles([r.contentRoot]).length} bundles`,
                        `${discoverWorkflows([r.contentRoot]).length} workflows`,
                        `${discoverAgents([r.contentRoot]).length} agents`,
                    ].join(', ');
                    console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.dim(counts)}`);
                    for (const o of overrideStatus(r.contentRoot, earlier)) {
                        console.log(
                            o.active
                                ? pc.yellow(`    ↑ override activo: ${o.name}`)
                                : pc.dim(`    ∅ override sin efecto: ${o.name}`)
                        );
                    }
                } catch (e) {
                    console.log(`${pc.cyan(r.name)}  ${r.remote}  ${pc.yellow(`⚠  Error reading registry: ${e instanceof Error ? e.message : String(e)}`)}`);
                }
                earlier.push(r.contentRoot);
            }
        });

    reg.command('remove <name>')
        .description('remove an additional registry (config + clone)')
        .option('-y, --yes', 'skip confirmation')
        .action(async (name: string, options: { yes?: boolean }) => {
            intro(pc.bgCyan(pc.black(' AWM - Remove Registry ')));
            if (!options.yes) {
                const sure = await confirm({ message: `Remove registry "${name}" and its local clone?` });
                if (isCancel(sure) || !sure) {
                    outro('Cancelled.');
                    return;
                }
            }
            const result = removeRegistry(name);
            if (!result.ok) {
                console.error(pc.red(result.error));
                process.exit(1);
            }
            try {
                for (const { agent, result: r } of reconcileAllSkillLinks(contentRoots())) {
                    if (r.pruned.length > 0) {
                        console.log(pc.yellow(`  ⚠  Pruned ${r.pruned.length} dead skill link(s) for ${agent}`));
                    }
                }
            } catch {
                // reconciliation must not abort a successful remove
            }
            outro(`✅ Registry ${pc.cyan(name)} removed.`);
        });
}
