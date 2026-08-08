# Production readiness — consolidated findings

**Date:** 2026-08-08
**Source:** four independent audits (regression/back-compat · provider×command matrix · security/robustness · maintainability), each verified empirically against the built binary in isolated `HOME`/`AWM_HOME` tmpdirs.
**Status:** all 4 blockers closed, plus both security blockers and 8 of the importants. Remaining open items are listed below.

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

## Still open — important

(I1, I2, I3, I5, I6, I7, I8, I9 and I10 are closed — see above.)

| ID | Finding |
|---|---|
| **I4** | **Copilot silently gets zero skills** and everything reports healthy. `stepDevCore` is skipped (correct: no global scope) but nothing falls back to a local install, and there is **no `skills.local` check for any provider** — so no surface anywhere reveals it. |
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

## Recommended order for what remains

1. **I4** — Copilot installs nothing and every surface reports healthy. Add a `skills.local` check so at least one thing tells the truth.
2. **I13 + I14** — the sensor gate silently emptying, and `awm sensors run` rewriting a committed file, both undermine the one mechanism that cannot be talked past.
3. **I16 + I17** — backup IDs collide and multi-bundle installs are not atomic; both weaken the rollback story the whole design leans on.
4. **I11, I12, I15** — honesty of rollback, remedies and project-scope healing.
5. Minors, by the paragraph above.
6. **Two structural guards** (below) — these are what stop the closed items from coming back.

## Two structural guards to add

Following the pattern already proven by `tests/structural/exec-invocation-explicit-stdio.test.ts` (written after the same bug recurred five times, and the best test in the repo):

- no `fs.symlinkSync` outside the single `linkOrCopy` primitive;
- no `RendererId` literal switched on outside the renderer table.

## What could not be verified here

This is a Linux box with **no agent binary installed**. Unverified, and **not** to be read as working: whether Cursor actually loads a `.mdc` with `alwaysApply: false`; whether Copilot honours `applyTo: "**"`; whether Antigravity reads `global_workflows/`; the Codex hook trust transition; every Windows-specific fallback path; the interactive pickers; `awm backup restore` end to end; and real network registry sync.

Those are exactly what the [acceptance playbooks](../testing/README.md) exist to cover.
