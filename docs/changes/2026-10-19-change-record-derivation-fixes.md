---
schema: awm.change-record/v1
id: 2026-10-19-change-record-derivation-fixes
title: "The Change Record derives type and scope from the change, not the plan, and resolves the base against the remote"
summary_short: "El Change Record ya no toma type ni scope de los commits del plan, y la base por defecto prefiere origin/main a un main local desactualizado, así changes list deja de decir que el repo no adoptó Change Records."
type: fix
scope: changes
semver: patch
breaking: false
modules:
  - cli/src/commands
  - cli/src/core
  - cli/tests/commands
  - cli/tests/core
  - docs
  - docs/plans
links:
  plan: docs/plans/2026-10-19-change-record-derivation-fixes-plan.md
  issue: https://github.com/Kodria/agentic-workflow/issues/222
verification:
  commit: 03266cc27650c4c8312bffee292d2df87d2c05b0
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:20167cd4bb0b662241047e24a60dbf7803a73d73dc0d71433f5f4b9890549f1c
manual_validation:
  - step: "Con la versión publicada, en un clon de agentic-workflow sin origin/HEAD (git remote set-head origin -d) y con el main local atrasado, correr awm changes list --format voice"
    expected: "Lista los Change Records de origin/main; no dice que el repo todavía no usa Change Records"
  - step: "Con la versión publicada, en una rama cuyo primer commit es docs(plans) y el resto son ci(release), correr awm sensors run y awm change new prueba"
    expected: "El registro dice type: ci y scope: release"
risks:
  - "Una rama cuyo Change Record se creó con el CLI 9.20.1 y que tiene commits que solo tocan docs/plans/ falla change validate con derived-mismatch al actualizar; se corrige con awm change new <slug> --refresh. Los records ya mergeados no se revalidan"
  - "change new y change validate ahora saltan una base por defecto sin historia común con HEAD (por ejemplo un origin/main shallow); changes list sigue tomando la primera que existe, así que en ese caso los dos comandos pueden mostrar bases distintas"
  - "Si los commits de código no son conventional, type y scope siguen saliendo de los commits del plan; no se inventa un tipo"
rollback: "Revertir el commit de merge del PR. No hay estado persistente; los records creados con esta versión pueden necesitar awm change new <slug> --refresh tras el rollback."
---

## Qué se hizo

- La base por defecto de `awm change new`, `awm change validate` y `awm changes list` es ahora `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`. Antes, sin `origin/HEAD`, se caía a un `main` local que podía estar muy atrasado y `changes list` respondía que el repo no usaba Change Records.
- Solo cuenta una base por defecto cuyo ref exacto existe: un tag llamado `main` o `refs/heads/main` ya no puede ocupar su lugar. `main`/`master` se resuelven como `refs/heads/*` y se siguen mostrando por su nombre corto. Un `--base` explícito sigue siendo el único candidato.
- `change new` y `change validate` saltan una base por defecto que no comparte historia con HEAD (un `origin/main` shallow), y calculan el merge base desde el commit ya resuelto.
- Los commits que solo tocan `docs/plans/` (el plan, sus enmiendas y marcas) ya no eligen `type` ni `scope`; siguen contando para `semver` y `breaking`. Si todos los commits conventional son del plan, se usan todos, como antes.
- El texto de ayuda de `--base` se construye desde la lista de candidatos. `docs/cli-reference.md` y la enmienda del diseño (`docs/plans/2026-10-17-change-record-design.md`) describen las reglas nuevas.

## Qué se probó

- Tests del Change Record (`tests/core/changes`, `tests/commands/change`, `tests/commands/changes`) más los estructurales: 54 suites, 2069 tests en verde. Typecheck y `awm sensors run` en `pass`.
- Revisión de especificación y de calidad por rebanada, revisión final de la rama y QA con Track A y las lentes de robustez, lógica y tests, con dos reverificaciones independientes. Cada hallazgo de tests se cerró con un mutante que antes sobrevivía y ahora falla, probado en un worktree aparte.
- Tests de comando: `change new` sobre una rama con la forma de #228 escribe `type: ci` y `scope: release`, y sin `origin/HEAD`, con un `main` local atrasado, deriva contra `origin/main`.
- Con el binario construido en este clon (sin `origin/HEAD`, `main` local en v9.19.0), `changes list --format voice` lista los dos Change Records de `origin/main`; el 9.20.1 publicado responde «todavía no usa Change Records».
- Este mismo registro se generó con el CLI de la rama: deriva `fix` / `changes` / `patch`; con las reglas anteriores el scope habría salido `plans`.

## Qué falta validar

- Instalar la versión publicada y, en un clon sin `origin/HEAD` con el `main` local atrasado, confirmar que `awm changes list --format voice` lista los Change Records.
- En una rama con un primer commit `docs(plans)` y commits `ci(release)`, confirmar que `awm change new` escribe `type: ci` y `scope: release`.

## Riesgos y rollback

- Un Change Record creado con 9.20.1 en una rama todavía abierta, con commits del plan, falla `change validate` con `derived-mismatch` tras actualizar; el remedio es `awm change new <slug> --refresh`. Los records ya mergeados no se revalidan.
- En un clon con `origin/main` shallow sin conexión con HEAD, `change new`/`validate` usan el `main` local y `changes list` usa `origin/main`.
- Commits de código no conventional: `type` y `scope` salen de los commits del plan (no se inventa un tipo).
- Rollback: revertir el merge del PR. No hay estado persistente.
