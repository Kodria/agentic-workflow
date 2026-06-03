---
name: harness-retro
version: "1.0.0"
description: Use when the same bug, review finding, or sensor failure has appeared at least twice — turns recurring symptoms into structural rules so the harness catches them automatically next time. Triggered by systematic-debugging, code-quality-reviewer, receiving-code-review, or the user. Outputs lint rules, structural tests, CONSTITUTION.md entries, or Semgrep rules depending on the bug class.
---

# Harness Retro

## Overview

A bug that escapes the harness once is a miss. A bug that escapes twice is a harness gap. `harness-retro` is the cross-cutting skill that turns the second occurrence into a structural rule so there is no third occurrence. It is the steering layer of the AWM Harness Engineering loop.

**Announce at start:** "I'm using the harness-retro skill to convert this recurring issue into a structural rule."

**Core principle:** Add the rule to the harness, not the fix to the symptom.

## When to use

- A test failure or production bug has the same root cause as a prior one
- A code reviewer flags the same systemic pattern across multiple files
- The same PR feedback recurs across multiple PRs
- An `awm sensors run` failure recurs after a recent fix that supposedly resolved it
- A `systematic-debugging` session ends with "we've seen this before"
- The user explicitly invokes it ("we keep seeing X, do a retro")

## When NOT to use

- First occurrence of a bug — fix it, write a regression test, move on. Don't structuralize on a single sample
- Style preference with no measurable failure — that's a discussion, not a harness gap
- Bug that's truly one-off due to environment (flaky network, race in third-party code) — handle defensively, don't add a rule that will never fire again

## Checklist

You MUST create a task for each item and complete them in order:

1. **Confirm recurrence** — ≥2 occurrences with the same root cause; if only 1, exit and recommend the user wait for the next instance
2. **Classify the bug** — structural / lógica / proceso / seguridad (see "The remediation tree" below)
3. **Identify the remediation target** — which file gets the new rule, which sensor catches it
4. **Draft the rule** — actual lint/test/constitution/semgrep text
5. **Present to user for approval** — show the rule and what it would have caught
6. **Apply the rule** — edit the target file
7. **Verify the rule fires** — manufacture the original failure, run the sensor, confirm it now fails fast
8. **Commit** the rule
9. **Add an entry to `docs/harness-retros.md`** (create if absent) — date, recurring issue summary, rule added

## The remediation tree

```
Bug escapó ≥2 veces
├── estructural → nueva regla de linter/tsc → agrega a eslint.config.awm.mjs / tsconfig.awm.json
├── de lógica  → nuevo test estructural → escrito por humano, no IA
├── de proceso → regla en CONSTITUTION.md o nueva skill
└── de seguridad → regla Semgrep nueva → agrega a .semgrep.awm.yml
```

### Classification heuristics

| Symptom | Class | Why |
|---|---|---|
| Type/shape error caught by reading the code | structural | The compiler/linter should reject it without running tests |
| Logic error only caught when code runs | de lógica | Behavioral; needs a test that exercises the path |
| "We always forget to do X before Y" | de proceso | Human discipline; rule belongs in CONSTITUTION.md |
| Pattern that creates a vulnerability (eval, unsanitized SQL, etc.) | de seguridad | Semgrep / dataflow rule |

If the bug straddles two classes (e.g., structural + de seguridad), pick the one that fails *earliest* in the loop — earlier = cheaper.

## The Process

### 1. Confirm recurrence

Ask explicitly: "Where did this pattern fail before?" Get:

- File or PR reference for occurrence #1
- File or PR reference for occurrence #2
- One-sentence statement of the shared root cause

If the user can't name two instances, this is premature. Recommend: "Add a regression test for this instance. When it happens a second time, come back."

### 2. Classify

Apply the heuristics from the table above. State the classification out loud:

> "Classifying as `de lógica` because the bug only surfaced when the function ran against an empty input — a static check wouldn't have caught it."

### 3. Identify the remediation target

Map class → target:

| Class | Target file(s) |
|---|---|
| structural | `eslint.config.awm.mjs` (rules), `tsconfig.awm.json` (compiler flags), `.dep-cruiser.awm.js` (boundaries) |
| de lógica | A new structural test file (e.g. `tests/structural/no-empty-input-leaks.test.ts`) |
| de proceso | `CONSTITUTION.md` (new bullet under Process or Sensors) |
| de seguridad | `.semgrep.awm.yml` (new rule) |

The structural tests directory may not exist yet. Create `tests/structural/` if needed. These tests are conventional unit tests, but their *purpose* is to enforce architectural invariants rather than verify business logic.

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

### 5. Present to user

Show:
1. The rule text (above)
2. **What it would have caught:** point at occurrence #1 and #2, confirm the rule fires on both
3. **False-positive risk:** would the rule flag any current code that's actually correct? Run `awm sensors run --all` (or the specific sensor) and report findings

Wait for explicit approval.

### 6. Apply the rule

Use the `Edit` or `Write` tool to add the rule to the target file. If the file doesn't exist (e.g. `tests/structural/` is new), create it and any required scaffolding.

### 7. Verify the rule fires

Manufacture the original failure in a scratch file or stash, then run the sensor:

```bash
awm sensors run --fast    # for tsc/eslint rules
awm sensors run --slow    # for semgrep
npm test -- tests/structural   # for structural tests
```

Expected: the sensor fails on the manufactured case with a clear error message pointing at the rule. If it doesn't fire, the rule is mis-scoped — iterate.

Then revert the manufactured failure and re-run: sensors should pass cleanly.

### 8. Commit

```bash
git add <changed-files>
git commit -m "harness-retro: <class> rule for <issue summary>"
```

Example:
```bash
git commit -m "harness-retro: structural rule for missing setTimeout delay"
```

### 9. Log the retro

Append (or create) `docs/harness-retros.md`:

```markdown
## YYYY-MM-DD — <one-line issue>

- **Class:** structural | de lógica | de proceso | de seguridad
- **Occurrences:** <PR/commit ref #1>, <PR/commit ref #2>
- **Rule:** path:line of the new rule
- **Sensor:** which sensor catches it (typecheck | lint | security | structural-test | constitution)
```

The log is auditable evidence that the harness is improving over time.

## Anti-patterns

- **Skipping recurrence confirmation.** Adding rules for one-off bugs creates false-positive noise that erodes trust in sensors. Two occurrences minimum.
- **Drafting a "philosophical" rule instead of an enforceable one.** "Code should be readable" is a wish, not a rule. Rules are concrete patterns a sensor can match.
- **Replacing the regression test with the rule.** Both should exist — the test asserts the specific case is fixed, the rule prevents the class of cases from returning.
- **Verifying with intent ("this rule clearly catches it") instead of running the sensor.** The verify step is non-optional. Manufacture the failure, see the sensor fail.
- **Letting AI write the de lógica structural test.** Per CONSTITUTION conventions, the harness-retro structural tests are reviewed/authored by a human. The skill drafts the test, but the human owns approval and may rewrite from scratch.

## Integration with other skills

Four cross-cutting skills propose `harness-retro` when they detect recurrence. The integration patches that wire this up are committed to the AWM registry in `registry/skills/<name>/SKILL.md` and in `registry/skills/harness-retro/integrations/` (as documentation of what was changed and why):

- `integrations/verification-before-completion.md` — sensors that fail twice
- `integrations/systematic-debugging.md` — debug sessions ending in pattern match
- `integrations/sdd-code-quality-reviewer.md` — reviewer findings spanning ≥2 files
- `integrations/receiving-code-review.md` — same PR feedback across ≥2 PRs

Users get the updated skills via `awm update` or reinstall.
