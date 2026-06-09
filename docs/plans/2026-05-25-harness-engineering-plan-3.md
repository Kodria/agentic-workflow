# Harness Engineering — Plan 3: Intelligent + Steering Layer
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two missing AWM skills (`setup-sensors`, `harness-retro`) and wire `harness-retro` into the four cross-cutting skills (`verification-before-completion`, `systematic-debugging`, `code-quality-reviewer-prompt` in SDD, `receiving-code-review`) so recurring failures trigger structural remediation instead of repeated symptom fixes.

**Architecture:** Two new SKILL.md files live in `registry/skills/` (versioned with AWM). The four integrations are small inserts into the corresponding `registry/skills/<name>/SKILL.md` files — all committed to the AWM repo. Users get the updated skills by running `awm update` or reinstalling. Skills are pure markdown — no scripts.

**Tech Stack:** Markdown skill documents with YAML frontmatter. Python 3 one-liners for frontmatter validation. `grep -F` for distinctive-string verification. Context7 MCP tools (`mcp__context7__resolve-library-id`, `mcp__context7__query-docs`) consumed by `setup-sensors` at runtime.

---

## File Map

**Create (committed to AWM repo on `feature/harness-engineering-plan-3`):**

- `registry/skills/setup-sensors/SKILL.md` — guided sensor config using Context7
- `registry/skills/harness-retro/SKILL.md` — steering loop with remediation tree
- `registry/skills/harness-retro/integrations/verification-before-completion.md` — patch record
- `registry/skills/harness-retro/integrations/systematic-debugging.md` — patch record
- `registry/skills/harness-retro/integrations/sdd-code-quality-reviewer.md` — patch record
- `registry/skills/harness-retro/integrations/receiving-code-review.md` — patch record
- `registry/skills/harness-retro/integrations/README.md` — index

**Modify (in `registry/skills/`, committed to AWM repo):**

- `registry/skills/verification-before-completion/SKILL.md` — insert "Sensor-based verification (AWM)" section before "The Bottom Line"
- `registry/skills/systematic-debugging/SKILL.md` — insert "Phase 5: Pattern Recognition (AWM harness-retro)" after Quick Reference table
- `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md` — add systemic-patterns bullet at end of bullet list
- `registry/skills/receiving-code-review/SKILL.md` — insert "Recurring Feedback (AWM)" section before "The Bottom Line"

---

## Conventions

### Distinctive marker strings

Each integration patch contains a distinctive marker string that lets us verify it's present without parsing the whole file. Markers are HTML comments so they don't render in the skill output.

| File | Marker |
|---|---|
| `registry/skills/verification-before-completion/SKILL.md` | `<!-- AWM-INTEGRATION: verification-sensors -->` |
| `registry/skills/systematic-debugging/SKILL.md` | `<!-- AWM-INTEGRATION: debugging-retro -->` |
| `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md` | `<!-- AWM-INTEGRATION: reviewer-retro -->` |
| `registry/skills/receiving-code-review/SKILL.md` | `<!-- AWM-INTEGRATION: receiving-retro -->` |

### Branch & commits

Working branch: `feature/harness-engineering-plan-3` (already created from `main`).

All commits go to this branch. Do NOT push to `main` during plan execution (per `dev-workflow-rules` memory). Final merge happens through `finishing-a-development-branch` after the plan is complete.

---

## Task 1: `setup-sensors` skill

**Files:**
- Create: `registry/skills/setup-sensors/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p registry/skills/setup-sensors
```

- [ ] **Step 2: Write the SKILL.md**

Create `registry/skills/setup-sensors/SKILL.md` with EXACTLY this content:

````markdown
---
name: setup-sensors
description: Use when a repository needs sensor configuration adapted to its actual installed tool versions (e.g. ESLint v9 flat config vs v8 extends, mypy vs ruff, monorepo tsconfig refs). Complements the `awm sensors init` CLI wizard by consulting Context7 for current docs and generating version-correct config files. Invoke when the wizard's templated configs don't fit the project.
---

# Setup Sensors

## Overview

`awm sensors init` writes a generic sensor manifest plus template config files (e.g. `eslint.config.awm.mjs`, `tsconfig.awm.json`, `.semgrep.awm.yml`). The templates target a typical version of each tool. When the project has unusual versions, a monorepo layout, an existing custom config, or a stack the wizard doesn't fully recognize, this skill adapts the configs by reading the project's actual versions and consulting Context7 for current documentation.

**Announce at start:** "I'm using the setup-sensors skill to configure sensors for this project."

## When to use

- After `awm sensors init` ran but `awm sensors status` reports DEGRADED with config gaps
- Stack uses tool versions outside the templates' assumptions (ESLint v9 flat config, TS 5 with project refs, Vitest instead of Jest)
- Project is a monorepo and the templated configs target a single package
- Existing custom configs need to coexist with the AWM ones rather than be replaced
- `awm sensors init --configure` failed or produced configs that error out when sensors run

## When NOT to use

- Fresh project, standard stack, no existing configs — use `awm sensors init --configure` directly; it's faster
- Just need to see which sensors are configured — use `awm sensors status`
- Tool isn't installed at all — install the tool first; this skill adapts configs, it doesn't install dependencies

## Checklist

You MUST create a task for each item and complete them in order:

1. **Run `awm sensors status`** — identify which sensors are missing, degraded, or configured
2. **Detect installed tool versions** — `eslint --version`, `npx tsc --version`, `semgrep --version`, etc.
3. **Read existing project configs** — `eslint.config.*`, `tsconfig*.json`, `.semgreprc`, etc.
4. **Consult Context7 for the tool+version combos that need adaptation**
5. **Propose minimal extensions per file** — get explicit user approval before writing
6. **Write the adapted configs** to the project root
7. **Re-run `awm sensors status`** — confirm DEGRADED → HEALTHY for the targeted sensors
8. **Run `awm sensors run --all`** — confirm no crashes and that the formatters produce LLM-readable output
9. **Commit** the new/changed config files

## The Process

### 1. Assess current state

```bash
awm sensors status
```

The output lists each sensor and its check verdict. Note which sensors are:
- **HEALTHY** — leave alone
- **DEGRADED** — config file present but failing checks (this is the target)
- **NOT_CONFIGURED** — sensor missing from manifest (run `awm sensors init` first, then return here)

### 2. Detect actual tool versions

Run these in parallel where possible. Some tools answer to multiple flags; the first one that works is fine.

```bash
npx tsc --version 2>/dev/null || echo "tsc not installed"
npx eslint --version 2>/dev/null || echo "eslint not installed"
semgrep --version 2>/dev/null || echo "semgrep not installed"
npx depcruise --version 2>/dev/null || echo "depcruise not installed"
```

Record the exact version of every tool whose sensor is DEGRADED. Don't proceed to Context7 with versions you didn't verify firsthand — outdated assumptions are the failure mode this skill exists to prevent.

### 3. Read existing project configs

Use `Glob` to find candidates:

- `eslint.config.{js,mjs,cjs,ts}`, `.eslintrc*`
- `tsconfig*.json`
- `.semgreprc`, `.semgrep.yml`
- `.depcruiserrc*`

Read every one that exists. The goal is to extend, not replace — the user's existing rules stay; AWM's rules get added.

### 4. Consult Context7

For each tool whose version is outside the template's assumption, call Context7. Example for ESLint v9:

```
mcp__context7__resolve-library-id: { libraryName: "eslint" }
→ /eslint/eslint

mcp__context7__query-docs: {
  context7CompatibleLibraryID: "/eslint/eslint",
  topic: "flat config",
  tokens: 5000
}
```

Look for: the current config file format, how to extend a base config without overwriting it, recommended rules for the language/runtime in use.

For TypeScript:
```
mcp__context7__resolve-library-id: { libraryName: "typescript" }
→ /microsoft/typescript

mcp__context7__query-docs: {
  context7CompatibleLibraryID: "/microsoft/typescript",
  topic: "project references",
  tokens: 3000
}
```

### 5. Propose minimal extensions

Present ONE config at a time. Example for ESLint v9 when the template is v8:

> The AWM template at `eslint.config.awm.mjs` uses v8 `extends` syntax, but your project has ESLint v9.5.0 which uses flat config arrays. Proposed extension:
>
> ```js
> // eslint.config.awm.mjs (v9 flat config)
> export default [
>   {
>     rules: {
>       'no-unused-vars': 'error',
>       'no-undef': 'error',
>     },
>   },
> ];
> ```
>
> Your existing `eslint.config.js` stays untouched. To activate AWM rules during a sensor run, the `lint` sensor cmd in `.awm/sensors.json` will be updated to `npx eslint . --config eslint.config.awm.mjs --format json`.
>
> Approve or tell me what to change.

Wait for explicit approval before moving to the next config. Do not batch.

### 6. Write the configs

Use the `Write` tool for each approved config. Update `.awm/sensors.json` if a sensor's command needs to change (e.g. `--config eslint.config.awm.mjs` added).

### 7. Validate

```bash
awm sensors status
```

Every DEGRADED sensor you touched should now report HEALTHY. If any are still DEGRADED, re-read the status output for the specific failure reason and iterate (return to step 3 for that sensor).

Then test the sensors run end-to-end:

```bash
awm sensors run --all
```

Expected: each sensor either passes or fails with LLM-friendly output (lines starting with `SENSOR[<type>]`). If any sensor crashes (non-zero exit with stderr noise), the config is still wrong — iterate.

### 8. Commit

```bash
git add eslint.config.awm.mjs tsconfig.awm.json .awm/sensors.json
git commit -m "chore(sensors): adapt configs to project tool versions"
```

(Replace the file list with what you actually changed.)

## Anti-patterns

- **Skipping version detection.** Adapting to ESLint "v9" because you assumed without running `eslint --version` produces wrong configs. Always verify firsthand.
- **Replacing existing configs.** The user's `eslint.config.js` stays. AWM configs live in `eslint.config.awm.mjs` (separate file). Sensors reference the AWM file explicitly.
- **Batch-approving all configs.** Each generated config is a separate decision. Section-by-section approval prevents silent mistakes from cascading.
- **Generating configs without Context7 for non-template versions.** Memorized config snippets from training data may be stale. When the version is outside the template's assumption, consult Context7 — that's why this skill exists.
- **Skipping the validation step.** A config that "looks right" is not the same as `awm sensors status` returning HEALTHY. Always verify.
````

- [ ] **Step 3: Verify the frontmatter is valid**

```bash
python3 -c "
content = open('registry/skills/setup-sensors/SKILL.md').read()
assert content.startswith('---\n'), 'must start with frontmatter delimiter'
parts = content.split('---\n', 2)
assert len(parts) >= 3, 'frontmatter must close with ---'
fm = parts[1]
assert 'name: setup-sensors' in fm
assert 'description:' in fm
print('Frontmatter OK')
print('Body length:', len(parts[2]), 'chars')
"
```

Expected: `Frontmatter OK` and `Body length:` > 3000.

- [ ] **Step 4: Verify section count and announce instruction**

```bash
grep -c '^## ' registry/skills/setup-sensors/SKILL.md
```
Expected: ≥ 6.

```bash
grep -F 'Announce at start' registry/skills/setup-sensors/SKILL.md
```
Expected: one match.

```bash
grep -F 'mcp__context7' registry/skills/setup-sensors/SKILL.md
```
Expected: two matches (one for `resolve-library-id`, one for `query-docs`).

- [ ] **Step 5: Commit**

```bash
git add registry/skills/setup-sensors/SKILL.md
git commit -m "feat(skills): add setup-sensors skill"
```

---

## Task 2: `harness-retro` skill

**Files:**
- Create: `registry/skills/harness-retro/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p registry/skills/harness-retro
```

- [ ] **Step 2: Write the SKILL.md**

Create `registry/skills/harness-retro/SKILL.md` with EXACTLY this content:

````markdown
---
name: harness-retro
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
````

- [ ] **Step 3: Verify the frontmatter is valid**

```bash
python3 -c "
content = open('registry/skills/harness-retro/SKILL.md').read()
parts = content.split('---\n', 2)
assert len(parts) >= 3
fm = parts[1]
assert 'name: harness-retro' in fm
assert 'description:' in fm
print('Frontmatter OK')
print('Body length:', len(parts[2]), 'chars')
"
```

Expected: `Frontmatter OK`, `Body length:` > 4000.

- [ ] **Step 4: Verify the remediation tree text is present**

```bash
grep -c '^├──\|^└──' registry/skills/harness-retro/SKILL.md
```
Expected: 4 (the four tree branches).

```bash
grep -F 'Announce at start' registry/skills/harness-retro/SKILL.md
```
Expected: one match.

- [ ] **Step 5: Commit**

```bash
git add registry/skills/harness-retro/SKILL.md
git commit -m "feat(skills): add harness-retro skill"
```

---

## Task 3: Integration patch record documents

**Files:**
- Create: `registry/skills/harness-retro/integrations/README.md`
- Create: `registry/skills/harness-retro/integrations/verification-before-completion.md`
- Create: `registry/skills/harness-retro/integrations/systematic-debugging.md`
- Create: `registry/skills/harness-retro/integrations/sdd-code-quality-reviewer.md`
- Create: `registry/skills/harness-retro/integrations/receiving-code-review.md`

These are documentation files recording what was changed in Tasks 4-7 and why. They serve as a reference for anyone reviewing the changes and as a guide for re-applying the integrations on fresh checkouts or after upstream skill updates.

- [ ] **Step 1: Create the integrations directory**

```bash
mkdir -p registry/skills/harness-retro/integrations
```

- [ ] **Step 2: Write `integrations/README.md`**

```markdown
# harness-retro integrations

Records of the patches applied to the four cross-cutting AWM skills to wire in `harness-retro`. Each `<name>.md` documents one integration:

- **Target** — file path in `registry/skills/` (committed to the AWM repo)
- **Anchor** — existing text the patch attaches to
- **Insert** — exact text that was added, including the `<!-- AWM-INTEGRATION: ... -->` marker
- **Verify** — grep command that returns 1 if the integration is present

## How these patches are delivered

The modifications live directly in `registry/skills/<name>/SKILL.md` (committed to the AWM repo). Users receive them when they run `awm update` or reinstall. These docs are the historical record of what changed and why — not a manual application script.

## How to verify

Run the Verify command from each doc against the registry file. A result of `1` means the integration is applied; `0` means the registry file is missing the integration (which would be a regression — fix it with `Edit`).

## If an upstream skill update wipes the integration

1. Read the relevant `<name>.md` patch doc
2. Locate the anchor in the updated file
3. Apply the Insert with `Edit`
4. Verify with the Verify grep
5. Commit the fix as `fix(skills): restore harness-retro integration for <name>`
```

- [ ] **Step 3: Write `integrations/verification-before-completion.md`**

````markdown
# Patch record: verification-before-completion ← harness-retro

**Target:** `registry/skills/verification-before-completion/SKILL.md`

**Marker:** `<!-- AWM-INTEGRATION: verification-sensors -->`

**Anchor:** The section header `## The Bottom Line` (near end of file).

**Position:** Inserted IMMEDIATELY BEFORE the `## The Bottom Line` line.

**Inserted text:**

```markdown
## Sensor-based verification (AWM)

<!-- AWM-INTEGRATION: verification-sensors -->

If the repo has `.awm/sensors.json`, "done" requires sensor evidence in addition to test/build evidence.

**Before claiming done:**

```bash
awm sensors run --slow
```

- Exit 0 with `overall: pass` → sensors clean; proceed.
- Exit 1 with sensor failures → autocorrect using the LLM-formatted errors, re-run sensors, then claim done.

**Recurrence trigger:**

If the SAME sensor (same `name` + same `rule`) has failed in a prior session for this repo, do not just fix it — invoke the `harness-retro` skill. Recurring sensor failures mean the harness has a gap; `harness-retro` turns the recurrence into a structural rule.

```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: verification-sensors' registry/skills/verification-before-completion/SKILL.md | wc -l
```
Expected: `1`
````

- [ ] **Step 4: Write `integrations/systematic-debugging.md`**

````markdown
# Patch record: systematic-debugging ← harness-retro

**Target:** `registry/skills/systematic-debugging/SKILL.md`

**Marker:** `<!-- AWM-INTEGRATION: debugging-retro -->`

**Anchor:** The `## When Process Reveals "No Root Cause"` heading.

**Position:** Inserted IMMEDIATELY BEFORE this heading (i.e. after the Quick Reference table).

**Inserted text:**

```markdown
## Phase 5: Pattern Recognition (AWM harness-retro)

<!-- AWM-INTEGRATION: debugging-retro -->

After the fix is verified, ask one question:

> "Have I debugged this same root cause before in this repo?"

Check `docs/harness-retros.md` (if it exists) and recent commit messages matching `harness-retro:` for prior instances. If you find one:

- **Yes, second occurrence** → invoke the `harness-retro` skill. The fix you just shipped is one sample; the rule from harness-retro turns it into a class.
- **No, first occurrence** → ship the regression test (Phase 4 Step 1 already covers this) and move on. Don't structuralize on a single sample.

This is what closes the loop between debugging and the harness. Without it, every recurrence costs a full debug cycle.

```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: debugging-retro' registry/skills/systematic-debugging/SKILL.md | wc -l
```
Expected: `1`
````

- [ ] **Step 5: Write `integrations/sdd-code-quality-reviewer.md`**

````markdown
# Patch record: SDD code-quality-reviewer prompt ← harness-retro

**Target:** `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`

**Marker:** `<!-- AWM-INTEGRATION: reviewer-retro -->`

**Anchor:** The line ending with `focus on what this change contributed.)`.

**Position:** Added as a new bullet at the END of the bullet list directly under the "In addition to standard code quality concerns" header.

**Inserted text (single bullet appended after anchor line):**

```markdown
- **Systemic patterns:** Does the same flaw appear across ≥2 files in this change? If yes, name the pattern and recommend the orchestrator invoke the `harness-retro` skill after this review. Do NOT list every occurrence as a separate finding — name the pattern once and point to one example. <!-- AWM-INTEGRATION: reviewer-retro -->
```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: reviewer-retro' registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md | wc -l
```
Expected: `1`
````

- [ ] **Step 6: Write `integrations/receiving-code-review.md`**

````markdown
# Patch record: receiving-code-review ← harness-retro

**Target:** `registry/skills/receiving-code-review/SKILL.md`

**Marker:** `<!-- AWM-INTEGRATION: receiving-retro -->`

**Anchor:** The section header `## The Bottom Line` (near end of file).

**Position:** Inserted IMMEDIATELY BEFORE the `## The Bottom Line` line.

**Inserted text:**

```markdown
## Recurring Feedback (AWM)

<!-- AWM-INTEGRATION: receiving-retro -->

If the SAME feedback item has appeared on a prior PR (check the last 5–10 merged PRs for matching language), do not just apply the fix this time — invoke the `harness-retro` skill.

Recurring review feedback means the human reviewer is acting as the harness for a class of issues the automated harness misses. `harness-retro` promotes the human-loop check into a sensor/test/rule so the reviewer's time goes to genuinely new things next round.

```

**Verify:**

```bash
grep -F 'AWM-INTEGRATION: receiving-retro' registry/skills/receiving-code-review/SKILL.md | wc -l
```
Expected: `1`
````

- [ ] **Step 7: Verify all five integration docs were created**

```bash
ls registry/skills/harness-retro/integrations/
```
Expected: `README.md`, `receiving-code-review.md`, `sdd-code-quality-reviewer.md`, `systematic-debugging.md`, `verification-before-completion.md` (5 files).

```bash
for f in registry/skills/harness-retro/integrations/*.md; do
  if [ "$(basename $f)" != "README.md" ]; then
    grep -F 'AWM-INTEGRATION:' "$f" | head -1 || echo "MISSING marker in $f"
  fi
done
```
Expected: 4 lines, each containing the appropriate marker.

- [ ] **Step 8: Commit**

```bash
git add registry/skills/harness-retro/integrations/
git commit -m "feat(skills): document harness-retro integration patches"
```

---

## Task 4: Apply integration to `verification-before-completion` registry skill

**Files:**
- Modify: `registry/skills/verification-before-completion/SKILL.md`

This task is verification-first: confirm the marker is absent, apply the edit, confirm it's present.

- [ ] **Step 1: Confirm marker is absent (pre-edit)**

```bash
grep -F 'AWM-INTEGRATION: verification-sensors' registry/skills/verification-before-completion/SKILL.md | wc -l
```
Expected: `0`. If `1`, the patch is already applied — skip to Step 4.

- [ ] **Step 2: Locate the anchor**

```bash
grep -n '^## The Bottom Line' registry/skills/verification-before-completion/SKILL.md
```
Expected: one line (e.g. `133:## The Bottom Line`). The patch goes immediately above it.

- [ ] **Step 3: Apply the patch via `Edit` tool**

Use the `Edit` tool on `registry/skills/verification-before-completion/SKILL.md` with:

- `old_string`: `## The Bottom Line`
- `new_string`:

```
## Sensor-based verification (AWM)

<!-- AWM-INTEGRATION: verification-sensors -->

If the repo has `.awm/sensors.json`, "done" requires sensor evidence in addition to test/build evidence.

**Before claiming done:**

```bash
awm sensors run --slow
```

- Exit 0 with `overall: pass` → sensors clean; proceed.
- Exit 1 with sensor failures → autocorrect using the LLM-formatted errors, re-run sensors, then claim done.

**Recurrence trigger:**

If the SAME sensor (same `name` + same `rule`) has failed in a prior session for this repo, do not just fix it — invoke the `harness-retro` skill. Recurring sensor failures mean the harness has a gap; `harness-retro` turns the recurrence into a structural rule.

## The Bottom Line
```

- [ ] **Step 4: Verify marker is present**

```bash
grep -F 'AWM-INTEGRATION: verification-sensors' registry/skills/verification-before-completion/SKILL.md | wc -l
```
Expected: `1`.

```bash
grep -nA2 'AWM-INTEGRATION: verification-sensors' registry/skills/verification-before-completion/SKILL.md
```
Expected: marker appears under `## Sensor-based verification (AWM)`, followed by content mentioning `awm sensors run --slow`.

- [ ] **Step 5: Sanity-check section count**

```bash
grep -c '^## ' registry/skills/verification-before-completion/SKILL.md
```
Original file had 10 `## ` headers; expected now: 11. If the count is off by more than +1, an existing section was accidentally overwritten — revert and retry.

- [ ] **Step 6: Commit**

```bash
git add registry/skills/verification-before-completion/SKILL.md
git commit -m "feat(skills): wire harness-retro into verification-before-completion"
```

---

## Task 5: Apply integration to `systematic-debugging` registry skill

**Files:**
- Modify: `registry/skills/systematic-debugging/SKILL.md`

- [ ] **Step 1: Confirm marker is absent**

```bash
grep -F 'AWM-INTEGRATION: debugging-retro' registry/skills/systematic-debugging/SKILL.md | wc -l
```
Expected: `0`.

- [ ] **Step 2: Locate the anchor**

```bash
grep -n '^## When Process Reveals' registry/skills/systematic-debugging/SKILL.md
```
Expected: one line (e.g. `267:## When Process Reveals "No Root Cause"`). The patch goes immediately above this line.

- [ ] **Step 3: Apply the patch via `Edit` tool**

Use the `Edit` tool on `registry/skills/systematic-debugging/SKILL.md` with:

- `old_string`: `## When Process Reveals "No Root Cause"`
- `new_string`:

```
## Phase 5: Pattern Recognition (AWM harness-retro)

<!-- AWM-INTEGRATION: debugging-retro -->

After the fix is verified, ask one question:

> "Have I debugged this same root cause before in this repo?"

Check `docs/harness-retros.md` (if it exists) and recent commit messages matching `harness-retro:` for prior instances. If you find one:

- **Yes, second occurrence** → invoke the `harness-retro` skill. The fix you just shipped is one sample; the rule from harness-retro turns it into a class.
- **No, first occurrence** → ship the regression test (Phase 4 Step 1 already covers this) and move on. Don't structuralize on a single sample.

This is what closes the loop between debugging and the harness. Without it, every recurrence costs a full debug cycle.

## When Process Reveals "No Root Cause"
```

- [ ] **Step 4: Verify marker is present**

```bash
grep -F 'AWM-INTEGRATION: debugging-retro' registry/skills/systematic-debugging/SKILL.md | wc -l
```
Expected: `1`.

```bash
grep -nA3 'AWM-INTEGRATION: debugging-retro' registry/skills/systematic-debugging/SKILL.md
```
Expected: marker under `## Phase 5: Pattern Recognition (AWM harness-retro)`, followed by content mentioning `harness-retros.md`.

- [ ] **Step 5: Sanity-check section count**

```bash
grep -c '^## ' registry/skills/systematic-debugging/SKILL.md
```
Original file had 11 `## ` headers; expected now: 12.

- [ ] **Step 6: Commit**

```bash
git add registry/skills/systematic-debugging/SKILL.md
git commit -m "feat(skills): wire harness-retro into systematic-debugging"
```

---

## Task 6: Apply integration to SDD `code-quality-reviewer-prompt` registry file

**Files:**
- Modify: `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`

- [ ] **Step 1: Confirm marker is absent**

```bash
grep -F 'AWM-INTEGRATION: reviewer-retro' registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md | wc -l
```
Expected: `0`.

- [ ] **Step 2: Locate the anchor**

```bash
grep -n 'focus on what this change contributed' registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md
```
Expected: one line. The full line is:
`- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)`

- [ ] **Step 3: Apply the patch via `Edit` tool**

Use the `Edit` tool with:

- `old_string`: `- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)`
- `new_string`:

```
- Did this implementation create new files that are already large, or significantly grow existing files? (Don't flag pre-existing file sizes — focus on what this change contributed.)
- **Systemic patterns:** Does the same flaw appear across ≥2 files in this change? If yes, name the pattern and recommend the orchestrator invoke the `harness-retro` skill after this review. Do NOT list every occurrence as a separate finding — name the pattern once and point to one example. <!-- AWM-INTEGRATION: reviewer-retro -->
```

- [ ] **Step 4: Verify marker is present**

```bash
grep -F 'AWM-INTEGRATION: reviewer-retro' registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md | wc -l
```
Expected: `1`.

```bash
grep -B1 -A1 'AWM-INTEGRATION: reviewer-retro' registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md
```
Expected: line containing marker mentions `Systemic patterns` and `harness-retro`.

- [ ] **Step 5: Commit**

```bash
git add registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md
git commit -m "feat(skills): wire harness-retro into code-quality-reviewer-prompt"
```

---

## Task 7: Apply integration to `receiving-code-review` registry skill

**Files:**
- Modify: `registry/skills/receiving-code-review/SKILL.md`

- [ ] **Step 1: Confirm marker is absent**

```bash
grep -F 'AWM-INTEGRATION: receiving-retro' registry/skills/receiving-code-review/SKILL.md | wc -l
```
Expected: `0`.

- [ ] **Step 2: Locate the anchor**

```bash
grep -n '^## The Bottom Line' registry/skills/receiving-code-review/SKILL.md
```
Expected: one line (e.g. `207:## The Bottom Line`). The patch goes immediately above it.

- [ ] **Step 3: Apply the patch via `Edit` tool**

Use the `Edit` tool on `registry/skills/receiving-code-review/SKILL.md` with:

- `old_string`: `## The Bottom Line`
- `new_string`:

```
## Recurring Feedback (AWM)

<!-- AWM-INTEGRATION: receiving-retro -->

If the SAME feedback item has appeared on a prior PR (check the last 5–10 merged PRs for matching language), do not just apply the fix this time — invoke the `harness-retro` skill.

Recurring review feedback means the human reviewer is acting as the harness for a class of issues the automated harness misses. `harness-retro` promotes the human-loop check into a sensor/test/rule so the reviewer's time goes to genuinely new things next round.

## The Bottom Line
```

- [ ] **Step 4: Verify marker is present**

```bash
grep -F 'AWM-INTEGRATION: receiving-retro' registry/skills/receiving-code-review/SKILL.md | wc -l
```
Expected: `1`.

```bash
grep -nA2 'AWM-INTEGRATION: receiving-retro' registry/skills/receiving-code-review/SKILL.md
```
Expected: marker under `## Recurring Feedback (AWM)`, content mentions `harness-retro` and "last 5–10 merged PRs".

- [ ] **Step 5: Sanity-check section count**

```bash
grep -c '^## ' registry/skills/receiving-code-review/SKILL.md
```
Original file had 14 `## ` headers; expected now: 15.

- [ ] **Step 6: Commit**

```bash
git add registry/skills/receiving-code-review/SKILL.md
git commit -m "feat(skills): wire harness-retro into receiving-code-review"
```

---

## Task 8: Final integration smoke test

This task verifies all four integrations are present in the registry, both new skills have valid frontmatter, and no regressions were introduced.

- [ ] **Step 1: Verify both new AWM skills exist and have valid frontmatter**

```bash
python3 -c "
import os
for skill in ['setup-sensors', 'harness-retro']:
    path = f'registry/skills/{skill}/SKILL.md'
    assert os.path.exists(path), f'MISSING: {path}'
    content = open(path).read()
    parts = content.split('---\n', 2)
    assert len(parts) >= 3, f'{path}: bad frontmatter'
    assert f'name: {skill}' in parts[1], f'{path}: name mismatch'
    print(f'OK {skill}: {len(parts[2])} body chars')
"
```
Expected: two `OK` lines, both with body length > 3000.

- [ ] **Step 2: Verify all four integrations are applied in the registry**

```bash
PASS=0; FAIL=0
check() {
  local file="$1"; local marker="$2"
  if grep -qF "AWM-INTEGRATION: $marker" "$file"; then
    echo "PASS: $marker in $file"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $marker missing from $file"
    FAIL=$((FAIL + 1))
  fi
}
check registry/skills/verification-before-completion/SKILL.md verification-sensors
check registry/skills/systematic-debugging/SKILL.md debugging-retro
check registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md reviewer-retro
check registry/skills/receiving-code-review/SKILL.md receiving-retro
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```
Expected: `Results: 4 passed, 0 failed`, exit 0.

- [ ] **Step 3: Verify patch record docs match applied markers**

```bash
PASS=0; FAIL=0
verify_doc_marker() {
  local doc="$1"; local target_file="$2"; local marker="$3"
  if grep -qF "$marker" "$doc" && grep -qF "$marker" "$target_file"; then
    echo "PASS: marker '$marker' consistent"
    PASS=$((PASS + 1))
  else
    echo "FAIL: marker '$marker' mismatch — doc=$doc target=$target_file"
    FAIL=$((FAIL + 1))
  fi
}
verify_doc_marker \
  registry/skills/harness-retro/integrations/verification-before-completion.md \
  registry/skills/verification-before-completion/SKILL.md \
  'AWM-INTEGRATION: verification-sensors'
verify_doc_marker \
  registry/skills/harness-retro/integrations/systematic-debugging.md \
  registry/skills/systematic-debugging/SKILL.md \
  'AWM-INTEGRATION: debugging-retro'
verify_doc_marker \
  registry/skills/harness-retro/integrations/sdd-code-quality-reviewer.md \
  registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md \
  'AWM-INTEGRATION: reviewer-retro'
verify_doc_marker \
  registry/skills/harness-retro/integrations/receiving-code-review.md \
  registry/skills/receiving-code-review/SKILL.md \
  'AWM-INTEGRATION: receiving-retro'
echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```
Expected: `Results: 4 passed, 0 failed`.

- [ ] **Step 4: Run existing Jest suite to confirm no regressions**

```bash
cd cli && npm test 2>&1 | tail -10
```
Expected: same pass count as before Plan 3 (the pre-existing `config.test.ts` failure unrelated to Plan 3 is acceptable; everything else must pass).

- [ ] **Step 5: Run the shell test from Plan 2 to confirm session-start hook still works**

```bash
bash cli/tests/hooks/test-session-start-constitution.sh
```
Expected: `Results: 9 passed, 0 failed`.

- [ ] **Step 6: Commit the plan completion marker**

```bash
git add docs/plans/2026-05-25-harness-engineering-plan-3.md
git commit -m "docs(plan): mark harness engineering plan 3 complete" --allow-empty
```

---

## Post-Implementation Checklist

- [ ] `registry/skills/setup-sensors/SKILL.md` exists, frontmatter valid, ≥6 `## ` sections, references `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`
- [ ] `registry/skills/harness-retro/SKILL.md` exists, frontmatter valid, contains the 4-branch remediation tree
- [ ] `registry/skills/harness-retro/integrations/` has README.md + 4 patch record docs
- [ ] All 4 AWM-INTEGRATION markers present in `registry/skills/<name>/SKILL.md` (or `code-quality-reviewer-prompt.md`)
- [ ] No existing sections in the modified registry skills were overwritten (section counts grew by exactly +1 each)
- [ ] Plan 2 shell test still green (`bash cli/tests/hooks/test-session-start-constitution.sh` → 9 passed)
- [ ] Jest suite has no NEW failures (pre-existing `config.test.ts` failure acceptable)
- [ ] All commits on `feature/harness-engineering-plan-3`; nothing pushed to `main`

---

## Notes for the executor

- **All changes are in the repo.** Unlike the original plan design, there are NO in-place edits to `~/.claude/skills/`. Everything goes into `registry/skills/`. The user runs `awm update` or reinstalls to push registry → `~/.claude/skills/`.
- **Subagent dispatch tip:** Tasks 4–7 are nearly identical in shape (verify-absent → locate-anchor → apply-edit → verify-present → sanity-check → commit). They can be dispatched in sequence with the same prompt template, swapping only the file path, marker, and anchor.
- **If a patch task fails verification:** the most likely cause is anchor text drift. Re-locate the anchor with `grep -n`, update the patch record doc to match, then retry. Commit the patch-doc fix as `fix(skills): update harness-retro anchor for <skill>`.
- **Don't push to main during execution.** Per `dev-workflow-rules` memory: `main` is release-only. Everything stays on `feature/harness-engineering-plan-3` until the user explicitly says "publica" / "release" / "merge to main".
- **`code-quality-reviewer` is not a standalone skill.** It is the prompt template at `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`. Task 6 patches that file specifically.
- **The `harness-retros.md` log** referenced in Task 2 step 9 is created on first use by the `harness-retro` skill itself, not during this plan.
