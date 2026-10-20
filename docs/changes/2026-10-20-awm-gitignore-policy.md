---
schema: awm.change-record/v1
id: 2026-10-20-awm-gitignore-policy
title: Canonical .awm/ versioning via managed gitignore block (#218)
summary_short: Managed .gitignore allowlist (D-024) from sensors/watch init, with blocking doctor and preflight checks that propose remedies.
type: feat
scope: awm-gitignore
semver: minor
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
  plan: docs/plans/2026-10-20-awm-gitignore-policy-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/218
verification:
  commit: 14378a4e30862cc468618e98f9c9d50a860fa0ad
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:32c8927cda3f5d734075d557eed3f1ac0e3f3e1384592143f8ad4d7183e3f250
manual_validation:
  - step: "En un repo git, correr awm sensors init o awm watch init"
    expected: ".gitignore contiene el bloque # AWM:GITIGNORE con sensors/baseline/profile/context-budget/context/index versionables y runtime ignorado"
  - step: "Trackear .awm/journal o ignorar sensors.json con .awm/ bare, luego awm preflight y awm doctor"
    expected: "Ambos fallan (blocking) y el remedio menciona regenerar el bloque y/o git rm --cached"
  - step: "Abrir docs/decisions.md D-024"
    expected: "Listas versionada y local documentadas"
risks:
  - "Repos with a bare .awm/ ignore will see preflight/doctor degraded until they re-run sensors init or watch init (intended)."
  - "Tracked journal/ledger must be removed from the index with git rm --cached; the CLI proposes that but does not run it."
rollback: "Revert the merge commit of this change; restore prior .gitignore allowlist if needed."
---

## Qué se hizo

Se implementó la política D-024 (#218): helper `awm-gitignore` con bloque marcado, writers en `sensors init` y `watch init`, checks blocking en doctor y preflight con remedio, migración de este repo al bloque, y lección en AGENTS.md.

## Qué se probó

Suites focalizadas awm-gitignore (core, sensors init, watch init, diagnostics, preflight) 14 tests en verde; typecheck/lint; `awm sensors run` overall pass con receipt en `14378a4e`; Track A PASS; Track B findings corregidos (bloque incompleto, wiring sensors/doctor).

## Qué falta validar

Los tres criterios de aceptación del plan contra el CLI publicado tras el release (init escribe el bloque; preflight/doctor blocking con remedio; D-024 en el tree publicado).

## Riesgos y rollback

Proyectos con `.awm/` bare quedan degraded hasta regenerar el bloque. Rollback = revert del merge.
