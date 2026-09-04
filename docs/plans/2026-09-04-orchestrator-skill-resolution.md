# Orchestrator Skill Resolution Implementation Plan

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
