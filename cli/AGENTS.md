<!-- AWM:START -->
<!-- AWM:BOUNDARY prefix=0 suffix=1 -->
<!-- AWM context (generated) -->
# AWM

Active extensions: none

---
name: using-awm
version: "1.2.2"
description: Use when starting any development conversation - establishes tiered skill invocation policy (spine skills always, specialized skills on clear signal)
---

<SUBAGENT-POLICY>
If you were dispatched as a subagent to execute a specific task: skip the orchestration
and product-layer skills (development-process, product-process, brainstorming,
writing-plans, executing-plans, subagent-driven-development, finishing-a-development-branch,
product-discovery, product-brief, architecture-assessment, architecture-extraction,
readiness-gate) — your controller owns orchestration, and these are heavy interactive/creative
skills whose own trigger phrases could otherwise fire mid-task the same way brainstorming's
could. But DO invoke:
1. Every skill your prompt declares as required.
2. The craft/verification skills your task triggers on its own signal — this list is
   illustrative, not exhaustive: frontend-craft for UI surfaces, test-driven-development
   for implementation, verification-before-completion before reporting done,
   systematic-debugging on bugs, and any other skill your task's own signal calls for
   (e.g. `design-fidelity` when verifying implemented UI against its design,
   `ui-ux-pro-max` when a design-system/style decision needs it directly).
</SUBAGENT-POLICY>

## Instruction Priority

AWM skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, AGENTS.md, direct requests) — highest priority
2. **AWM skills** — override default system behavior where they conflict
3. **Default system prompt** — lowest priority

If CLAUDE.md or AGENTS.md says "don't use TDD" and a skill says "always use TDD," follow the user's instructions. The user is in control.

## How to Access Skills

Use the active platform’s native skill-loading mechanism. The mechanism may be
a dedicated skill loader or the ability to read a visible `SKILL.md`; load or
read it when its trigger applies, then follow the instructions it provides
directly. Do not assume a particular provider's tool name: the active runtime
owns skill discovery and loading.

## Native Runtime Contract

Runtime instructions describe capabilities, not vendor APIs. Use the active
platform's native mechanisms to:

- create or update a task plan when the active skill requires tracked work;
- dispatch, steer, wait for, or stop a subagent only when the session exposes
  delegation support; and
- request user approval before an action that needs authority beyond the
  current task;
- inspect files, read files, or edit files through the active platform's native
  filesystem capability; and
- run shell commands through its native command-execution capability.

If a capability is unavailable in the session, state the limitation and
continue only with a safe, in-scope single-agent alternative. Do not invent a
provider-specific configuration or tool as a workaround.

# Using Skills

## The rule (by tier)

Not every skill competes equally for your attention. Apply two tiers:

**Spine and gates — always consider them.** The process and quality skills
(`development-process`, `product-process`, `brainstorming`, `writing-plans`, `executing-plans`,
`subagent-driven-development`, `test-driven-development`,
`requesting-code-review`, `receiving-code-review`, `post-implementation-qa`,
`finishing-a-development-branch`, `verification-before-completion`,
`systematic-debugging`) form development discipline: evaluate them on all
development work. Your default entry point is one of `development-process`
or `product-process` — see the Orchestration section below for which.

**Specialized — only on clear signal.** The remaining skills (architecture/NFR
advisory, frontend — `frontend-craft`, `design-fidelity`, `ui-ux-pro-max` — documentation,
etc.) are invoked **only when the context explicitly calls for them** (you are discussing
architecture, working on a UI screen, verifying a UI against its
design, documenting a module...). Do not invoke them "just in case": waiting for the
signal avoids noise and unnecessary overhead.

## Orchestration

AWM has two sibling orchestrators with an explicit boundary. Route by what the session starts with:

| The session starts with… | Orchestrator |
|---|---|
| An idea/need WITHOUT a formed requirement ("I have an idea", "let's explore a new module"), an architecture evaluation or extraction request, or an existing brief to resume | `product-process` |
| A concrete requirement over code (defined feature, bug, refactor), or a certified-`ready` brief handed off to build | `development-process` |
| Ambiguous | ASK: "mature the idea (product layer) or build now (development)?" — never guess |

Precedence rule: `brainstorming` explores SOLUTION space and is invoked via `development-process` — never as the entry point for a raw business idea. `product-discovery` explores PROBLEM space.

Architecture disambiguation: a request for a full, standalone architecture evaluation that produces a portable, re-ingestible report ("assess this architecture", "diagnose whether this holds up") goes to `product-process` → `architecture-assessment`. A one-off advisory opinion mid-conversation with no report artifact ("what pattern fits here", "does this design make sense") stays with `architecture-advisor` directly (Specialized tier) — `architecture-assessment` itself invokes `architecture-advisor` in Contextual Mode for exactly this kind of targeted opinion, so the two are complementary, not competing entry points.

Anti-loss rules: one orchestrator active at a time; the brief is the baton between them (context crosses only inside the artifact); returning from development to product happens explicitly through `product-process`, never by improvising business answers mid-development.

For documentation tasks, the equivalent entry point is `docs-system-orchestrator`.

## Red Flags

These thoughts mean STOP — you're rationalizing:

- "I know what to do, I don't need the skill" → **LOAD AND FOLLOW IT**
- "It's a simple request, the skill is overkill" → **LOAD AND FOLLOW IT**
- "I'll just answer first, then check if a skill applies" → **LOAD AND FOLLOW IT FIRST**
- "The skill description doesn't exactly match" → **LOAD AND FOLLOW IT if the spine/gates are relevant**
- "The user just asked a question, no skill needed" → **CHECK FIRST, THEN LOAD AND FOLLOW relevant spine skills**

The skill decides if it applies, not you.

## Announcing Skill Use

When you load a skill, announce it briefly: *"I'm using the {skill-name} skill to {purpose}."* This makes the process visible to the user and confirms to yourself that you're following the discipline.

## Checklist-Driven Skills

If a skill provides a checklist, create or update a task plan with an item for
each step and complete them in order. Skills are designed to be followed
exactly — do not skip steps or reorder them.

## Robustness invariants (agnostic, AWM)

Generic rules that AWM inherits to every agent via injected context. Not specific to any project:

- **Every public function validates its inputs and fails loudly.** Never silently return `Infinity`/`NaN`/`undefined` on invalid or edge inputs: throw an explicit error.
- **Scope may exclude *features*, never *security/robustness*.** A design declaring something "out of scope" justifies omitting a feature, not omitting input validation or a robustness invariant. Input validation is a floor, not a feature.


Read and obey `CONSTITUTION.md` before work when that file exists.
Use `.awm/profile.json` to declare project extensions, then run `awm sync`.
Run the verification commands declared by the project before completion.
<!-- AWM:END -->
