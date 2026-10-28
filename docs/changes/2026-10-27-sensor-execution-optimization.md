---
schema: awm.change-record/v1
id: 2026-10-27-sensor-execution-optimization
title: Sensor execution optimization — inputs cache, --slice, schema-2 receipts
summary_short: Digests and fingerprint cache skip unchanged sensors; --slice skips closureOnly; schema-2 receipts relax late paths only when every sensor declares inputs.
type: feat
scope: sensors
semver: minor
breaking: false
modules:
  - .
  - .awm
  - cli
  - cli/src/commands
  - cli/src/core
  - cli/src/types
  - cli/tests/commands
  - cli/tests/core
  - cli/tests/structural
  - docs
  - docs/guides
  - docs/plans
links:
  plan: docs/plans/2026-10-27-sensor-execution-optimization-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/236
verification:
  commit: b87ceae5ae7566e68048f70d5865122d61003085
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:56b1b4860e6028caeaeb4a22efda3ab309437e842da098f6ce214110feda7014
manual_validation:
  - step: Run `awm sensors run --slice` on a project with mutation marked closureOnly and confirm mutation is skipped while test/lint/typecheck still run
    expected: overall reflects non-closure sensors; mutation status skipped with explicit reason; no Change Record receipt for --slice
  - step: After a full-gate pass with project `inputs` on every sensor, edit only a README and run full-gate again
    expected: cacheable sensors may hit cache; schema-2 validate allows the docs-only advance only when every sensor had authored inputs (else schema-1 late rules apply)
  - step: Confirm `awm sensors status` and preflight show a non-blocking warning for enabled sensors without inputs
    expected: warning text mentions not cacheable / no effective inputs; exit code remains success
risks:
  - Incomplete authored `inputs` can false-green a cache hit; mitigation is conservative pack defaults, preflight warnings, and setup-sensors teaching (registry companion)
  - Stock packs leave `test` without inputs, so RF-4.5 unmeasured relaxation does not apply until projects override
rollback: Revert this branch / publish prior CLI version; registry must not raise minCliVersion until a parsing CLI is published (companion plan waits on npm).
---

## Qué se hizo

Implemented CLI-side sensor execution optimization for #236: declarative `inputs` and sensor-level `closureOnly` parsing; git+picomatch input digests with fingerprint cache (`failureKind`, live versions, `useCache`); `--slice` / `--no-cache`; receipt schema 2 with late-path validate (RF-4.5/4.6); status/preflight warnings; CLI docs and D-025. Pack/skill rollout remains in awm-baseline-registry companion plan after npm publish.

## Qué se probó

Per-slice RED/GREEN (S1–S5) with dual reviews; closure suites 12 files / 361+ tests and typecheck green; post-implementation QA Track A/B with important fixes (measurements without live versions, cache raw hardening); `awm sensors run` overall pass on clean HEAD `b87ceae5` with receipt written; structural docs/decision contracts green.

## Qué falta validar

Registry companion (#79): extension-bound pack defaults, skill phase gates, `minCliVersion` + CLI re-certification after this CLI is on npm. Manual smoke of `--slice` vs mutation `closureOnly` on a real mutmut project. Confirm docs-only Change Record path after project overrides give every sensor `inputs`.

## Riesgos y rollback

Risks: false-green from incomplete `inputs`; schema-1 late rules until overrides. Rollback: revert/publish prior CLI; do not ship pack fields before matching `minCliVersion`/`certifiedCli`.
