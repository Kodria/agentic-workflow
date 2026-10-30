---
schema: awm.change-record/v1
id: 2026-10-30-wait-npm-windows-shards
title: Align the npm visibility guard with windows-shards
summary_short: published-doctor-evidence failed after publish because the wait-npm test still required the pre-#239 ARM jobs. It now matches release needs [test, windows-shards].
type: test
scope: ci
semver: none
breaking: false
modules:
  - .github/scripts
  - .github/workflows
  - docs
verification:
  commit: 24d4143178af1a46b3b6b4c36a94f7b00c84811a
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:bcaf49eee27341473ae4c7492840c73df161a9aebb4cd7ee37d40886aeb6592d
manual_validation:
  - step: "node --test .github/scripts/wait-npm-publication.test.cjs"
    expected: "7 tests pass, and test 7 accepts release needs [test, windows-shards] in any order"
  - step: "En el próximo release que publique de verdad (un commit feat/fix/perf bajo cli/)"
    expected: "published-doctor-evidence pasa Verify publication visibility guard en ubuntu, macos y windows"
risks:
  - "Si release.yml suma otro job de gate, hay que actualizar juntos RELEASE_GATE y el test 7; si no, doctor vuelve a fallar después de publicar."
  - "Este merge no publica (type test, y el commit no toca cli/). Las corridas 9.22.1 y 9.22.2 siguen rojas; el job doctor se vuelve a ejecutar en el próximo publish."
rollback: "Revertir el commit. No hay que republicar el paquete: el bump solo mira commits bajo cli/ y test no es un tipo releasable."
---

## Qué se hizo

El test 7 de `.github/scripts/wait-npm-publication.test.cjs` comparaba el `needs` del job `release` con `{test, windows-arm-changes, windows-arm-hot}`. Desde #239 `release.yml` declara `needs: [test, windows-shards]`, el mismo conjunto que `RELEASE_GATE` en `native-release-artifacts.test.ts`. El job `published-doctor-evidence` corre ese archivo después de publicar, así que 9.22.1 y 9.22.2 publicaron y después fallaron el paso "Verify publication visibility guard" en las tres plataformas.

La comparación sigue siendo por membresía (orden irrelevante) y no se aflojó el gate. `ci.yml` corre el mismo archivo en el job `test`, antes de publicar. D-005 deja de describir el costo actual como dos shards ARM dedicados.

## Qué se probó

`node --test .github/scripts/wait-npm-publication.test.cjs` 7/7. `npx jest tests/structural/native-release-artifacts.test.ts --runInBand` 10/10. `awm sensors run` overall pass con receipt en `24d41431`.

## Qué falta validar

El job `published-doctor-evidence` en el próximo release que publique a npm. Este cambio no dispara bump: el release solo cuenta commits bajo `cli/` y `test` no es releasable, así que el workflow del merge salta el doctor (`published != true`) en vez de re-ejecutarlo.

## Riesgos y rollback

El guard sigue siendo un segundo contrato sobre el mismo `needs`. Rollback = revert del commit; no hay versión de npm que deshacer.
