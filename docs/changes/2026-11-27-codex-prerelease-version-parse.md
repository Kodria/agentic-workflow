---
schema: awm.change-record/v1
id: 2026-11-27-codex-prerelease-version-parse
title: Accept Codex prerelease and build version suffixes in awm init
summary_short: Codex versionPattern now accepts optional semver prerelease and build suffixes so awm init no longer fails with could not parse on lines like codex-cli 0.172.0-alpha.2; the core X.Y.Z still gates the minimum.
type: fix
scope: cli
semver: patch
breaking: false
modules:
  - .
  - cli
  - cli/src/providers
  - cli/tests/core
  - cli/tests/providers
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-11-27-issue-254-codex-prerelease-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/254
verification:
  commit: 2847d10165bfc87c260e6b523f5ed0377d8c8e57
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:2f4abdf73e3bd958e11fc98e9ca8e17e42fc8696a7f00a4c9ca761a3d1b3eaeb
manual_validation:
  - step: "With codex-cli 0.172.0-alpha.2 on PATH, run awm init -a codex (or assertProviderSupported path)."
    expected: "Succeeds without could not parse Codex version; version gate uses core 0.172.0."
  - step: "Force a below-floor line such as codex-cli 0.144.9-alpha.1."
    expected: "Rejects with requires Codex >= 0.145.0."
  - step: "Feed unrecognized Codex --version shapes (v-prefix, trailing tokens)."
    expected: "Still could not parse Codex version."
risks:
  - "Core-only floor (P1): 0.145.0-beta.1 passes >= 0.145.0 even though strict semver ranks prerelease older than that stable; owner accepted."
  - "Doctor/display may show the bare core for an alpha install (P2 out of scope)."
rollback: "Revert this branch's commits (or restore the prior CLI release). Codex pattern returns to /^codex-cli (\\d+\\.\\d+\\.\\d+)$/."
---

## Qué se hizo

Widened Codex `versionPattern` in `cli/src/providers/index.ts` to optional `-prerelease` and `+build` suffixes while keeping capture group 1 as the core triple for `compareSemver`. Updated provider-version and providers/index tests (accepts alpha/build; rejects under-floor and empty suffixes). Noted acceptance in `docs/agents-setup.md`. Hardened Jest with default `AWM_NO_UPDATE_CHECK=1` so CLI-spawned tests do not race the npm update worker when the branch lags latest.

## Qué se probó

- CMD-PROVIDER-VERSION / CMD-PROVIDERS-INDEX (TDD RED→GREEN; 31 + 18 after kills) — pass
- `npm --prefix cli run typecheck` — pass
- Track A fidelity + Track B robustness QA — CLEAN
- Full `awm sensors run` at verification commit `2847d101` — overall pass
- `awm plan validate` after audit amend — valid

## Qué falta validar

- Manual `awm init -a codex` on a host with real `codex-cli 0.172.0-alpha.2`
- Optional P2: surface full prerelease string in doctor (not this change)

## Riesgos y rollback

See frontmatter `risks` and `rollback`. Do not re-anchor `$` immediately after `X.Y.Z` without a design amendment.
