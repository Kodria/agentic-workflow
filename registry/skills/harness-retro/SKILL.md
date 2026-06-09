---
name: harness-retro
version: "2.0.0"
description: Use as the terminal learning phase of development-process — reads the per-branch findings ledger (awm ledger), presents the session's findings and wins interactively, and cures each into a concrete, durable rule (remediation tree / CONSTITUTION.md / AGENTS.md) so the agent stops repeating mistakes. Ledger-driven, not dependent on human recall.
---

# Harness Retro

## Overview

`harness-retro` is the terminal learning phase of `development-process`. It reads the branch ledger accumulated during the session (populated by SDD reviewers, post-qa, sensors, and debugging phases), presents every item to the user interactively, and cures the approved ones into the remediation tree or existing delivered docs.

**Announce at start:** "I'm using the harness-retro skill to review this session's findings and cure them into the harness."

**Core principle:** Add the rule to the harness, not the fix to the symptom.

**Source of truth:** the per-branch ledger at `.awm/ledger/<branch>.jsonl`, populated during the session by the review/QA/sensor/debugging phases. harness-retro reads it; it does not ask you to remember prior occurrences.

## When to use

- Automatically: `development-process` routes here after `post-implementation-qa` completes and `awm-qa-complete` is present but `awm-retro-complete` is absent.
- Manually: the user invokes it directly ("do a retro on this session", "we keep seeing X, do a retro").

## When NOT to use

- The ledger is empty, there are no manual observations, **and the session genuinely produced zero findings** — exit fast and add the `awm-retro-complete` marker.

**Empty-ledger consistency check (mandatory before fast-exit):** an empty ledger is only legitimate if nothing was found during the cycle. Cross-check against the session evidence: did the spec/quality reviewers report issues? Did `post-implementation-qa` present findings (Type B/C in the plan or QA report)? If findings were reported anywhere but the ledger is empty, the learning pipeline is broken — **that IS the retro finding**. Do not fast-exit: trace where the `awm ledger add` instruction was dropped (inline prompt instead of template? missing gate?), cure the gap in the responsible skill, and log it. An empty ledger after a cycle with findings is contradictory evidence, never a clean bill.

## Checklist

You MUST create a task for each item and complete them in order:

1. **Read the session ledger** — run `awm ledger list` and `awm ledger recurring --min 2`; summarize findings + wins for the user
2. **Present each item interactively** — for each finding and win, let the user decide: structuralize, record as AGENTS.md lesson, or dismiss
3. **Classify each approved item** — structural / lógica / proceso / seguridad
4. **Draft the rule** — actual lint/test/constitution/semgrep/AGENTS.md text
5. **Cure, don't append raw** — when writing to CONSTITUTION.md or AGENTS.md: merge the new lesson into the relevant existing section and drop entries that no longer apply (merge-and-prune, never append raw)
6. **Apply the rule** — edit the target file
7. **Verify the rule fires** (for sensor rules) — manufacture the failure, run the sensor, confirm it catches it
8. **Commit** the rules
9. **Log the retro** — append to `docs/harness-retros.md`
10. **Close the retro** — run `awm ledger archive` and add the `awm-retro-complete` marker

## The remediation tree

```
Session finding
├── structural / seguridad / lógica (sensor-catchable)
│   └── remediation tree: eslint.config.awm.mjs / .semgrep.awm.yml / tests/structural/
├── de proceso (project rule)
│   └── CONSTITUTION.md
└── agent working-style + wins
    └── AGENTS.md
```

**Two-tier curation targets:**

| Class | Cured target (existing, delivered) |
|---|---|
| structural / seguridad / lógica (sensor-catchable) | remediation tree: `eslint.config.awm.mjs` / `.semgrep.awm.yml` / `tests/structural/` |
| de proceso (project rule) | `CONSTITUTION.md` |
| agent working-style + **wins** | `AGENTS.md` |

Wins (`polarity: win`) are reinforced as short "what works here" notes in `AGENTS.md`. Agent-style lessons land in `AGENTS.md` (agnostic — every agent reads it), never `CLAUDE.md`.

### Classification heuristics

| Symptom | Class | Why |
|---|---|---|
| Type/shape error caught by reading the code | structural | The compiler/linter should reject it without running tests |
| Logic error only caught when code runs | de lógica | Behavioral; needs a test that exercises the path |
| "We always forget to do X before Y" | de proceso | Human discipline; rule belongs in CONSTITUTION.md |
| Pattern that creates a vulnerability (eval, unsanitized SQL, etc.) | de seguridad | Semgrep / dataflow rule |
| Agent working-style lesson or win | agent | Notes in AGENTS.md |

If the bug straddles two classes, pick the one that fails *earliest* in the loop — earlier = cheaper.

## The Process

### 1. Read the session ledger

Run these two commands:

```bash
awm ledger list
awm ledger recurring --min 2
```

`awm ledger list` shows all findings and wins recorded during the session.
`awm ledger recurring --min 2` groups by `signature` and shows clusters where the same issue appeared ≥2 times — this is a **señal** (signal) to weigh when deciding whether to structuralize, not a hard gate. You may structuralize a single high-impact finding (`count: 1`), or defer a recurring trivial one. The user decides per item.

Summarize for the user: total findings, total wins, recurring clusters (if any).

### 2. Present each item interactively

Present every ledger item — findings AND wins — grouped by signature with its recurrence count. For each, wait for an explicit user decision:

- **Structuralize** → which target (remediation tree / CONSTITUTION.md / AGENTS.md)?
- **Record as AGENTS.md lesson/win** → reinforcing working patterns
- **Dismiss** → note the reason and move on

Do not apply anything without explicit user approval per item. Do not batch-apply.

### 3. Classify

Apply the heuristics from the table above. State the classification out loud:

> "Classifying as `de lógica` because the bug only surfaced when the function ran against an empty input — a static check wouldn't have caught it."

### 4. Draft the rule

Write the actual rule, not a description. Examples by class:

**structural (ESLint):**
```js
// eslint.config.awm.mjs — added rule
{
  rules: {
    'no-restricted-syntax': ['error', {
      selector: "CallExpression[callee.name='setTimeout'][arguments.length=1]",
      message: 'setTimeout requires an explicit delay argument.',
    }],
  },
}
```

**de lógica (structural test):**
```ts
// tests/structural/no-implicit-any-fallback.test.ts
import { parseConfig } from '../../src/config';

test('parseConfig returns explicit error on empty input', () => {
  expect(() => parseConfig('')).toThrow(/empty config/);
});
```

**de proceso (CONSTITUTION.md):**
```markdown
## Process
- Before invoking a destructive Bash command (rm, drop, truncate), MUST confirm with the user when not in CI.
```

**de seguridad (Semgrep):**
```yaml
# .semgrep.awm.yml — added rule
- id: no-eval-on-user-input
  pattern: eval($USER_INPUT)
  message: eval() on user input — use a parser/validator instead.
  severity: ERROR
  languages: [javascript, typescript]
```

**agent lesson/win (AGENTS.md):**
```markdown
## What works here
- Staging files individually (not `git add -A`) prevents accidental secret inclusion — confirmed pattern across multiple sessions.
```

### 5. Cure, don't append raw

When writing to `CONSTITUTION.md` or `AGENTS.md`, **merge and prune**: fold the new lesson into the relevant existing section and drop entries that no longer apply. These docs are delivered every session — keep them a curated index, not an append-only log, so context never saturates.

### 6. Apply

Use the `Edit` or `Write` tool to add the rule to the target file. If the file doesn't exist (e.g. `tests/structural/` is new), create it and any required scaffolding.

### 7. Verify the rule fires

For sensor-catchable rules (structural, de lógica, de seguridad), manufacture the original failure and confirm the sensor catches it:

```bash
awm sensors run    # for tsc/eslint rules
npm test -- tests/structural   # for structural tests
```

Expected: the sensor fails on the manufactured case. Then revert and re-run — sensors should pass cleanly.

### 8. Commit

```bash
git add <changed-files>
git commit -m "harness-retro: <class> rule for <issue summary>"
```

### 9. Log the retro

Append (or create) `docs/harness-retros.md`:

```markdown
## YYYY-MM-DD — <one-line issue>

- **Class:** structural | de lógica | de proceso | de seguridad | agent
- **Occurrences (ledger count):** N
- **Rule:** path:line of the new rule
- **Sensor:** which sensor catches it (typecheck | lint | security | structural-test | constitution | agents-md)
```

### 10. Close the retro

Run `awm ledger archive` to rotate this branch's ledger out of the active flow (it stays on disk under `.awm/ledger/archive/` for audit; the next plan starts fresh):

```bash
awm ledger archive
```

Then add the `awm-retro-complete` marker to the active plan (first line after the `#` header), so `development-process` routes to `finishing-a-development-branch`:

```markdown
<!-- awm-retro-complete: YYYY-MM-DD -->
```

## Anti-patterns

- **Asking "where did this fail before?" instead of reading the ledger.** The ledger has the answer — use `awm ledger list` and `awm ledger recurring`.
- **Treating recurrence count as a hard gate.** Count is a signal to weigh, not a threshold to pass. A single high-severity finding may be worth structuralizing.
- **Drafting a "philosophical" rule instead of an enforceable one.** "Code should be readable" is a wish, not a rule.
- **Replacing the regression test with the harness rule.** Both should exist — the test asserts the specific case is fixed, the rule prevents the class of cases from returning.
- **Letting AI write the de lógica structural test.** The skill drafts, the human owns approval.
- **Appending raw entries to CONSTITUTION.md / AGENTS.md** without merging/pruning — these docs are delivered every session and must stay bounded.
- **Curating agent-style lessons into CLAUDE.md.** Agent lessons and wins go to `AGENTS.md` (every agent reads it), never `CLAUDE.md` (Claude-specific).
- **Skipping the `awm ledger archive` step.** The next session should start with a clean ledger; always archive before closing.
- **Fast-exiting on an empty ledger without the consistency check.** If reviewers or QA reported findings during the cycle, an empty ledger means the emission pipeline broke — trace and cure it; don't declare "nothing to learn".

## Integration with other skills

| Skill | How it feeds harness-retro |
|---|---|
| `subagent-driven-development` spec-reviewer | Emits `awm ledger add --polarity finding|win` per spec gap / win |
| `subagent-driven-development` code-quality-reviewer | Emits `awm ledger add` per quality issue / win |
| `post-implementation-qa` deep-review | Emits `awm ledger add` per Type B/C finding / win |
| `verification-before-completion` | Emits `awm ledger add` on recurring sensor failure |
| `systematic-debugging` | Emits `awm ledger add` on confirmed root cause |
| `development-process` | Routes to harness-retro after QA; requires `awm-retro-complete` to proceed to finishing |
