#!/usr/bin/env node

import { intro, outro, spinner, select, multiselect, confirm, isCancel } from '@clack/prompts';
import { Command } from 'commander';
import { getPreferences, savePreferences } from './utils/config';
import { buildGroupedOptions } from './utils/grouping';
import { buildPackageView, packageSummaryLines, packageDetailLines, findPackage, buildLevel1Options, buildLevel2Options, resolveLevel2Selection, ALL_SENTINEL, ArtifactView, artifactValue } from './utils/registry-view';
import { getTargetPath, AgentTarget, Scope, ArtifactType, PROVIDERS } from './providers';
import { installArtifact, removeArtifact } from './core/executor';
import { syncRegistry } from './core/registry';
import { regenerateGlobalContext } from './core/context/regenerate';
import { discoverSkills, discoverWorkflows, discoverAgents } from './core/discovery';
import { discoverBundles, defaultScopeForBundle } from './core/bundles';
import { addBundle, syncProfile } from './core/bundle-install';
import { findProjectRoot, readProfile } from './core/profile';
import path from 'path';
import pc from 'picocolors';
import fs from 'fs';
import { parseStoryMap, updateMiroFrameId } from './core/story-map-parser';
import { syncToMiro } from './core/miro';
import { registerHooksCommand } from './commands/hooks';
import { registerSensorsCommand } from './commands/sensors';
import { registerDoctorCommand } from './commands/doctor';
import { registerInitCommand } from './commands/init';

const program = new Command();
program.name('awm').description('Agentic Workflow Manager').version('1.0.0');

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
  .option('-a, --agent <agent>', `Target agent: ${Object.keys(PROVIDERS).join(', ')}`)
  .option('-s, --scope <scope>', 'Scope: local or global')
  .option('-m, --method <method>', 'Install method: symlink or copy')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (name: string | undefined, options: { type?: string; agent?: string; scope?: string; method?: string; yes?: boolean }) => {
      intro(pc.bgCyan(pc.black(' AWM - Agentic Workflow Manager ')));

      // 1. Sync the registry
      const s = spinner();
      s.start('Syncing registry with remote...');
      try {
          await syncRegistry();
          s.stop('Registry synced.');
      } catch (e: any) {
          s.stop('Failed to sync registry.');
          console.error(pc.red(e.message));
          process.exit(1);
      }

      // 1b. If `name` matches a bundle, run the bundle-activation flow and exit.
      if (name) {
          const allBundles = discoverBundles();
          const matchedBundle = allBundles.find((b) => b.name === name);
          if (matchedBundle) {
              const prefs = getPreferences();

              let bundleAgents: AgentTarget[];
              if (options.agent) {
                  const valid = Object.keys(PROVIDERS);
                  const parsed = options.agent.split(',').map((a) => a.trim());
                  for (const a of parsed) {
                      if (!valid.includes(a)) {
                          console.error(pc.red(`Invalid agent "${a}". Use: ${valid.join(', ')}.`));
                          process.exit(1);
                      }
                  }
                  bundleAgents = parsed as AgentTarget[];
              } else {
                  bundleAgents = [prefs.defaultAgent];
              }

              let scopeOverride: Scope | undefined;
              if (options.scope) {
                  if (!['local', 'global'].includes(options.scope)) {
                      console.error(pc.red(`Invalid scope "${options.scope}". Use: local or global.`));
                      process.exit(1);
                  }
                  scopeOverride = options.scope as Scope;
              }

              const effective = scopeOverride ?? defaultScopeForBundle(matchedBundle.scope);
              const projectRoot = findProjectRoot(process.cwd());
              if (effective === 'local' && !projectRoot) {
                  console.error(pc.red('No project root found (need a .git/, package.json, or .awm/profile.json here). Run inside a project, or pass --global.'));
                  process.exit(1);
              }

              const result = addBundle({
                  bundleName: matchedBundle.name,
                  bundles: allBundles,
                  agents: bundleAgents,
                  method: 'symlink',
                  projectRoot: projectRoot ?? process.cwd(),
                  scopeOverride,
              });

              if (result.skipped.length > 0) {
                  for (const s of result.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${s}`));
              }
              if (result.installed.length === 0) {
                  outro(pc.yellow(`Nothing installed for bundle "${matchedBundle.name}".`));
                  return;
              }
              const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
              const recordNote = result.recordedExtension
                  ? `\n\n${pc.dim('Recorded as a project extension in .awm/profile.json (commit it; symlinks are gitignored).')}`
                  : '';
              outro(`✅ Installed bundle ${pc.cyan(matchedBundle.name)}:\n  ${lines}${recordNote}`);
              return;
          }
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

      // 3. Agent & Scope Prompts (Moved up)
      let targetAgents: AgentTarget[];
      if (options.agent) {
          const validAgents = Object.keys(PROVIDERS);
          const parsed = options.agent.split(',').map(a => a.trim());
          for (const a of parsed) {
              if (!validAgents.includes(a)) {
                  console.error(pc.red(`Invalid agent "${a}". Use: ${validAgents.join(', ')}.`));
                  process.exit(1);
              }
          }
          targetAgents = parsed as AgentTarget[];
      } else {
          const agentChoice = await multiselect({
              message: 'Which agent(s) do you want to install to?',
              options: Object.entries(PROVIDERS).map(([key, config]) => ({
                  value: key as AgentTarget,
                  label: config.label
              })),
              initialValues: [prefs.defaultAgent],
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
      const includeWorkflows = targetAgents.some(a => PROVIDERS[a].workflow !== null);
      const includeAgents = targetAgents.some(a => PROVIDERS[a].agent !== null);
      const view = buildPackageView(
          skills,
          includeWorkflows ? workflows : [],
          includeAgents ? agents : [],
          discoverBundles()
      );

      if (view.length === 0) {
          outro(pc.yellow('No artifacts available for the selected agent(s).'));
          process.exit(0);
      }

      // 5. Level 1 — pick package(s)
      const pkgChoice = await multiselect({
          message: 'Select package(s)',
          options: buildLevel1Options(view),
          required: true
      });
      handleCancel(pkgChoice);
      const selectedPackages = (pkgChoice as string[])
          .map(name => view.find(p => p.name === name)!)
          .filter(Boolean);

      // 5b. Level 2 — pick skills within each package, in sequence
      const dedup = new Map<string, ArtifactView>();
      for (let i = 0; i < selectedPackages.length; i++) {
          const pkg = selectedPackages[i];
          const skillChoice = await multiselect({
              message: `[${i + 1}/${selectedPackages.length}] ${pkg.name} — select artifacts`,
              options: buildLevel2Options(pkg),
              initialValues: [ALL_SENTINEL],
              required: true
          });
          handleCancel(skillChoice);
          for (const a of resolveLevel2Selection(pkg, skillChoice as string[])) {
              dedup.set(artifactValue(a), a);
          }
      }

      const artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] =
          Array.from(dedup.values()).map(a => ({ name: a.installName, sourcePath: a.sourcePath, type: a.type }));

      if (artifactsToInstall.length === 0) {
          outro(pc.yellow('No artifacts selected.'));
          return;
      }

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
                  if (PROVIDERS[currentAgent][artifact.type] === null) {
                      skipped.push(`${artifact.name} (${currentAgent})`);
                      continue;
                  }
                  const targetDir = getTargetPath(artifact.type, currentAgent, scopeVal);
                  const finalDest = path.join(targetDir, artifact.name);
                  installArtifact(artifact.sourcePath, finalDest, methodVal);
                  installed.push(`${artifact.name} → ${currentAgent} (${scopeVal})`);
              }
          }

          savePreferences({ defaultAgent: targetAgents[0], defaultScope: scopeVal, installMethod: methodVal });

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
  .description('Sync the local registry with the remote repository')
  .action(async () => {
      intro(pc.bgCyan(pc.black(' AWM - Update Registry ')));

      const s = spinner();
      s.start('Pulling latest changes from remote...');

      try {
          await syncRegistry();
          s.stop('Registry updated successfully.');

          try {
              const regen = regenerateGlobalContext();
              const refreshed = regen.filter((r) => r.action === 'refreshed').map((r) => r.agent);
              if (refreshed.length > 0) {
                  console.log(pc.green(`  ✓ Regenerated AWM context for: ${refreshed.join(', ')}`));
              }
          } catch {
              // context regeneration failure must not abort a successful registry update
          }

          outro('✅ All symlinked skills and workflows are now up-to-date.');
      } catch (e: any) {
          s.stop('Update failed.');
          console.error(pc.red(e.message));
          process.exit(1);
      }
});

program.command('sync')
  .description('Rebuild local skill symlinks from .awm/profile.json (e.g. after cloning on a new machine)')
  .option('-a, --agent <agent>', `Target agent: ${Object.keys(PROVIDERS).join(', ')}`)
  .option('-m, --method <method>', 'Install method: symlink or copy', 'symlink')
  .action(async (options: { agent?: string; method?: string }) => {
      intro(pc.bgCyan(pc.black(' AWM - Sync Project Profile ')));

      const projectRoot = findProjectRoot(process.cwd());
      if (!projectRoot) {
          console.error(pc.red('No project root found (need a .git/, package.json, or .awm/profile.json here).'));
          process.exit(1);
      }

      const profile = readProfile(projectRoot);
      if (profile.extensions.length === 0) {
          outro(pc.yellow('No extensions in .awm/profile.json — nothing to sync. Use `awm add <bundle>` first.'));
          return;
      }

      const s = spinner();
      s.start('Syncing registry...');
      try {
          await syncRegistry();
          s.stop('Registry synced.');
      } catch (e: any) {
          s.stop('Failed to sync registry.');
          console.error(pc.red(e.message));
          process.exit(1);
      }

      const prefs = getPreferences();
      let agents: AgentTarget[];
      if (options.agent) {
          const valid = Object.keys(PROVIDERS);
          const parsed = options.agent.split(',').map((a) => a.trim());
          for (const a of parsed) {
              if (!valid.includes(a)) {
                  console.error(pc.red(`Invalid agent "${a}". Use: ${valid.join(', ')}.`));
                  process.exit(1);
              }
          }
          agents = parsed as AgentTarget[];
      } else {
          agents = [prefs.defaultAgent];
      }
      const method = options.method === 'copy' ? 'copy' : 'symlink';

      const result = syncProfile({ projectRoot, bundles: discoverBundles(), agents, method });
      if (result.skipped.length > 0) {
          for (const sk of result.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${sk}`));
      }
      const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
      const installedNote = lines ? `\n  ${lines}` : pc.dim(' (all up to date)');
      outro(`✅ Synced extensions [${result.extensions.join(', ')}]:${installedNote}`);
  });

program.command('list [package]')
  .description('List available artifacts. With no argument shows a package summary; pass a package name or --all for detail.')
  .option('-a, --all', 'Expand every package')
  .action(async (packageName: string | undefined, options: { all?: boolean }) => {
      intro(pc.bgCyan(pc.black(' AWM - Registry Listing ')));

      const s = spinner();
      s.start('Syncing registry...');
      try {
          await syncRegistry();
          s.stop('Registry synced.');
      } catch (e: any) {
          s.stop('Failed to sync registry.');
          console.error(pc.red(e.message));
          process.exit(1);
      }

      const fullView = buildPackageView(discoverSkills(), discoverWorkflows(), discoverAgents(), discoverBundles());
      const view = options.all ? fullView : fullView.filter((p) => p.visibility !== 'private');

      if (view.length === 0) {
          outro(pc.yellow('No artifacts found in the registry. Run `awm update` or check your registry content.'));
          return;
      }

      if (packageName && options.all) {
          console.log(pc.dim('(Ignoring --all when a package name is provided.)'));
      }

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
          for (const line of packageDetailLines(match)) console.log(line);
          console.log();
          outro(`Run ${pc.green(`awm add`)} to install artifacts from ${pc.cyan(match.name)}.`);
          return;
      }

      // Expand everything.
      if (options.all) {
          for (const pkg of view) {
              console.log();
              for (const line of packageDetailLines(pkg)) console.log(line);
          }
          console.log();
          outro(`Run ${pc.green('awm add')} to install any of these artifacts.`);
          return;
      }

      // Default: compact summary.
      console.log();
      for (const line of packageSummaryLines(view)) console.log(line);
      console.log();
      console.log(pc.dim(`  awm list <pkg>  ·  awm list --all`));
      outro(`Run ${pc.green('awm add')} to install artifacts.`);
  });

program.command('remove')
  .description('Remove an installed skill or workflow')
  .action(async () => {
      intro(pc.bgCyan(pc.black(' AWM - Remove Artifact ')));

      const prefs = getPreferences();

      // Multi-agent selection (matching the add command flow)
      const agentChoice = await multiselect({
          message: 'From which agent(s)?',
          options: Object.entries(PROVIDERS).map(([key, config]) => ({
              value: key as AgentTarget,
              label: config.label
          })),
          initialValues: [prefs.defaultAgent],
          required: true
      });
      handleCancel(agentChoice);
      const targetAgents = agentChoice as AgentTarget[];

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

      // Scan installed artifacts across all selected agents, aggregating by name
      const artifactMap = new Map<string, {
          name: string;
          type: ArtifactType;
          installedIn: AgentTarget[];
          fullPaths: string[];
      }>();

      const scanDir = (dir: string, type: ArtifactType, agent: AgentTarget) => {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
              const existing = artifactMap.get(entry.name);
              if (existing) {
                  existing.installedIn.push(agent);
                  existing.fullPaths.push(path.join(dir, entry.name));
              } else {
                  artifactMap.set(entry.name, {
                      name: entry.name,
                      type,
                      installedIn: [agent],
                      fullPaths: [path.join(dir, entry.name)]
                  });
              }
          }
      };

      for (const targetAgent of targetAgents) {
          try { scanDir(getTargetPath('skill', targetAgent, scopeVal), 'skill', targetAgent); } catch { /* ok */ }
          try { scanDir(getTargetPath('workflow', targetAgent, scopeVal), 'workflow', targetAgent); } catch { /* ok */ }
          try { scanDir(getTargetPath('agent', targetAgent, scopeVal), 'agent', targetAgent); } catch { /* ok */ }
      }

      const installed = Array.from(artifactMap.values());

      if (installed.length === 0) {
          outro(pc.yellow('No installed artifacts found for the selected agents/scope.'));
          process.exit(0);
      }

      const groupedOpts = buildGroupedOptions(installed, discoverBundles(),
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
registerDoctorCommand(program);
registerInitCommand(program);

program.parse();
