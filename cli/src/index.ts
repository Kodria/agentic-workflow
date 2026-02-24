#!/usr/bin/env node

import { intro, outro, spinner, select, confirm } from '@clack/prompts';
import { Command } from 'commander';
import { getPreferences, savePreferences } from './utils/config';
import { getTargetPath, AgentTarget, Scope } from './providers';
import { installArtifact } from './core/executor';
import path from 'path';

const program = new Command();
program.name('awm').description('Agentic Workflow Manager').version('1.0.0');

program.command('add')
  .description('Add a skill or process interactively')
  .action(async () => {
      intro('AWM - Agentic Workflow Manager');
      
      const prefs = getPreferences();

      // Dummy source resolution for now (mocking the GitHub registry pull)
      const mockRegistrySkillPath = path.resolve(__dirname, '../../skills/example-skill');

      const targetAgent = await select({
          message: 'Which agent do you want to install to?',
          options: [
              { value: 'antigravity', label: 'Antigravity' },
              { value: 'opencode', label: 'OpenCode' }
          ],
          initialValue: prefs.defaultAgent
      }) as AgentTarget;

      const scope = await select({
          message: 'Installation scope',
          options: [
              { value: 'local', label: 'Project (Local)' },
              { value: 'global', label: 'Global' }
          ],
          initialValue: prefs.defaultScope
      }) as Scope;

      const method = await select({
          message: 'Installation method',
          options: [
              { value: 'symlink', label: 'Symlink (Recommended) - Updates instantly' },
              { value: 'copy', label: 'Copy to agent' }
          ],
          initialValue: prefs.installMethod
      }) as 'symlink' | 'copy';

      const shouldProceed = await confirm({ message: 'Proceed with installation?' });

      if (shouldProceed) {
          const s = spinner();
          s.start('Installing...');
          
          try {
              const targetPath = getTargetPath('skill', targetAgent, scope);
              const finalDest = path.join(targetPath, 'example-skill');
              
              // Only runs if source exists, skipping actual install in this template
              // installArtifact(mockRegistrySkillPath, finalDest, method);
              
              // Save preferences
              savePreferences({ defaultAgent: targetAgent, defaultScope: scope, installMethod: method });

              s.stop('Installation complete!');
              outro(`Success! Registered to ${targetAgent} (${scope})`);
          } catch (e: any) {
              s.stop('Installation failed.');
              console.error(e.message);
              process.exit(1);
          }
      } else {
          outro('Installation cancelled.');
      }
});

program.parse();
