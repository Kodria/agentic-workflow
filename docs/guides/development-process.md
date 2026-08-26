# Running the development process

The engine that takes a concrete requirement — a feature, a bug, a refactor — to merged, verified code.

This is the process the `development-process` skill orchestrates. You don't have to memorise it: in a hooks-native agent you say what you want and the orchestrator routes you. This page is so you know what *should* be happening, can tell when it isn't, and can drive it manually in an agent that doesn't enforce.

## When this is the right entry point

| You have | Go to |
|---|---|
| A concrete requirement over code (defined feature, bug, refactor) | **development-process** — this page |
| A certified-ready brief handed over to build | **development-process** — this page |
| An idea without a formed requirement | [product-process](product-process.md) first |
| Ambiguous | Ask. Don't guess — the orchestrator is instructed to ask too. |

---

## The phases

```
brainstorming ──► [ui-design] ──► writing-plans ──► execution ──► post-implementation-qa ──► post-implementation-docs ──► harness-retro ──► finishing
   design doc      screens         plan file       code+tests       findings closed              docs verified            lessons cured      merge/PR
```

| # | Phase | Skill | Produces |
|---|---|---|---|
| 1 | Design | `brainstorming` | A design doc — explores the solution space *before* code |
| 1.5 | UI design *(only if the design declares screens)* | `ui-design` | Screen artifacts under `.stitch/designs/` |
| 2 | Planning | `writing-plans` | `docs/plans/YYYY-MM-DD-<topic>-plan.md` with numbered, checkable tasks |
| 3 | Execution | `subagent-driven-development` (same session) or `executing-plans` (separate session) | Code committed per task, each reviewed |
| 4 | QA | `post-implementation-qa` | Track A + Track B findings, all closed |
| 4.2 | Docs | `post-implementation-docs` | User-facing documentation updated and verified against the real running binary; marker `awm-docs-complete` added to plan |
| 4.5 | Retro | `harness-retro` | Recurring lessons cured into rules; ledger archived |
| 5 | Completion | `finishing-a-development-branch` | Merge, PR, or clean branch handoff |

**State lives in files, not in the conversation.** The orchestrator decides the next phase by looking at what exists on disk: is there a design doc? a plan? are its tasks checked? does the plan carry `<!-- awm-qa-complete -->`? `<!-- awm-docs-complete -->`? `<!-- awm-retro-complete -->`? That's what makes the process survive a lost session, a compaction, or a different machine — you can hand the repo to someone else mid-flight and the state is legible.

---

## Phase by phase, in practice

### 1 · Design — `brainstorming`

Explores **what to build and why** before any code. Output is a design doc in `docs/plans/`.

Skipping this is the most common and most expensive mistake: without it, "planning" turns into writing down whatever the first idea was.

### 2 · Planning — `writing-plans`

Turns the design into an implementation plan: discrete tasks with checkboxes and, ideally, **requirement IDs** (`R1`, `R2.3`). Those IDs are what QA later measures fidelity against — without them, QA has to read prose and say so.

The plan also declares its **execution mode**:

```markdown
**Modo de ejecución:** desatendido
```

The literal plan values `interactivo` (the default) and `desatendido` respectively pause for
confirmation between phases or run the whole process without check-ins. The gates still run
identically; unattended mode only removes the pauses. Use it for long autonomous runs and use
interactive mode when you want to steer.

### 3 · Execution

Two shapes:

- **`subagent-driven-development`** — same session, one fresh subagent per task, then a two-stage review (spec compliance, then code quality). Faster; no context switch.
- **`executing-plans`** — separate session, batched with review checkpoints. Better when you want a human in the loop per batch.

Either way, per task: **test first** (`test-driven-development`), implement, sensors must pass, reviewers must approve, and only then is the task marked complete.

### 4 · QA — `post-implementation-qa`

Two tracks that answer different questions:

- **Track A — fidelity.** "The plan promised R2.3. Is R2.3 built *and* tested?" Also catches the reverse: code with no requirement behind it (scope creep).
- **Track B — quality.** Plan-agnostic. A panel of independent lenses (robustness/security, logic, tests) each looking with a different criterion. A crash on empty input is a defect **even if the design said it was out of scope** — scope excludes features, never the robustness floor.

Track B is a panel rather than one bigger pass on purpose: one critic has one blind spot, and copies of it share that blind spot. Different criteria catch different things.

### 4.2 · Docs — `post-implementation-docs`

Runs after QA closes and before the retro. Updates the user-facing documentation this cycle's changes made stale — guides, references, anything a reader relies on — and verifies every claim against the real running binary rather than against the plan's own prose or memory.

> Comment narrative that survives spec-review and code-quality-review can still contain real factual errors, because nobody executed anything. Verifying against the binary is what catches that.

Closes by writing `<!-- awm-docs-complete: YYYY-MM-DD -->` to the plan. `development-process` will not route to `harness-retro` or `finishing-a-development-branch` while `awm-qa-complete` is present and `awm-docs-complete` is absent.

### 4.5 · Retro — `harness-retro`

Reads the branch ledger (`awm ledger list`) and turns **recurring** findings into durable rules: a sensor rule, a `CONSTITUTION.md` entry, or an `AGENTS.md` lesson.

> Add the rule to the harness, not the fix to the symptom.

The regression test proves *this* bug is fixed; the rule stops the *class* from coming back. You want both.

### 5 · Completion — `finishing-a-development-branch`

Tests must pass first. Then merge locally, push and open a PR, keep the branch, or discard. In unattended mode it goes straight to push + PR.

---

## The gates you cannot talk past

| Gate | What it does |
|---|---|
| `awm sensors run` | Real commands, real exit codes. No lens, review or claim overrides a red sensor. |
| `awm preflight` | Verifies the harness can *actually* gate before you start — a green run on a project with no configured sensors is a lie, and preflight is what catches it. Use `--require-current` when the handoff also requires authoritative CLI and registry freshness. |
| `verification-before-completion` | No "done/fixed/passing" claim without the command output that proves it. |
| Plan markers | `awm-qa-complete`, `awm-docs-complete`, and `awm-retro-complete` must be present before finishing, in that order. |

The last one is worth dwelling on: the markers exist so that a *later* session — or a different person — can tell whether QA, the docs pass, and the retro really ran, instead of trusting a summary.

---

## Driving it manually

In `config-managed`, `agents-md-managed` or `context-only` agents (OpenCode, Cursor, Copilot, Antigravity), nothing enforces phase order — the process is delivered as context and the agent follows it as well as it follows any instruction. To drive it yourself:

```
"Use the brainstorming skill for <feature>."
"Now use writing-plans on that design."
"Execute the plan with subagent-driven-development."
"Run post-implementation-qa on the branch."
"Run post-implementation-docs."
"Run harness-retro."
"Finish the branch."
```

And run the deterministic parts yourself at each boundary:

```bash
awm preflight        # before starting
awm preflight --require-current # before a freshness-enforced unattended handoff
awm plan validate PLAN_PATH # validate a compact plan without executing its commands
awm sensors run      # before claiming any task done
awm ledger list      # before the retro
```

Those work identically on every agent.

Strict currentness is separate from local `minCliVersion` compatibility: either
verdict blocks a freshness-enforced handoff. Follow the report's exact remedy:
`awm update --yes` for a stale registry, or `awm unpin REGISTRY_NAME` followed
by `awm update --yes` for a pinned-behind registry. In cacheable environments,
run `npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight
--require-current`. This only protects a process that executes the fresh
CLI/bootstrap; it cannot update a host or cached container that never runs new
code.

---

## Debugging mid-flight

When something breaks, `systematic-debugging` applies, and its first rule is the one people skip under pressure:

> **No fixes without root-cause investigation first.**

Three failed fixes is not "try a fourth" — it's a signal to question the architecture. And when a fix lands, verify it by **reverting only the fix** and confirming the new test goes red. A green suite alone doesn't prove a test discriminates anything; this repo has the retros to show for it.

---

## Related

- [Product process](product-process.md) — the layer before this one
- [How AWM works](../framework.md) — how the phases, gates and learning loop compose
- [CLI reference](../cli-reference.md) — every command
- [Runbook ch. 3](../runbook.md#chapter-3--day-to-day-in-a-project) — day-to-day mechanics
