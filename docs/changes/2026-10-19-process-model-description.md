---
schema: awm.change-record/v1
id: 2026-10-19-process-model-description
title: "Process models can declare an optional description, validated as single-line YAML"
summary_short: "Los modelos de proceso (awm: process-model) aceptan un campo description opcional, así Codex carga esos skills; el CLI lo valida con un parser YAML real y rechaza las formas que un runtime leería distinto."
type: fix
scope: plans
semver: patch
breaking: false
modules:
  - cli/src/core
  - cli/tests/commands
  - cli/tests/core
  - cli/tests/structural
  - docs
  - docs/awm/context
  - docs/plans
links:
  plan: docs/plans/2026-10-18-process-model-description-plan.md
  issue: https://github.com/Kodria/awm-personal-registry/issues/3
verification:
  commit: 2bd769f5c46af1654a2ad6e688ca6be9e2f1a96c
  overall: pass
  sensors:
    depcheck: pass
    lint: pass
    typecheck: pass
  receipt_digest: sha256:91d79725382f23dddd73f858202e9ae3c3b5e39a821b20c7ad106f59a8a56929
manual_validation:
  - step: "Instalar la versión publicada por este cambio (npm i -g agentic-workflow-manager@latest) y correr awm --version"
    expected: "Imprime una versión mayor que 9.20.0"
  - step: "En un registry con un modelo de proceso que declara description en su frontmatter, correr awm process show <nombre> --json"
    expected: "El JSON incluye \"description\" con el texto y no aparece ningún diagnóstico unknown field \"description\""
  - step: "En el mismo registry, quitar la línea description del modelo y correr awm process list"
    expected: "El modelo sigue listado y sin diagnósticos, igual que antes del cambio"
risks:
  - "readPairs ahora corta líneas en CR y recorta solo espacios y tabs: un modelo con un CR suelto o un NBSP pegado a un valor, que antes pasaba por accidente, ahora se rechaza o deja de reconocerse (es la lectura correcta de YAML)"
  - "Un registry que publique un modelo con description debe exigir esta versión en minCliVersion: el CLI 9.20.0 rechaza ese modelo con unknown field \"description\""
  - "Divergencias preexistentes entre el lector de frontmatter y los runtimes YAML quedan abiertas en #225 y #226"
rollback: "Revertir el commit de merge del PR. Ningún estado persiste; los registries que ya declaren description deberán quitarla o fijar minCliVersion en la versión revertida."
---

## Qué se hizo

- `parseProcessFrontmatter` (`cli/src/core/process/model.ts`) admite `description` como el único campo opcional del contrato `awm: process-model`. Un modelo sin `description` se parsea igual que antes.
- Cuando hay `description`, se lee del frontmatter completo cargado con js-yaml, como lo lee un runtime. Se rechaza en estos casos:
  - YAML inválido;
  - null o vacío;
  - un valor que no es string (booleano, número, fecha, colección);
  - más de 1024 code points;
  - block scalars y valores de varias líneas;
  - caracteres de control, de salto de línea o de override bidireccional.
- El lector propio (`readPairs`) corta líneas igual que YAML (CR, LF, CRLF) y recorta solo espacios y tabs. Además debe ver las mismas claves de nivel superior que YAML, para que ninguna clave pase sin validar.
- Los diagnósticos nunca repiten el contenido: una línea inválida se informa por su número. Las claves indentadas (`awm` indentado) dan un diagnóstico en vez de perder el modelo en silencio.
- El contrato quedó documentado como enmienda en `docs/plans/2026-08-23-process-lifecycle-design.md`, fijado por un test estructural.
- La lección del ciclo se agregó al contexto de agentes (CTX-AGENTS-031/032): validar con el parser real desde el inicio.

## Qué se probó

- Tests de `tests/core/process`, `tests/commands/process.test.ts`, `tests/core/frontmatter` y `tests/structural`: 37 suites, 374 tests en verde.
- Suite completa del CLI: 6649 tests en verde. Hubo 1 falla preexistente de entorno (`registry/doctor.test.ts`, `chmod 0` no surte efecto como root), que también falla en `main` en esta sesión.
- `awm sensors run`: overall pass (typecheck, lint, depcheck).
- Revisiones por slice (especificación y calidad), revisión final de la rama y QA con Track A y tres lentes de Track B durante cuatro rondas. La comparación diferencial contra js-yaml (200.000 casos) no dio diferencias en el valor guardado.
- Los 473 archivos `.md` del repo y los dos modelos reales del registry personal (`trazar-sesion`, `documentar-proceso`) parsean igual que en `main`.
- Verificado contra los binarios: el CLI 9.20.0 publicado rechaza `description` con `unknown field`, y el build de esta rama aplica cada regla documentada.

## Qué falta validar

- Instalar la versión publicada y confirmar que `awm --version` es mayor que 9.20.0.
- Con un registry real que declare `description` en un modelo de proceso, `awm process show <nombre> --json` muestra la descripción sin diagnósticos.
- Sin `description`, `awm process list` sigue listando el modelo sin diagnósticos.
- Después: actualizar Kodria/awm-personal-registry (`description` en `trazar-sesion` y `documentar-proceso`, más `minCliVersion`) y confirmar que Codex carga esos skills sin `missing field description`.

## Riesgos y rollback

- El lector de frontmatter es más estricto: un CR suelto o un NBSP pegado a un valor ahora se leen como los lee YAML. Puede rechazar o dejar de reconocer modelos que antes pasaban por accidente; en los registries conocidos no hay ninguno.
- Un registry que publique `description` necesita `minCliVersion` en esta versión, porque el CLI 9.20.0 rechaza esos modelos.
- Siguen abiertas divergencias preexistentes: #225 (regex cuadrática en la lectura de `description` de cualquier `SKILL.md`) y #226 (cierre del frontmatter con `---x`, slugs que YAML lee como no-string, diagnósticos sin tope).
- Rollback: revertir el merge del PR. No hay estado persistente.
