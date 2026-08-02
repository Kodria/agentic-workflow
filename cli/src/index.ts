#!/usr/bin/env node

import { intro, outro, spinner, select, multiselect, confirm, isCancel } from '@clack/prompts';
import { Command } from 'commander';
import { enableAgent, getPreferences, savePreferences } from './utils/config';
import { buildGroupedOptions } from './utils/grouping';
import { buildPackageView, packageSummaryLines, packageDetailLines, findPackage, packagePickerItems, artifactPickerItems, resolveLevel2Selection, ALL_SENTINEL, ArtifactView, artifactValue } from './utils/registry-view';
import { isInteractive } from './ui/tty';
import { multiselectPicker } from './ui/picker';
import {
  AGENT_TARGETS,
  assertLinkRenderer,
  providerFor,
  AgentTarget,
  Scope,
  ArtifactType,
} from './providers';
import { installArtifact, removeArtifact } from './core/executor';
import {
  scanLegacyArtifacts,
} from './core/provider-artifacts';
import { preflightLinkArtifactsForCli } from './ui/provider-preflight';
import { discoverSkills, discoverWorkflows, discoverAgents } from './core/discovery';
import { discoverAllBundles } from './core/bundles';
import { syncRegistries } from './core/registries';
import path from 'path';
import pc from 'picocolors';
import fs from 'fs';
import { parseStoryMap, updateMiroFrameId } from './core/story-map-parser';
import { syncToMiro } from './core/miro';
import { registerHooksCommand } from './commands/hooks';
import { registerSensorsCommand } from './commands/sensors';
import { registerLedgerCommand } from './commands/ledger';
import { registerDoctorCommand } from './commands/doctor';
import { registerBackupCommand } from './commands/backup';
import { registerInitCommand } from './commands/init';
import { registerRegistryCommand } from './commands/registry';
import { registerPinCommands } from './commands/pin';
import { registerExportCommand } from './commands/export';
import { registerAgentCommand } from './commands/agent';
import { registerJobCommand } from './commands/job';
import { registerWatchCommand } from './commands/watch';
import { registerTrackCommand } from './commands/track';
import { runAddBundleCore } from './commands/add';
import { runSyncCore } from './commands/sync';
import { runUpdateCore } from './commands/update';
import { resolveAgentTargetsOrError } from './core/agent-targets';
import type { AwmPreferences } from './utils/config';
import { maybeNotifyUpdate } from './core/update-check';
import { warnIfUnsupportedPlatform } from './core/paths';
import { cliVersion } from './core/cli-version';

const program = new Command();
program.name('awm').description('Agentic Workflow Manager').version(cliVersion());

program.hook('postAction', () => {
    try { maybeNotifyUpdate(); } catch { /* el aviso nunca rompe un comando */ }
});

/** Shared resolve-or-exit for the 3 index.ts call sites that need `--agent` targeting
 *  outside an already-testable `run*Core` function (which returns `{ code: 1, ... }`
 *  instead — see `core/agent-targets.ts`'s `resolveAgentTargetsOrError`). */
function resolveTargetsOrExit(prefs: AwmPreferences, explicit: string | undefined): AgentTarget[] {
    const resolved = resolveAgentTargetsOrError({ prefs, explicit });
    if (!resolved.ok) {
        console.error(pc.red(resolved.error));
        process.exit(1);
    }
    return resolved.targets;
}

function handleCancel(value: unknown): void {
    if (isCancel(value)) {
        outro('Operation cancelled.');
        process.exit(0);
    }
}


function resolveSelectedArtifacts(selections: any[]): any[] {
    const result = new Map<string, any>();
    for (const sel of selections) {
        if (sel._group) {
            for (const c of sel.children) {
                for (const a of c.artifacts) result.set(a.name, a);
            }
        } else if (sel._child) {
            for (const a of sel.combined.artifacts) {
                result.set(a.name, a);
            }
        }
    }
    return Array.from(result.values());
}

program.command('add [name]')
  .description('Add a skill, workflow, or process interactively (or non-interactively with flags)')
  .option('-t, --type <type>', 'Artifact type: skill, workflow, or process')
  .option('-a, --agent <agent>', `Target agent: ${AGENT_TARGETS.join(', ')}`)
  .option('-s, --scope <scope>', 'Scope: local or global')
  .option('-m, --method <method>', 'Install method: symlink or copy')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--all', 'install all artifacts from all packages without prompting')
  .action(async (name: string | undefined, options: { type?: string; agent?: string; scope?: string; method?: string; yes?: boolean; all?: boolean }) => {
      intro(pc.bgCyan(pc.black(' AWM - Agentic Workflow Manager ')));

      // 1. Sync the registry
      const s = spinner();
      s.start('Syncing registries...');
      const results = await syncRegistries();
      s.stop('Registries synced.');
      for (const r of results) {
          if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
      }

      // 1b. If `name` matches a bundle, run the bundle-activation flow and exit.
      if (name) {
          const allBundles = discoverAllBundles();
          const prefs = getPreferences();
          const outcome = runAddBundleCore({ name, agent: options.agent, scope: options.scope }, prefs, allBundles);
          if (outcome.code !== 0) process.exit(outcome.code);
          outro('Done.');
          return;
      }

      // 2. Discover artifacts
      const skills = discoverSkills();
      const workflows = discoverWorkflows();
      const agents = discoverAgents();

      if (skills.length === 0 && workflows.length === 0 && agents.length === 0) {
          outro(pc.yellow('No artifacts found in the registry. Please check your registry content.'));
          process.exit(0);
      }

      const prefs = getPreferences();

      // --all: install everything from every package headlessly
      if (options.all) {
          const targetAgents = resolveTargetsOrExit(prefs, options.agent);

          let scopeVal: Scope;
          if (options.scope) {
              if (!['local', 'global'].includes(options.scope)) {
                  console.error(pc.red(`Invalid scope "${options.scope}". Use: local or global.`));
                  process.exit(1);
              }
              scopeVal = options.scope as Scope;
          } else {
              scopeVal = prefs.defaultScope;
          }

          let methodVal: 'symlink' | 'copy';
          if (options.method) {
              if (!['symlink', 'copy'].includes(options.method)) {
                  console.error(pc.red(`Invalid method "${options.method}". Use: symlink or copy.`));
                  process.exit(1);
              }
              methodVal = options.method as 'symlink' | 'copy';
          } else {
              methodVal = scopeVal === 'local' ? 'copy' : 'symlink';
          }

          const includeWorkflows = targetAgents.some((a) => providerFor(a).workflow !== null);
          const includeAgents = targetAgents.some((a) => providerFor(a).agent !== null);
          const allView = buildPackageView(
              skills,
              includeWorkflows ? workflows : [],
              includeAgents ? agents : [],
              discoverAllBundles()
          );

          const allDedup = new Map<string, ArtifactView>();
          for (const pkg of allView) {
              for (const a of pkg.artifacts) {
                  allDedup.set(artifactValue(a), a);
              }
          }

          const artifactsToInstall = Array.from(allDedup.values()).map((a) => ({
              name: a.installName,
              sourcePath: a.sourcePath,
              type: a.type,
          }));

          if (artifactsToInstall.length === 0) {
              outro(pc.yellow('No artifacts available.'));
              return;
          }

          const preflightOk = preflightLinkArtifactsForCli(targetAgents.flatMap((agent) =>
              artifactsToInstall.map((artifact) => ({ agent, artifact })),
          ));
          if (!preflightOk) return;

          const installSpinner = spinner();
          installSpinner.start('Installing artifacts...');

          try {
              const installed: string[] = [];
              const skipped: string[] = [];

              for (const currentAgent of targetAgents) {
                  for (const artifact of artifactsToInstall) {
                      const config = assertLinkRenderer(artifact.type, currentAgent);
                      if (config === null) {
                          skipped.push(`${artifact.name} (${currentAgent})`);
                          continue;
                      }
                      const targetDir = config[scopeVal];
                      const finalDest = path.join(targetDir, artifact.name);
                      installArtifact(artifact.sourcePath, finalDest, methodVal);
                      installed.push(`${artifact.name} → ${currentAgent} (${scopeVal})`);
                  }
              }

              const updatedPrefs = targetAgents.reduce(
                  (current, agent) => enableAgent(current, agent),
                  prefs,
              );
              savePreferences({
                  ...updatedPrefs,
                  defaultAgent: targetAgents[0],
                  defaultScope: scopeVal,
                  installMethod: methodVal,
              });
              installSpinner.stop('Installation complete!');

              if (skipped.length > 0) {
                  for (const sk of skipped) {
                      console.log(pc.yellow(`  ⚠️  Skipped: ${sk} (not supported by target agent)`));
                  }
              }

              const names = installed.map((n) => pc.green(n)).join('\n  ');
              outro(`✅ Installed:\n  ${names}`);
          } catch (e: any) {
              installSpinner.stop('Installation failed.');
              console.error(pc.red(e.message));
              process.exit(1);
          }
          return;
      }

      // Interactive selection requires a TTY. Bundle-by-name (handled above) works headless.
      if (!isInteractive()) {
          console.error(pc.red('`awm add` needs an interactive terminal for selection.'));
          console.error(pc.dim('Install a bundle non-interactively: `awm add <bundle>` (optionally with --agent/--scope).'));
          process.exit(1);
      }

      // 3. Agent & Scope Prompts (Moved up)
      let targetAgents: AgentTarget[];
      if (options.agent) {
          targetAgents = resolveTargetsOrExit(prefs, options.agent);
      } else {
          const agentChoice = await multiselect({
              message: 'Which agent(s) do you want to install to?',
              options: AGENT_TARGETS.map((key) => ({
                  value: key,
                  label: providerFor(key).label
              })),
              initialValues: [...prefs.enabledAgents],
              required: true
          });
          handleCancel(agentChoice);
          targetAgents = agentChoice as AgentTarget[];
      }

      let scopeVal: Scope;
      if (options.scope) {
          if (!['local', 'global'].includes(options.scope)) {
              console.error(pc.red(`Invalid scope "${options.scope}". Use: local or global.`));
              process.exit(1);
          }
          scopeVal = options.scope as Scope;
      } else {
          const scopeChoice = await select({
              message: 'Installation scope',
              options: [
                  { value: 'local', label: 'Project (Local)' },
                  { value: 'global', label: 'Global' }
              ],
              initialValue: prefs.defaultScope
          });
          handleCancel(scopeChoice);
          scopeVal = scopeChoice as Scope;
      }

      // 4. Build the package view, filtered to artifact types the target agent(s) support
      const includeWorkflows = targetAgents.some(a => providerFor(a).workflow !== null);
      const includeAgents = targetAgents.some(a => providerFor(a).agent !== null);
      const view = buildPackageView(
          skills,
          includeWorkflows ? workflows : [],
          includeAgents ? agents : [],
          discoverAllBundles()
      );

      if (view.length === 0) {
          outro(pc.yellow('No artifacts available for the selected agent(s).'));
          process.exit(0);
      }

      // 5. Level 1 — pick package(s)
      const pickedPackages = await multiselectPicker({
          title: 'Select package(s)',
          items: packagePickerItems(view),
      });
      if (pickedPackages === null) { outro('Operation cancelled.'); process.exit(0); }
      if (pickedPackages.length === 0) { outro(pc.yellow('No packages selected.')); return; }
      const selectedPackages = pickedPackages
          .map((name) => view.find((p) => p.name === name)!)
          .filter(Boolean);

      // 5b. Level 2 — pick skills within each package, in sequence
      const dedup = new Map<string, ArtifactView>();
      for (let i = 0; i < selectedPackages.length; i++) {
          const pkg = selectedPackages[i];
          const picked = await multiselectPicker({
              title: `[${i + 1}/${selectedPackages.length}] ${pkg.name} — select artifacts`,
              items: artifactPickerItems(pkg),
              initialSelected: [ALL_SENTINEL, ...pkg.artifacts.map((a) => artifactValue(a))],
          });
          if (picked === null) { outro('Operation cancelled.'); process.exit(0); }
          for (const a of resolveLevel2Selection(pkg, picked)) {
              dedup.set(artifactValue(a), a);
          }
      }

      const artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] =
          Array.from(dedup.values()).map(a => ({ name: a.installName, sourcePath: a.sourcePath, type: a.type }));

      if (artifactsToInstall.length === 0) {
          outro(pc.yellow('No artifacts selected.'));
          return;
      }

      const preflightOk = preflightLinkArtifactsForCli(targetAgents.flatMap((agent) =>
          artifactsToInstall.map((artifact) => ({ agent, artifact })),
      ));
      if (!preflightOk) return;

      // 6. Installation Method
      let methodVal: 'symlink' | 'copy';
      if (options.method) {
          if (!['symlink', 'copy'].includes(options.method)) {
              console.error(pc.red(`Invalid method "${options.method}". Use: symlink or copy.`));
              process.exit(1);
          }
          methodVal = options.method as 'symlink' | 'copy';
      } else {
          const recommendedMethod = scopeVal === 'local' ? 'copy' : 'symlink';
          const methodChoice = await select({
              message: 'Installation method',
              options: [
                  { value: 'symlink', label: `Symlink (Updates instantly)${recommendedMethod === 'symlink' ? ' - Recommended' : ''}` },
                  { value: 'copy', label: `Copy to agent${recommendedMethod === 'copy' ? ' - Recommended for Git repos' : ''}` }
              ],
              initialValue: recommendedMethod
          });
          handleCancel(methodChoice);
          methodVal = methodChoice as 'symlink' | 'copy';
      }

      // 7. Confirm (skip with --yes)
      if (!options.yes) {
          const agentLabels = targetAgents.join(', ');
          const shouldProceed = await confirm({ message: `Install ${artifactsToInstall.length} artifact(s) to ${targetAgents.length} agent(s) (${agentLabels})?` });
          handleCancel(shouldProceed);
          if (!shouldProceed) {
              outro('Installation cancelled.');
              return;
          }
      }

      const installSpinner = spinner();
      installSpinner.start('Installing artifacts...');

      try {
          const installed: string[] = [];
          const skipped: string[] = [];

          for (const currentAgent of targetAgents) {
              for (const artifact of artifactsToInstall) {
                  // Skip artifacts not supported by this agent
                  const config = assertLinkRenderer(artifact.type, currentAgent);
                  if (config === null) {
                      skipped.push(`${artifact.name} (${currentAgent})`);
                      continue;
                  }
                  const targetDir = config[scopeVal];
                  const finalDest = path.join(targetDir, artifact.name);
                  installArtifact(artifact.sourcePath, finalDest, methodVal);
                  installed.push(`${artifact.name} → ${currentAgent} (${scopeVal})`);
              }
          }

          const updatedPrefs = targetAgents.reduce(
              (current, agent) => enableAgent(current, agent),
              prefs,
          );
          savePreferences({
              ...updatedPrefs,
              defaultAgent: targetAgents[0],
              defaultScope: scopeVal,
              installMethod: methodVal,
          });

          installSpinner.stop('Installation complete!');

          if (skipped.length > 0) {
              for (const s of skipped) {
                  console.log(pc.yellow(`  ⚠️  Skipped: ${s} (not supported by target agent)`));
              }
          }

          const names = installed.map(n => pc.green(n)).join('\n  ');
          outro(`✅ Installed:\n  ${names}`);
      } catch (e: any) {
          installSpinner.stop('Installation failed.');
          console.error(pc.red(e.message));
          process.exit(1);
      }
});

program.command('update')
  .description('Sync all configured registries, reconcile artifacts and re-sync hooks')
  .option('-a, --agent <agent>', `Target agent(s), comma-separated: ${AGENT_TARGETS.join(', ')} (defaults to every enabled agent)`)
  .action(async (options: { agent?: string }) => {
      intro(pc.bgCyan(pc.black(' AWM - Update Registries ')));
      warnIfUnsupportedPlatform((m) => console.warn(pc.yellow(`⚠ ${m}`)));
      const result = await runUpdateCore(options);
      outro(result.code === 0 ? '✅ Registries, skills and hooks updated.' : pc.red('Update failed — see errors above.'));
      process.exitCode = result.code;
  });

program.command('sync')
  .description('Rebuild local skill symlinks from .awm/profile.json (e.g. after cloning on a new machine)')
  .option('-a, --agent <agent>', `Target agent(s), comma-separated: ${AGENT_TARGETS.join(', ')} (defaults to every enabled agent)`)
  .option('-m, --method <method>', 'Install method: symlink or copy', 'symlink')
  .action(async (options: { agent?: string; method?: string }) => {
      intro(pc.bgCyan(pc.black(' AWM - Sync Project Profile ')));
      warnIfUnsupportedPlatform((m) => console.warn(pc.yellow(`⚠ ${m}`)));
      const { code } = await runSyncCore(options);
      outro(code === 0 ? 'Done.' : pc.red('Sync failed — see errors above.'));
      process.exitCode = code;
  });

program.command('list [package]')
  .description('List available artifacts. With no argument shows a package summary; pass a package name or --all for detail.')
  .option('-a, --all', 'Expand every package')
  .action(async (packageName: string | undefined, options: { all?: boolean }) => {
      intro(pc.bgCyan(pc.black(' AWM - Registry Listing ')));

      const s = spinner();
      s.start('Syncing registries...');
      const listSyncResults = await syncRegistries();
      s.stop('Registries synced.');
      for (const r of listSyncResults) {
          if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
      }

      const fullView = buildPackageView(discoverSkills(), discoverWorkflows(), discoverAgents(), discoverAllBundles());
      const view = options.all ? fullView : fullView.filter((p) => p.visibility !== 'private');

      if (view.length === 0) {
          outro(pc.yellow('No artifacts found in the registry. Run `awm update` or check your registry content.'));
          return;
      }

      if (packageName && options.all) {
          console.log(pc.dim('(Ignoring --all when a package name is provided.)'));
      }

      const listWidth = process.stdout.isTTY ? process.stdout.columns : undefined;

      // Detail for a single package.
      if (packageName) {
          const { match, suggestion } = findPackage(fullView, packageName);
          if (!match) {
              const hint = suggestion
                  ? pc.dim(` Did you mean "${suggestion}"?`)
                  : pc.dim(' Run `awm list` to see available packages.');
              console.error(pc.red(`No package named "${packageName}".`) + hint);
              process.exit(1);
          }
          console.log();
          for (const line of packageDetailLines(match, listWidth)) console.log(line);
          console.log();
          outro(`Run ${pc.green(`awm add`)} to install artifacts from ${pc.cyan(match.name)}.`);
          return;
      }

      // Expand everything.
      if (options.all) {
          for (const pkg of view) {
              console.log();
              for (const line of packageDetailLines(pkg, listWidth)) console.log(line);
          }
          console.log();
          outro(`Run ${pc.green('awm add')} to install any of these artifacts.`);
          return;
      }

      // Default: compact summary.
      console.log();
      for (const line of packageSummaryLines(view, listWidth)) console.log(line);
      console.log();
      console.log(pc.dim(`  awm list <pkg>  ·  awm list --all`));
      outro(`Run ${pc.green('awm add')} to install artifacts.`);
  });

program.command('remove')
  .description('Remove an installed skill or workflow')
  .option('-a, --agent <agent>', `Target agent(s), comma-separated: ${AGENT_TARGETS.join(', ')} (defaults to every enabled agent)`)
  .action(async (options: { agent?: string }) => {
      intro(pc.bgCyan(pc.black(' AWM - Remove Artifact ')));

      const prefs = getPreferences();

      // Multi-agent selection (matching the add command flow). --agent skips
      // the interactive prompt and resolves the same way as add/sync/update/doctor (R12/R13).
      let targetAgents: AgentTarget[];
      if (options.agent) {
          targetAgents = resolveTargetsOrExit(prefs, options.agent);
      } else {
          const agentChoice = await multiselect({
              message: 'From which agent(s)?',
              options: AGENT_TARGETS.map((key) => ({
                  value: key,
                  label: providerFor(key).label
              })),
              initialValues: [...prefs.enabledAgents],
              required: true
          });
          handleCancel(agentChoice);
          targetAgents = agentChoice as AgentTarget[];
      }

      const scopeChoice = await select({
          message: 'Scope?',
          options: [
              { value: 'local', label: 'Project (Local)' },
              { value: 'global', label: 'Global' }
          ],
          initialValue: prefs.defaultScope
      });
      handleCancel(scopeChoice);
      const scopeVal = scopeChoice as Scope;

      const installed = scanLegacyArtifacts(targetAgents, scopeVal);

      if (installed.length === 0) {
          outro(pc.yellow('No installed artifacts found for the selected agents/scope.'));
          process.exit(0);
      }

      const groupedOpts = buildGroupedOptions(installed, discoverAllBundles(),
          (c) => {
              const hasSkill = c.artifacts.some(a => a.type === 'skill');
              const hasWf = c.artifacts.some(a => a.type === 'workflow');
              const hasAgent = c.artifacts.some(a => a.type === 'agent');
              const icons = [hasSkill ? '🧠' : '', hasWf ? '⚡' : '', hasAgent ? '🤖' : ''].filter(Boolean).join(' ');
              const locations = new Set<string>();
              for (const a of c.artifacts) {
                  for (const loc of a.installedIn) locations.add(loc);
              }
              return `${icons} ${c.baseName} ${pc.dim(`(in: ${Array.from(locations).join(', ')})`)}`;
          }
      );

      const toRemove = await multiselect({
          message: 'Select artifact(s) to remove',
          options: groupedOpts,
          required: true
      });
      handleCancel(toRemove);

      const resolved = resolveSelectedArtifacts(toRemove as any[]) as typeof installed;
      const names = resolved.map(a => pc.red(a.name)).join(', ');

      const confirmRemove = await confirm({ message: `Remove ${names}?` });
      handleCancel(confirmRemove);

      if (confirmRemove) {
          try {
              for (const artifact of resolved) {
                  for (const p of artifact.fullPaths) {
                      removeArtifact(p);
                  }
              }
              outro(`✅ Removed ${resolved.map(a => pc.red(a.name)).join(', ')} (${scopeVal})`);
          } catch (e: any) {
              console.error(pc.red(e.message));
              process.exit(1);
          }
      } else {
          outro('Removal cancelled.');
      }
  });

function loadEnvFile(cwd: string): Record<string, string> {
    const envPath = path.join(cwd, '.env');
    if (!fs.existsSync(envPath)) return {};
    const env: Record<string, string> = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key) env[key] = value;
    }
    return env;
}

const miroCmd = program.command('miro').description('Miro board integration');

miroCmd.command('sync <storyMapPath>')
    .description('Sync a story-map.md file to a Miro board frame')
    .action(async (storyMapPath: string) => {
        intro(pc.bgCyan(pc.black(' AWM - Miro Sync ')));

        // 1. Load config from .env in cwd
        const env = loadEnvFile(process.cwd());
        const token = env['MIRO_TOKEN'];
        const boardId = env['MIRO_BOARD_ID'];

        if (!token || !boardId) {
            console.error(pc.red('✗ Missing config. Add to .env in project root:'));
            console.error(pc.dim('  MIRO_TOKEN=your_token_here'));
            console.error(pc.dim('  MIRO_BOARD_ID=your_board_id_here'));
            process.exit(1);
        }

        // 2. Read and parse story map
        const resolvedPath = path.resolve(process.cwd(), storyMapPath);
        if (!fs.existsSync(resolvedPath)) {
            console.error(pc.red(`✗ File not found: ${resolvedPath}`));
            process.exit(1);
        }

        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const storyMap = parseStoryMap(content);

        if (storyMap.activities.length === 0) {
            console.error(pc.red('✗ No activities found in Backbone section. Check markdown format.'));
            process.exit(1);
        }

        // 3. Sync to Miro
        const s = spinner();
        const isFirstSync = !storyMap.miro_frame_id;
        s.start(isFirstSync ? 'Creating Miro frame...' : 'Updating Miro frame...');

        try {
            const result = await syncToMiro(
                { token, boardId },
                storyMap,
                storyMap.miro_frame_id
            );

            // 4. Persist frame ID back to frontmatter on first sync
            if (isFirstSync) {
                const updated = updateMiroFrameId(content, result.frameId);
                fs.writeFileSync(resolvedPath, updated, 'utf-8');
            }

            s.stop('Sync complete!');
            console.log(pc.green(`  ✓ Frame: ${result.frameId}`));
            console.log(pc.green(`  ✓ Created: ${result.created} | Updated: ${result.updated} | Deleted: ${result.deleted}`));
            outro('Story map synced to Miro. Open your board to view the frame.');
        } catch (e: any) {
            s.stop('Sync failed.');
            console.error(pc.red(`✗ ${e.message}`));
            process.exit(1);
        }
    });

registerHooksCommand(program);
registerSensorsCommand(program);
registerLedgerCommand(program);
registerDoctorCommand(program);
registerBackupCommand(program);
registerInitCommand(program);
registerRegistryCommand(program);
registerPinCommands(program);
registerExportCommand(program);
registerAgentCommand(program);
registerJobCommand(program);
registerWatchCommand(program);
registerTrackCommand(program);

program.parse();
