---
schema: awm.change-record/v1
id: 2026-10-19-frontmatter-hardening
title: Harden frontmatter parsing against ReDoS, ---x close, and YAML slug divergence
summary_short: Linear comment strip, exact --- closer, YAML-typed process slugs, and bounded diagnostics for untrusted registry SKILL.md input (#225/#226).
type: fix
scope: frontmatter
semver: patch
breaking: false
modules:
  - .
  - cli/src/core
  - cli/tests/core
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-10-19-frontmatter-hardening-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/225
verification:
  commit: 9e280b3d4e65b42f17622e9941515e10f5597095
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:595ce1683ec34e08a98bff8c5515d815d4d97752b8e9f6812183281d3517f93a
manual_validation:
  - step: "Con la versión publicada, un SKILL.md cuyo description plano tiene 80000 espacios sin #"
    expected: "discovery lo resuelve en menos de 50 ms (no segundos)"
  - step: "Un frontmatter con una línea '---x: 1' antes del cierre real '---'"
    expected: "matchFrontmatterBlock conserva las claves posteriores al ---x"
  - step: "awm process con name: null (o 0x1f / 1e5) vs name entrecomillado demo-ok o null"
    expected: "rechaza los bare YAML non-string y acepta los strings entrecomillados validos como slug"
risks:
  - "Process models that relied on bare YAML non-string tokens as slug text (name: null) now reject; quote them."
  - "Oversized or alias-bearing process-model frontmatter fails closed with size/invalid diagnostics."
rollback: "Revert the merge commit of this change; republish the previous agentic-workflow-manager patch if already released."
---

## Qué se hizo

Se endureció el borde registry → CLI para frontmatter no confiable (#225, #226): strip lineal de comentarios en description, cierre solo en línea exacta `---`, slugs de process-model tipados vía js-yaml con guardas de alias/tamaño, y topes de allocation/problemas en el parser de modelos.

## Qué se probó

Suites focalizadas `frontmatter-hardening`, `frontmatter-description-vs-yaml` y `process/model` (223 tests) en verde; `awm sensors run` overall pass (lint, typecheck, depcheck) con receipt en `9e280b3d`; Track A/B QA post-fix limpios tras enmiendas.

## Qué falta validar

Los tres criterios de aceptación del plan contra la versión publicada en npm tras el release (timing de description hostil, conservación tras `---x`, rechazo/aceptación de slugs YAML).

## Riesgos y rollback

Riesgo bajo de rechazo de modelos con tokens YAML crudos usados como slug; rollback = revert del merge y republicar el patch anterior si ya salió a npm.
