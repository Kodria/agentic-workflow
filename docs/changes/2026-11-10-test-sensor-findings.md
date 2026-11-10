---
schema: awm.change-record/v1
id: 2026-11-10-test-sensor-findings
title: Test sensor per-failure findings for baseline ratchet
summary_short: File-first Jest/JUnit results under coverage/ emit stable per-test findings so awm sensors baseline ratchets legacy failures without stale-artifact false greens.
type: feat
scope: sensors
semver: minor
breaking: false
modules:
  - .
  - cli/src/commands
  - cli/tests/commands
  - cli/tests/structural
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-11-10-test-sensor-findings-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/248
verification:
  commit: eec70aba64e30600deae296fd6af7d62e427a863
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:580b2a18d6c2485e3fc47583075e4227addbd23918436c70c05a2a19e90cce1a
manual_validation:
  - step: In a throwaway repo, run Jest with two known failures writing coverage/awm-test-results.json; awm sensors baseline; confirm both fingerprints accepted; add a third failing test; confirm gate fails only on the new fingerprint; remove it and confirm pass.
    expected: Baseline ratchets the two legacy failures; only the new failure fails the gate; without it, overall pass.
  - step: Pre-seed a baselined results file, run a non-zero test command that does not rewrite the artifact after clear.
    expected: Sensor fails with failureKind exit-code; never pass on the stale baselined artifact.
  - step: Force unlink failure (or leave identity unchanged) with exit ≠0.
    expected: exit-code failure; never pass.
  - step: Jest JSON with truthy coverageMap and baselined assertion failures vs the same without coverageMap.
    expected: coverageMap → exit-code (baseline cannot pass); without coverageMap → findings-mode may pass after baseline.
  - step: Admit with verify-sensors while coverage/ is gitignored and holds no tracked files; confirm readOnly pre-clear under coverage does not mutate .awm.
    expected: Admit sensors pass observation; no .awm mutation from pre-clear.
risks:
  - Operators who point resultsFile at arbitrary project files no longer get unconditional pre-clear unlink (safe basename / exclusion-name policy); freshness then depends on the runner rewriting the file.
  - Packs still do not write the artifact; projects that never wire --json/--junitxml stay on synthetic exit-code and need the re-baseline advisory after wiring.
rollback: Revert this branch's commits (or restore the prior CLI release). Remove optional resultsFile overrides and coverage/awm-test-results.* writers from project sensor commands if added during adoption.
---

## Qué se hizo

The `test` sensor can consume a structured results artifact (defaults `coverage/awm-test-results.json` then `.xml`, or `resultsFile`) with contained pre-clear, identity-snapshot freshness, and Jest/JUnit parsers that emit one finding per failed test (`sensor|file|rule`). Unexplained non-zero exits (including Jest `coverageMap`, runtime/interrupt, stale/unlink-fail) stay authoritative `exit-code`. Status/run/baseline emit a non-blocking re-baseline advisory when the test baseline is empty or synthetic-only; on `sensors run` that advisory goes to **stderr only** so stdout stays a single parseable JSON document. Operator docs cover defaults, pack override, and admit/`coverage/` caveats.

## Qué se probó

- CMD-PARSERS / CMD-INTERPRET / CMD-ADVISORY-DOCS Jest suites (formatters, result-test-findings, results-file, advisory, docs example parse, preflight kind filter) — pass
- `npm --prefix cli run typecheck` — pass
- Per-slice `awm sensors run --slice` during SDD — overall pass
- Full `awm sensors run` at Change Record verification commit — overall pass (lint/typecheck/depcheck)
- Post-implementation QA Track A/B with fix loop (arbitrary unlink, JUnit depth, vacuous JSON preference, reserved read, priorIdentities fail-closed, prepare formatter default, RF amendments) — closed
- Impl audit I1/I2: `index.test.ts` (incl. stdout-JSON-vs-stderr advisory kill-RED) + typecheck — pass; I3 RF-1.2 prefer-findings already matched design

## Qué falta validar

- Manual acceptance criteria above on a real project with a wired Jest/JUnit writer and an existing baseline debt set
- Confirm pack-bound installs that override only the test script (no registry pack command change) produce ratchetable fingerprints in CI

## Riesgos y rollback

See frontmatter `risks` and `rollback`. Prefer defaults under gitignored `coverage/`; do not combine `--coverage` thresholds on the same test sensor command used for the ratchet.
