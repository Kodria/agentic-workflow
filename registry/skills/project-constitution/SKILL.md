---
name: project-constitution
version: "1.0.0"
description: Use when a repository needs to formalize its non-negotiable rules so every agent session receives them as feedforward context. Generates CONSTITUTION.md at the repo root from project context (CLAUDE.md, AGENTS.md, README, sensors manifest). AWM delivers this file automatically to every agent session — via the SessionStart hook (Claude Code) or via project-local config instructions (OpenCode).
---

# Project Constitution

## Overview

`CONSTITUTION.md` is the project's non-negotiable rulebook: testing discipline, architecture invariants, sensor obligations, code style, process. It lives at the repo root. AWM delivers it to the agent on every session — via the SessionStart hook (Claude Code) or the project-local config `instructions` (agents like OpenCode) — so the agent sees these rules from the first token.

**Announce at start:** "I'm using the project-constitution skill to generate CONSTITUTION.md."

## When to use

- Repo has no `CONSTITUTION.md` and the team wants to codify rules
- After `awm sensors init` — sensors are configured but their rules aren't enforced doctrinally yet
- Existing rules are scattered across CLAUDE.md, README, code review comments — needs consolidation
- Onboarding new contributors and want every agent session to start with the same rules

## When NOT to use

- The repo has no clear rules to enforce yet — come back after the first code review pass or after `awm sensors init`
- The user wants a description of the project (purpose, structure, commands) — use `AGENTS.md` / `CLAUDE.md` for that. `CONSTITUTION.md` is for rules, not description.

## Checklist

You MUST create a task for each item and complete them in order:

1. **Gather project context** — read CLAUDE.md, AGENTS.md, README.md, package.json/pyproject.toml, .awm/sensors.json
2. **Detect existing CONSTITUTION.md** — if present, treat as an update (preserve existing rules, surface conflicts)
3. **Draft sections** — work through Section structure and Drafting rules to produce section drafts
4. **Present sections to user one at a time** — get explicit approval before moving to the next
5. **Write CONSTITUTION.md** to repo root using the Write tool
6. **Verify AWM delivery** — for Claude Code: run `awm hooks status`; tell user to run `awm hooks install` if not HEALTHY. For OpenCode: confirm `opencode.json` in the project root contains `"CONSTITUTION.md"` in the `instructions` array (added automatically by `awm init --agent opencode`).
7. **Commit** the new file
8. **Tell the user** how to verify delivery worked: start a new session and confirm the agent acknowledges or applies the rules. On Claude Code, `/clear` forces a fresh context load and the rules should appear in `additionalContext`. On OpenCode, the project-local `opencode.json` `instructions` entry ensures the file loads each session.

## The Process

### 1. Gather project context

Run these reads in parallel where possible:

- `Read CLAUDE.md` and `Read AGENTS.md` — capture existing instructions and conventions
- `Read README.md` — capture stated project goals
- `Read package.json` or `Read pyproject.toml` — detect stack, scripts, lint/test commands
- `Read .awm/sensors.json` — capture which sensors are configured (typecheck, lint, security, etc.)
- `Glob CONSTITUTION.md` — confirm whether one already exists at the root

If `CONSTITUTION.md` exists: read it and treat this session as an update.
- Diff gathered context against existing rules: identify rules that are still valid, rules that are now outdated, and new rules to add from the gathered context.
- Surface any contradictions to the user before presenting sections (e.g., "The README says X but your current constitution says Y — which should we follow?").
- Preserve every existing rule unless the user explicitly asks to remove or change it.

### 2. Section structure

The CONSTITUTION.md should contain only the sections that apply. Skip any section that has nothing meaningful to say — bloat dilutes the signal. The skeleton:

```markdown
# Project Constitution

> Non-negotiable rules for this repo. AWM delivers this file into every agent session as feedforward context. Rules here override agent defaults.

## Testing
- (TDD requirements, coverage thresholds, what must have a test, what tests must be human-written)

## Architecture
- (module boundaries, dependency rules, layer constraints, what must live where)

## Sensors
- (which sensors MUST pass before declaring done; which are advisory; mapping to .awm/sensors.json)

## Code Style
- (strict mode requirements, lint rules that cannot be disabled, formatter, naming)

## Process
- (commit message conventions, PR/review requirements, what triggers brainstorming, when to invoke harness-retro)
```

### 3. Drafting rules

- **Be specific, not aspirational.** "All tests use TDD" → "Write the failing test before implementation. Commit the failing test before the fix."
- **Tie each rule to a sensor or review when possible.** Rules without an enforcement mechanism decay. Reference `.awm/sensors.json` entries by name.
- **Mark mandatory vs advisory** with MUST / SHOULD / MAY (RFC 2119 style).
- **Keep it under 200 lines.** If it grows, split: `CONSTITUTION.md` for non-negotiables, `CONVENTIONS.md` for advisory.
- **No self-reference.** The constitution does not document how to generate the constitution.
- **Use the existing repo's vocabulary** — if the repo says "package," don't say "module."

### 4. Section-by-section approval

Present ONE section at a time. Example for the Testing section:

> Here's the Testing section draft:
> ```
> ## Testing
> - TDD MUST be followed: failing test committed before implementation.
> - All new code in src/ MUST have a corresponding test in tests/.
> - Mutation tests (`npx stryker run`) MAY be run locally but are not gating in CI.
> ```
> Approve, or tell me what to change.

Wait for explicit approval before drafting the next section. Do not batch.

### 5. Writing the file

After all sections approved:

Use the Write tool to create `CONSTITUTION.md` at the repo root with all approved sections concatenated in order.

Then verify the hook will pick it up:

```bash
awm hooks status
```

If status is not `HEALTHY`, tell the user to run `awm hooks install` so the SessionStart hook is registered for their agent. The hook reads `$PWD/CONSTITUTION.md` automatically — no further configuration needed.

### 6. Commit

```bash
git add CONSTITUTION.md
git commit -m "docs: add project constitution"
```

### 7. Verification

Tell the user: the next agent session in this repo will receive `CONSTITUTION.md` as context — via the SessionStart hook (Claude Code) or via `opencode.json` `instructions` (OpenCode). To verify, start a new session and confirm the agent acknowledges or applies the rules. On Claude Code, `/clear` forces a fresh context load.

## Anti-patterns

- **Generating without user approval per section.** This file ships into every session — silent drift damages agent behavior. Always approve section by section.
- **Copying AGENTS.md verbatim into CONSTITUTION.md.** AGENTS.md describes the repo (purpose, structure, commands). CONSTITUTION.md states the rules. Different purposes, different files.
- **Aspirational rules ("we should write more tests").** Constitution rules are enforceable claims, not goals.
- **Forgetting to verify AWM delivery.** A CONSTITUTION.md without the delivery mechanism set up is just a file. Run `awm hooks install` (Claude Code) or ensure `awm init --agent opencode` was run (OpenCode).
- **Adding the constitution itself as a rule** (e.g., "always update CONSTITUTION.md when X happens"). The constitution doesn't talk about itself.
