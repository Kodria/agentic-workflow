---
name: setup-sensors
version: "1.0.0"
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

### 7. Re-run sensor status

```bash
awm sensors status
```

Every DEGRADED sensor you touched should now report HEALTHY. If any are still DEGRADED, re-read the status output for the specific failure reason and iterate (return to step 3 for that sensor).

### 8. Run sensors end-to-end

```bash
awm sensors run --all
```

Expected: each sensor either passes or fails with LLM-friendly output (lines starting with `SENSOR[<type>]`). If any sensor crashes (non-zero exit with stderr noise), the config is still wrong — iterate.

### 9. Commit

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
