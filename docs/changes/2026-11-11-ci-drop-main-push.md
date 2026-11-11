---
schema: awm.change-record/v1
id: 2026-11-11-ci-drop-main-push
title: "CI: ci.yml solo en pull_request (#244)"
summary_short: "Quita el push a main de ci.yml y agrega concurrency cancel-in-progress; release.yml sigue siendo el unico gate post-merge."
type: fix
scope: ci
semver: patch
breaking: false
modules:
  - .github/workflows
  - cli/tests/structural
  - docs/plans
links:
  plan: docs/plans/2026-11-11-ci-drop-main-push-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/244
verification:
  commit: 0b67c66a0ad5c815b91d76185197697b1682485c
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:2425aa8cf673cc421dbf118e6532634c3f12288b5d15b43fca096b5e37c02462
manual_validation:
  - step: "Mergear un PR a main y abrir Actions"
    expected: "Corre release; no hay corrida nueva de ci por el push a main"
  - step: "Abrir o actualizar un PR con dos pushes seguidos"
    expected: "ci corre completo; el segundo push cancela la corrida anterior"
  - step: "Abrir la corrida de release tras el merge si hay otra en vuelo"
    expected: "Hace fila (cancel-in-progress false)"
risks:
  - "Un PR con required check ci sigue dependiendo del ultimo push; cancelar no marca verde la corrida cancelada"
rollback: "Restaurar en ci.yml el bloque push a main y quitar el bloque concurrency; revertir el commit del pin estructural si hace falta."
---

## Qué se hizo

- `ci.yml` dispara solo en `pull_request` (sin `push` a `main`).
- Concurrency `ci-${{ github.ref }}` con `cancel-in-progress: true` en corridas de PR.
- `release.yml` sin cambios: sigue probando en cada push a `main` sin cancelar.
- Pin estructural `cli/tests/structural/ci-pr-only-triggers.test.ts` (RF-1.1–RF-1.3).

## Qué se probó

- `npm --prefix cli test -- --runInBand --silent tests/structural/ci-pr-only-triggers.test.ts` → 3/3 pass (RED→GREEN en S1).
- `awm sensors run --slice --base e89d414c…` y `awm sensors run` full → overall pass.
- Spec + quality + final + Track A/B QA → compliant/approved/pass.

## Qué falta validar

- Tras merge: confirmar en Actions que el push a `main` no dispara `ci` y sí dispara `release`.
- En un PR activo: confirmar que un push nuevo cancela la corrida `ci` anterior.

## Riesgos y rollback

- Riesgo bajo: main queda cubierto por `release.yml` en cada push (sin paths-ignore).
- Rollback: revertir el cambio de triggers/concurrency en `ci.yml` (y el pin si se desea).
