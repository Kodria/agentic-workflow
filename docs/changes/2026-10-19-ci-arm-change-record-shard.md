---
schema: awm.change-record/v1
id: 2026-10-19-ci-arm-change-record-shard
title: "Release gate: the Change Record suites run in their own Windows ARM shard"
summary_short: "Las suites del Change Record pasan a un tercer job de Windows ARM que corre en paralelo y bloquea el release, para bajar el camino crítico del gate de ~37 min a menos de 25; un test estructural fija la partición y los bypass del gate."
type: docs
scope: plans
semver: none
breaking: false
modules:
  - .github/workflows
  - cli/tests/structural
  - docs
  - docs/awm/context
  - docs/plans
links:
  plan: docs/plans/2026-10-19-ci-arm-change-record-shard-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/223
verification:
  commit: b0513e59c0df5396347cd288d22ffb9c870d976d
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:0dca4237d9c7783d0c7c4d2cb05437d396ca5d101a97eb036e8793226f9ae0f5
manual_validation:
  - step: "Mergear y abrir la corrida de release.yml de ese merge en GitHub Actions"
    expected: "Los jobs test (windows-11-arm, win32-arm64) y windows-arm-changes tardan menos de 25 min cada uno y release espera a los tres jobs de test"
  - step: "En la misma corrida, abrir el log de windows-arm-changes"
    expected: "Corre 23 suites de test y ninguna falla"
risks:
  - "Un tercer runner Windows ARM por corrida suma minutos de Actions aunque baje el tiempo de pared"
  - "Un directorio de tests nuevo del Change Record fuera de core/changes, commands/change o commands/changes corre en el remainder y no en el shard (no se pierde ni se duplica; solo no acelera)"
rollback: "Revertir el merge del PR: vuelve la partición de dos shards ARM y el test estructural anterior. No hay estado persistente."
---

## Qué se hizo

- `ci.yml` y `release.yml` suman el job `windows-arm-changes`, una copia de `windows-arm-hot` que corre solo las 23 suites de `cli/tests/core/changes/`, `cli/tests/commands/change/` y `cli/tests/commands/changes/`, con `--testPathPatterns`.
- El remainder ARM de la matriz excluye esas mismas suites. Cada archivo de test corre una sola vez en ARM: 355 en el remainder, 23 en el shard y 2 en `windows-arm-hot`, total 380.
- `release` declara `needs: [test, windows-arm-hot, windows-arm-changes]`. Rojo en cualquier plataforma o shard no publica.
- `native-release-artifacts.test.ts` valida el gate sobre los workflows cargados con js-yaml:
  - `release` no tiene `if` ni `continue-on-error`, y `needs` es exactamente ese conjunto, en cualquier orden;
  - ningún job ni step de test ni de los shards tiene `continue-on-error`;
  - los shards no tienen `if`;
  - la partición y sus patrones están fijados, también ante directorios que difieren solo en mayúsculas.
- D-005 describe los tres jobs de test y los tres shards ARM.
- Una ocurrencia más se sumó a la lección CTX-AGENTS-031: fijar YAML con regex no converge; hay que validarlo parseado.

## Qué se probó

- `tests/structural`: 31 suites, 147 tests en verde. `npm run typecheck` limpio.
- `awm sensors run`: overall pass (typecheck, lint, depcheck).
- `npx jest --listTests`: shard 23, remainder 355, hot 2, total 380. Los tres grupos no se solapan.
- Revisiones del slice (especificación y calidad), QA (fidelidad y robustez/tests) y tres verificaciones independientes. La última aplicó 175 mutaciones al YAML de los workflows: bypass con `if`/`continue-on-error` en cualquier forma de comillas, `needs` incompleto o duplicado, deriva de patrones y comentario quitado. Todas hicieron fallar el test, y las 6 permutaciones de `needs` quedaron en verde.

## Qué falta validar

- En la primera corrida de `release.yml` después del merge: `test (windows-11-arm, win32-arm64)` y `windows-arm-changes` por debajo de 25 min cada uno, y `release` esperando a los tres jobs de test.
- En esa corrida, `windows-arm-changes` ejecuta 23 suites y ninguna falla.

## Riesgos y rollback

- Hay un runner Windows ARM más por corrida: más minutos de Actions, menos tiempo de pared.
- Si un test nuevo del Change Record vive fuera de los tres directorios del shard, corre en el remainder. No se pierde ni se duplica, solo no acelera.
- Rollback: revertir el merge del PR. Vuelve la partición anterior y no hay estado persistente.
