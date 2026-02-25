# AWM Remove Command Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the `awm remove` CLI command to support bulk removal of artifacts across multiple agents simultaneously using a unified select interface.

**Architecture:** The command will prompt the user to select one or more target agents. It will aggregate installed artifacts across all selected agents into a single list, displaying a unified multi-select or single prompt. When an artifact is selected, it will systematically remove it from all associated paths.

**Tech Stack:** TypeScript, Node.js (fs, path), Commander, Clack Prompts

---

### Task 1: Update CLI Remove Logic

**Files:**
- Modify: `/Users/cencosud/Developments/personal/agentic-workflow/cli/src/index.ts:360-430`

**Step 1: Write the failing test**

```typescript
// No automated tests exist for the CLI prompt interactions directly.
// We will rely on manual testing via npm run build and awm execution.
```

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: PASS (builds successfully but logic doesn't support multiselect agents)

**Step 3: Write minimal implementation**

Modify `cli/src/index.ts` starting at the `program.command('remove')` action:

```typescript
  .action(async () => {
      intro(pc.bgCyan(pc.black(' AWM - Remove Artifact ')));

      const prefs = getPreferences();

      // Change from single select to multiselect for target agents
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

      // Scan installed artifacts across all selected agents
      const fs = await import('fs');
      
      // Use a map to aggregate artifacts by name
      const artifactMap = new Map<string, {
          name: string;
          type: ArtifactType;
          installedIn: AgentTarget[];
          fullPaths: string[];
      }>();

      const scanDir = (dir: string, type: ArtifactType, currentAgent: AgentTarget) => {
          if (!fs.existsSync(dir)) return;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
              const existing = artifactMap.get(entry.name);
              if (existing) {
                  existing.installedIn.push(currentAgent);
                  existing.fullPaths.push(path.join(dir, entry.name));
              } else {
                  artifactMap.set(entry.name, {
                      name: entry.name,
                      type,
                      installedIn: [currentAgent],
                      fullPaths: [path.join(dir, entry.name)]
                  });
              }
          }
      };

      for (const targetAgent of targetAgents) {
          try { scanDir(getTargetPath('skill', targetAgent, scopeVal), 'skill', targetAgent); } catch {}
          try { scanDir(getTargetPath('workflow', targetAgent, scopeVal), 'workflow', targetAgent); } catch {}
      }

      const installed = Array.from(artifactMap.values());

      if (installed.length === 0) {
          outro(pc.yellow('No installed artifacts found for the selected agents/scope.'));
          process.exit(0);
      }

      const toRemove = await select({
          message: 'Select artifact to remove',
          options: installed.map(a => ({ 
              value: a, 
              label: `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name} ${pc.dim(`(in: ${a.installedIn.join(', ')})`)}` 
          }))
      });
      handleCancel(toRemove);

      const artifact = toRemove as typeof installed[0];

      const confirmRemove = await confirm({ message: `Remove ${pc.red(artifact.name)} from ${artifact.installedIn.join(' and ')}?` });
      handleCancel(confirmRemove);

      if (confirmRemove) {
          try {
              for (const p of artifact.fullPaths) {
                  removeArtifact(p);
              }
              outro(`✅ Removed ${pc.red(artifact.name)} from ${artifact.installedIn.join(', ')} (${scopeVal})`);
          } catch (e: any) {
              console.error(pc.red(e.message));
              process.exit(1);
          }
      } else {
          outro('Removal cancelled.');
      }
  });
```

**Step 4: Run test to verify it passes**

Run: `npm run build && node dist/index.js remove`
Expected: PASS (interactive prompts work, multiselect succeeds, deletion paths succeed)

**Step 5: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat(cli): refactor remove command to support bulk multi-agent deletion"
```
