#!/usr/bin/env node

import { intro, outro, spinner, select, multiselect, confirm, isCancel } from '@clack/prompts';
import { Command } from 'commander';
import { getPreferences, savePreferences } from './utils/config';
import { getTargetPath, AgentTarget, Scope, ArtifactType } from './providers';
import { installArtifact, removeArtifact } from './core/executor';
import { syncRegistry } from './core/registry';
import { discoverSkills, discoverWorkflows, discoverProcesses, ProcessDefinition, SkillArtifact, WorkflowArtifact, SKILLS_DIR, WORKFLOWS_DIR } from './core/discovery';
import path from 'path';
import pc from 'picocolors';

const program = new Command();
program.name('awm').description('Agentic Workflow Manager').version('1.0.0');

function handleCancel(value: unknown): void {
    if (isCancel(value)) {
        outro('Operation cancelled.');
        process.exit(0);
    }
}

// ── Grouping utilities ──────────────────────────────────────────────────────

interface GroupableArtifact {
    name: string;
    type: ArtifactType;
    [k: string]: any;
}

function buildGroupedOptions<T extends GroupableArtifact>(
    artifacts: T[],
    processes: ProcessDefinition[],
    formatLabel: (a: T) => string
): { value: any; label: string; hint?: string }[] {
    const grouped = new Map<string, T[]>();
    const standalone: T[] = [];

    for (const a of artifacts) {
        let foundParent = false;
        for (const p of processes) {
            const matchName = a.type === 'workflow' ? a.name.replace(/\.md$/, '') : a.name;
            if ((a.type === 'skill' && p.skills.includes(matchName)) ||
                (a.type === 'workflow' && p.workflows.includes(matchName))) {
                if (!grouped.has(p.name)) grouped.set(p.name, []);
                grouped.get(p.name)!.push(a);
                foundParent = true;
                break;
            }
        }
        if (!foundParent) standalone.push(a);
    }

    const options: { value: any; label: string; hint?: string }[] = [];

    for (const [procName, children] of grouped.entries()) {
        const proc = processes.find(p => p.name === procName)!;
        options.push({
            value: { _group: true, processName: procName, children },
            label: `📦 ${procName}`,
            hint: `${proc.description} — ${children.length} artifacts`
        });
        children.forEach((c, idx) => {
            const prefix = idx === children.length - 1 ? '  └─ ' : '  ├─ ';
            options.push({ value: { _child: true, artifact: c }, label: `${prefix}${formatLabel(c)}` });
        });
    }

    if (standalone.length > 0) {
        standalone.forEach(c => {
            options.push({ value: { _child: true, artifact: c }, label: `🔹 ${formatLabel(c)}` });
        });
    }

    return options;
}

function resolveSelectedArtifacts(selections: any[]): any[] {
    const result = new Map<string, any>();
    for (const sel of selections) {
        if (sel._group) {
            for (const c of sel.children) result.set(c.name, c);
        } else if (sel._child) {
            result.set(sel.artifact.name, sel.artifact);
        }
    }
    return Array.from(result.values());
}

program.command('add [name]')
  .description('Add a skill, workflow, or process interactively (or non-interactively with flags)')
  .option('-t, --type <type>', 'Artifact type: skill, workflow, or process')
  .option('-a, --agent <agent>', 'Target agent: antigravity or opencode')
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

      // 2. Discover artifacts
      const skills = discoverSkills();
      const workflows = discoverWorkflows();
      const processes = discoverProcesses();

      if (skills.length === 0 && workflows.length === 0 && processes.length === 0) {
          outro(pc.yellow('No artifacts found in the registry. Please check your registry content.'));
          process.exit(0);
      }

      const prefs = getPreferences();

      // 3. Agent & Scope Prompts (Moved up)
      let targetAgents: AgentTarget[];
      if (options.agent) {
          const parsed = options.agent.split(',').map(a => a.trim());
          for (const a of parsed) {
              if (!['antigravity', 'opencode'].includes(a)) {
                  console.error(pc.red(`Invalid agent "${a}". Use: antigravity or opencode.`));
                  process.exit(1);
              }
          }
          targetAgents = parsed as AgentTarget[];
      } else {
          const agentChoice = await multiselect({
              message: 'Which agent(s) do you want to install to?',
              options: [
                  { value: 'antigravity' as AgentTarget, label: 'Antigravity' },
                  { value: 'opencode' as AgentTarget, label: 'OpenCode' }
              ],
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

      // 4. Build unified artifact list grouped by process
      const includeWorkflows = targetAgents.includes('antigravity');
      const allAvailable: GroupableArtifact[] = [
          ...skills.map(s => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path })),
          ...(includeWorkflows ? workflows.map(w => ({ name: `${w.name}.md`, type: 'workflow' as ArtifactType, sourcePath: w.path })) : [])
      ];

      if (allAvailable.length === 0) {
          outro(pc.yellow('No artifacts available for the selected agent(s).'));
          process.exit(0);
      }

      const groupedOpts = buildGroupedOptions(allAvailable, processes,
          (a) => `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name}`);

      // 5. Pick artifact(s) via grouped multiselect
      const artifactChoice = await multiselect({
          message: 'Select artifact(s) to install',
          options: groupedOpts,
          required: true
      });
      handleCancel(artifactChoice);

      const resolved = resolveSelectedArtifacts(artifactChoice as any[]);
      const artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] = resolved.map((a: any) => ({
          name: a.name,
          sourcePath: a.sourcePath,
          type: a.type
      }));

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
      const totalInstalls = artifactsToInstall.length * targetAgents.length;
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
                  // Skip workflows for non-Antigravity agents
                  if (currentAgent !== 'antigravity' && artifact.type === 'workflow') {
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
                  console.log(pc.yellow(`  ⚠️  Skipped: ${s} (workflows not supported)`));
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
          outro('✅ All symlinked skills and workflows are now up-to-date.');
      } catch (e: any) {
          s.stop('Update failed.');
          console.error(pc.red(e.message));
          process.exit(1);
      }
});

program.command('list')
  .description('List all available artifacts in the local cache registry')
  .action(async () => {
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

      const skills = discoverSkills();
      const workflows = discoverWorkflows();
      const processes = discoverProcesses();

      // Build combined artifact list for grouping
      const allArtifacts: GroupableArtifact[] = [
          ...skills.map(s => ({ name: s.name, type: 'skill' as ArtifactType })),
          ...workflows.map(w => ({ name: `${w.name}.md`, type: 'workflow' as ArtifactType }))
      ];

      const grouped = new Map<string, GroupableArtifact[]>();
      const standalone: GroupableArtifact[] = [];

      for (const a of allArtifacts) {
          let found = false;
          for (const p of processes) {
              const matchName = a.type === 'workflow' ? a.name.replace(/\.md$/, '') : a.name;
              if ((a.type === 'skill' && p.skills.includes(matchName)) ||
                  (a.type === 'workflow' && p.workflows.includes(matchName))) {
                  if (!grouped.has(p.name)) grouped.set(p.name, []);
                  grouped.get(p.name)!.push(a);
                  found = true;
                  break;
              }
          }
          if (!found) standalone.push(a);
      }

      for (const [procName, children] of grouped.entries()) {
          const proc = processes.find(p => p.name === procName)!;
          const skillCount = children.filter(c => c.type === 'skill').length;
          const wfCount = children.filter(c => c.type === 'workflow').length;
          const badges = [skillCount > 0 ? `🧠 ${skillCount} skills` : '', wfCount > 0 ? `⚡ ${wfCount} workflows` : ''].filter(Boolean).join(' · ');
          console.log(`\n${pc.cyan(pc.bold(`📦 ${procName}`))} ${pc.dim(`— ${proc.description}`)} ${pc.magenta(`[${badges}]`)}`);
          children.forEach((c, idx) => {
              const prefix = idx === children.length - 1 ? '  └─ ' : '  ├─ ';
              const icon = c.type === 'skill' ? '🧠' : '⚡';
              console.log(`${prefix}${icon} ${c.name}`);
          });
      }

      if (standalone.length > 0) {
          console.log(`\n${pc.cyan(pc.bold('🔹 Standalone'))}`);
          standalone.forEach((c, idx) => {
              const prefix = idx === standalone.length - 1 ? '  └─ ' : '  ├─ ';
              const icon = c.type === 'skill' ? '🧠' : '⚡';
              console.log(`${prefix}${icon} ${c.name}`);
          });
      }

      console.log();
      outro(`Run ${pc.green('awm add')} to install any of these artifacts.`);
  });

program.command('remove')
  .description('Remove an installed skill or workflow')
  .action(async () => {
      intro(pc.bgCyan(pc.black(' AWM - Remove Artifact ')));

      const prefs = getPreferences();

      // Multi-agent selection (matching the add command flow)
      const agentChoice = await multiselect({
          message: 'From which agent(s)?',
          options: [
              { value: 'antigravity' as AgentTarget, label: 'Antigravity' },
              { value: 'opencode' as AgentTarget, label: 'OpenCode' }
          ],
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
      const fs = await import('fs');
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
      }

      const installed = Array.from(artifactMap.values());

      if (installed.length === 0) {
          outro(pc.yellow('No installed artifacts found for the selected agents/scope.'));
          process.exit(0);
      }

      const processes = discoverProcesses();
      const groupedOpts = buildGroupedOptions(installed, processes,
          (a) => `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name} ${pc.dim(`(in: ${a.installedIn.join(', ')})`)}`
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

program.parse();
