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

      // 4. Determine what to install
      let installType: string;
      if (options.type) {
          if (!['skill', 'workflow', 'process'].includes(options.type)) {
              console.error(pc.red(`Invalid type "${options.type}". Use: skill, workflow, or process.`));
              process.exit(1);
          }
          installType = options.type;
      } else {
          const typeOptions: Array<{ value: 'process' | 'skill' | 'workflow'; label: string }> = [
              ...(processes.length > 0 ? [{ value: 'process' as const, label: `📦 Process (${processes.length} available)` }] : []),
              ...(skills.length > 0 ? [{ value: 'skill' as const, label: `🧠 Skill (${skills.length} available)` }] : [])
          ];
          
          if (targetAgents.includes('antigravity') && workflows.length > 0) {
              typeOptions.push({ value: 'workflow' as const, label: `⚡ Workflow (${workflows.length} available)` });
          }

          if (typeOptions.length === 0) {
              outro(pc.yellow(`No artifacts available for the selected agent.`));
              process.exit(0);
          }

          const selected = await select({
              message: 'What do you want to install?',
              options: typeOptions
          });
          handleCancel(selected);
          installType = selected as string;
      }

      // 5. Pick the artifact
      let artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] = [];

      if (installType === 'process') {
          let proc: ProcessDefinition;
          if (name) {
              const found = processes.find(p => p.name === name);
              if (!found) {
                  console.error(pc.red(`Process "${name}" not found. Available: ${processes.map(p => p.name).join(', ')}`));
                  process.exit(1);
              }
              proc = found;
          } else {
              const processChoice = await select({
                  message: 'Select a process to install',
                  options: processes.map(p => ({ value: p, label: `${p.name} - ${p.description}` }))
              });
              handleCancel(processChoice);
              proc = processChoice as ProcessDefinition;
          }
          for (const skillName of proc.skills) {
              artifactsToInstall.push({ name: skillName, sourcePath: path.join(SKILLS_DIR, skillName), type: 'skill' });
          }
          for (const wfName of proc.workflows) {
              artifactsToInstall.push({ name: `${wfName}.md`, sourcePath: path.join(WORKFLOWS_DIR, `${wfName}.md`), type: 'workflow' });
          }
      } else if (installType === 'skill') {
          let skillArtifact: SkillArtifact;
          if (name) {
              const found = skills.find(s => s.name === name);
              if (!found) {
                  console.error(pc.red(`Skill "${name}" not found. Available: ${skills.map(s => s.name).join(', ')}`));
                  process.exit(1);
              }
              skillArtifact = found;
              artifactsToInstall.push({ name: found.name, sourcePath: found.path, type: 'skill' });
          } else {
              const skillChoice = await select({
                  message: 'Select a skill to install',
                  options: skills.map(s => ({ value: s, label: s.name }))
              });
              handleCancel(skillChoice);
              skillArtifact = skillChoice as SkillArtifact;
              artifactsToInstall.push({ name: skillArtifact.name, sourcePath: skillArtifact.path, type: 'skill' });
          }

          // Suggest complementary workflow if in Antigravity
          if (targetAgents.includes('antigravity')) {
              const complementaryWorkflow = workflows.find(w => w.name === skillArtifact.name);
              if (complementaryWorkflow) {
                  let addWf: boolean;
                  if (options.yes) {
                      addWf = true;
                  } else {
                      const answer = await confirm({ message: `A complementary workflow "${complementaryWorkflow.name}" exists for Antigravity. Install it too?` });
                      handleCancel(answer);
                      addWf = answer as boolean;
                  }
                  if (addWf) {
                      artifactsToInstall.push({ name: `${complementaryWorkflow.name}.md`, sourcePath: complementaryWorkflow.path, type: 'workflow' });
                  }
              }
          }
      } else {
          let wfArtifact: WorkflowArtifact;
          if (name) {
              const found = workflows.find(w => w.name === name);
              if (!found) {
                  console.error(pc.red(`Workflow "${name}" not found. Available: ${workflows.map(w => w.name).join(', ')}`));
                  process.exit(1);
              }
              wfArtifact = found;
              artifactsToInstall.push({ name: `${found.name}.md`, sourcePath: found.path, type: 'workflow' });
          } else {
              const wfChoice = await select({
                  message: 'Select a workflow to install',
                  options: workflows.map(w => ({ value: w, label: w.name }))
              });
              handleCancel(wfChoice);
              wfArtifact = wfChoice as WorkflowArtifact;
              artifactsToInstall.push({ name: `${wfArtifact.name}.md`, sourcePath: wfArtifact.path, type: 'workflow' });
          }
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

      console.log(`\n${pc.cyan(pc.bold('Skills'))} (${skills.length} available)`);
      if (skills.length > 0) {
          skills.forEach(sk => console.log(`  🧠 ${sk.name}`));
      } else {
          console.log('  (none)');
      }

      console.log(`\n${pc.cyan(pc.bold('Workflows'))} (${workflows.length} available)`);
      if (workflows.length > 0) {
          workflows.forEach(wf => console.log(`  ⚡ ${wf.name}`));
      } else {
          console.log('  (none)');
      }

      console.log(`\n${pc.cyan(pc.bold('Processes'))} (${processes.length} available)`);
      if (processes.length > 0) {
          processes.forEach(proc => {
              console.log(`  📦 ${pc.bold(proc.name)} — ${proc.description}`);
              console.log(`     Skills: ${proc.skills.join(', ')}`);
              console.log(`     Workflows: ${proc.workflows.join(', ')}`);
          });
      } else {
          console.log('  (none)');
      }

      outro(`Run ${pc.green('awm add')} to install any of these artifacts.`);
  });

program.command('remove')
  .description('Remove an installed skill or workflow')
  .action(async () => {
      intro(pc.bgCyan(pc.black(' AWM - Remove Artifact ')));

      const prefs = getPreferences();

      const targetAgent = await select({
          message: 'From which agent?',
          options: [
              { value: 'antigravity', label: 'Antigravity' },
              { value: 'opencode', label: 'OpenCode' }
          ],
          initialValue: prefs.defaultAgent
      }) as AgentTarget;
      handleCancel(targetAgent);

      const scope = await select({
          message: 'Scope?',
          options: [
              { value: 'local', label: 'Project (Local)' },
              { value: 'global', label: 'Global' }
          ],
          initialValue: prefs.defaultScope
      }) as Scope;
      handleCancel(scope);

      // Scan installed artifacts
      const fs = await import('fs');
      const installed: { name: string; fullPath: string; type: ArtifactType }[] = [];

      const scanDir = (dir: string, type: ArtifactType) => {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
              installed.push({ name: entry.name, fullPath: path.join(dir, entry.name), type });
          }
      };

      try {
          scanDir(getTargetPath('skill', targetAgent, scope), 'skill');
      } catch { /* workflows not supported for some agents */ }
      try {
          scanDir(getTargetPath('workflow', targetAgent, scope), 'workflow');
      } catch { /* ok */ }

      if (installed.length === 0) {
          outro(pc.yellow('No installed artifacts found for this agent/scope.'));
          process.exit(0);
      }

      const toRemove = await select({
          message: 'Select artifact to remove',
          options: installed.map(a => ({ value: a, label: `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name}` }))
      });
      handleCancel(toRemove);

      const artifact = toRemove as typeof installed[0];

      const confirmRemove = await confirm({ message: `Remove ${pc.red(artifact.name)}?` });
      handleCancel(confirmRemove);

      if (confirmRemove) {
          try {
              removeArtifact(artifact.fullPath);
              outro(`✅ Removed ${pc.red(artifact.name)} from ${targetAgent} (${scope})`);
          } catch (e: any) {
              console.error(pc.red(e.message));
              process.exit(1);
          }
      } else {
          outro('Removal cancelled.');
      }
});

program.parse();
