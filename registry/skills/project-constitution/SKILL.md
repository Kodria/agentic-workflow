---
name: project-constitution
description: Use when a repository needs to formalize its non-negotiable rules so Claude Code receives them as feedforward in every session. Generates CONSTITUTION.md at the repo root from project context (CLAUDE.md, AGENTS.md, README, sensors manifest). The AWM SessionStart hook injects this file into additionalContext automatically.
---

# Project Constitution

## Overview

`CONSTITUTION.md` is the project's non-negotiable rulebook: testing discipline, architecture invariants, sensor obligations, code style, process. It lives at the repo root. The AWM SessionStart hook reads `$PWD/CONSTITUTION.md` and appends its content to `additionalContext` on every Claude Code session — so the agent sees these rules from the first token.

**Announce at start:** "I'm using the project-constitution skill to generate CONSTITUTION.md."

## When to use

- Repo has no `CONSTITUTION.md` and the team wants to codify rules
- After `awm sensors init` — sensors are configured but their rules aren't enforced doctrinally yet
- Existing rules are scattered across CLAUDE.md, README, code review comments — needs consolidation
- Onboarding new contributors and want every Claude Code session to start with the same rules

## When NOT to use

- The repo has no clear rules to enforce yet — come back after the first code review pass or after `awm sensors init`
- The user wants a description of the project (purpose, structure, commands) — use `AGENTS.md` / `CLAUDE.md` for that. `CONSTITUTION.md` is for rules, not description.

## Checklist

Create a task for each item and complete them in order:

1. **Gather project context** — read CLAUDE.md, AGENTS.md, README.md, package.json/pyproject.toml, .awm/sensors.json
2. **Detect existing CONSTITUTION.md** — if present, treat as an update (preserve existing rules)
3. **Draft sections** — Testing, Architecture, Sensors, Code Style, Process — skip any that have nothing to say
4. **Present sections to user one at a time** — get explicit approval before moving to the next
5. **Write CONSTITUTION.md** to repo root
6. **Verify hook installation** — run `awm hooks status`; tell user to run `awm hooks install` if not HEALTHY
7. **Commit** the new file

## The Process

### 1. Gather project context

Run these reads in parallel where possible:

- `Read CLAUDE.md` and `Read AGENTS.md` — capture existing instructions and conventions
- `Read README.md` — capture stated project goals
- `Read package.json` or `Read pyproject.toml` — detect stack, scripts, lint/test commands
- `Read .awm/sensors.json` — capture which sensors are configured (typecheck, lint, security, etc.)
- `Glob CONSTITUTION.md` — confirm whether one already exists at the root

If `CONSTITUTION.md` exists: read it and treat this session as an update. Preserve every existing rule unless the user explicitly asks to remove or change it.

### 2. Section structure

The CONSTITUTION.md should contain only the sections that apply. Skip any section that has nothing meaningful to say — bloat dilutes the signal. The skeleton:

```markdown
# Project Constitution

> Non-negotiable rules for this repo. The AWM SessionStart hook injects this file into every Claude Code session as `additionalContext`. Rules here override agent defaults.

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

```bash
# Write CONSTITUTION.md to the repo root (use the Write tool)
```

Then verify the hook will pick it up:

```bash
awm hooks status
```

If status is not `HEALTHY`, tell the user to run `awm hooks install` so the SessionStart hook is registered in `~/.claude/settings.json`. The hook reads `$PWD/CONSTITUTION.md` automatically — no further configuration needed.

### 6. Commit

```bash
git add CONSTITUTION.md
git commit -m "docs: add project constitution"
```

### 7. Verification

Tell the user: the next Claude Code session in this repo will receive `CONSTITUTION.md` as part of `additionalContext` from the SessionStart hook. To verify, they can `/clear` the conversation and confirm that the agent acknowledges or applies the rules.

## Anti-patterns

- **Generating without user approval per section.** This file ships into every session — silent drift damages agent behavior. Always approve section by section.
- **Copying AGENTS.md verbatim into CONSTITUTION.md.** AGENTS.md describes the repo (purpose, structure, commands). CONSTITUTION.md states the rules. Different purposes, different files.
- **Aspirational rules ("we should write more tests").** Constitution rules are enforceable claims, not goals.
- **Forgetting to verify hook installation.** A CONSTITUTION.md with no hook is just a file. The whole point is automatic injection.
- **Adding the constitution itself as a rule** (e.g., "always update CONSTITUTION.md when X happens"). The constitution doesn't talk about itself.
