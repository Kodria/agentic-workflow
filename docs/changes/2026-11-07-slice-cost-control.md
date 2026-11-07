---
schema: awm.change-record/v1
id: 2026-11-07-slice-cost-control
title: Slice cost control CLI — sliceCommand, scoped cache, evidence run/verify, ledger defer
summary_short: CLI ships structured sliceCommand with conditional --base, scoped⟂full cache isolation, MechanicalRunEvidence (evidence run/verify), and ledger deferred resolve-by-id for #246.
type: feat
scope: sensors
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
  commit: c99d50da8dbf335f10b7337ce2807745e4bc9481
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:57d922677f00f86fedb270021fc3605b686fed62a1073440d135da021589c60c
manual_validation:
  - step: "From a clean clone of this branch, build CLI (npm --prefix cli run build) and run node cli/dist/src/index.js sensors run --slice with no sliceCommand in the project pack"
    expected: "Bare closureOnly sensors skip as in 9.22.x; command does not fail solely for missing --base"
  - step: "Add a temporary closureOnly sensor with structured sliceCommand+fileInput; run --slice without --base, then with --base <sha> after touching matching files"
    expected: "Without base that sensor is non-pass naming missing base; with base argv includes scoped files; empty extension filter is skipped not pass"
  - step: "After a scoped pass with inputs, run a full-gate sensors run on the same sensor"
    expected: "Full gate does not report cached true from the scoped entry; second identical full run may hit full cache when inputs unchanged"
  - step: "node cli/dist/src/index.js evidence run -- printf ok then evidence verify <receipt> -- printf ok and again without expected argv"
    expected: "With argv match; omit argv mismatch fail-closed"
  - step: "ledger add two deferred entries with the same signature; resolve --id the first; list --deferred-open"
    expected: "Distinct ids; first resolved; second still listed open"
  - step: "Delete a tracked .ts then run sensors --changed (and a sliceCommand run with --slice --base)"
    expected: "Deleted path is absent from tool argv; slice digest/diagnostics may still account for the delete"
  - step: "evidence run with --paths covering a glob; add a new matching file; evidence verify with expected argv"
    expected: "mismatch with scope reason (declared set drifted), not a false match"
risks:
  - "Published npm is still 9.22.2 until this lands and publishes; registry skills must wait for minCliVersion bump (companion plan)."
  - "Project-declared sliceCommand cache plans attach measurements but remain non-cacheable without live tool versions (documented in D-026)."
rollback: "Revert this branch merge commit (or git revert the merge) and republish the previous CLI tag; discard .awm/evidence/runs receipts and deferred ledger resolve lines written only by the new commands."
---

## Qué se hizo

Shipped CLI support for #246 slice cost control without reopening Spine #126: optional variant/project `sliceCommand` (structured, `fileInput` required), `--slice` that stays bare-compatible and requires `--base` only when executing `sliceCommand`, scoped⟂full result-cache isolation, `awm evidence run`/`verify` for MechanicalRunEvidence (distinct from CycleEvidenceV1), and ledger deferred/`resolve --id`/`--deferred-open`. Documented in `docs/cli-reference.md` and D-026. Post-review hardening (A1–A6): deletes stay out of tool argv (digest/diagnostics only), verify re-expands declared scope, large files stream-hash, slice path content in scoped digests, project slice cachePlan wiring, HOME+AWM_HOME redirected in fixtures with save/restore (not delete) matching `run-read-only`. Windows CI: `filterPathsInsidePackageRoot` realpaths via `toSafeRepoRel` so native gitRoot vs packageRoot cannot false-throw on `--changed`; evidence RF-3.4 test generates large stdout in-child (no 50k argv) and sync spawn failures seal as exit 127. Registry skills/packs (RF-E.3, pack schema teaching) remain a companion after npm publish.

## Qué se probó

- Compact S1–S6 with TDD + independent spec/quality reviews; plan P7/P8 amendments; QA Track A/B with fix rounds; external audit A1–A6 closed with RED/GREEN suites; re-audit residual A6 (env restore) fixed.
- Related suites after review fixes + Windows containment + evidence RF-3.4 argv fix: sensors/evidence suites green; prepare/run-cache still pass; `tsc --noEmit` clean.
- `awm sensors run` full gate → `overall: pass` (lint/typecheck/depcheck) with receipt on commit `c99d50da`.
- Built `cli/dist` smoke for `evidence`/`ledger`/`sensors` help surfaces against operator docs.

## Qué falta validar

- Manual acceptance steps above against the built binary on a throwaway repo (PATH `awm` remains 9.22.2 until publish).
- Registry companion plan after npm: `minCliVersion`, pack `sliceCommand` teaching, RF-E.3 QA fail-closed on deferred-open.

## Riesgos y rollback

Scoped cache and MechanicalRunEvidence are new persistence under `.awm/`; they are self-ignored (0600) and must not be committed. Rollback is revert+republish; consumers pinning an unreleased CLI from this branch should unpin. Deleted paths are intentionally omitted from argv so tools like eslint do not see gone files.
