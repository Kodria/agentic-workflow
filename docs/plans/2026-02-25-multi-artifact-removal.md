# Multi-Artifact Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modify the `awm remove` command to allow selecting and uninstalling multiple artifacts (skills/workflows) simultaneously across one or more agents.

**Architecture:** We will replace the single `select` prompt in `awm remove` with a `multiselect` prompt for both agents and artifacts. We will aggregate all installed artifacts across the selected agents/scopes into a single list, allowing the user to select multiple items to purge in one loop.

**Tech Stack:** TypeScript, Commander.js, `@clack/prompts`

---

### Task 1: Update `awm remove` command prompts

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Change agent selection to multiselect**

```typescript
      // From:
      const targetAgent = await select({
          message: 'From which agent?',
          options: [
              { value: 'antigravity', label: 'Antigravity' },
              { value: 'opencode', label: 'OpenCode' }
          ],
          initialValue: prefs.defaultAgent
      }) as AgentTarget;
      
      // To:
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
```

**Step 2: Aggregate artifacts across selected agents**

```typescript
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
```

**Step 3: Change artifact selection to multiselect**

```typescript
      // From:
      const toRemove = await select({ ... })
      const artifact = toRemove as typeof installed[0];
      
      // To:
      const toRemove = await multiselect({
          message: 'Select artifact(s) to remove',
          options: installed.map(a => ({
              value: a,
              label: `${a.type === 'skill' ? '🧠' : '⚡'} ${a.name} (in: ${a.installedIn.join(', ')})`
          })),
          required: true
      });
      handleCancel(toRemove);
      const artifacts = toRemove as typeof installed;
```

**Step 4: Confirm and remove in loop**

```typescript
      const names = artifacts.map(a => a.name).join(', ');
      const confirmRemove = await confirm({ message: `Remove ${pc.red(names)}?` });
      handleCancel(confirmRemove);

      if (confirmRemove) {
          try {
              for (const artifact of artifacts) {
                  for (const p of artifact.fullPaths) {
                      removeArtifact(p);
                  }
              }
              outro(`✅ Removed ${pc.red(names)} (${scopeVal})`);
          } catch (e: any) {
              console.error(pc.red(e.message));
              process.exit(1);
          }
      }
```

**Step 5: Test locally and compile**

Run: `npm run build` inside `cli/`
Run: `awm remove` to verify the multi-selection logic.

**Step 6: Commit**

```bash
git add cli/src/index.ts docs/plans/2026-02-25-multi-artifact-removal.md
git commit -m "feat(cli): refactor remove command to support bulk multi-agent deletion"
```
