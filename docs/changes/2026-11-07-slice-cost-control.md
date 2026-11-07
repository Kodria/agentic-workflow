---
schema: awm.change-record/v1
id: 2026-11-07-slice-cost-control
title: Slice cost control CLI — sliceCommand, scoped cache, evidence run/verify, ledger defer
summary_short: CLI ships structured sliceCommand with conditional --base, scoped⟂full cache isolation, MechanicalRunEvidence (evidence run/verify), and ledger deferred resolve-by-id for #246.
type: feat
scope: evidence
semver: minor
breaking: false
modules:
  - .
  - cli/src/commands
  - cli/src/core
  - cli/tests/commands
  - cli/tests/core
  - cli/tests/structural
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-11-06-slice-cost-control-cli-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/246
verification:
  commit: a30380b50aab662e493dcb11e3a076c0ccf2210b
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:5ab5a36db7331005e11232ba60d72299fc4110c8dfe75e77e3908e7dfa800e85
manual_validation:
  - step: From a clean clone of this branch, build CLI (`npm --prefix cli run build`) and run `node cli/dist/src/index.js sensors run --slice` with no sliceCommand in the project pack
    expected: Bare closureOnly sensors skip as in 9.22.x; command does not fail solely for missing --base
  - step: Add a temporary closureOnly sensor with structured sliceCommand+fileInput; run `--slice` without `--base`, then with `--base <sha>` after touching matching files
    expected: Without base → that sensor non-pass naming missing base; with base → argv includes scoped files; empty extension filter → skipped not pass
  - step: After a scoped pass with inputs, run a full-gate `sensors run` on the same sensor
    expected: Full gate does not report cached:true from the scoped entry; second identical full run may hit full cache when inputs unchanged
  - step: `node cli/dist/src/index.js evidence run -- printf ok` then `evidence verify <receipt> -- printf ok` and again without expected argv
    expected: With argv → match; omit argv → mismatch fail-closed
  - step: `ledger add` two deferred entries with the same signature; `resolve --id` the first; `list --deferred-open`
    expected: Distinct ids; first resolved; second still listed open
risks:
  - Published npm is still 9.22.2 until this lands and publishes; registry skills must wait for minCliVersion bump (companion plan).
  - Projects that relied on undocumented --diff-filter=d omission of deletes now see deleted paths in --changed/--slice scope (RF-1.8); argv may grow for delete-heavy diffs.
rollback: Revert this branch's merge commit (or `git revert` the merge) and republish the previous CLI tag; discard any `.awm/evidence/runs/` receipts and deferred ledger resolve lines written only by the new commands.
---

## Qué se hizo

Shipped CLI support for #246 slice cost control without reopening Spine #126: optional variant/project `sliceCommand` (structured, `fileInput` required), `--slice` that stays bare-compatible and requires `--base` only when executing `sliceCommand`, scoped⟂full result-cache isolation, `awm evidence run`/`verify` for MechanicalRunEvidence (distinct from CycleEvidenceV1), and ledger deferred/`resolve --id`/`--deferred-open`. Documented in `docs/cli-reference.md` and D-026. Registry skills/packs (RF-E.3, pack schema teaching) remain a companion after npm publish.

## Qué se probó

- Compact S1–S6 with TDD + independent spec/quality reviews; plan P7 amendment for verify expected argv; QA Track A/B with fix rounds through A6/B1/B2 residuals.
- Closure CMD suite (schema, slice, scoped-cache, evidence, ledger, docs, typecheck): 96 tests pass at HEAD.
- `awm sensors run` full gate → `overall: pass` (lint/typecheck/depcheck) with receipt on commit `a30380b5`.
- Built `cli/dist` smoke for `evidence`/`ledger`/`sensors` help surfaces against operator docs.

## Qué falta validar

- Manual acceptance steps above against the built binary on a throwaway repo (PATH `awm` remains 9.22.2 until publish).
- Registry companion plan after npm: `minCliVersion`, pack `sliceCommand` teaching, RF-E.3 QA fail-closed on deferred-open.

## Riesgos y rollback

Scoped cache and MechanicalRunEvidence are new persistence under `.awm/`; they are self-ignored (0600) and must not be committed. Rollback is revert+republish; consumers pinning an unreleased CLI from this branch should unpin. Delete-path inclusion in changed/slice scope is intentional per RF-1.8 — watch sensors that expand large delete sets into argv.
