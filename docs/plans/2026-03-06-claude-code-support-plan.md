# Claude Code Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude Code as a third AgentTarget in the AWM CLI, refactoring the provider layer from ad-hoc if/else to a declarative PROVIDERS map.

**Architecture:** Replace the `getTargetPath()` if/else branching with a `PROVIDERS` record that maps each agent target to its supported artifact types and filesystem paths. The CLI derives all prompts, validations, and filtering from this map. Claude Code supports skills (`~/.claude/skills/`) and agents (`~/.claude/agents/`) but not workflows.

**Tech Stack:** TypeScript, Commander.js, @clack/prompts, Jest with ts-jest

**Design doc:** `docs/plans/2026-03-06-claude-code-support-design.md`

---

### Task 1: Refactor providers to declarative PROVIDERS map

**Files:**
- Modify: `cli/src/providers/index.ts` (full rewrite, 31 lines)

**Step 1: Write the failing tests for the new provider structure**

Add new tests and verify existing ones still reference the same import. Edit `cli/tests/providers/index.test.ts` to replace the entire file with:

```ts
// tests/providers/index.test.ts
import { getTargetPath, PROVIDERS } from '../../src/providers';
import os from 'os';

describe('Providers Routing', () => {
    // ── Existing Antigravity tests (preserved) ──
    it('routes antigravity global skills correctly', () => {
        const result = getTargetPath('skill', 'antigravity', 'global');
        expect(result).toBe(`${os.homedir()}/.gemini/antigravity/skills`);
    });

    it('routes opencode local skills correctly', () => {
        const result = getTargetPath('skill', 'opencode', 'local');
        expect(result).toBe('.agents/skills');
    });

    it('routes antigravity global workflows correctly', () => {
        const result = getTargetPath('workflow', 'antigravity', 'global');
        expect(result).toBe(`${os.homedir()}/.gemini/antigravity/global_workflows`);
    });

    it('throws on opencode workflow', () => {
        expect(() => getTargetPath('workflow', 'opencode', 'global')).toThrow('not supported');
    });

    // ── New Claude Code tests ──
    it('routes claude-code global skills correctly', () => {
        const result = getTargetPath('skill', 'claude-code', 'global');
        expect(result).toBe(`${os.homedir()}/.claude/skills`);
    });

    it('routes claude-code local skills correctly', () => {
        const result = getTargetPath('skill', 'claude-code', 'local');
        expect(result).toBe('.claude/skills');
    });

    it('routes claude-code global agents correctly', () => {
        const result = getTargetPath('agent', 'claude-code', 'global');
        expect(result).toBe(`${os.homedir()}/.claude/agents`);
    });

    it('routes claude-code local agents correctly', () => {
        const result = getTargetPath('agent', 'claude-code', 'local');
        expect(result).toBe('.claude/agents');
    });

    it('throws on claude-code workflow', () => {
        expect(() => getTargetPath('workflow', 'claude-code', 'global')).toThrow('not supported');
    });

    it('throws on unknown agent target', () => {
        expect(() => getTargetPath('skill', 'unknown-agent' as any, 'global')).toThrow('Unknown agent target');
    });

    // ── PROVIDERS map structure tests ──
    it('exports PROVIDERS with all three targets', () => {
        expect(Object.keys(PROVIDERS)).toEqual(
            expect.arrayContaining(['antigravity', 'opencode', 'claude-code'])
        );
    });

    it('marks unsupported artifact types as null', () => {
        expect(PROVIDERS['antigravity'].agent).toBeNull();
        expect(PROVIDERS['opencode'].workflow).toBeNull();
        expect(PROVIDERS['claude-code'].workflow).toBeNull();
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=providers 2>&1`
Working directory: `cli/`
Expected: FAIL — `PROVIDERS` is not exported, Claude Code tests fail because `'claude-code'` is not in the `AgentTarget` type.

**Step 3: Implement the declarative PROVIDERS map**

Replace `cli/src/providers/index.ts` entirely with:

```ts
// src/providers/index.ts
import os from 'os';
import path from 'path';

export type AgentTarget = 'antigravity' | 'opencode' | 'claude-code';
export type Scope = 'global' | 'local';
export type ArtifactType = 'skill' | 'workflow' | 'agent';

type ArtifactConfig = {
    global: string;
    local: string;
};

export type ProviderConfig = {
    label: string;
    skill: ArtifactConfig;
    workflow: ArtifactConfig | null;
    agent: ArtifactConfig | null;
};

const homedir = os.homedir();

export const PROVIDERS: Record<AgentTarget, ProviderConfig> = {
    antigravity: {
        label: 'Antigravity',
        skill:    { global: path.join(homedir, '.gemini/antigravity/skills'),           local: '.agent/skills' },
        workflow: { global: path.join(homedir, '.gemini/antigravity/global_workflows'), local: '.agent/workflows' },
        agent:    null
    },
    opencode: {
        label: 'OpenCode',
        skill:    { global: path.join(homedir, '.agents/skills'),          local: '.agents/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.config/opencode/agents'), local: '.agents/profiles' }
    },
    'claude-code': {
        label: 'Claude Code',
        skill:    { global: path.join(homedir, '.claude/skills'),  local: '.claude/skills' },
        workflow: null,
        agent:    { global: path.join(homedir, '.claude/agents'),  local: '.claude/agents' }
    }
};

export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
    const provider = PROVIDERS[agent];
    if (!provider) throw new Error(`Unknown agent target: ${agent}`);

    const config = provider[type];
    if (!config) throw new Error(`${type}s are not supported by ${provider.label}.`);

    return config[scope];
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=providers 2>&1`
Working directory: `cli/`
Expected: ALL PASS (12 tests)

**Step 5: Commit**

```bash
git add cli/src/providers/index.ts cli/tests/providers/index.test.ts
git commit -m "feat: refactor providers to declarative PROVIDERS map and add claude-code target"
```

---

### Task 2: Update CLI `add` command to derive from PROVIDERS

**Files:**
- Modify: `cli/src/index.ts:6` (update import)
- Modify: `cli/src/index.ts:111` (update `--agent` option description)
- Modify: `cli/src/index.ts:145-166` (agent validation + prompt)
- Modify: `cli/src/index.ts:189-195` (artifact filtering)
- Modify: `cli/src/index.ts:268-278` (skip logic during install)

**Step 1: Update the import to include PROVIDERS**

In `cli/src/index.ts` line 6, change:
```ts
import { getTargetPath, AgentTarget, Scope, ArtifactType } from './providers';
```
to:
```ts
import { getTargetPath, AgentTarget, Scope, ArtifactType, PROVIDERS } from './providers';
```

**Step 2: Update `--agent` flag description**

In `cli/src/index.ts` line 111, change:
```ts
  .option('-a, --agent <agent>', 'Target agent: antigravity or opencode')
```
to:
```ts
  .option('-a, --agent <agent>', `Target agent: ${Object.keys(PROVIDERS).join(', ')}`)
```

**Step 3: Update agent validation for `--agent` flag**

In `cli/src/index.ts` lines 146-153, replace:
```ts
      if (options.agent) {
          const parsed = options.agent.split(',').map(a => a.trim());
          for (const a of parsed) {
              if (!['antigravity', 'opencode'].includes(a)) {
                  console.error(pc.red(`Invalid agent "${a}". Use: antigravity or opencode.`));
                  process.exit(1);
              }
          }
          targetAgents = parsed as AgentTarget[];
```
with:
```ts
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
```

**Step 4: Update interactive agent selection prompt**

In `cli/src/index.ts` lines 155-163, replace:
```ts
          const agentChoice = await multiselect({
              message: 'Which agent(s) do you want to install to?',
              options: [
                  { value: 'antigravity' as AgentTarget, label: 'Antigravity' },
                  { value: 'opencode' as AgentTarget, label: 'OpenCode' }
              ],
              initialValues: [prefs.defaultAgent],
              required: true
          });
```
with:
```ts
          const agentChoice = await multiselect({
              message: 'Which agent(s) do you want to install to?',
              options: Object.entries(PROVIDERS).map(([key, config]) => ({
                  value: key as AgentTarget,
                  label: config.label
              })),
              initialValues: [prefs.defaultAgent],
              required: true
          });
```

**Step 5: Update artifact filtering logic**

In `cli/src/index.ts` lines 189-190, replace:
```ts
      const includeWorkflows = targetAgents.includes('antigravity');
      const includeAgents = targetAgents.includes('opencode');
```
with:
```ts
      const includeWorkflows = targetAgents.some(a => PROVIDERS[a].workflow !== null);
      const includeAgents = targetAgents.some(a => PROVIDERS[a].agent !== null);
```

**Step 6: Update skip logic during installation**

In `cli/src/index.ts` lines 269-278, replace:
```ts
                  // Skip workflows for non-Antigravity agents
                  if (currentAgent !== 'antigravity' && artifact.type === 'workflow') {
                      skipped.push(`${artifact.name} (${currentAgent})`);
                      continue;
                  }
                  // Skip agents for non-OpenCode agents
                  if (currentAgent !== 'opencode' && artifact.type === 'agent') {
                      skipped.push(`${artifact.name} (${currentAgent})`);
                      continue;
                  }
```
with:
```ts
                  // Skip artifacts not supported by this agent
                  if (PROVIDERS[currentAgent][artifact.type] === null) {
                      skipped.push(`${artifact.name} (${currentAgent})`);
                      continue;
                  }
```

**Step 7: Verify build compiles**

Run: `npm run build 2>&1`
Working directory: `cli/`
Expected: No TypeScript errors

**Step 8: Run all tests**

Run: `npm test 2>&1`
Working directory: `cli/`
Expected: ALL PASS

**Step 9: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat: derive add command options and filtering from PROVIDERS map"
```

---

### Task 3: Update CLI `remove` command to derive from PROVIDERS

**Files:**
- Modify: `cli/src/index.ts:423-431` (agent selection prompt in remove)

**Step 1: Update interactive agent selection in remove command**

In `cli/src/index.ts` lines 423-431, replace:
```ts
      const agentChoice = await multiselect({
          message: 'From which agent(s)?',
          options: [
              { value: 'antigravity' as AgentTarget, label: 'Antigravity' },
              { value: 'opencode' as AgentTarget, label: 'OpenCode' }
          ],
          initialValues: [prefs.defaultAgent],
          required: true
      });
```
with:
```ts
      const agentChoice = await multiselect({
          message: 'From which agent(s)?',
          options: Object.entries(PROVIDERS).map(([key, config]) => ({
              value: key as AgentTarget,
              label: config.label
          })),
          initialValues: [prefs.defaultAgent],
          required: true
      });
```

**Step 2: Verify build compiles**

Run: `npm run build 2>&1`
Working directory: `cli/`
Expected: No TypeScript errors

**Step 3: Run all tests**

Run: `npm test 2>&1`
Working directory: `cli/`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add cli/src/index.ts
git commit -m "feat: derive remove command agent options from PROVIDERS map"
```

---

### Task 4: Final verification

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `npm test 2>&1`
Working directory: `cli/`
Expected: ALL PASS

**Step 2: Build the project**

Run: `npm run build 2>&1`
Working directory: `cli/`
Expected: Clean build, no errors

**Step 3: Verify no hardcoded agent names remain in CLI**

Search `cli/src/index.ts` for any remaining hardcoded references to `'antigravity'`, `'opencode'`, or `'claude-code'` outside of type definitions. There should be none — all references should go through `PROVIDERS`.

Note: `cli/src/providers/index.ts` will still have agent names in the `PROVIDERS` map and `AgentTarget` type — that's expected and correct (single source of truth).
