# Orchestrator Skill Resolution Implementation Plan
<!-- awm-qa-complete: 2026-09-04 -->
<!-- awm-docs-complete: 2026-09-04 -->
<!-- awm-retro-complete: 2026-09-04 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evitar que AWM componga declaraciones de orquestador sin un skill resoluble en registries configurados y seguros.

**Architecture:** El parser permanece estructural. El collector obtiene los nombres de `discoverSkills([root])` para cada `contentRoots()` y filtra nombres no resolubles antes del dedupe existente.

**Tech Stack:** TypeScript, Jest, Node.js, dependency-cruiser.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

### Task 1: Especificar la resolución semántica en tests

_Requirements: R110-1, R110-2, R110-3, R110-5, R110-6, R110-7_

**Files:**
- Modify: `cli/tests/core/orchestrators.test.ts`
- Modify: `cli/tests/integration/context-orchestrators-e2e.test.ts`

- [ ] Agregar `writeSkill(registryName, skillName)` a los tests core; crea `skills/<name>/SKILL.md` con frontmatter mínimo.
- [ ] Actualizar fixtures existentes que esperan composición para crear skills de `shared`, `uno`, `dos`, `ejemplo-proceso`, `task_capture_process` y `proceso-sano`.
- [ ] Cambiar la prueba de colisión post-saneamiento para usar `foo_bar` y `foobar`, ambos nombres válidos en Windows.
- [ ] Escribir primero los tests: nombre fantasma se omite y diagnostica; nombre declarado en un registry resuelve contra un skill de otro; root con discovery roto diagnostica pero conserva una declaración sana; `terminatesTo` inexistente se conserva.
- [ ] Agregar fixture E2E con `phantom-process`, sólo `skills/real-skill/SKILL.md`, y comprobar que `awm context orchestrators --verify phantom-process` devuelve código 2 y diagnóstico.
- [ ] Ejecutar los dos suites focalizados y comprobar RED: phantom sigue compuesto, `--verify` devuelve 0 y no existe diagnóstico de discovery roto.

### Task 2: Implementar la resolución global fail-safe

_Requirements: R110-1, R110-2, R110-3, R110-4, R110-5, R110-7_

**Files:**
- Modify: `cli/src/core/orchestrators.ts`
- Test: `cli/tests/core/orchestrators.test.ts`

- [ ] Importar `contentRoots` desde `./registries` y `discoverSkills` desde `./discovery`; mantener `readDeclaredOrchestrators()` sin discovery.
- [ ] Añadir un helper privado que itere `contentRoots()`, ejecute `discoverSkills([root])`, acumule `skill.name` en un `Set<string>` y convierta cada excepción en un diagnóstico sanitizado con `stripControlChars`.
- [ ] Al inicio de `collectDeclaredOrchestrators()`, obtener el set disponible; antes de `seenNames`, omitir cada `orch.name` ausente y diagnosticar `declaration dropped` sin caracteres de control.
- [ ] Mantener dedupe, colisión post-saneamiento y `terminatesTo` sin cambios.
- [ ] Ejecutar RED/GREEN con `npm test -- --runInBand tests/core/orchestrators.test.ts`, después `npm run typecheck`.

### Task 3: Verificar binario, gates y commit

_Requirements: R110-1, R110-2, R110-3, R110-4, R110-5, R110-6, R110-7_

**Files:**
- Verify: `cli/src/core/orchestrators.ts`
- Verify: `cli/tests/core/orchestrators.test.ts`
- Verify: `cli/tests/integration/context-orchestrators-e2e.test.ts`

- [ ] Ejecutar `npm run build`, luego los E2E focalizados y ambos suites focalizados.
- [ ] Ejecutar `npm test -- --runInBand`, `npm run typecheck`, `npm run build`, `npm run lint` y `awm sensors run`; todos deben informar PASS/`overall: pass`.
- [ ] Ejecutar dependency-cruiser focalizado sobre `orchestrators`, `discovery`, `registries`, `frontmatter` y `text`; no debe aparecer ciclo. Registrar, sin ampliar alcance, el ciclo preexistente de `npm run depcheck` si continúa limitado a `watch`.
- [ ] Confirmar `git diff --check`; hacer commit de código, tests y estos dos documentos con `fix(orchestrators): require declared skill resolution`.

## Matriz de trazabilidad

| Requisito | Tareas | Evidencia |
|---|---|---|
| R110-1 | T1-T3 | Unit phantom y E2E `--verify` 2 |
| R110-2 | T1-T3 | Unit cross-registry |
| R110-3 | T1-T3 | Unit root roto + sano |
| R110-4 | T2-T3 | Parser existente + typecheck |
| R110-5 | T1-T3 | Unit successor inexistente preservado |
| R110-6 | T1, T3 | E2E `--verify` 2 |
| R110-7 | T1-T3 | Unit y E2E mixtos |

## Amendment A1 — Fixtures de consumidores de contexto

**Motivo:** La primera corrida de la suite completa reveló cuatro tests existentes
que declaran `mi-proceso` o `proceso-valido` y afirman que llegan al contexto,
pero crean solamente `skills/using-awm`. Bajo R110-1 esas fixtures representan
declaraciones no resolubles y deben materializar el skill que afirman usar.

**Alcance:**

- `cli/tests/commands/hooks/install.test.ts`: crear `skills/mi-proceso/SKILL.md`
  y `skills/proceso-valido/SKILL.md` en los dos fixtures de declaración válida.
- `cli/tests/commands/hooks/resync.test.ts`: crear `skills/mi-proceso/SKILL.md`
  en el fixture de resync materializado.
- `cli/tests/core/context/orchestrator.test.ts`: crear
  `skills/mi-proceso/SKILL.md` en la fixture que verifica estado inyectado.

**Aceptación:** las cuatro aserciones existentes vuelven a pasar sin relajar
R110-1; el test de nombre fantasma continúa demostrando que una declaración sin
skill se descarta.

## Amendment A2 — Correcciones encontradas por QA global

**Motivo:** QA encontró cuatro casos que la implementación inicial no cubría:
una identidad descartada podía coincidir con otra compuesta tras saneamiento;
los diagnósticos nuevos aceptaban CR/LF; una fixture creaba un directorio con
ESC inválido en Windows; y el discovery por root ocultaba colisiones globales
de skills sin override. También se confirmó que `discoverSkills` aceptaba
artefactos `SKILL.md` no regulares, lo cual puede bloquear la colección síncrona.

**Alcance:**

- Conservar las identidades crudas descartadas para que `--verify` rechace una
  entrada descartada aun si su forma saneada coincide con una compuesta.
- Saneamiento de una sola línea para todo texto no confiable que entre en los
  diagnósticos de esta ruta.
- Reemplazar la fixture de nombre hostil por metadata hostil sin nombre de
  directorio no portable.
- Descubrir incrementalmente los roots previamente aceptados más el root actual;
  si aparece una colisión sin override, diagnosticar y excluir ese root sin
  invalidar los anteriores.
- Exigir que `SKILL.md` sea un archivo regular no enlazado antes de leerlo.

**Aceptación:** regresiones RED/GREEN para los cuatro casos; suites focalizadas,
sensores y verificación completa verdes; no se relajan R110-1 a R110-7.

## Amendment A3 — Cierre de saneamiento y lectura segura

**Motivo:** la re-lectura de QA comprobó que los diagnósticos estructurales del
parser seguían reenviando U+2028/U+0085 y que el chequeo `lstat` de `SKILL.md`
tenía una ventana TOCTOU antes de su lectura.

**Alcance:**

- Pasar todos los diagnósticos de `readDeclaredOrchestrators()` por el saneador
  de una sola línea antes de que lleguen a `diagnosticsToStderr`.
- Inspeccionar `SKILL.md`, abrirlo con `O_NOFOLLOW` cuando exista, comprobar en
  el descriptor `dev`/`ino`, tipo regular y tamaño contra la inspección, y leer
  desde ese descriptor; fallar cerrado si cambia o no es regular.

**Aceptación:** regresiones RED/GREEN para clave de metadata Unicode y sustitución
de `SKILL.md` tras `lstat`; las rutas inseguras no se leen ni bloquean el
collector.

## Amendment A4 — Sustitución concurrente de directorio padre

**Motivo:** QA reprodujo que sustituir un directorio padre por un symlink antes
de la inspección de la hoja podía autorizar un `SKILL.md` externo.

**Alcance y aceptación:** inspeccionar los componentes observables del path de
skill, rechazar symlinks y comprobar que la hoja abierta permanece bajo la
cadena inspeccionada; una regresión de filesystem real debe demostrar que el
reemplazo de padre no lee contenido externo.
