# Production readiness — consolidated findings

**Date:** 2026-08-08
**Source:** four independent audits (regression/back-compat · provider×command matrix · security/robustness · maintainability), each verified empirically against the built binary in isolated `HOME`/`AWM_HOME` tmpdirs.
**Status:** 2 of 4 blockers closed. This document is the durable backlog for the rest.

> Every finding below was reproduced **with the test suite green** (158 suites / 1608 tests). That is itself the headline: the fixtures encode the same wrong assumptions as the code. Coverage is 82% and it did not catch any of this.

---

## The dominant root cause

Most blockers are one class, not many:

> **The provider capability model is *declared* but not *consistently consumed*.**

`providers/index.ts` declares each provider's capabilities (`skill.global: string | null`, `renderer`, `hooks?`, `injection?`). The step/writer layer mostly honours them. The **reader** layers — diagnostics, reconciliation, removal — re-derive the same facts by hand, and disagree.

Concretely, "what filename does renderer R produce" exists in **three** divergent places and is **absent** from a fourth that needs it. "Does this provider have hooks" is answered correctly in two places and wrongly in a third.

This is the same shape as the two bugs already fixed this cycle (`awm init -a copilot` crashing, four frontmatter parsers). Fixing the instances without collapsing the class means writing this document again in a month.

**The structural fix that closes most of it:** a single `RENDERERS` table keyed by `RendererId` carrying `{ extension, render, verify }`, plus an explicit `applicable: boolean` on capability facts — so a reader can distinguish *"missing"* from *"not applicable"*. That one change makes the F5/F6/F1 family unable to recur, and turns "add a 7th provider" into a localized edit.

---

## Closed

| ID | Severity | Finding |
|---|---|---|
| **SEC-2** | blocker | **Command injection in `awm sensors status` / `awm preflight`.** `resolveOnPath` interpolated a sensor's `cmd` token into a shell. `git clone <untrusted repo> && awm sensors status` executed arbitrary code and reported HEALTHY. Fixed: PATH resolved in-process, no shell anywhere. |
| **SEC-1** | blocker | **Path traversal from registry content.** Artifact names from `bundle.json` escaped the install directory; the installer's recursive delete then destroyed `~/.ssh`. Fixed: name validation at entry + containment assertion on the resolved path. |

---

## Open — blockers

### B1 · `awm update` and `awm add` die for every provider when Copilot is enabled
`core/reconciliation.ts:82`, `core/bundle-install.ts:84` — both hardcode `scope: 'global'`; `physicalTarget` throws for a provider whose `skill.global` is `null`.

```
awm init -a claude-code -y && awm init -a copilot -y && awm update
→ Artifact reconciliation failed: skill global scope is not supported by Copilot   exit=1
```

The command dies **before** hook re-sync, so *every other provider on that machine* stops receiving updates. There is no command to un-enable an agent, and `awm doctor` reports healthy. R7 explicitly invited users into this state by fixing `awm init -a copilot`.

**Fix:** skip global-only artifacts for providers without global scope, or degrade to local (their own `globalUnsupportedReason` says "must be installed per-project"). Same guard `assertCompleteSharedGroup` already has.

### B2 · `awm init` exits 1 for four of six providers
`core/diagnostics/checks.ts:34` emits `machine.hook: missing` whenever `hook.present` is false — but `init/steps.ts:187` correctly *skips* the step for providers with no hook mechanism, and `provider-checks.ts:194` correctly *drops* the row. Three readers of `provider.hooks`, one wrong.

`awm init --machine-only` exits **1** for opencode, antigravity, cursor, copilot with **zero failed steps**, printing a remedy (`awm init`) that can never satisfy it. A bootstrap script under `set -euo pipefail` aborts after a fully successful init.

**Fix:** `applicable: boolean` on the fact, computed where `providerFor(agent)` is in scope; emit nothing when not applicable.

### B3 · Cursor/Copilot and Codex overwrite each other's `AGENTS.md` block
`managed-block.ts` supports one managed slot per file; both Cursor/Copilot's `inject()` and Codex's `injectProject()` target `<projectRoot>/AGENTS.md`. Whoever ran last wins.

For **Copilot that file is its only delivery channel** — a Codex init silently leaves Copilot with zero context. `awm doctor` shows ⚠ but reports `status: healthy`, exit 0 (`'stale'` is excluded from `DEGRADING_PROVIDER_STATES`).

### B4 · `awm remove` bypasses every safety mechanism the install path built
`planRemoval` (which implements the shared-ownership rule) is **dead code**. The real path is `provider-artifacts.ts::scanLegacyArtifacts`, which:
- keys on bare `name` across all types → selecting `deploy.md` deletes both a workflow and an unrelated agent;
- resolves local scope against `process.cwd()`, not the project root → finds nothing from a subdirectory, and hands `fs.rmSync` a **relative** path when it does;
- lists the whole directory → offers to delete skills the user hand-wrote;
- has no ownership check on the directory shared by OpenCode and Codex;
- swallows renderer errors → is a permanent no-op for cursor/copilot skills.

`src/index.ts` (703 lines, containing this flow) has **0% test coverage** — the highest-blast-radius untested code in the repo.

---

## Open — important

| ID | Finding |
|---|---|
| **I1** | **Rendered-skill filenames break every state check.** `physicalTarget` writes `<name>.mdc` / `.instructions.md`; three readers in `diagnostics/context.ts` look for the bare `<name>`. Result: `awm init` is **never idempotent** for Cursor/Copilot (full baseline reinstall + 2 unpruned backup dirs *per run*), and `doctor` shows a permanent red whose remedy can never succeed. The sibling three lines below *does* handle the extension. |
| **I2** | Same class for **agent** artifacts: `installName` is `<a>.md` but the reader maps `codex-agent-toml → .toml : n`. Breaks `machine.devCore` for **claude-code** (the default provider) against the **real** registry. |
| **I3** | **`awm add --all` and the picker hard-fail** for cursor, copilot **and** codex — `assertLinkRenderer` throws "not implemented yet" although the render pipeline supports all three. For codex it's collateral: skills install fine, one agent artifact kills the run. |
| **I4** | **Copilot silently gets zero skills** and everything reports healthy. `stepDevCore` is skipped (correct: no global scope) but nothing falls back to a local install, and there is **no `skills.local` check for any provider** — so no surface anywhere reveals it. |
| **I5** | **`awm update` never regenerates `managed-agents-md` context** (codex, cursor, copilot) — `regenerate.ts:25` only handles `config-instructions`. Silent no-op; only `awm init` fixes it. |
| **I6** | **AWM gitignores `.cursor/rules/` and `.github/instructions/`** — the two directories that must be committed for the team to receive anything. It also gitignores the `awm.mdc` carrier written specifically so context survives Cursor's Background Agent. One-line fix: skip non-`link` renderers. |
| **I7** | **`sensors/install.ts` clobbers `~/.claude/settings.json`** on malformed JSON (`catch { return {} }` then writes it back) — verified destroying `model`, `permissions`, and AWM's own hook. The sibling writer refuses correctly. Three writers of that file, three hardening levels. |
| **I8** | **`skill-integrity.ts:57` deletes then fails to recreate links on Windows** — uses `'dir'` (needs privilege) instead of `'junction'`, with no fallback, after already `rmSync`-ing. And `resyncClaudeHookFiles` has no copy fallback, so `awm update` fails **forever** on Windows without Developer Mode. |
| **I9** | **Unvalidated `JSON.parse` on registry content** (`bundles.ts:45,61`) — one malformed `bundle.json` in any registry makes `awm list`/`awm add` exit with a raw stack trace. Some shapes silently return `[]`, making a registry's bundles vanish without a word. |
| **I10** | **`awm pin base <v>` is a silent no-op** (registry is named `baseline`) — and it is the documented escape from a `minCliVersion` wedge. Reports success, changes nothing. |
| **I11** | **Rollback leaves files behind** outside a project root: `AGENTS.md` and `.awm/context/` survive a rolled-back init, while the output claims every path was restored. |
| **I12** | **`awm doctor` exits 1 with `✖ native agents` and no remedy** for any registry shipping no `agents/` — a degrading state with no remediation code. |
| **I13** | R3's `FALLBACK_DEFAULTS` removal **silently empties the Python sensor manifest** against a registry without a `python` pack (pinned or stale). Quality gate goes from four sensors to zero; preflight flips to exit 1. |
| **I14** | R3's shell detection makes **`awm sensors run` rewrite a committed `sensors.json`**, add a `shellcheck` dependency, and flip a green harness to `not_certified` — with no `awm sensors init` involved. |
| **I15** | **Project-scope broken symlinks are never healed, pruned, or reported.** The healing path exists for global scope and simply isn't wired to `update`/`sync`. |
| **I16** | **Backup transaction IDs collide** (1 ms resolution, no uniqueness) — the second transaction overwrites the first's manifest, making the earlier backup unrestorable and `awm backup restore` restore the wrong target. |
| **I17** | **Multi-bundle installs are not atomic**: one transaction per extension in a loop; a failure midway leaves earlier ones installed and the transaction ids never reach the caller, so the user cannot name them to `awm backup restore`. |

---

## Open — minor

`.md` stripping has three implementations, one unanchored (`discovery.ts` turns `a.mdb.md` into `ab.md`) · `savePreferences` reimplements atomic write, losing the symlink guard · `registries.ts` resolves `awmHome()` at require time, contradicting the call-time rule in `paths.ts` · `provider-version.ts` hardcodes "Codex" in the regex and all error strings · `awm init` installs only the *first* baseline bundle while `awm update` reconciles all · Antigravity's workflows are installed and never verified by any diagnostic · `awm watch --provider` accepts any string, failing later · the managed `AGENTS.md` block embeds raw `---` frontmatter fences · `compareSemver` returns `NaN` on malformed input and the version gate **fails open**.

---

## Recommended order

1. **B1** — `awm update` is the command everyone runs. It is broken machine-wide today.
2. **B2** — one `applicable` flag; unblocks `awm init` for four providers and any CI using it.
3. **I1 + I2 + I6** — the Cursor/Copilot experience is currently: never idempotent, permanently red, and artifacts gitignored so teammates get nothing.
4. **B4** — data loss.
5. **I7 + I8** — destroys user config; breaks `awm update` permanently on Windows.
6. **The `RENDERERS` table** — after which I1/I2/I3 cannot recur, and a 7th provider is a localized edit.
7. Everything else, by the table above.

## Two structural guards to add

Following the pattern already proven by `tests/structural/exec-invocation-explicit-stdio.test.ts` (written after the same bug recurred five times, and the best test in the repo):

- no `fs.symlinkSync` outside the single `linkOrCopy` primitive;
- no `RendererId` literal switched on outside the renderer table.

## What could not be verified here

This is a Linux box with **no agent binary installed**. Unverified, and **not** to be read as working: whether Cursor actually loads a `.mdc` with `alwaysApply: false`; whether Copilot honours `applyTo: "**"`; whether Antigravity reads `global_workflows/`; the Codex hook trust transition; every Windows-specific fallback path; the interactive pickers; `awm backup restore` end to end; and real network registry sync.

Those are exactly what the [acceptance playbooks](../testing/README.md) exist to cover.
