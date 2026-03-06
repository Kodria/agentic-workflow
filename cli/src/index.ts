#!/usr/bin/env node

import { intro, outro, spinner, select, multiselect, confirm, isCancel } from '@clack/prompts';
import { Command } from 'commander';
import { getPreferences, savePreferences } from './utils/config';
import { getTargetPath, AgentTarget, Scope, ArtifactType, PROVIDERS } from './providers';
import { installArtifact, removeArtifact } from './core/executor';
import { syncRegistry } from './core/registry';
import { discoverSkills, discoverWorkflows, discoverAgents, discoverProcesses, ProcessDefinition, SkillArtifact, WorkflowArtifact, AgentArtifact, SKILLS_DIR, WORKFLOWS_DIR, AGENTS_DIR } from './core/discovery';
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

interface CombinedArtifact {
    baseName: string;
    artifacts: GroupableArtifact[];
}

function buildGroupedOptions<T extends GroupableArtifact>(
    artifacts: T[],
    processes: ProcessDefinition[],
    formatLabel: (c: CombinedArtifact) => string
): { value: any; label: string; hint?: string }[] {
    const grouped = new Map<string, Map<string, T[]>>();
    const standalone = new Map<string, T[]>();

    for (const a of artifacts) {
        let foundParent = false;
        const baseName = (a.type === 'workflow' || a.type === 'agent') ? a.name.replace(/\.md$/, '') : a.name;

        for (const p of processes) {
            if ((a.type === 'skill' && p.skills.includes(baseName)) ||
                (a.type === 'workflow' && p.workflows.includes(baseName)) ||
                (a.type === 'agent' && p.agents?.includes(baseName))) {
                if (!grouped.has(p.name)) grouped.set(p.name, new Map());
                const procGroup = grouped.get(p.name)!;
                if (!procGroup.has(baseName)) procGroup.set(baseName, []);
                procGroup.get(baseName)!.push(a);
                foundParent = true;
                break;
            }
        }
        if (!foundParent) {
            if (!standalone.has(baseName)) standalone.set(baseName, []);
            standalone.get(baseName)!.push(a);
        }
    }

    const options: { value: any; label: string; hint?: string }[] = [];

    for (const [procName, baseNameMap] of grouped.entries()) {
        const proc = processes.find(p => p.name === procName)!;
        const children = Array.from(baseNameMap.entries()).map(([baseName, arr]) => ({ baseName, artifacts: arr }));
        options.push({
            value: { _group: true, processName: procName, children },
            label: `📦 ${procName}`,
            hint: `${proc.description} — ${children.length} artifacts`
        });
        children.forEach((c, idx) => {
            const prefix = idx === children.length - 1 ? '  └─ ' : '  ├─ ';
            options.push({ value: { _child: true, combined: c }, label: `${prefix}${formatLabel(c)}` });
        });
    }

    if (standalone.size > 0) {
        Array.from(standalone.entries()).forEach(([baseName, arr]) => {
            const c = { baseName, artifacts: arr };
            options.push({ value: { _child: true, combined: c }, label: `🔹 ${formatLabel(c)}` });
        });
    }

    return options;
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

      // 2. Discover artifacts
      const skills = discoverSkills();
      const workflows = discoverWorkflows();
      const agents = discoverAgents();
      const processes = discoverProcesses();

      if (skills.length === 0 && workflows.length === 0 && agents.length === 0 && processes.length === 0) {
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

      // 4. Build unified artifact list grouped by process
      const includeWorkflows = targetAgents.some(a => PROVIDERS[a].workflow !== null);
      const includeAgents = targetAgents.some(a => PROVIDERS[a].agent !== null);
      const allAvailable: GroupableArtifact[] = [
          ...skills.map(s => ({ name: s.name, type: 'skill' as ArtifactType, sourcePath: s.path })),
          ...(includeWorkflows ? workflows.map(w => ({ name: `${w.name}.md`, type: 'workflow' as ArtifactType, sourcePath: w.path })) : []),
          ...(includeAgents ? agents.map(a => ({ name: `${a.name}.md`, type: 'agent' as ArtifactType, sourcePath: a.path })) : [])
      ];

      if (allAvailable.length === 0) {
          outro(pc.yellow('No artifacts available for the selected agent(s).'));
          process.exit(0);
      }

      const groupedOpts = buildGroupedOptions(allAvailable, processes,
          (c) => {
              const hasSkill = c.artifacts.some(a => a.type === 'skill');
              const hasWf = c.artifacts.some(a => a.type === 'workflow');
              const hasAgent = c.artifacts.some(a => a.type === 'agent');
              const icons = [hasSkill ? '🧠' : '', hasWf ? '⚡' : '', hasAgent ? '🤖' : ''].filter(Boolean).join(' ');
              return `${icons} ${c.baseName}`;
          });

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
      const agents = discoverAgents();
      const processes = discoverProcesses();

      // Build combined artifact list for grouping
      const allArtifacts: GroupableArtifact[] = [
          ...skills.map(s => ({ name: s.name, type: 'skill' as ArtifactType })),
          ...workflows.map(w => ({ name: `${w.name}.md`, type: 'workflow' as ArtifactType })),
          ...agents.map(a => ({ name: `${a.name}.md`, type: 'agent' as ArtifactType }))
      ];

      const grouped = new Map<string, Map<string, GroupableArtifact[]>>();
      const standalone = new Map<string, GroupableArtifact[]>();

      for (const a of allArtifacts) {
          let found = false;
          const baseName = a.type === 'workflow' || a.type === 'agent' ? a.name.replace(/\.md$/, '') : a.name;
          for (const p of processes) {
              if ((a.type === 'skill' && p.skills.includes(baseName)) ||
                  (a.type === 'workflow' && p.workflows.includes(baseName)) ||
                  (a.type === 'agent' && p.agents?.includes(baseName))) {
                  if (!grouped.has(p.name)) grouped.set(p.name, new Map());
                  const procGroup = grouped.get(p.name)!;
                  if (!procGroup.has(baseName)) procGroup.set(baseName, []);
                  procGroup.get(baseName)!.push(a);
                  found = true;
                  break;
              }
          }
          if (!found) {
              if (!standalone.has(baseName)) standalone.set(baseName, []);
              standalone.get(baseName)!.push(a);
          }
      }

      for (const [procName, baseNameMap] of grouped.entries()) {
          const proc = processes.find(p => p.name === procName)!;
          let skillCount = 0; let wfCount = 0; let agentCount = 0;
          const children = Array.from(baseNameMap.values());
          for (const arr of children) {
              if (arr.some(a => a.type === 'skill')) skillCount++;
              if (arr.some(a => a.type === 'workflow')) wfCount++;
              if (arr.some(a => a.type === 'agent')) agentCount++;
          }
          const badges = [skillCount > 0 ? `🧠 ${skillCount} skills` : '', wfCount > 0 ? `⚡ ${wfCount} workflows` : '', agentCount > 0 ? `🤖 ${agentCount} agents` : ''].filter(Boolean).join(' · ');
          console.log(`\n${pc.cyan(pc.bold(`📦 ${procName}`))} ${pc.dim(`— ${proc.description}`)} ${pc.magenta(`[${badges}]`)}`);
          children.forEach((arr, idx) => {
              const prefix = idx === children.length - 1 ? '  └─ ' : '  ├─ ';
              const hasSkill = arr.some(a => a.type === 'skill');
              const hasWf = arr.some(a => a.type === 'workflow');
              const hasAgent = arr.some(a => a.type === 'agent');
              const icons = [hasSkill ? '🧠' : '', hasWf ? '⚡' : '', hasAgent ? '🤖' : ''].filter(Boolean).join(' ');
              const baseName = arr[0].type === 'workflow' || arr[0].type === 'agent' ? arr[0].name.replace(/\.md$/, '') : arr[0].name;
              console.log(`${prefix}${icons} ${baseName}`);
          });
      }

      if (standalone.size > 0) {
          console.log(`\n${pc.cyan(pc.bold('🔹 Standalone'))}`);
          const entries = Array.from(standalone.entries());
          entries.forEach(([baseName, arr], idx) => {
              const prefix = idx === entries.length - 1 ? '  └─ ' : '  ├─ ';
              const hasSkill = arr.some(a => a.type === 'skill');
              const hasWf = arr.some(a => a.type === 'workflow');
              const hasAgent = arr.some(a => a.type === 'agent');
              const icons = [hasSkill ? '🧠' : '', hasWf ? '⚡' : '', hasAgent ? '🤖' : ''].filter(Boolean).join(' ');
              console.log(`${prefix}${icons} ${baseName}`);
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
          try { scanDir(getTargetPath('agent', targetAgent, scopeVal), 'agent', targetAgent); } catch { /* ok */ }
      }

      const installed = Array.from(artifactMap.values());

      if (installed.length === 0) {
          outro(pc.yellow('No installed artifacts found for the selected agents/scope.'));
          process.exit(0);
      }

      const processes = discoverProcesses();
      const groupedOpts = buildGroupedOptions(installed, processes,
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

program.parse();
