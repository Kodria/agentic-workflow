---
schema: awm.change-record/v1
id: 2026-10-30-issue-240-readonly-tool-cache
title: Strip ESLint tool-cache argv under read-only admission
summary_short: Admission readOnly no longer fails on .eslintcache from eslint --cache; operator runs keep cache flags.
type: feat
scope: sensors
semver: minor
breaking: false
modules:
  - cli/src/commands
  - cli/tests/commands
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-10-30-issue-240-readonly-tool-cache-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/240
verification:
  commit: be219757095b7d02645c515b0536640112e9b7b1
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:ef00b2f7c6e89a5e00e1855fbeb8fdcc6daa8ba3940f644b50df30fb8cc447e8
manual_validation:
  - step: En un repo js-ts con lint --cache, borrar .eslintcache y correr awm plan admit … --verify-sensors en frío
    expected: No ADMISSION_SENSORS_BLOCKED por read-only-mutation-detected solo por .eslintcache
  - step: awm sensors run (sin readOnly) sobre el mismo manifiesto
    expected: ESLint sigue recibiendo --cache (operador)
  - step: Observar .awm/sensors/runs durante admit --verify-sensors
    expected: No se crean/leen cache-*.json nuevos por esa corrida (RF-2.11)
risks:
  - Packs o sensores con executable distinto de exactamente "eslint" no reciben el strip; un tool-cache en un path observado puede seguir bloqueando admit hasta ampliar la allowlist o el pack.
  - Legacy cmd string no se reescribe (R8); proyectos solo-legacy siguen expuestos a .eslintcache.
rollback: Revertir los commits de cli/src/commands/sensors/read-only-tool-cache.ts y el cableado en run.ts; republicar CLI. La documentación en docs/configuration.md y docs/cli-reference.md debe revertirse en el mismo cambio.
---

## Qué se hizo

- Helper `stripReadOnlyToolCacheArgs(executable, args)` que solo actúa cuando `executable === 'eslint'`: quita `--cache` / `--cache=<value>` y, si hubo enablement, `--cache-location` (+ operando) / `--cache-location=<path>`, sin tocar `--cache-strategy`.
- Cableado en `runPreparedSlot` bajo `readOnly` + comando structured, antes de `executePrepared`.
- Tests unitarios + integración mock + evidencia con binario real de eslint; cobertura de `--cache=true` (Track B).
- Docs de admisión read-only actualizadas; diseño/plan #240 y comentario de diagnóstico en el issue.

## Qué se probó

- `npm --prefix cli test -- --runInBand` sobre `read-only-tool-cache.test.ts` y `run-read-only-tool-cache.test.ts` (22 tests, incl. real eslint).
- Regresión RF-2.11 en `run-cache.test.ts`.
- `npm --prefix cli run typecheck` y `lint`.
- Track A fidelity CLEAN; Track B B1 corregido (`--cache=`).
- `awm sensors run` overall pass con receipt en HEAD de verificación.

## Qué falta validar

- Admit en frío en un proyecto externo con pack js-ts publicado (sin location) tras publicar esta CLI.
- Companion registry R4 (`--cache-location` en pack) en `awm-baseline-registry` (fuera de esta rama).

## Riesgos y rollback

Ver `risks` y `rollback` en el frontmatter.
