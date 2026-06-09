# Harness Engineering — Plan 2: Feedforward Extension (CONSTITUTION.md)
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the SessionStart hook to inject `$PWD/CONSTITUTION.md` into every session, and add a `project-constitution` skill that generates this file from project context.

**Architecture:** The existing `registry/hooks/session-start` bash script reads `using-awm.md` and emits Claude Code's `additionalContext` JSON. We add ~7 lines to optionally append `CONSTITUTION.md` content from the current working directory. The new `project-constitution` skill is a SKILL.md document (no script — the agent uses its own Read/Glob/Bash tools) that walks the user section-by-section through generating `CONSTITUTION.md`.

**Tech Stack:** Bash 3.2+ (macOS default, no bash-isms beyond what session-start already uses), markdown skill document. Shell tests are plain bash with `mktemp -d` for isolation.

---

## File Map

**Create:**
- `cli/tests/hooks/test-session-start-constitution.sh` — automated shell test for hook extension
- `registry/skills/project-constitution/SKILL.md` — new skill that generates CONSTITUTION.md

**Modify:**
- `registry/hooks/session-start` — add CONSTITUTION.md injection block (after line 33, before `printf` at line 39)

---

## Background — the hook today

`registry/hooks/session-start` currently:
1. Resolves `AWM_HOOKS_ROOT` (env var override, else dir of script)
2. Reads `$AWM_HOOKS_ROOT/using-awm.md` (empty string if missing)
3. Escapes the content for JSON via `escape_for_json()` (handles `\`, `"`, `\n`, `\r`, `\t`)
4. Wraps with `<EXTREMELY_IMPORTANT>...</EXTREMELY_IMPORTANT>` envelope in `session_context`
5. Emits Claude Code JSON: `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "<context>" } }`

Our extension lives between step 4 and 5: if `$PWD/CONSTITUTION.md` exists and is non-empty, append `\\n\\n## Project Constitution\\n\\n<escaped content>` to `session_context`. The `\\n` is a literal backslash-n sequence in the bash string — when emitted into the JSON value via `printf '%s'`, the JSON parser converts it to a real newline. This is the same convention the existing script uses (see line 36).

---

## Task 1: Hook extension + shell test (TDD)

**Files:**
- Create: `cli/tests/hooks/test-session-start-constitution.sh`
- Modify: `registry/hooks/session-start` (insert block before line 39)

- [ ] **Step 1: Write the failing shell test**

Create `cli/tests/hooks/test-session-start-constitution.sh` with exactly this content (make it executable in Step 2):

```bash
#!/usr/bin/env bash
# Tests CONSTITUTION.md injection in registry/hooks/session-start
# Run with: bash cli/tests/hooks/test-session-start-constitution.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/../../../registry/hooks/session-start"

if [ ! -f "$HOOK" ]; then
    echo "ERROR: hook not found at $HOOK"
    exit 2
fi

PASS=0
FAIL=0

assert_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"
    if printf '%s' "$haystack" | grep -qF "$needle"; then
        echo "PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $name"
        echo "  Expected to find: $needle"
        echo "  Got: $haystack" | head -c 500
        echo ""
        FAIL=$((FAIL + 1))
    fi
}

assert_not_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"
    if printf '%s' "$haystack" | grep -qF "$needle"; then
        echo "FAIL: $name"
        echo "  Expected NOT to find: $needle"
        FAIL=$((FAIL + 1))
    else
        echo "PASS: $name"
        PASS=$((PASS + 1))
    fi
}

# Setup: three isolated temp dirs
TMP_WITH=$(mktemp -d)
TMP_WITHOUT=$(mktemp -d)
TMP_EMPTY=$(mktemp -d)
cleanup() { rm -rf "$TMP_WITH" "$TMP_WITHOUT" "$TMP_EMPTY"; }
trap cleanup EXIT

# Test 1: CONSTITUTION.md present and non-empty
cat > "$TMP_WITH/CONSTITUTION.md" << 'CONSTITUTION'
# Project Constitution

## Testing
- TDD always: write the failing test first.
CONSTITUTION
OUTPUT_WITH=$(cd "$TMP_WITH" && AWM_HOOKS_ROOT="$TMP_WITH" bash "$HOOK")
assert_contains "with constitution: emits JSON" "$OUTPUT_WITH" "additionalContext"
assert_contains "with constitution: includes header" "$OUTPUT_WITH" "Project Constitution"
assert_contains "with constitution: includes content" "$OUTPUT_WITH" "TDD always"
assert_contains "with constitution: still includes AWM envelope" "$OUTPUT_WITH" "You have AWM"

# Test 2: CONSTITUTION.md absent — behavior unchanged
OUTPUT_WITHOUT=$(cd "$TMP_WITHOUT" && AWM_HOOKS_ROOT="$TMP_WITHOUT" bash "$HOOK")
assert_contains "without constitution: emits JSON" "$OUTPUT_WITHOUT" "additionalContext"
assert_not_contains "without constitution: no constitution header" "$OUTPUT_WITHOUT" "Project Constitution"
assert_contains "without constitution: still includes AWM envelope" "$OUTPUT_WITHOUT" "You have AWM"

# Test 3: CONSTITUTION.md exists but empty — treated as absent
touch "$TMP_EMPTY/CONSTITUTION.md"
OUTPUT_EMPTY=$(cd "$TMP_EMPTY" && AWM_HOOKS_ROOT="$TMP_EMPTY" bash "$HOOK")
assert_contains "empty constitution: emits JSON" "$OUTPUT_EMPTY" "additionalContext"
assert_not_contains "empty constitution: no constitution header" "$OUTPUT_EMPTY" "Project Constitution"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 2: Make the test executable and run it — verify FAIL**

```bash
chmod +x cli/tests/hooks/test-session-start-constitution.sh
bash cli/tests/hooks/test-session-start-constitution.sh
```

Expected: 2 of the 9 assertions FAIL — specifically the two "with constitution" ones that check for the `Project Constitution` header and the `TDD always` content (the hook does not yet inject anything). The other 7 should already pass because (a) the JSON envelope is always emitted, (b) the `You have AWM` literal is hardcoded in the envelope regardless of whether `using-awm.md` is present, and (c) the absent/empty paths match current behavior.

- [ ] **Step 3: Modify `registry/hooks/session-start` — add CONSTITUTION.md injection**

Open `registry/hooks/session-start` and locate this region (around line 33-36):

```bash
using_awm_escaped=$(escape_for_json "$using_awm_content")

# Wrap with the imperative envelope.
session_context="<EXTREMELY_IMPORTANT>\nYou have AWM.\n\n**Below is the full content of your 'using-awm' skill — your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_awm_escaped}\n</EXTREMELY_IMPORTANT>"
```

Insert the following block AFTER the `session_context=...` assignment and BEFORE the `printf` emit (around line 38). Add a blank line above the block for readability:

```bash

# Inject CONSTITUTION.md from the project root if present and non-empty.
# Silent-in-absence: empty or missing file leaves session_context untouched.
CONSTITUTION_FILE="$PWD/CONSTITUTION.md"
if [ -s "$CONSTITUTION_FILE" ]; then
    constitution_content=$(cat "$CONSTITUTION_FILE")
    constitution_escaped=$(escape_for_json "$constitution_content")
    session_context="${session_context}\n\n## Project Constitution\n\n${constitution_escaped}"
fi
```

Note on the `\n` sequences: they are literal backslash-n (2 chars) in the bash double-quoted string. They get printed as-is into the JSON value via `printf '%s'` on line 39, and the JSON parser converts them to real newlines when Claude Code reads the hook output. This matches the convention already used on the line above.

The full file after the edit should look like:

```bash
#!/usr/bin/env bash
# SessionStart hook for AWM bootstrap.
# Reads ${AWM_HOOKS_ROOT}/using-awm.md and emits a Claude Code-compatible JSON.

set -euo pipefail

# Determine hooks root. Set via env var so tests can override.
# Defaults to the directory containing this script (assumes installed at ~/.awm/hooks/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AWM_HOOKS_ROOT="${AWM_HOOKS_ROOT:-$SCRIPT_DIR}"

SKILL_FILE="${AWM_HOOKS_ROOT}/using-awm.md"

# Failure-safe: missing skill produces empty context instead of crashing.
if [ -f "$SKILL_FILE" ]; then
    using_awm_content=$(cat "$SKILL_FILE")
else
    using_awm_content=""
fi

# Escape string for JSON via bash parameter substitution (orders of magnitude
# faster than character loops). Same approach as superpowers canon.
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_awm_escaped=$(escape_for_json "$using_awm_content")

# Wrap with the imperative envelope.
session_context="<EXTREMELY_IMPORTANT>\nYou have AWM.\n\n**Below is the full content of your 'using-awm' skill — your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_awm_escaped}\n</EXTREMELY_IMPORTANT>"

# Inject CONSTITUTION.md from the project root if present and non-empty.
# Silent-in-absence: empty or missing file leaves session_context untouched.
CONSTITUTION_FILE="$PWD/CONSTITUTION.md"
if [ -s "$CONSTITUTION_FILE" ]; then
    constitution_content=$(cat "$CONSTITUTION_FILE")
    constitution_escaped=$(escape_for_json "$constitution_content")
    session_context="${session_context}\n\n## Project Constitution\n\n${constitution_escaped}"
fi

# Emit Claude Code format using printf (avoids bash 5.3+ heredoc hang).
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"

exit 0
```

- [ ] **Step 4: Run the shell test — verify PASS**

```bash
bash cli/tests/hooks/test-session-start-constitution.sh
```

Expected: `Results: 9 passed, 0 failed` and exit code 0.

- [ ] **Step 5: Verify the JSON output is still valid (sanity check)**

```bash
# Run this from the repo root.
HOOK_ABS="$(pwd)/registry/hooks/session-start"
TMP=$(mktemp -d)
cat > "$TMP/CONSTITUTION.md" << 'EOF'
# Test

A "quoted" value with a \backslash and a newline.
EOF
(cd "$TMP" && AWM_HOOKS_ROOT="$TMP" bash "$HOOK_ABS") | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK length:', len(d['hookSpecificOutput']['additionalContext']))"
rm -rf "$TMP"
```

Expected: `OK length: <some number greater than 100>`. If `json.load` raises an exception, the escape logic is broken — debug before committing.

- [ ] **Step 6: Commit both files together**

```bash
git add registry/hooks/session-start cli/tests/hooks/test-session-start-constitution.sh
git commit -m "feat(hooks): inject CONSTITUTION.md from project root in session-start"
```

---

## Task 2: `project-constitution` skill

**Files:**
- Create: `registry/skills/project-constitution/SKILL.md`

No automated tests — this is a skill document (instructions for the agent). The validation is reading the file, confirming the frontmatter is well-formed, and that subsequent invocations of the skill produce a reasonable `CONSTITUTION.md`.

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p registry/skills/project-constitution
```

- [ ] **Step 2: Write the skill document**

Create `registry/skills/project-constitution/SKILL.md` with exactly this content:

````markdown
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
````

- [ ] **Step 3: Verify the frontmatter is valid**

Skill files use YAML frontmatter. Confirm the file parses cleanly:

```bash
python3 -c "
import sys
content = open('registry/skills/project-constitution/SKILL.md').read()
assert content.startswith('---\n'), 'must start with frontmatter delimiter'
parts = content.split('---\n', 2)
assert len(parts) >= 3, 'frontmatter must close with ---'
fm = parts[1]
assert 'name: project-constitution' in fm, 'name field missing'
assert 'description:' in fm, 'description field missing'
print('Frontmatter OK')
print('Body length:', len(parts[2]), 'chars')
"
```

Expected: `Frontmatter OK` followed by `Body length: <some number greater than 2000> chars`.

- [ ] **Step 4: Verify the skill follows the AWM skill conventions**

Compare structure against an existing skill (e.g. `registry/skills/using-awm/SKILL.md`). Confirm:

```bash
grep -c '^##' registry/skills/project-constitution/SKILL.md
```

Expected: a number ≥ 6 (Overview, When to use, When NOT to use, Checklist, The Process, Anti-patterns at minimum).

```bash
grep -F 'Announce at start' registry/skills/project-constitution/SKILL.md
```

Expected: one match (the announce instruction).

- [ ] **Step 5: Commit**

```bash
git add registry/skills/project-constitution/SKILL.md
git commit -m "feat(skills): add project-constitution skill"
```

---

## Post-Implementation Checklist

- [ ] `bash cli/tests/hooks/test-session-start-constitution.sh` returns 9 passed, 0 failed
- [ ] The session-start hook still works without CONSTITUTION.md (existing behavior preserved)
- [ ] `registry/skills/project-constitution/SKILL.md` has valid frontmatter and ≥ 6 sections
- [ ] Full Jest suite still green: `cd cli && npm test`
- [ ] Manual E2E (optional, see `cli/tests/integration/README.md`): drop a `CONSTITUTION.md` in a test project, start a Claude Code session, confirm the agent acknowledges the constitution rules

---

## Notes for Plan 3

Plan 2 closes the feedforward loop. Plan 3 adds the intelligent and steering layers:

- New skill `setup-sensors` — guided sensor configuration with Context7 (handles ESLint v8 vs v9, mypy vs ruff, etc.)
- New skill `harness-retro` — converts recurring bugs into sensor rules / structural tests / CONSTITUTION.md entries
- Modify `verification-before-completion` — call `awm sensors run --slow` before any "done" claim
- Modify `systematic-debugging`, `code-quality-reviewer`, `receiving-code-review` — propose `harness-retro` on recurring patterns

The output of the `project-constitution` skill (this plan) becomes one of the artifacts `harness-retro` can extend in Plan 3.
