# Design: Claude Code Support for AWM CLI

**Date:** 2026-03-06
**Status:** Approved

## Context

AWM currently supports two agent targets: Antigravity and OpenCode. Claude Code is a third AI coding assistant that uses a skills/agents filesystem convention highly compatible with AWM's existing registry format. This design adds Claude Code as a new `AgentTarget` while refactoring the provider layer from ad-hoc `if/else` branching to a declarative provider registry.

### Claude Code conventions (from official docs)

- **Skills**: directories with `SKILL.md` at `~/.claude/skills/<name>/` (personal) or `.claude/skills/<name>/` (project). Follow the Agent Skills standard — same format as AWM's registry.
- **Subagents**: markdown files with YAML frontmatter at `~/.claude/agents/<name>.md` (personal) or `.claude/agents/<name>.md` (project). Compatible with AWM's Agent Profiles.
- **Workflows**: no equivalent concept in Claude Code.

## Decisions

| Decision | Resolution |
|---|---|
| Artifact scope | Skills + Agents only (no workflows for Claude Code) |
| Workflows visibility | Hidden when Claude Code is the only selected target (same pattern as OpenCode) |
| Paths — Skills | Global: `~/.claude/skills/` · Local: `.claude/skills/` |
| Paths — Agents | Global: `~/.claude/agents/` · Local: `.claude/agents/` |
| Install method | Symlink and copy — same behavior as existing targets |
| Agent Profiles | Single file, copied as-is. Claude Code ignores unknown frontmatter fields (e.g., `mode: primary`). No transformation needed. |
| Architecture | Declarative `PROVIDERS` map replacing `if/else` in provider layer |
| CLI changes | Prompts, validations, and artifact filtering derived from `PROVIDERS` map — no hardcoded provider names |
| Testing | Existing tests preserved + 5 new Claude Code tests + 1 generic unknown-agent test |

## Architecture: Declarative Provider Registry

### Provider config type

```ts
type ArtifactConfig = {
  global: string;
  local: string;
};

type ProviderConfig = {
  label: string;
  skill: ArtifactConfig;
  workflow: ArtifactConfig | null;   // null = not supported
  agent: ArtifactConfig | null;      // null = not supported
};
```

### Provider map

```ts
const PROVIDERS: Record<AgentTarget, ProviderConfig> = {
  antigravity: {
    label: 'Antigravity',
    skill:    { global: '~/.gemini/antigravity/skills',           local: '.agent/skills' },
    workflow: { global: '~/.gemini/antigravity/global_workflows', local: '.agent/workflows' },
    agent:    null
  },
  opencode: {
    label: 'OpenCode',
    skill:    { global: '~/.agents/skills',            local: '.agents/skills' },
    workflow: null,
    agent:    { global: '~/.config/opencode/agents',   local: '.agents/profiles' }
  },
  'claude-code': {
    label: 'Claude Code',
    skill:    { global: '~/.claude/skills',   local: '.claude/skills' },
    workflow: null,
    agent:    { global: '~/.claude/agents',   local: '.claude/agents' }
  }
};
```

### Simplified getTargetPath

```ts
export function getTargetPath(type: ArtifactType, agent: AgentTarget, scope: Scope): string {
  const provider = PROVIDERS[agent];
  if (!provider) throw new Error(`Unknown agent target: ${agent}`);

  const config = provider[type];
  if (!config) throw new Error(`${type}s are not supported by ${provider.label}.`);

  return config[scope];
}
```

## CLI Changes

### Agent selection prompt

Generated from `PROVIDERS` instead of hardcoded options:

```ts
options: Object.entries(PROVIDERS).map(([key, config]) => ({
  value: key as AgentTarget,
  label: config.label
}))
```

Applies to: `add` command, `remove` command, `--agent` flag validation.

### Artifact filtering

Derived from the registry instead of hardcoded agent names:

```ts
const includeWorkflows = targetAgents.some(a => PROVIDERS[a].workflow !== null);
const includeAgents = targetAgents.some(a => PROVIDERS[a].agent !== null);
```

### Skip unsupported artifacts during installation

Generic check instead of per-agent conditions:

```ts
if (PROVIDERS[currentAgent][artifact.type] === null) {
  skipped.push(`${artifact.name} (${currentAgent})`);
  continue;
}
```

## Files to Modify

1. `cli/src/providers/index.ts` — refactor to declarative map + add `claude-code`
2. `cli/src/index.ts` — derive options and filtering from `PROVIDERS`
3. `cli/tests/providers/index.test.ts` — add Claude Code tests

## Files NOT Changed

- `cli/src/core/executor.ts` — symlink/copy works unchanged
- `cli/src/core/discovery.ts` — registry discovery unchanged
- `cli/src/core/registry.ts` — git sync unchanged
- `registry/` — artifacts need no modification

## Test Plan

### Existing tests (preserved, same assertions)

- `routes antigravity global skills correctly`
- `routes opencode local skills correctly`
- `routes antigravity global workflows correctly`
- `throws on opencode workflow`

### New tests

- `routes claude-code global skills correctly` → `~/.claude/skills`
- `routes claude-code local skills correctly` → `.claude/skills`
- `routes claude-code global agents correctly` → `~/.claude/agents`
- `routes claude-code local agents correctly` → `.claude/agents`
- `throws on claude-code workflow`
- `throws on unknown agent target`
