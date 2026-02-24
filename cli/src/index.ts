#!/usr/bin/env node

import { intro, outro, spinner, select, confirm, isCancel } from '@clack/prompts';
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

program.command('add')
  .description('Add a skill, workflow, or process interactively')
  .action(async () => {
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

      // 3. What to install?
      const installType = await select({
          message: 'What do you want to install?',
          options: [
              ...(processes.length > 0 ? [{ value: 'process' as const, label: `📦 Process (${processes.length} available)` }] : []),
              ...(skills.length > 0 ? [{ value: 'skill' as const, label: `🧠 Skill (${skills.length} available)` }] : []),
              ...(workflows.length > 0 ? [{ value: 'workflow' as const, label: `⚡ Workflow (${workflows.length} available)` }] : []),
          ]
      });
      handleCancel(installType);

      // 4. Pick the artifact
      const prefs = getPreferences();
      let artifactsToInstall: { name: string; sourcePath: string; type: ArtifactType }[] = [];

      if (installType === 'process') {
          const processChoice = await select({
              message: 'Select a process to install',
              options: processes.map(p => ({ value: p, label: `${p.name} - ${p.description}` }))
          });
          handleCancel(processChoice);

          const proc = processChoice as ProcessDefinition;
          // Resolve all skills and workflows in the process
          for (const skillName of proc.skills) {
              artifactsToInstall.push({
                  name: skillName,
                  sourcePath: path.join(SKILLS_DIR, skillName),
                  type: 'skill'
              });
          }
          for (const wfName of proc.workflows) {
              artifactsToInstall.push({
                  name: `${wfName}.md`,
                  sourcePath: path.join(WORKFLOWS_DIR, `${wfName}.md`),
                  type: 'workflow'
              });
          }
      } else if (installType === 'skill') {
          const skillChoice = await select({
              message: 'Select a skill to install',
              options: skills.map(s => ({ value: s, label: s.name }))
          });
          handleCancel(skillChoice);
          const skill = skillChoice as SkillArtifact;
          artifactsToInstall.push({ name: skill.name, sourcePath: skill.path, type: 'skill' });
      } else {
          const wfChoice = await select({
              message: 'Select a workflow to install',
              options: workflows.map(w => ({ value: w, label: w.name }))
          });
          handleCancel(wfChoice);
          const wf = wfChoice as WorkflowArtifact;
          artifactsToInstall.push({ name: `${wf.name}.md`, sourcePath: wf.path, type: 'workflow' });
      }

      // 5. Agent & Scope
      const targetAgent = await select({
          message: 'Which agent do you want to install to?',
          options: [
              { value: 'antigravity', label: 'Antigravity' },
              { value: 'opencode', label: 'OpenCode' }
          ],
          initialValue: prefs.defaultAgent
      }) as AgentTarget;
      handleCancel(targetAgent);

      const scope = await select({
          message: 'Installation scope',
          options: [
              { value: 'local', label: 'Project (Local)' },
              { value: 'global', label: 'Global' }
          ],
          initialValue: prefs.defaultScope
      }) as Scope;
      handleCancel(scope);

      const method = await select({
          message: 'Installation method',
          options: [
              { value: 'symlink', label: 'Symlink (Recommended) - Updates instantly' },
              { value: 'copy', label: 'Copy to agent' }
          ],
          initialValue: prefs.installMethod
      }) as 'symlink' | 'copy';
      handleCancel(method);

      // 6. Confirm
      const shouldProceed = await confirm({ message: `Install ${artifactsToInstall.length} artifact(s)?` });
      handleCancel(shouldProceed);

      if (shouldProceed) {
          const installSpinner = spinner();
          installSpinner.start('Installing artifacts...');

          try {
              for (const artifact of artifactsToInstall) {
                  const targetDir = getTargetPath(artifact.type, targetAgent, scope);
                  const finalDest = path.join(targetDir, artifact.name);
                  installArtifact(artifact.sourcePath, finalDest, method);
              }

              savePreferences({ defaultAgent: targetAgent, defaultScope: scope, installMethod: method });

              installSpinner.stop('Installation complete!');

              const names = artifactsToInstall.map(a => pc.green(a.name)).join(', ');
              outro(`✅ Installed: ${names} → ${targetAgent} (${scope})`);
          } catch (e: any) {
              installSpinner.stop('Installation failed.');
              console.error(pc.red(e.message));
              process.exit(1);
          }
      } else {
          outro('Installation cancelled.');
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
