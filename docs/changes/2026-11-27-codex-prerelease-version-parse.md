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
  - cli/tests/commands
  - cli/tests/core
  - cli/tests/providers
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-11-27-issue-254-codex-prerelease-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/254
verification:
  commit: a32ace0097bb6d78d243545aad1cad86347cb69a
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:3abd6390b81d641d3f5bcae26a61a18319d700c6c55fe73cca21588f28551e20
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

Widened Codex `versionPattern` in `cli/src/providers/index.ts` to optional `-prerelease` and `+build` suffixes while keeping capture group 1 as the core triple for `compareSemver`. Updated provider-version and providers/index tests (accepts alpha/build; rejects under-floor and empty suffixes). Noted acceptance in `docs/agents-setup.md`. Hardened Jest with default `AWM_NO_UPDATE_CHECK=1` so CLI-spawned tests do not race the npm update worker when the branch lags latest; `plan/index.test.ts` (and peers that assert the banner) pass `AWM_NO_UPDATE_CHECK: ''` on the child env (#255 R1).

## Qué se probó

- CMD-PROVIDER-VERSION / CMD-PROVIDERS-INDEX (TDD RED→GREEN; 31 + 18 after kills) — pass
- `plan/index.test.ts` update-notification case with empty override — pass
- `npm --prefix cli run typecheck` — pass
- Track A fidelity + Track B robustness QA — CLEAN
- Full `awm sensors run` at verification commit `a32ace00` — overall pass
- `awm plan validate` after audit amend — valid

## Qué falta validar

- Manual `awm init -a codex` on a host with real `codex-cli 0.172.0-alpha.2`
- Optional P2: surface full prerelease string in doctor (not this change)

## Riesgos y rollback

See frontmatter `risks` and `rollback`. Do not re-anchor `$` immediately after `X.Y.Z` without a design amendment.
