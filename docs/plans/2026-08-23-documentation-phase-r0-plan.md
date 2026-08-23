# Fase de documentación (R0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una fase de documentación obligatoria entre QA y retro, gateada por un marker que el CLI observa, para que la documentación de usuario final deje de derivar en silencio.

**Architecture:** Dos capas con frontera dura y **la de contenido va primero**. Las Tasks 1–4 viven enteramente en `awm-baseline-registry` (skills + bundle, entregados por tag + `awm update`); las Tasks 5–10 viven en `agentic-workflow` (CLI, publicado a npm por `release.yml`). El orden importa: si el CLI llegara primero, los usuarios verían planes clasificados `docs_pending` sin tener todavía el skill que produce el marker. Al revés la degradación es invisible — el dashboard simplemente reporta el estado anterior hasta que el CLI alcanza.

**Tech Stack:** TypeScript (CLI, **Jest** — `npm test` corre `jest --runInBand`; no es Vitest), Markdown (skills del registry, tests con el runner nativo de Node `node tests/<x>.test.mjs`), JSON (bundles/catálogo).

**Modo de ejecución:** interactivo

---

## Contexto que el implementador necesita

Ninguna de estas afirmaciones es de memoria; todas se verificaron contra el código en la fase de diseño.

**El ciclo de vida de AWM no se gobierna por prosa, se gobierna por markers.** Un plan lleva `<!-- awm-qa-complete: YYYY-MM-DD -->` y `<!-- awm-retro-complete: YYYY-MM-DD -->`, y hay código que los lee para clasificar el estado del plan. Agregar una fase significa agregar un marker Y enseñárselo a todos los que leen la cadena.

**Por qué la fase va entre QA y retro, no después de retro.** `classifyPlanState` evalúa `retroComplete` primero y devuelve `executed` — el estado terminal. Si la fase fuera después de retro, `executed` dejaría de significar "terminado" y rompería a todo consumidor. Entre QA y retro, `retroComplete → executed` conserva su significado exacto y solo se inserta un estado intermedio nuevo.

**Los puntos de enumeración de la cadena de markers y de los estados de plan** (todos verificados):

| Archivo | Qué enumera |
|---|---|
| `cli/src/core/dashboard/plan-state.ts:1` | el union `PlanState` |
| `cli/src/core/dashboard/plan-state.ts:5` | `PlanStateInput['markers']` |
| `cli/src/core/dashboard/plan-state.ts:21` | `assertKeys(..., ['qaComplete','retroComplete'])` — **tira excepción ante clave desconocida** |
| `cli/src/core/dashboard/plan-state.ts:26` | typecheck booleano de cada marker |
| `cli/src/core/dashboard/plan-state.ts:37-40` | la cadena de clasificación |
| `cli/src/core/evidence/types.ts:3` | `PLAN_STATES` — contrato durable de evidencia |
| `cli/src/commands/evidence/index.ts:28` | el union literal de nombres de marker en `marker()` |
| `cli/src/commands/evidence/index.ts:64` | construcción del objeto `markers` |
| `cli/src/core/dashboard/collect.ts:164,169-174` | mapeo inverso estado → markers |
| `cli/src/core/dashboard/sanitize.ts:4` | `ALLOWED_KEYS` — **un marker ausente acá se descarta en silencio** |

**Los puntos de enumeración de las secciones del Dashboard** (todos verificados):

| Archivo | Qué enumera |
|---|---|
| `cli/src/core/dashboard/types.ts:12` | el union `DashboardSectionV1['id']` |
| `cli/src/core/dashboard/types.ts:26` | `PROJECT_SECTION_IDS` |
| `cli/src/core/dashboard/validate.ts:3` | `SECTION_ORDER` (allowlist del validador) |
| `cli/src/core/dashboard/render-html.ts:67` | `stageSections` |
| `cli/tests/core/dashboard/collect.test.ts:49` | `expect(...).toEqual([...])` — **igualdad exacta sobre la lista ordenada** |
| `cli/tests/core/dashboard/contracts.test.ts:18` | fixture de contrato |

**Decisión de contrato ya tomada — leela antes de tocar `evidence/`.** `CycleEvidenceV1` es un registro **durable** que se comparte entre versiones del CLI; `DashboardSnapshotV1` es una vista **local y viva**. Ampliar el enum durable por un estado intermedio transitorio tiene mal costo/beneficio: un CLI viejo leyendo evidencia nueva rechazaría un `plan.state` desconocido. Por eso:

- `DashboardSnapshotV1.schema` **sí** pasa a `2` (Task 8), y ahí se agregan `docs` y `processes` **de una sola vez** — `processes` queda en `availability: 'not_applicable'` hasta que R1 lo pueble. `not_applicable` ya es un valor de primera clase del contrato, así que no es código muerto sino una declaración honesta.
- `CycleEvidenceV1.schema` **se queda en `1`**, y `docs_pending` nunca cruza al registro de evidencia: se mapea a `retro_pending` en el borde (Task 6). El compilador lo va a hacer cumplir, porque Task 6 corrige una inconsistencia latente — `CycleEvidencePlanState` está declarado en `cli/src/core/evidence/types.ts:4` y **no se usa** en el campo para el que fue creado (`plan: { ref: string; state: PlanState }` usa el tipo ancho).

**Cuidado con la frontera de `~/.awm`.** Ningún test ni paso de este plan puede escribir bajo `~/.awm`. Todos los tests usan tmpdirs con `HOME` y `AWM_HOME` sobreescritos — el patrón está en `cli/tests/commands/hooks/install.test.ts`.

**Los dos repos son clones separados.** `awm-baseline-registry` está en `/home/user/awm-baseline-registry`. El contenido no se copia a mano a la instalación: se commitea, se taggea, y llega por `awm update`.

## File Structure

**Repo `awm-baseline-registry` (capa de contenido — va primero):**

| Archivo | Responsabilidad |
|---|---|
| `skills/post-implementation-docs/SKILL.md` | **Nuevo.** El skill de la fase: qué documentar, cómo verificarlo contra el binario real, cómo degradar, y el marker de cierre |
| `skills/development-process/SKILL.md` | El ruteo: fila nueva en la tabla de estado, fila nueva en la tabla de fases, nodo nuevo en el grafo, regla de decisión nueva |
| `skills/post-implementation-qa/SKILL.md` | Su handoff deja de nombrar `finishing-a-development-branch` y nombra la fase de documentación |
| `skills/harness-retro/SKILL.md` | Su "cuándo se usa" deja de decir "después de QA" y dice "después de la fase de documentación" |
| `bundles/dev/bundle.json` · `catalog.json` | Empaque del skill nuevo + bump de versión (duplicado a propósito, ambos avanzan juntos) |

**Repo `agentic-workflow` (capa de CLI):**

| Archivo | Responsabilidad |
|---|---|
| `cli/src/core/dashboard/plan-state.ts` | El clasificador: estado `docs_pending`, marker `docsComplete`, allowlist |
| `cli/src/core/evidence/types.ts` | Angostar `plan.state` a `CycleEvidencePlanState` — el borde durable |
| `cli/src/commands/evidence/index.ts` | Leer el marker nuevo; mapear `docs_pending → retro_pending` al capturar |
| `cli/src/core/dashboard/collect.ts` | Mapeo inverso estado → markers |
| `cli/src/core/dashboard/sanitize.ts` | `docsComplete` en el allowlist |
| `cli/src/core/dashboard/types.ts` · `validate.ts` · `render-html.ts` | `schema: 2` + secciones `docs` y `processes` |
| `CONSTITUTION.md` | La regla, apuntando al mecanismo |
| `docs/guides/development-process.md` · `docs/guides/dashboard-and-evidence.md` | La documentación de usuario — la fase aplicada a sí misma |

---
## Capa de contenido — repo `awm-baseline-registry`

### Task 1: Skill `post-implementation-docs`

_Requirements: R6.1, R6.4, R6.5, R6.6_

**Files:**
- Create: `skills/post-implementation-docs/SKILL.md`
- Test: `tests/r10-documentation-phase-contract.test.mjs`

> Trabajá en el clon `/home/user/awm-baseline-registry`, no en `agentic-workflow` y **nunca** bajo `~/.awm`.

- [ ] **Step 1: Escribir el test de contrato que falla**

Crear `tests/r10-documentation-phase-contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');

const DOCS = 'skills/post-implementation-docs/SKILL.md';

test('R6.1: el skill de documentacion se declara como fase entre QA y retro', () => {
  const text = read(DOCS);                                  // verifies R6.1
  assert.match(text, /^name:\s*post-implementation-docs\s*$/m,
    'the frontmatter name must match the directory name — directory wins for discovery');
  assert.match(text, /`post-implementation-qa`/,
    'the skill must name its predecessor phase');
  assert.match(text, /`harness-retro`/,
    'the skill must name its successor phase');
});

test('R6.4: la verificacion es contra el binario real, no contra la prosa', () => {
  const text = read(DOCS);                                  // verifies R6.4
  assert.match(text, /verify-cmd-source-before-documenting/,
    'the skill must cite the AGENTS.md pattern that mandates checking the source');
  assert.match(text, /runbook-as-script/,
    'the skill must cite the pattern that mandates executing the doc as a script');
  assert.match(text, /\bnunca\b[^.]*\bprosa\b|\bprosa\b[^.]*\bno\b/i,
    'the skill must state explicitly that reading the prose is not verification');
});

test('R6.5: la fase es resoluble sin humano presente', () => {
  const text = read(DOCS);                                  // verifies R6.5
  assert.match(text, /^\*\*Modo de ejecución:\*\*|## Modo de ejecución/m,
    'every post-plan phase skill must declare how it reads the execution mode');
  assert.match(text, /desatendido/,
    'the skill must describe its unattended behavior — it runs after the human boundary');
});

test('R6.6: sin el registry de documentacion la fase corre igual y no bloquea', () => {
  const text = read(DOCS);                                  // verifies R6.6
  assert.match(text, /awm-documentation-registry|registry de documentación/i,
    'the skill must name the optional documentation registry');
  assert.match(text, /\bnunca\b[^.]*\bbloquea|no bloquea|sin bloquear/i,
    'the skill must state that a missing documentation registry never blocks the branch');
});

test('R6.2: el marker de cierre es awm-docs-complete', () => {
  const text = read(DOCS);                                  // verifies R6.2
  assert.match(text, /<!--\s*awm-docs-complete:\s*YYYY-MM-DD\s*-->/,
    'the skill must show the literal closing marker it writes');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node tests/r10-documentation-phase-contract.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory, open '.../skills/post-implementation-docs/SKILL.md'`

- [ ] **Step 3: Escribir el skill**

Crear `skills/post-implementation-docs/SKILL.md`:

````markdown
---
name: post-implementation-docs
version: "1.0.0"
license: Apache-2.0
description: Use after post-implementation-qa closes and before harness-retro — updates the user-facing documentation that this cycle's changes made stale, verifying every claim against the real binary rather than against prose. Writes the awm-docs-complete marker.
---

# Post-Implementation Docs

**Announce at start:** "I'm using the post-implementation-docs skill to bring the user-facing documentation in line with what this cycle shipped."

## Overview

La documentación de usuario final no deriva de golpe: deriva un cambio por vez, cada uno demasiado chico como para justificar una pasada de documentación propia. Esta fase existe para que ese costo se pague en el ciclo que lo causa, cuando el diff todavía está fresco y quien lo hizo sabe qué cambió.

**Core principle:** Documentar contra el binario, nunca contra la prosa.

Esta fase corre **después** de `post-implementation-qa` y **antes** de `harness-retro`. Ese orden no es estético: `harness-retro` es la fase terminal de aprendizaje, y un hueco de documentación encontrado acá es exactamente el tipo de hallazgo que el retro sabe curar. Documentar antes del retro convierte el drift en material de aprendizaje en vez de perderlo.

## Modo de ejecución (lectura del campo)

Al arrancar, localiza el plan activo (`docs/plans/*-plan.md` de la rama actual) y lee su línea `**Modo de ejecución:**`:

- Ausente o `interactivo` → modo interactivo (default): presentá el inventario del Step 2 y esperá confirmación antes de editar.
- `desatendido` → aplicá la sección **Modo desatendido** de este skill.
- Cualquier otro valor → tratalo como `interactivo` y avisá: "Valor inválido en `Modo de ejecución`: `<valor>` — usando modo interactivo."

### Modo desatendido

WHEN el modo es `desatendido`, no presentes el inventario ni pidas confirmación: actualizá **toda** la documentación que el inventario del Step 2 marque como afectada, con la verificación del Step 3 corriendo igual sobre cada afirmación. Al terminar, escribí el marker y devolvé el control al orquestador.

Esta fase es post-plan, así que corre del lado desatendido de la frontera — está diseñada para ser resoluble por un agente solo. IF una afirmación no se puede verificar contra el binario porque el comando no existe o falla, THEN no la escribas: registrá el hueco como hallazgo del ciclo (`awm ledger add`) y seguí. Inventar output de CLI es peor que no documentar.

## Degradación

Este skill **no depende** del registry de documentación (`awm-documentation-registry`, opt-in). IF ese registry está instalado y aporta skills de documentación, THEN usalos. IF no está instalado, THEN esta fase corre igual con las instrucciones de este documento y **nunca bloquea** el cierre de la rama — la ausencia de un registry opcional no es un fallo.

## The Process

### Step 1: Leer qué cambió

```bash
git diff main...HEAD --stat
git log main...HEAD --oneline
```

El diff es la única fuente de qué documentar. No documentes de memoria ni de lo que el plan prometía — documentá lo que efectivamente entró.

### Step 2: Inventario de documentación afectada

Para cada cambio del diff, identificá qué documentación de usuario final lo describe hoy. Buscá por el símbolo, no por el tema:

```bash
# Un comando o flag nuevo/cambiado
grep -rn "<comando>" docs/ README.md

# Un archivo de configuración cambiado
grep -rn "<clave-de-config>" docs/ README.md

# Un comportamiento descripto en una guía
grep -rln "<término>" docs/guides/
```

Presentá el inventario como tabla: qué cambió · qué doc lo describe · qué dice hoy · qué debería decir. **En modo interactivo, esperá confirmación acá** — es el punto más barato para que alguien te diga "eso no hace falta documentarlo".

Un cambio sin documentación afectada es un resultado válido y frecuente (un refactor interno, un test). Decilo y seguí.

### Step 3: Verificar contra el binario antes de escribir

**Este es el paso que hace que la fase valga algo.** `AGENTS.md` de este repo documenta el patrón `verify-cmd-source-before-documenting` con ocurrencias confirmadas repetidas: narrativa de comandos que sobrevivió spec-review Y code-quality-review con errores factuales, porque nadie ejecutó nada.

Para cada afirmación que vayas a escribir:

- **Un comando, sus flags, sus keywords** → leé `cli/src/commands/<cmd>.ts` y corré el comando.
- **Output de ejemplo** → pegá el output real, nunca uno plausible.
- **Una secuencia de pasos** → ejecutala literalmente, en orden, en un entorno limpio. Es el patrón `runbook-as-script`: el doc se escribe como hipótesis y se corre como test; las divergencias se corrigen en el doc.

**Al auto-verificar el CLI de AWM durante su propio desarrollo**, `awm` del PATH puede ser una instalación global publicada, desconectada del working tree. Usá `npm run build && node dist/src/index.js <comando>` desde `cli/`.

Leer la prosa **nunca** es verificación. Si no ejecutaste, no lo escribas.

### Step 4: Actualizar

Editá la documentación afectada. Reglas:

- **Corregí, no apiles.** Si un doc dice algo que dejó de ser cierto, se reemplaza — no se le agrega un párrafo nuevo que lo contradiga.
- **Un cambio de comportamiento sin doc que lo describa** puede necesitar sección nueva, o puede no necesitar nada. No inventes documentación para justificar la fase.
- **No toques `AGENTS.md`, `CONSTITUTION.md` ni `CLAUDE.md`.** Esos son contexto de agente y los cura `harness-retro`, que corre después. Esta fase es documentación **de usuario final**.

### Step 5: Verificar de nuevo

```bash
awm sensors run
```

Correr desde la raíz del repo. `overall: pass` o no cerrás. Si el repo tiene link-checking o lint de markdown, corrélo también.

### Step 6: Commit

```bash
git add docs/ README.md
git commit -m "docs: <qué se puso al día y por qué cambió>"
```

### Step 7: Escribir el marker

Agregá al plan activo, junto a los otros markers de ciclo:

```markdown
<!-- awm-docs-complete: YYYY-MM-DD -->
```

Reportá: "Documentación al día. N documentos actualizados, M afirmaciones verificadas contra el binario. Listo para `harness-retro`."

## Red Flags

| Tentación | Realidad |
|---|---|
| "El cambio es interno, no afecta docs" | Puede ser cierto. Corré el inventario del Step 2 igual y decilo con evidencia |
| "El output de ejemplo se ve bien" | Pegá el real. Es la fuente de error más común en documentación de comandos |
| "Agrego una nota aclaratoria" | Si la doc quedó falsa, se corrige. Una nota que contradice el párrafo de arriba es peor que nada |
| "Actualizo AGENTS.md de paso" | Eso es del retro, que corre después. Esta fase es documentación de usuario |
| "No está el registry de documentación, salteo la fase" | La fase corre igual. El registry es opcional y su ausencia nunca bloquea |

## Integration

| Skill | Rol |
|---|---|
| `post-implementation-qa` | Fase anterior; le cede el control con `awm-qa-complete` puesto |
| `harness-retro` | Fase siguiente; se dispara con `awm-docs-complete` presente |
| `development-process` | Rutea a esta fase y exige su marker para avanzar |
| `verification-before-completion` | Gate antes de declarar la fase cerrada |
````

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd /home/user/awm-baseline-registry && node tests/r10-documentation-phase-contract.test.mjs`
Expected: PASS — 5 tests, 0 failures

- [ ] **Step 5: Cablear el test en CI**

Agregar en `.github/workflows/validate.yml`, después de la línea `- run: node tests/r9-declared-orchestrators-contract.test.mjs`:

```yaml
      - run: node tests/r10-documentation-phase-contract.test.mjs
```

Hacer lo mismo en `.github/workflows/auto-tag.yml` (buscá ahí la misma lista de `- run: node tests/...` y agregá la línea en la misma posición relativa). Un test que no corre en CI no gatea nada.

- [ ] **Step 6: Commit**

```bash
cd /home/user/awm-baseline-registry
git add skills/post-implementation-docs/SKILL.md tests/r10-documentation-phase-contract.test.mjs .github/workflows/validate.yml .github/workflows/auto-tag.yml
git commit -m "feat(skills): fase post-implementation-docs entre QA y retro"
```

---

### Task 2: Rutear la fase en `development-process`

_Requirements: R6.1, R6.2_

**Files:**
- Modify: `skills/development-process/SKILL.md:40-46` (grafo), `:60-62` (tabla de fases), `:133-135` (tabla de estado), `:190-196` (reglas de decisión)
- Test: `tests/r10-documentation-phase-contract.test.mjs` (extiende el de Task 1)

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `tests/r10-documentation-phase-contract.test.mjs`:

```js
const DEV_PROCESS = 'skills/development-process/SKILL.md';

test('R6.1: development-process rutea la fase entre QA y retro', () => {
  const text = read(DEV_PROCESS);                           // verifies R6.1
  const qa = text.indexOf('"post-implementation-qa" -> "post-implementation-docs"');
  const retro = text.indexOf('"post-implementation-docs" -> "harness-retro"');
  assert.ok(qa >= 0, 'the lifecycle graph must route QA into the documentation phase');
  assert.ok(retro >= 0, 'the lifecycle graph must route the documentation phase into retro');
  assert.doesNotMatch(text, /"post-implementation-qa" -> "harness-retro"/,
    'the old direct QA -> retro edge must be gone, not merely supplemented');
});

test('R6.2: el estado Docs pending se gatea por el marker', () => {
  const text = read(DEV_PROCESS);                           // verifies R6.2
  assert.match(text, /awm-docs-complete/,
    'the state table must gate on the new marker');
  const docsRow = text.split('\n').find(line =>
    line.includes('awm-qa-complete') && line.includes('awm-docs-complete') && line.startsWith('|'));
  assert.ok(docsRow, 'a state row must require qa-complete present and docs-complete absent');
  assert.match(docsRow, /post-implementation-docs/,
    'that row must route to the documentation phase');
});

test('R6.2: retro ya no se dispara con solo qa-complete', () => {
  const text = read(DEV_PROCESS);                           // verifies R6.2
  const retroRow = text.split('\n').find(line =>
    line.startsWith('|') && line.includes('Invoke `harness-retro`'));
  assert.ok(retroRow, 'the retro routing row must still exist');
  assert.match(retroRow, /awm-docs-complete/,
    'retro must now be gated on docs-complete, not on qa-complete alone');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd /home/user/awm-baseline-registry && node tests/r10-documentation-phase-contract.test.mjs`
Expected: FAIL — 3 tests nuevos rojos ("the lifecycle graph must route QA into the documentation phase")

- [ ] **Step 3: Editar el grafo del ciclo de vida**

En `skills/development-process/SKILL.md`, en el bloque `digraph lifecycle`, agregar el nodo junto a los otros dos amarillos:

```dot
    "post-implementation-docs" [shape=box, style=filled, fillcolor=lightyellow, label="post-implementation-docs"];
```

y reemplazar la arista `"post-implementation-qa" -> "harness-retro";` por:

```dot
    "post-implementation-qa" -> "post-implementation-docs";
    "post-implementation-docs" -> "harness-retro";
```

- [ ] **Step 4: Editar la tabla de fases**

Insertar entre la fila `4. QA` y la fila `4.5. Retro`:

```markdown
| 4.2. Docs | `post-implementation-docs` | QA complete (`awm-qa-complete`), docs not yet done (`awm-docs-complete` absent) | Documentación de usuario final al día y verificada contra el binario; marker `awm-docs-complete` added to plan |
```

y cambiar el trigger de la fila `4.5. Retro` de `QA complete (`awm-qa-complete`), retro not yet done (`awm-retro-complete` absent)` a:

```markdown
| 4.5. Retro | `harness-retro` | Docs complete (`awm-docs-complete`), retro not yet done (`awm-retro-complete` absent) | Lessons cured into remediation tree / CONSTITUTION.md / AGENTS.md; ledger archived; marker `awm-retro-complete` added to plan |
```

- [ ] **Step 5: Editar la tabla de estado del Step 1**

Insertar entre la fila de QA Pending y la de Retro pending:

```markdown
| `*-plan.md` all tasks complete, `<!-- awm-qa-complete` present in plan, no `<!-- awm-docs-complete` | **Docs pending** | Invoke `post-implementation-docs` |
```

y reemplazar la fila de Retro pending por:

```markdown
| `*-plan.md` all tasks complete, `<!-- awm-docs-complete` present in plan, no `<!-- awm-retro-complete` | **Retro pending** | Invoke `harness-retro` |
```

- [ ] **Step 6: Editar las reglas de decisión**

Insertar antes de la regla "When QA is complete but the retro marker is absent":

```markdown
### When QA is complete but the docs marker is absent
1. Check the plan for `<!-- awm-docs-complete`
2. If absent → invoke `post-implementation-docs`
3. Do NOT jump to `harness-retro` or `finishing-a-development-branch` without the docs marker
```

y cambiar el paso 1 de la regla del retro de `Check the plan for `<!-- awm-retro-complete`` a:

```markdown
1. Check the plan for `<!-- awm-docs-complete` (prerequisite) and `<!-- awm-retro-complete`
```

- [ ] **Step 7: Actualizar la lista de fases del modo desatendido**

En la sección `### Modo desatendido`, la enumeración de fases post-plan dice **Executing**, **QA Pending**, **Retro pending** y **Finishing**. Agregar **Docs pending** entre QA Pending y Retro pending, para que el ruteo automático la cubra.

- [ ] **Step 8: Correr el test y verificar que pasa**

Run: `cd /home/user/awm-baseline-registry && node tests/r10-documentation-phase-contract.test.mjs`
Expected: PASS — 8 tests, 0 failures

- [ ] **Step 9: Commit**

```bash
cd /home/user/awm-baseline-registry
git add skills/development-process/SKILL.md tests/r10-documentation-phase-contract.test.mjs
git commit -m "feat(skills): development-process rutea la fase de documentacion entre QA y retro"
```

---

### Task 3: Poner al día el handoff de las fases vecinas

_Requirements: R6.1_

**Files:**
- Modify: `skills/post-implementation-qa/SKILL.md:234` (reporte final), `:271` (tabla Connections)
- Modify: `skills/harness-retro/SKILL.md:22` (cuándo se usa), `:349` (tabla de integración)
- Test: `tests/r10-documentation-phase-contract.test.mjs`

> Una fase cuyo vecino sigue nombrando al vecino viejo produce exactamente el salto que el ruteo prohíbe. Los dos extremos tienen que moverse con el medio.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `tests/r10-documentation-phase-contract.test.mjs`:

```js
test('R6.1: QA le cede el control a la fase de documentacion, no a finishing', () => {
  const text = read('skills/post-implementation-qa/SKILL.md');   // verifies R6.1
  assert.match(text, /Ready for `post-implementation-docs`/,
    'the QA completion report must hand off to the documentation phase');
  assert.doesNotMatch(text, /Ready for `finishing-a-development-branch`/,
    'QA must no longer name finishing as its successor');
});

test('R6.1: retro se declara disparado por el marker de documentacion', () => {
  const text = read('skills/harness-retro/SKILL.md');            // verifies R6.1
  assert.match(text, /awm-docs-complete/,
    'harness-retro must state it is routed after the documentation phase');
  assert.match(text, /post-implementation-docs/,
    'harness-retro must name the documentation phase as its predecessor');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd /home/user/awm-baseline-registry && node tests/r10-documentation-phase-contract.test.mjs`
Expected: FAIL — 2 tests nuevos rojos

- [ ] **Step 3: Editar `post-implementation-qa`**

Línea 234, reemplazar:

```markdown
Report: "QA complete. N findings found and closed. Ready for `post-implementation-docs`."
```

En la tabla `## Connections` (línea 271), reemplazar la fila de `finishing-a-development-branch` por:

```markdown
| `post-implementation-docs` | Next phase when QA is clean |
```

- [ ] **Step 4: Editar `harness-retro`**

Línea 22, reemplazar:

```markdown
- Automatically: `development-process` routes here after `post-implementation-docs` completes and `awm-docs-complete` is present but `awm-retro-complete` is absent.
```

En la tabla de integración (línea 349), reemplazar la fila de `development-process` por:

```markdown
| `development-process` | Routes to harness-retro after the documentation phase; requires `awm-retro-complete` to proceed to finishing |
```

y agregar una fila:

```markdown
| `post-implementation-docs` | Previous phase; a documentation gap it found is ledger material this retro cures |
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd /home/user/awm-baseline-registry && node tests/r10-documentation-phase-contract.test.mjs`
Expected: PASS — 10 tests, 0 failures

- [ ] **Step 6: Commit**

```bash
cd /home/user/awm-baseline-registry
git add skills/post-implementation-qa/SKILL.md skills/harness-retro/SKILL.md tests/r10-documentation-phase-contract.test.mjs
git commit -m "feat(skills): QA y retro nombran la fase de documentacion como vecina"
```

---

### Task 4: Empaquetar el skill y bumpear versiones

_Requirements: R6.1_

**Files:**
- Modify: `bundles/dev/bundle.json`, `catalog.json`

> La versión está duplicada a propósito entre `catalog.json` y `bundle.json`, y **las dos avanzan juntas** en cada release. Un skill que no está en el bundle no se instala, y entonces `development-process` rutea a una fase que no existe.

- [ ] **Step 1: Agregar el skill al bundle**

En `bundles/dev/bundle.json`, agregar `"post-implementation-docs"` al array `skills`, inmediatamente después de `"post-implementation-qa"`. **Sin `onSignal`** — es una fase del spine, se instala siempre, igual que `post-implementation-qa`:

```json
    "receiving-code-review", "post-implementation-qa", "post-implementation-docs",
    "finishing-a-development-branch",
```

- [ ] **Step 2: Bumpear la versión del bundle**

En `bundles/dev/bundle.json`, `"version": "3.4.0"` → `"version": "3.5.0"` (minor: agrega un skill, no rompe nada existente).

- [ ] **Step 3: Bumpear la versión en el catálogo**

En `catalog.json`, la fila del bundle `dev`: `"version": "3.4.0"` → `"version": "3.5.0"`.

- [ ] **Step 4: Verificar que las dos versiones coinciden**

Run:
```bash
cd /home/user/awm-baseline-registry
node -e "const b=require('./bundles/dev/bundle.json'),c=require('./catalog.json');const e=c.bundles.find(x=>x.name==='dev');console.log(b.version===e.version?'OK '+b.version:'MISMATCH '+b.version+' vs '+e.version)"
```
Expected: `OK 3.5.0`

- [ ] **Step 5: Correr la suite completa del registry**

Run: `cd /home/user/awm-baseline-registry && for t in tests/*.test.mjs; do echo "--- $t"; node "$t" || echo "FALLO $t"; done`
Expected: sin ninguna línea `FALLO` — en particular `release-skill-version-gate.test.mjs` y `validate-portability.test.mjs` verdes, que son los que gatean versiones y portabilidad del contenido nuevo

- [ ] **Step 6: Commit**

```bash
cd /home/user/awm-baseline-registry
git add bundles/dev/bundle.json catalog.json
git commit -m "feat(bundles): dev 3.5.0 — incorpora post-implementation-docs al spine"
```

---
## Capa de CLI — repo `agentic-workflow`

> Todo lo que sigue corre en `/home/user/agentic-workflow`. Comandos de test desde `cli/`.

### Task 5: `classifyPlanState` reconoce `docs_pending`

_Requirements: R6.3_

**Files:**
- Modify: `cli/src/core/dashboard/plan-state.ts:1`, `:5`, `:21`, `:26`, `:37-40`
- Test: `cli/tests/core/dashboard/plan-state.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `cli/tests/core/dashboard/plan-state.test.ts`:

```ts
describe('fase de documentacion', () => {
    it('clasifica docs_pending con QA hecha y documentacion pendiente', () => {   // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: true, docsComplete: false, retroComplete: false },
            tasks: { total: 3, completed: 3 },
        })).toBe('docs_pending');
    });

    it('vuelve a retro_pending cuando la documentacion esta hecha', () => {       // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: true, docsComplete: true, retroComplete: false },
            tasks: { total: 3, completed: 3 },
        })).toBe('retro_pending');
    });

    it('conserva executed con retro hecho — el significado no cambia', () => {    // verifies R6.3
        expect(classifyPlanState({
            markers: { qaComplete: true, docsComplete: true, retroComplete: true },
            tasks: { total: 3, completed: 3 },
        })).toBe('executed');
    });

    it('rechaza un marker desconocido', () => {                                   // verifies R6.3
        expect(() => classifyPlanState({
            markers: { qaComplete: true, docsComplete: false, retroComplete: false, bogusComplete: true },
            tasks: { total: 1, completed: 1 },
        })).toThrow(/unsupported fields/);
    });

    it('rechaza docsComplete no booleano', () => {                                // verifies R6.3
        expect(() => classifyPlanState({
            markers: { qaComplete: true, docsComplete: 'yes', retroComplete: false },
            tasks: { total: 1, completed: 1 },
        })).toThrow(/must be boolean/);
    });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd cli && npx jest --runInBand tests/core/dashboard/plan-state.test.ts`
Expected: FAIL — `expected 'retro_pending' to be 'docs_pending'` en el primero, y `Plan markers has unsupported fields` en los que pasan `docsComplete` (porque el allowlist todavía no lo admite)

- [ ] **Step 3: Ampliar el tipo y el allowlist**

En `cli/src/core/dashboard/plan-state.ts`, línea 1:

```ts
export type PlanState = 'active' | 'blocked' | 'qa_pending' | 'docs_pending' | 'retro_pending' | 'executed' | 'legacy_unverifiable';
```

Línea 5:

```ts
    markers: { qaComplete: boolean; docsComplete: boolean; retroComplete: boolean };
```

Línea 21:

```ts
    assertKeys(input.markers, 'markers', ['qaComplete', 'docsComplete', 'retroComplete']);
```

Línea 26:

```ts
    if (typeof markers.qaComplete !== 'boolean' || typeof markers.docsComplete !== 'boolean' || typeof markers.retroComplete !== 'boolean') throw new Error('Plan markers must be boolean');
```

- [ ] **Step 4: Insertar el estado en la cadena**

Reemplazar las líneas 37-40 por:

```ts
    if (markers.retroComplete) return 'executed';
    if (markers.docsComplete) return 'retro_pending';
    if (markers.qaComplete) return 'docs_pending';
    if (tasks.total > 0 && tasks.completed === tasks.total) return 'qa_pending';
    return 'legacy_unverifiable';
```

El orden es lo que hace que `retroComplete → executed` conserve su significado: se evalúa primero, igual que antes. Lo único nuevo es que el tramo entre QA y retro ahora tiene dos escalones en vez de uno.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd cli && npx jest --runInBand tests/core/dashboard/plan-state.test.ts`
Expected: PASS. **El typecheck del resto del proyecto va a estar rojo** — `docsComplete` es requerido y hay 7 sitios que todavía no lo pasan. Los arreglan las Tasks 6 y 7; no los arregles acá.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/dashboard/plan-state.ts cli/tests/core/dashboard/plan-state.test.ts
git commit -m "feat(dashboard): estado docs_pending entre QA y retro en classifyPlanState"
```

---

### Task 6: Borde de evidencia — leer el marker sin ampliar el contrato durable

_Requirements: R6.2, R6.3_

**Files:**
- Modify: `cli/src/core/evidence/types.ts:1`, `:13`
- Modify: `cli/src/core/evidence/capture.ts:11`
- Modify: `cli/src/commands/evidence/index.ts:28`, `:36`, `:64`
- Test: `cli/tests/commands/evidence/*.test.ts` (el archivo existente que cubre `runEvidenceCapture`)

> **Por qué el contrato durable no crece.** `CycleEvidenceV1` es un registro que se comparte entre versiones del CLI: un CLI viejo leyendo evidencia nueva rechazaría un `plan.state` desconocido, y eso es un fallo de compatibilidad hacia adelante, no un detalle. `docs_pending` es un estado **vivo** del dashboard, transitorio por definición, así que no gana nada cruzando al registro. Se mapea a `retro_pending` en el borde y el compilador lo hace cumplir.

- [ ] **Step 1: Escribir el test que falla**

Agregar al archivo de tests de `runEvidenceCapture`:

```ts
it('lee el marker awm-docs-complete del plan', () => {                       // verifies R6.2
    const root = makeRepo();   // helper existente del archivo
    writePlan(root, ['# Plan', '<!-- awm-qa-complete: 2026-08-23 -->', '- [x] Task 1']);
    const captured = runEvidenceCapture(root, 'docs/plans/p.md', { journal: completeJournal(), ledger: [] });
    expect(captured.code).toBe(0);
    // sin el marker de docs, el estado vivo seria docs_pending
    expect(readEvidence(root).plan.state).toBe('retro_pending');
});

it('no filtra docs_pending al registro durable de evidencia', () => {        // verifies R6.3
    const root = makeRepo();
    writePlan(root, ['# Plan', '<!-- awm-qa-complete: 2026-08-23 -->', '- [x] Task 1']);
    runEvidenceCapture(root, 'docs/plans/p.md', { journal: completeJournal(), ledger: [] });
    expect(PLAN_STATES).not.toContain('docs_pending');
    expect(PLAN_STATES).toContain(readEvidence(root).plan.state);
});

it('con docs y retro completos el estado sigue siendo executed', () => {     // verifies R6.3
    const root = makeRepo();
    writePlan(root, ['# Plan', '<!-- awm-qa-complete: 2026-08-23 -->',
        '<!-- awm-docs-complete: 2026-08-23 -->', '<!-- awm-retro-complete: 2026-08-23 -->', '- [x] Task 1']);
    runEvidenceCapture(root, 'docs/plans/p.md', { journal: completeJournal(), ledger: [] });
    expect(readEvidence(root).plan.state).toBe('executed');
});
```

> Usá los helpers que ya existen en ese archivo para construir repo, plan y journal — no inventes nuevos. Si no existe un helper de lectura de evidencia, leé el archivo escrito bajo `.awm/` con `JSON.parse(fs.readFileSync(...))`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd cli && npx jest --runInBand tests/commands/evidence`
Expected: FAIL — `Plan markers has unsupported fields` o `Plan markers must be boolean`, porque `index.ts:64` todavía construye el objeto sin `docsComplete`

- [ ] **Step 3: Angostar el contrato durable**

En `cli/src/core/evidence/types.ts`, borrar la línea 1 (`import type { PlanState } ...`, queda sin uso) y cambiar la línea 13:

```ts
  plan: { ref: string; state: CycleEvidencePlanState };
```

En `cli/src/core/evidence/capture.ts`, línea 11, cambiar el campo del input y su import:

```ts
export interface CaptureCycleEvidenceInput { root: string; repositoryIdentity: unknown; planPath: string; journal: unknown; gates: unknown; ledger: unknown; pr?: unknown; planState?: CycleEvidencePlanState; }
```

Importar `CycleEvidencePlanState` desde `./types` y quitar el import de `PlanState` si queda sin uso.

- [ ] **Step 4: Leer el marker nuevo y mapear en el borde**

En `cli/src/commands/evidence/index.ts`, línea 28, ampliar el union de nombres:

```ts
function marker(lines: readonly string[], name: 'awm-qa-complete' | 'awm-docs-complete' | 'awm-retro-complete', release: string | undefined): boolean {
```

Agregar la función de borde justo antes de `planState`:

```ts
/** `docs_pending` es un estado vivo del dashboard; el registro durable no lo conoce (schema 1). */
function forEvidence(state: PlanState): CycleEvidencePlanState {
  return state === 'docs_pending' ? 'retro_pending' : state;
}
```

Cambiar la firma de `planState` a `: CycleEvidencePlanState` y envolver el return:

```ts
  return forEvidence(classifyPlanState({
    ...(status === 'IN_PROGRESS' ? { journal: { state: 'active' } } : status === 'BLOCKED' ? { journal: { state: 'blocked' } } : {}),
    markers: {
      qaComplete: marker(visibleLines, 'awm-qa-complete', release),
      docsComplete: marker(visibleLines, 'awm-docs-complete', release),
      retroComplete: marker(visibleLines, 'awm-retro-complete', release),
    },
    tasks: { total, completed },
  }));
```

Agregar `CycleEvidencePlanState` al import de `../../core/evidence/types`.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `cd cli && npx jest --runInBand tests/commands/evidence && npm run typecheck`
Expected: tests PASS. `tsc` todavía rojo en `collect.ts` — lo cierra la Task 7.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/evidence/types.ts cli/src/core/evidence/capture.ts cli/src/commands/evidence/index.ts cli/tests/commands/evidence
git commit -m "feat(evidence): leer awm-docs-complete sin ampliar el contrato durable (schema 1)"
```

---

### Task 7: Mapeo inverso y allowlist de sanitización

_Requirements: R6.3_

**Files:**
- Modify: `cli/src/core/dashboard/collect.ts:164`, `:169-174`
- Modify: `cli/src/core/dashboard/sanitize.ts:4`
- Test: `cli/tests/core/dashboard/collect.test.ts`

> **`sanitize.ts` es la trampa silenciosa.** Su `ALLOWED_KEYS` filtra el input del adapter; una clave que no esté ahí **se descarta sin error**. Un `docsComplete` que llegue del adapter y no esté en el allowlist produce un fallo mudo, no una excepción.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `cli/tests/core/dashboard/collect.test.ts`:

```ts
it('sanitize conserva docsComplete', () => {                                  // verifies R6.3
    const cleaned = sanitizeDashboardSource({
        lifecycle: { markers: { qaComplete: true, docsComplete: true, retroComplete: false }, tasks: { total: 1, completed: 1 } },
    });
    expect((cleaned as any).lifecycle.markers.docsComplete).toBe(true);
});

it('un ciclo historico retro_pending no retrocede a docs_pending', () => {    // verifies R6.3
    // Evidencia escrita antes de que existiera la fase: docs se considera hecho.
    expect(classifyPlanState(lifecycleForCycleFixture('retro_pending'))).toBe('retro_pending');
});
```

> `lifecycleForCycleFixture` es un helper a agregar en el archivo de test que construya el `cycle` mínimo que `lifecycleForCycle` espera y devuelva su resultado. Si `lifecycleForCycle` no está exportado, exportalo — es lógica de contrato y merece test directo.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd cli && npx jest --runInBand tests/core/dashboard/collect.test.ts`
Expected: FAIL — `expected undefined to be true` en el primero (la clave se descartó en silencio, que es justamente el modo de falla)

- [ ] **Step 3: Agregar la clave al allowlist**

En `cli/src/core/dashboard/sanitize.ts`, línea 4, agregar `'docsComplete'` junto a las otras dos:

```ts
const ALLOWED_KEYS = new Set(['findings', 'label', 'id', 'state', 'detail', 'remediation', 'remediationVerified', 'execution', 'qa', 'retro', 'history', 'lifecycle', 'journal', 'markers', 'tasks', 'total', 'completed', 'qaComplete', 'docsComplete', 'retroComplete']);
```

- [ ] **Step 4: Completar el mapeo inverso**

En `cli/src/core/dashboard/collect.ts`, línea 164:

```ts
    return { journal: { state: overlay.state }, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: overlay.tasks };
```

Líneas 169-174, reemplazar el bloque completo:

```ts
    if (cycle.plan.state === 'blocked' || cycle.cycleState === 'blocked') return { journal: { state: 'blocked' }, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total, completed: 0 } };
    if (cycle.plan.state === 'active') return { journal: { state: 'active' }, markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total, completed: 0 } };
    if (cycle.plan.state === 'executed') return { markers: { qaComplete: true, docsComplete: true, retroComplete: true }, tasks: { total, completed: total } };
    if (cycle.plan.state === 'retro_pending') return { markers: { qaComplete: true, docsComplete: true, retroComplete: false }, tasks: { total, completed: total } };
    if (cycle.plan.state === 'qa_pending') return { markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total, completed: total } };
    return { markers: { qaComplete: false, docsComplete: false, retroComplete: false }, tasks: { total: 0, completed: 0 } };
```

**La decisión que importa está en la fila de `retro_pending`: `docsComplete: true`.** Esa evidencia se escribió antes de que la fase existiera. Reconstruirla con `docsComplete: false` haría que todo ciclo histórico apareciera para siempre como `docs_pending`, inventando deuda retroactiva. Tratarlo como documentación hecha es la única lectura no regresiva.

- [ ] **Step 5: Correr toda la suite y el typecheck**

Run: `cd cli && npm run typecheck && npx jest --runInBand`
Expected: `tsc` limpio y suite verde. Este es el punto donde el rojo de typecheck que arrastraban las Tasks 5 y 6 se cierra.

- [ ] **Step 6: Commit**

```bash
git add cli/src/core/dashboard/collect.ts cli/src/core/dashboard/sanitize.ts cli/tests/core/dashboard/collect.test.ts
git commit -m "feat(dashboard): mapeo inverso y allowlist para docsComplete"
```

---

### Task 8: Contrato de secciones del snapshot — un solo bump a `schema: 2`

_Requirements: R6.3, R5.3 (parcial — el id; el adapter llega en R1)_

**Files:**
- Modify: `cli/src/core/dashboard/types.ts:12`, `:20`, `:26`, `:37`
- Modify: `cli/src/core/dashboard/validate.ts:3`, `:47`
- Modify: `cli/src/core/dashboard/render-html.ts:67`
- Modify: `cli/src/core/dashboard/collect.ts` (construcción de secciones, alrededor de `:349`)
- Test: `cli/tests/core/dashboard/collect.test.ts:49`, `cli/tests/core/dashboard/contracts.test.ts:18`

> **Por qué las dos secciones entran juntas.** La lista de secciones está enumerada en seis lugares, uno de ellos una aserción de igualdad exacta. Cambiarla es un bump de `schema`, y hacer dos bumps para dos secciones que ya sabemos que van a existir es pagar el costo dos veces. `processes` entra ahora en `availability: 'not_applicable'` — un valor de primera clase del contrato, diseñado exactamente para "esta sección no aplica acá" — y R1 lo pobla con su adapter.

- [ ] **Step 1: Escribir los tests que fallan**

En `cli/tests/core/dashboard/collect.test.ts`, cambiar la aserción de la línea 49 y agregar dos tests:

```ts
expect(snapshot.sections.map((section) => section.id)).toEqual(   // verifies R6.3
    ['machine', 'project', 'planning', 'execution', 'qa', 'docs', 'retro', 'history', 'processes']);
```

```ts
it('el snapshot declara schema 2', () => {                                    // verifies R6.3
    const snapshot = collectDashboard({ cwd: repoWithProject(), now: NOW });
    expect(snapshot.schema).toBe(2);
});

it('processes queda declarada no aplicable hasta R1', () => {                 // verifies R5.3
    const snapshot = collectDashboard({ cwd: repoWithProject(), now: NOW });
    const processes = snapshot.sections.find((section) => section.id === 'processes');
    expect(processes).toEqual({ id: 'processes', availability: 'not_applicable', items: [] });
});
```

En `cli/tests/core/dashboard/contracts.test.ts`, agregar al fixture las dos secciones nuevas y `schema: 2`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd cli && npx jest --runInBand tests/core/dashboard`
Expected: FAIL — la lista de secciones no coincide y `schema must be version 1` desde el validador

- [ ] **Step 3: Ampliar los tipos**

En `cli/src/core/dashboard/types.ts`, línea 12:

```ts
    id: 'machine' | 'project' | 'planning' | 'execution' | 'qa' | 'docs' | 'retro' | 'history' | 'processes';
```

Línea 20 (`schema: 1;` en `DashboardSnapshotV1`) → `schema: 2;`

Línea 26:

```ts
const PROJECT_SECTION_IDS: DashboardSectionV1['id'][] = ['machine', 'project', 'planning', 'execution', 'qa', 'docs', 'retro', 'history', 'processes'];
```

Línea 37 (el literal del fixture `dashboardSnapshot`): `schema: 1,` → `schema: 2,`

> El nombre del tipo se queda en `DashboardSnapshotV1`. `V1` nombra la familia del contrato; `schema` nombra su versión. Renombrar el tipo tocaría 20+ sitios sin ganar nada.

- [ ] **Step 4: Ampliar el validador**

En `cli/src/core/dashboard/validate.ts`, línea 3:

```ts
const SECTION_ORDER = ['machine', 'project', 'planning', 'execution', 'qa', 'docs', 'retro', 'history', 'processes'] as const;
```

Línea 47:

```ts
    if (value.schema !== 2) throw new DashboardValidationError('schema must be version 2');
```

- [ ] **Step 5: Ampliar el render**

En `cli/src/core/dashboard/render-html.ts`, línea 67:

```ts
    const stageSections: DashboardSectionV1['id'][] = ['planning', 'execution', 'qa', 'docs', 'retro', 'history'];
```

`processes` **no** va en `stageSections`: no es una etapa del ciclo, es un inventario. Se renderiza por el mapeo genérico de la línea 81, que ya cubre toda sección del snapshot.

- [ ] **Step 6: Construir las secciones en el collector**

En `cli/src/core/dashboard/collect.ts`, donde se arma el array de secciones (alrededor de la línea 349), agregar `docs` entre `qa` y `retro` con la misma forma que las otras secciones de etapa, y agregar al final:

```ts
        section('processes', 'not_applicable', []),
```

- [ ] **Step 7: Correr toda la suite**

Run: `cd cli && npm run typecheck && npx jest --runInBand`
Expected: verde. Si algún test de integración (`doctor-dashboard.e2e.test.ts`, `published-doctor-evidence.e2e.test.ts`) tiene un snapshot fijado con `schema: 1`, actualizalo — es el mismo bump, no un hallazgo nuevo.

- [ ] **Step 8: Commit**

```bash
git add cli/src/core/dashboard/ cli/tests/core/dashboard/ cli/tests/integration/
git commit -m "feat(dashboard)!: schema 2 — secciones docs y processes"
```

---

### Task 9: La regla en `CONSTITUTION.md`

_Requirements: R6.7_

**Files:**
- Modify: `CONSTITUTION.md` (sección nueva, después de "Frontera atendido/desatendido")
- Test: `cli/tests/structural/documentation-phase-is-mechanized.test.ts`

> La regla se enuncia **apuntando al mecanismo**, nunca como sustituto del mecanismo. Ese es el error que este release entero existe para no repetir. Y como el requisito dice literalmente que el enunciado **no puede ser el único lugar donde la fase existe**, eso se verifica con un test estructural — no alcanza con escribirlo.

- [ ] **Step 1: Escribir el test estructural que falla**

Crear `cli/tests/structural/documentation-phase-is-mechanized.test.ts`, siguiendo el patrón de `cli/tests/structural/active-documentation.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('la fase de documentacion esta mecanizada, no solo enunciada', () => {
    it('CONSTITUTION.md enuncia la regla y nombra el marker', () => {          // verifies R6.7
        const text = read('CONSTITUTION.md');
        expect(text).toMatch(/awm-docs-complete/);
        expect(text).toMatch(/post-implementation-docs/);
    });

    it('CONSTITUTION.md apunta al mecanismo, no lo reemplaza', () => {         // verifies R6.7
        const text = read('CONSTITUTION.md');
        // debe citar el archivo que efectivamente hace cumplir la regla
        expect(text).toMatch(/plan-state\.ts/);
        expect(text).toMatch(/development-process/);
    });

    it('el enunciado NO es el unico lugar donde la fase existe', () => {       // verifies R6.7
        // Si esto pasa solo por CONSTITUTION.md, la regla es decorativa.
        expect(read('cli/src/core/dashboard/plan-state.ts')).toMatch(/docsComplete/);
        expect(read('cli/src/core/dashboard/plan-state.ts')).toMatch(/docs_pending/);
        expect(read('cli/src/core/dashboard/sanitize.ts')).toMatch(/docsComplete/);
        expect(read('cli/src/commands/evidence/index.ts')).toMatch(/awm-docs-complete/);
    });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd cli && npx jest --runInBand tests/structural/documentation-phase-is-mechanized.test.ts`
Expected: FAIL en el primer test — `CONSTITUTION.md` todavía no menciona el marker. Los assertions del tercer test ya deberían pasar si las Tasks 5–7 están hechas; si fallan, la task correspondiente quedó incompleta.

- [ ] **Step 3: Escribir la sección**

Insertar en `CONSTITUTION.md` después de la sección "Frontera atendido/desatendido":

```markdown
## Fase de documentación — obligatoria y observable

Todo ciclo de desarrollo termina con su documentación de usuario final al día. La fase corre entre `post-implementation-qa` y `harness-retro`, y cierra escribiendo `<!-- awm-docs-complete: YYYY-MM-DD -->` en el plan activo.

**Esta regla no se sostiene por estar escrita acá.** Se sostiene porque hay mecanismo: `development-process` rutea a `post-implementation-docs` cuando `awm-qa-complete` está y `awm-docs-complete` falta, y no avanza a retro ni a `finishing-a-development-branch` sin el marker; `classifyPlanState` (`cli/src/core/dashboard/plan-state.ts`) clasifica ese estado como `docs_pending` y `awm doctor` lo muestra. El enunciado de esta sección explica **por qué**; lo que la hace cumplir es la cadena de markers.

La razón de que esté acá y no solo en el código: la documentación de usuario final de AWM no deriva de golpe, deriva un cambio por vez, y cada cambio individual siempre parece demasiado chico como para justificar una pasada de documentación. `AGENTS.md` → "Patrones de documentación" tiene la evidencia de qué pasa cuando nadie paga ese costo en el momento: narrativa de comandos con errores factuales que sobrevivió spec-review y code-quality-review, porque la revisión leyó prosa en vez de ejecutar el binario.

Por eso la fase tiene una obligación que no es negociable: **documentar contra el binario, nunca contra la prosa**. Una afirmación sobre un comando que no se ejecutó no se escribe.

La fase es post-plan, o sea que corre del lado desatendido de la frontera descrita arriba. Está diseñada para ser resoluble por un agente solo, y su degradación es honesta: si el registry de documentación (opt-in) no está instalado, la fase corre igual con instrucciones genéricas y **nunca** bloquea el cierre de la rama.
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd cli && npx jest --runInBand tests/structural/documentation-phase-is-mechanized.test.ts`
Expected: PASS — 3 tests, 0 failures

- [ ] **Step 5: Verificar el presupuesto de contexto**

Run: `awm context-budget`
Expected: sin reporte (dentro de presupuesto). Si reporta, presentá el delta — `CONSTITUTION.md` se inyecta en toda sesión y esta sección le suma peso.

- [ ] **Step 6: Commit**

```bash
git add CONSTITUTION.md cli/tests/structural/documentation-phase-is-mechanized.test.ts
git commit -m "docs(constitution): fase de documentacion obligatoria, apuntando al mecanismo"
```

---

### Task 10: La documentación de usuario — la fase aplicada a sí misma

_Requirements: R6.4_

**Files:**
- Modify: `docs/guides/development-process.md`
- Modify: `docs/guides/dashboard-and-evidence.md`

> Este release agrega una fase que exige documentar lo que se envía. Cerrarlo sin documentarlo sería la refutación más limpia posible de su propia tesis.

- [ ] **Step 1: Inventario de documentación afectada**

Run:
```bash
grep -rn "awm-qa-complete\|awm-retro-complete\|retro_pending\|qa_pending" docs/ README.md
```
Expected: al menos `docs/guides/development-process.md` (la cadena de fases) y `docs/guides/dashboard-and-evidence.md` (los estados que muestra el dashboard). Anotá cada coincidencia: qué dice hoy · qué debería decir.

- [ ] **Step 2: Verificar contra el binario antes de escribir**

Run:
```bash
cd cli && npm run build
cd .. && node cli/dist/src/index.js doctor --full
```
Expected: la salida real, que es lo que se pega en la guía. **No escribas output de ejemplo plausible** — `AGENTS.md` documenta que es la fuente de error más común en documentación de comandos, y que `awm` del PATH puede ser una instalación global vieja desconectada de este working tree.

- [ ] **Step 3: Actualizar `docs/guides/development-process.md`**

Insertar la fase de documentación en la descripción de la cadena, entre QA y retro, con su marker y su disparador. Corregí toda afirmación que diga o implique que retro sigue inmediatamente a QA — se reemplaza, no se le agrega una nota que la contradiga.

- [ ] **Step 4: Actualizar `docs/guides/dashboard-and-evidence.md`**

Agregar `docs_pending` a la descripción de estados de plan, con el output real capturado en el Step 2. Documentar que la sección `processes` existe y hoy reporta "no aplica" — un lector que la vea vacía merece saber que es deliberado y no un bug.

- [ ] **Step 5: Verificar que lo escrito es cierto**

Run: `awm sensors run`
Expected: `overall: pass`. Correr **desde la raíz del repo** — desde `cli/` resuelve el `.awm/` equivocado y reporta `not_certified`.

Releé cada afirmación nueva y confirmá que corriste el comando que la respalda. Si no lo corriste, no la escribas.

- [ ] **Step 6: Escribir el marker de la fase en este mismo plan**

Agregar como primera línea después del `#` de este plan:

```markdown
<!-- awm-docs-complete: YYYY-MM-DD -->
```

Es el primer uso real del marker, y sirve de verificación de punta a punta: `awm doctor --full` debe pasar este plan de `docs_pending` a `retro_pending`.

- [ ] **Step 7: Commit**

```bash
git add docs/guides/development-process.md docs/guides/dashboard-and-evidence.md docs/plans/2026-08-23-documentation-phase-r0-plan.md
git commit -m "docs(guides): documentar la fase de documentacion y el estado docs_pending"
```

---

## Criterios de aceptación del release

Se verifican después de las diez tasks, antes de cerrar la rama.

- [ ] **CA-0.1** — un plan con `awm-qa-complete` presente y `awm-docs-complete` ausente reporta `docs_pending` en `awm doctor --full`. Verificable sobre este mismo plan antes del Step 6 de la Task 10.
- [ ] **CA-0.2** — la fase corre en modo desatendido de punta a punta, sin pausas, en un ciclo real.
- [ ] **CA-0.3** — con el registry de documentación ausente (que es el estado por defecto: es opt-in), la fase corre igual y la rama cierra. Verificable en este mismo ciclo, que no lo tiene instalado.
- [ ] **Entrega ordenada** — el contenido se taggea y publica **antes** de que el CLI mergee a `main`. Si el CLI llegara primero, los usuarios verían planes en `docs_pending` sin tener todavía el skill que produce el marker.

---

## Self-Review

### Matriz de trazabilidad

| Req | Task(s) | Test(s) |
|---|---|---|
| R6.1 | T1, T2, T3, T4 | `R6.1: el skill de documentacion se declara como fase entre QA y retro` · `R6.1: development-process rutea la fase entre QA y retro` · `R6.1: QA le cede el control a la fase de documentacion, no a finishing` · `R6.1: retro se declara disparado por el marker de documentacion` |
| R6.2 | T2, T6 | `R6.2: el marker de cierre es awm-docs-complete` · `R6.2: el estado Docs pending se gatea por el marker` · `R6.2: retro ya no se dispara con solo qa-complete` · `lee el marker awm-docs-complete del plan` |
| R6.3 | T5, T6, T7, T8 | `clasifica docs_pending…` · `vuelve a retro_pending…` · `conserva executed…` · `rechaza un marker desconocido` · `rechaza docsComplete no booleano` · `no filtra docs_pending al registro durable` · `sanitize conserva docsComplete` · `un ciclo historico retro_pending no retrocede` · `el snapshot declara schema 2` |
| R6.4 | T1, T10 | `R6.4: la verificacion es contra el binario real, no contra la prosa` (automático) + T10 Steps 2 y 5 (**verificación manual**, ver nota de precisión abajo) |
| R6.5 | T1 | `R6.5: la fase es resoluble sin humano presente` |
| R6.6 | T1, CA-0.3 | `R6.6: sin el registry de documentacion la fase corre igual y no bloquea` |
| R6.7 | T9 | `CONSTITUTION.md enuncia la regla y nombra el marker` · `CONSTITUTION.md apunta al mecanismo, no lo reemplaza` · `el enunciado NO es el unico lugar donde la fase existe` |
| R5.3 *(parcial)* | T8 | `processes queda declarada no aplicable hasta R1` — cobertura completa en R1, cuando llegue el adapter |

**Sin huecos hacia adelante:** cada `R6.#` tiene ≥1 task y ≥1 test.
**Sin huecos hacia atrás:** las diez tasks trazan a un requisito. T4 (empaque) traza a R6.1 porque un skill fuera del bundle es una fase que `development-process` rutea y no existe — sin él R6.1 no se cumple en una instalación real.

**Nota de precisión de la matriz (R6.4).** El test automático verifica que el skill **cite** `verify-cmd-source-before-documenting` y `runbook-as-script`; eso prueba que la instrucción está escrita, no que se haya ejecutado en un ciclo dado. La afirmación semántica de R6.4 — *que la documentación se verificó contra el binario* — se comprueba por lectura en los Steps 2 y 5 de la Task 10, no por proxy automático. Se declara acá en vez de fingir cobertura mecánica: un `grep` de una frase reusada probaría que la frase existe, no que la verificación ocurrió.

### Escaneo de placeholders

Sin `TBD`, sin "implementar después", sin "agregar manejo de errores apropiado", sin "similar a la Task N". Cada paso que cambia código muestra el código. Las dos únicas indirecciones son deliberadas y acotadas:

- **T6 Step 1** dice "usá los helpers que ya existen en ese archivo" en vez de inventarlos. Escribir helpers falsos que no coinciden con los reales sería peor que nombrar la restricción.
- **T8 Step 6** ubica la construcción de secciones "alrededor de la línea 349" porque las líneas se corren con las ediciones previas de la misma task. El ancla es `section('history', ...)`, que sí es estable.

### Consistencia de tipos

- `docsComplete` (no `docComplete`, no `documentationComplete`) en los cinco sitios: `plan-state.ts`, `sanitize.ts`, `collect.ts`, `evidence/index.ts`, y los tests.
- `docs_pending` (snake_case, como sus vecinos `qa_pending` / `retro_pending`), nunca `docsPending`.
- `awm-docs-complete` (kebab-case, como `awm-qa-complete` / `awm-retro-complete`).
- Sección del dashboard: `docs`, singular-plural consistente con `qa` / `retro` / `history`.
- `CycleEvidencePlanState` es el tipo angosto (contrato durable); `PlanState` es el ancho (estado vivo). T6 los separa y el compilador hace cumplir el borde.
- **`DashboardSnapshotV1` conserva su nombre con `schema: 2`.** `V1` nombra la familia del contrato, `schema` su versión — igual que `CycleEvidenceV1`. No renombrar.

### Propagación a tareas de UI

No aplica: ninguna task toca una pantalla diseñada, y el design doc no tiene sección `## UI Screens`. El único render involucrado es HTML de reporte generado por el CLI (`render-html.ts`), que no pasa por `.stitch/designs/`.

### Analyze Gate

- ✅ Todo requisito tiene ≥1 task **y** ≥1 test.
- ✅ Ninguna task ni test queda sin requisito ancla.

Gate verde. *(R5.3 figura como cobertura parcial declarada, no como hueco: su parte de R0 — el id de sección — está cubierta y testeada; el adapter es alcance de R1 por diseño.)*
