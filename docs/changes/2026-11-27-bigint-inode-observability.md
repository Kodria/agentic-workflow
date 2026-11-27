---
schema: awm.change-record/v1
id: 2026-11-27-bigint-inode-observability
title: Accept high-bit bigint inodes and stop Number FS identity compares
summary_short: POSIX FS identity now uses BigInt.asUintN observability and bigint ino/dev compares, so Codex Cloud high-bit inodes stop failing as unobservable and distinct near-2^63 inodes no longer collide as Number.
type: fix
scope: cli
semver: patch
breaking: false
modules:
  - .
  - cli/src/commands
  - cli/src/core
  - cli/tests/commands
  - cli/tests/core
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-11-27-issue-252-bigint-inode-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/252
verification:
  commit: d2e74c1bf32d51762d837a24ad9f007f105478b9
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:13c134d231e2aabe7dd6bbe85c73735cd690efeed6bd5d8c267f0e9f09295bf1
manual_validation:
  - step: "On a host where fs.lstatSync(path, { bigint: true }).ino is negative from the high bit (e.g. Codex Cloud /workspace), run awm registry add … --no-install and skill discovery against that tree."
    expected: "No directory identity is unobservable; registry clones and skills are discovered."
  - step: "Force or observe an inode of 0n on a parent/leaf under discovery or same-path checks."
    expected: Still rejected as identity unobservable / unavailable.
  - step: "Inspect digests built as `${dev.toString()}:${ino.toString()}` for a high-bit signed inode."
    expected: "Uses the raw signed BigInt string, not BigInt.asUintN(64, ino).toString()."
  - step: "Two distinct paths sharing dev with inodes 2^63+92 and 2^63+900 (or mocks of those BigInts) through sameExistingPath / isRootManifest."
    expected: Reported as different paths (no Number collision).
risks:
  - "Hosts or tests that still stub statSync/lstatSync without honoring { bigint: true } may see type errors or false negatives until mocks return bigint dev/ino."
  - "test-results-artifact still uses Number(ino) by design (fail-closed on collision); that path is out of this change's RF set."
  - "B3 Codex alpha rejection (codex-cli alpha vs stable) remains an open follow-up issue before closing #252."
rollback: "Revert this branch's commits (or restore the prior CLI release). Identity gates return to signed ino <= 0n / Number compares."
---

## Qué se hizo

Added `cli/src/core/fs-identity.ts` with `isObservableInode` (`BigInt.asUintN(64, ino) !== 0n`) and `inodeIdentityFragment` (raw `toString()`). Migrated discovery, registry-contracts, exec-wrapper, plan-validate, `sameExistingPath`, record-io, native-runtime, and request-recovery off signed inequality / Number `ino`/`dev` compares. Kill-tests cover high-bit acceptance, zero rejection, digest formatting, and Number-collision RED cases; QA tightened vacuous kills (mtime pin, same-dev dual `0n`). Docs/plan markers + AGENTS lesson + harness-retro entry.

## Qué se probó

- CMD-FS-IDENTITY / discovery / same-path / Number-identity Jest suites (incl. kill-RED after QA fixes) — pass
- `npm --prefix cli run typecheck` — pass
- `awm plan validate` after post-S1 locator amend — valid
- Post-implementation QA Track A/B fix loop (B1–B5 vacuous kills) — closed; `awm-qa-complete`
- Full `awm sensors run` at Change Record verification commit `d2e74c1b` — overall pass (lint/typecheck/depcheck)

## Qué falta validar

- Manual acceptance on a real high-bit host (Codex Cloud `/workspace`) for registry add + discovery
- Open B3 follow-up issue for `codex-cli` alpha rejection and link it before closing #252

## Riesgos y rollback

See frontmatter `risks` and `rollback`. Do not widen `test-results-artifact` Number(ino) without amending its RF; keep digests on raw signed BigInt strings.
