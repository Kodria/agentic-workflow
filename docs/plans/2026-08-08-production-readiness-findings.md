# Production readiness — consolidated findings

**Date:** 2026-08-08
**Source:** four independent audits (regression/back-compat · provider×command matrix · security/robustness · maintainability), each verified empirically against the built binary in isolated `HOME`/`AWM_HOME` tmpdirs.
**Status:** closed. Both security blockers, all 4 functional blockers, all 17 importants, and every minor. Both structural guards are in place. The only items left open are the ones no Linux box can settle — see *What could not be verified here*.

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

## Closed — blockers

| ID | Finding | How it was verified |
|---|---|---|
| **B1** | `awm update`/`awm add` died for every provider when Copilot was enabled — `assertCompleteSharedGroup`'s inner filter had the guard, the line above it did not. | `awm update` now exits 0 with claude-code + copilot both enabled; an explicit `-a copilot -s global` still fails with its explanation. |
| **B2** | `awm init` exited 1 for four of six providers with zero failed steps. | `--machine-only` now exits 0 for all but codex, which correctly exits 2 without its binary. |
| **B3** | Cursor/Copilot and Codex overwrote each other's `AGENTS.md` block (140 → 6 → 140 lines). | Rich content now survives in either init order. |
| **B4** | `awm remove` collapsed same-name artifacts across types, resolved local paths against cwd, offered the user's own files, and was a no-op for rendered artifacts. | Ownership ledger cross-check + type-keyed map + explicit project root. |

Closed importants: **I1, I2** (renderer filenames — one table, idempotency restored), **I3** (`add --all` routed through the real pipeline), **I5** (`update` regenerates managed-agents-md context), **I6** (gitignore only covers link artifacts), **I7** (settings.json no longer clobbered), **I8** (Windows junction + stage-before-remove, resync copy fallback), **I9** (registry JSON validated), **I10** (`awm pin base` reaches the key the resolver reads). `stale` now counts as degrading, so an out-of-date context is visible to a CI exit code.

## Closed — important

(All of I1–I17. The ones closed in the first pass are listed in the paragraph above.)

| ID | Finding | How it was closed |
|---|---|---|
| **I4** | Copilot silently got zero skills and every surface reported healthy. | The devCore fact is computed against the local dir for a provider with no global one, and `stepDevCore` installs there with `scopeOverride: 'local'`. |
| **I11** | Rollback left `AGENTS.md` and `.awm/context/` behind while claiming a clean restore. | Two situations were being read as one. Writing into an unmarked cwd is legitimate — Copilot has no other channel — so `mutation-targets` now enumerates those paths unconditionally for local-scope providers, which is where the hole actually was. `--machine-only` is the case that must not write at all, and it now skips explicitly instead of inheriting the null-project branch. |
| **I12** | `awm doctor` exited 1 with `✖ native agents` and no remedy. | Nothing to verify emits no row, rather than a red one with no action. |
| **I13** | `awm sensors init` silently wrote an empty manifest for a pack the registry does not ship. | Auto-detection now validates against the registry like `--pack` always did, falls back to a pack that exists, and names the missing one at both call sites. `defaultActions.initSensors` was projecting the result down to `detection` alone, so the field would have died in the wrapper. |
| **I14** | `awm sensors run` rewrote a committed `sensors.json` and copied pack config files into the repo. | The rebuild is gone; the drift is reported (`packDrift`) and `awm sensors init` remains the only thing that adopts a pack. `run.ts` no longer imports anything that can write. |
| **I15** | Project-scope broken symlinks were never healed, pruned, or reported. | `classifyGlobalSkills`/`repairGlobalSkills` were always scope-agnostic — the name was the bug. Renamed, plus `reconcileProjectSkillLinks`, wired into `awm sync` before the no-extensions early return, and a `project.orphans` row in doctor. |
| **I16** | Backup transaction IDs collided at 1 ms resolution. | Unique ids; the earlier backup stays restorable. |
| **I17** | Multi-bundle installs were not atomic and their transaction ids never reached the caller. | `syncProfile` builds ONE plan for the whole sync instead of one transaction per extension, so a failure on the third leaves nothing installed. `awm sync` and `awm add` now print the transaction id with the `awm backup restore` invocation that uses it. |

## Closed — minor

Every item from the paragraph that used to be here:

- `.md` stripping anchored (`a.mdb.md` no longer becomes `ab.md`).
- `savePreferences` routed through `writeFileAtomic` — the local copy had drifted below the shared primitive.
- `registries.ts` resolves `awmHome()` at call time; `REGISTRIES_DIR`/`REGISTRIES_CONFIG_PATH` are now `registriesDir()`/`registriesConfigPath()`. It was the only module contradicting the call-time rule in `paths.ts`.
- `provider-version.ts` no longer hardcodes "Codex" in messages or in the parse regex — the pattern moved into `versionCommand.versionPattern`, so the second provider to declare one will not report Codex's absence when its own binary is missing.
- `awm init` installs **every** baseline bundle, matching what `awm update` reconciles; the diagnostic that decides whether the baseline is satisfied was changed with it, since it had the same `find`.
- Antigravity's global workflows have a `workflows.global` check — it was the one provider using them and nothing verified them.
- `awm watch --provider` is validated at the CLI boundary instead of at the first supervisor tick, with the journal already written.
- `compareSemver` throws on malformed input; the registry gate fails **closed** and the update notice fails silent. All six callers were audited.

One item surfaced by the structural guards rather than the audits: three `fs.symlinkSync` call sites passed no type argument, leaving Node to infer it. All now say `'file'`.

---

---

## Two structural guards — added

Following the pattern already proven by `tests/structural/exec-invocation-explicit-stdio.test.ts` (written after the same bug recurred five times, and the best test in the repo). Both were verified the only way a structural guard can be: by reintroducing the shape they forbid and watching them go red.

- `tests/structural/symlink-type-is-explicit.test.ts` — every `fs.symlinkSync` passes an explicit type argument or has a visible copy fallback. It found a live site on its first run.
- `tests/structural/renderer-table-is-single-source.test.ts` — no source file outside `core/renderers/registry.ts` maps a renderer id to a file extension, and the surviving table covers every declared `RendererId`. It found a **fourth** copy of the mapping, in `provider-checks.ts`, still alive after the first three were collapsed.

## What could not be verified here

This is a Linux box with **no agent binary installed**. Unverified, and **not** to be read as working: whether Cursor actually loads a `.mdc` with `alwaysApply: false`; whether Copilot honours `applyTo: "**"`; whether Antigravity reads `global_workflows/`; the Codex hook trust transition; every Windows-specific fallback path; the interactive pickers; `awm backup restore` end to end; and real network registry sync.

Those are exactly what the [acceptance playbooks](../testing/README.md) exist to cover.
