---
schema: awm.change-record/v1
id: 2026-10-20-issue-231-packselection-doctor
title: Preserve packSelection in status and align doctor release needs (#231)
summary_short: Status/preflight keep packSelection for explicit-opt-in sensors; wait-npm guard matches the three-job release gate so published-doctor-evidence can pass.
type: fix
scope: ci
semver: patch
breaking: false
modules:
  - .
  - .github/scripts
  - cli
  - cli/src/commands
  - cli/tests/commands
  - docs/plans
links:
  plan: docs/plans/2026-10-19-issue-231-packselection-doctor-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/231
verification:
  commit: 2794ac1ec3a5a8a9cf2616446563bb89ebc0fa40
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:57c43dd117ad5733de3d58aed3a69d06e802de3c33b3e312625d47e493c45813
manual_validation:
  - step: "Con un manifiesto que tiene packSelection: \"explicit\" y un sensor explicit-opt-in inicializado (format/prettier)"
    expected: "awm sensors status (y preflight) reportan ese sensor ok, sin compatibility drift / not-applicable"
  - step: "Tras el próximo release que publique a npm"
    expected: "published-doctor-evidence pasa Verify publication visibility guard (wait-npm test 7) con needs de tres jobs"
risks:
  - "Projects that relied on status falsely marking explicit-opt-in sensors as not-applicable will now see them applicable when packSelection is explicit (intended)."
  - "If release.yml adds another gating job later, both RELEASE_GATE and wait-npm test 7 must update together."
rollback: "Revert the merge commit of this change; republish the previous agentic-workflow-manager patch if already released."
---

## Qué se hizo

Se corrigieron los dos defectos confirmados de #231: `packBoundOnly` ahora conserva `packSelection: "explicit"` para que status/preflight no inventen drift en sensores `explicit-opt-in`, y el test 7 de `wait-npm-publication` compara el `needs` del job `release` por membresía (tres jobs) en vez de la regex de dos jobs que quedó stale tras #228.

## Qué se probó

Suite `status.test.ts` (26) en verde, incluida la regresión packSelection/explicit-opt-in (RED→GREEN); `npm run test:wait-npm-publication` 7/7; `native-release-artifacts` 10/10; typecheck y lint verdes; `awm sensors run` overall pass con receipt en `2794ac1e`; Track A/B QA PASS sin blockers.

## Qué falta validar

Los dos criterios de aceptación del plan en el entorno publicado: status/preflight con `packSelection` explícito tras instalar el patch, y el job `published-doctor-evidence` en el próximo release real (no se re-disparó doctor para 9.20.2/9.20.3 en este PR).

## Riesgos y rollback

Riesgo bajo de cambio de semántica status/run alineada (antes divergían). Rollback = revert del merge; si el patch ya salió a npm, republicar el anterior.
