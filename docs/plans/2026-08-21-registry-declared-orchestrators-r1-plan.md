# Orquestadores declarados — Release 1 (capa de contenido) Implementation Plan

<!-- awm-qa-complete: 2026-08-22 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `use-awm` considere orquestadores declarados por cualquier registry instalado, sin tocar una sola línea del CLI.

**Architecture:** Todo el cambio vive en la capa de contenido. Se modifica la sección `## Orchestration` de `skills/using-awm/SKILL.md` en `awm-baseline-registry` para que deje de enumerar dos orquestadores fijos, y se blinda con un test de contrato al estilo de `tests/r8-sensor-gate-contract.test.mjs`. El descubrimiento es por visibilidad: los skills ya se enlazan a `~/.claude/skills/`, así que el agente ve el orquestador declarado sin que nadie componga nada. La guía de autoría se publica en `agentic-workflow`.

**Tech Stack:** Markdown (contenido de skills), `node:test` + `node:assert/strict` (tests de contrato), GitHub Actions (`validate.yml`, `auto-tag.yml`), bash (`scripts/check-skill-version-bumps.sh`).

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

## Contexto imprescindible para quien ejecute

Lee esto antes de la Task 1. Son cuatro hechos verificados que, si se ignoran, hacen fallar el release:

1. **Dos repos distintos.** Las Tasks 1–5 se ejecutan en `awm-baseline-registry`. La Task 6 se ejecuta en `agentic-workflow`. La rama de trabajo en ambos es `claude/notion-task-capture-integration-ymltjd`.

2. **Tocar un `SKILL.md` obliga a bumpear tres archivos.** `scripts/check-skill-version-bumps.sh` falla si `skills/*/SKILL.md` cambia sin que avance (a) su propio `version:` de frontmatter, y (b) la versión del bundle que lo contiene, **duplicada** en `bundles/<b>/bundle.json` y en `catalog.json`. `using-awm` pertenece al bundle `dev`.

3. **Un test nuevo no corre solo.** `tests/release-skill-version-gate.test.mjs` verifica que los workflows ejecuten los tests por nombre. Un archivo de test que no se agregue a `validate.yml` **y** a `auto-tag.yml` nunca se ejecuta en CI, y el plan habría producido una garantía decorativa.

4. **El registry personal es tuyo, no del agente.** La Task 7 requiere crear un repositorio privado que no existe y al que el agente no tiene acceso. Está marcada como acción del dueño.

## File Structure

| Archivo | Responsabilidad | Repo |
|---|---|---|
| `tests/r9-declared-orchestrators-contract.test.mjs` | Test de contrato: asegura que `using-awm` declara las reglas de orquestadores declarados y que no puede volver a enumerar dos orquestadores fijos sin fallar | `awm-baseline-registry` (crear) |
| `skills/using-awm/SKILL.md` | Sección `## Orchestration` reescrita + bump de `version:` | `awm-baseline-registry` (modificar) |
| `bundles/dev/bundle.json` | Bump de `version` del bundle que contiene `using-awm` | `awm-baseline-registry` (modificar) |
| `catalog.json` | Bump de la versión duplicada del bundle `dev` | `awm-baseline-registry` (modificar) |
| `.github/workflows/validate.yml` | Ejecutar el test nuevo en validación | `awm-baseline-registry` (modificar) |
| `.github/workflows/auto-tag.yml` | Ejecutar el test nuevo antes de tagear | `awm-baseline-registry` (modificar) |
| `docs/guides/authoring-a-registry-with-an-orchestrator.md` | Método de autoría reproducible | `agentic-workflow` (crear) |

---

### Task 1: Test de contrato para orquestadores declarados

_Requirements: R2.1, R2.2, R2.3, R2.4, R3.1, R3.2, R3.3, R5.3_

**Files:**
- Create: `tests/r9-declared-orchestrators-contract.test.mjs`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/r9-declared-orchestrators-contract.test.mjs` en `awm-baseline-registry`:

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');

const USING_AWM = 'skills/using-awm/SKILL.md';

/** Extrae la seccion ## Orchestration completa, sin el resto del skill. */
function orchestrationSection(text) {
  const start = text.indexOf('## Orchestration');
  assert.ok(start >= 0, 'using-awm must keep an ## Orchestration section');
  const rest = text.slice(start + 1);
  const nextHeading = rest.indexOf('\n## ');
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
}

test('R2.1: los orquestadores declarados se consideran antes que los dos existentes', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R2.1
  assert.match(section, /declared orchestrator/i,
    'the orchestration section must name declared orchestrators as a routing input');
  const declared = section.search(/declared orchestrator/i);
  const builtins = section.indexOf('`development-process`');
  assert.ok(declared >= 0 && builtins > declared,
    'declared orchestrators must be introduced before the built-in pair, matching their precedence');
});

test('R2.2: la precedencia entre declarados sale de la terminacion, no de un campo del framework', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R2.2
  assert.match(section, /termination/i,
    'ordering among declared orchestrators must be anchored to the termination contract');
  assert.doesNotMatch(section, /\bprecedence:\s|\bpriority:\s|\border:\s\d/i,
    'the framework must not introduce a precedence/priority/order field — that is process vocabulary');
});

test('R2.3: sin declarados aplicables, el ruteo es el actual y no se los menciona', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R2.3
  assert.match(section, /no declared orchestrator applies/i,
    'the section must state the fallback when nothing declared applies');
  assert.match(section, /`product-process`/,
    'the existing two-orchestrator routing table must survive intact');
});

test('R2.4: empate sin nombrarse => no aplicar ninguno', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R2.4
  assert.match(section, /two or more declared orchestrators[\s\S]{0,240}?none of them/i,
    'the tie case must resolve to applying none, never to an arbitrary pick');
});

test('R3.1 y R3.2: terminacion explicita y un solo orquestador activo', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R3.1, R3.2
  assert.match(section, /name(s)? (its|the) (successor|termination target|next)/i,
    'a declared orchestrator must name its termination target explicitly');
  assert.match(section, /one orchestrator active at a time/i,
    'the single-active-orchestrator invariant must be stated');
});

test('R3.3: destino no instalado degrada, no aborta', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R3.3
  assert.match(section, /not installed[\s\S]{0,200}?(continue|fall back)/i,
    'naming an uninstalled successor must degrade to the current routing, never abort the session');
});

test('R5.3: el contrato de declaracion no admite secretos', () => {
  const section = orchestrationSection(read(USING_AWM));   // verifies R5.3
  assert.match(section, /never (contain|carry|include) (credentials|secrets)/i,
    'the declaration contract must state that it carries no credentials or secrets');
});

test('RED mutation: volver a enumerar solo dos orquestadores es rechazado', () => {
  const original = read(USING_AWM);
  const weakened = original.replace(
    orchestrationSection(original),
    '## Orchestration\n\nAWM has two sibling orchestrators: `development-process` and `product-process`.\n',
  );
  assert.throws(
    () => {
      const section = orchestrationSection(weakened);
      assert.match(section, /declared orchestrator/i);
    },
    /declared orchestrator/i,
    'reverting to the hardcoded two-orchestrator table must fail this contract',
  );
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd /home/user/awm-baseline-registry
node tests/r9-declared-orchestrators-contract.test.mjs
```

Esperado: FAIL. Los primeros asserts fallan con `the orchestration section must name declared orchestrators as a routing input`, porque `## Orchestration` todavía enumera solo los dos orquestadores fijos.

- [ ] **Step 3: Commit del test en rojo**

```bash
cd /home/user/awm-baseline-registry
git add tests/r9-declared-orchestrators-contract.test.mjs
git commit -m "test: contrato de orquestadores declarados (RED)"
```

---

### Task 2: Reescribir la seccion Orchestration de using-awm

_Requirements: R2.1, R2.2, R2.3, R2.4, R3.1, R3.2, R3.3, R5.3_

**Files:**
- Modify: `skills/using-awm/SKILL.md` (sección `## Orchestration` y campo `version:` del frontmatter)

- [ ] **Step 1: Reemplazar la seccion `## Orchestration`**

Sustituir el bloque que hoy empieza en `## Orchestration` y termina justo antes de `## Red Flags` por este texto completo:

```markdown
## Orchestration

AWM routes a session to exactly one orchestrator. Two ship with the baseline; any installed registry may contribute more.

### Declared orchestrators (considered first)

An installed registry may contribute a **declared orchestrator**: a skill that presents itself as a session entry point, states in its own description when it applies, and names where it hands control afterwards. Consider these before the built-in pair below.

The declaration carries only four things — identity, when it applies, what it does, and its termination target. It never carries domain vocabulary of a particular process, and it must **never contain credentials or secrets** of any kind.

Rules:

- **Precedence.** A declared orchestrator that applies is considered before `development-process` and `product-process`.
- **Ordering among declared orchestrators comes from the termination contract, not from any framework field.** There is no precedence, priority or order attribute. A declared orchestrator names its successor when it finishes, exactly as `product-process` hands off to `development-process`.
- **One orchestrator active at a time.** A declared orchestrator runs to its terminal state and only then names its successor: another declared orchestrator, `development-process`, `product-process`, or none.
- **Tie.** If two or more declared orchestrators apply and none of them names the other, apply none of them and continue with the routing table below.
- **Uninstalled successor.** If a declared orchestrator names a termination target that is not installed, say so and continue with the routing table below — never abort the session.
- **Fail-safe.** If a declared orchestrator cannot run for any reason, including an external system it depends on being unavailable, say so and continue. It must never block the user from working.
- **Silence when absent.** If no declared orchestrator applies, route exactly as below and do not mention that declared orchestrators exist.

### The built-in pair

Route by what the session starts with:

| The session starts with… | Orchestrator |
|---|---|
| An idea/need WITHOUT a formed requirement ("I have an idea", "let's explore a new module"), an architecture evaluation or extraction request, or an existing brief to resume | `product-process` |
| A concrete requirement over code (defined feature, bug, refactor), or a certified-`ready` brief handed off to build | `development-process` |
| Ambiguous | ASK: "mature the idea (product layer) or build now (development)?" — never guess |

Precedence rule: `brainstorming` explores SOLUTION space and is invoked via `development-process` — never as the entry point for a raw business idea. `product-discovery` explores PROBLEM space.

Architecture disambiguation: a request for a full, standalone architecture evaluation that produces a portable, re-ingestible report ("assess this architecture", "diagnose whether this holds up") goes to `product-process` → `architecture-assessment`. A one-off advisory opinion mid-conversation with no report artifact ("what pattern fits here", "does this design make sense") stays with `architecture-advisor` directly (Specialized tier) — `architecture-assessment` itself invokes `architecture-advisor` in Contextual Mode for exactly this kind of targeted opinion, so the two are complementary, not competing entry points.

Anti-loss rules: one orchestrator active at a time; the brief is the baton between them (context crosses only inside the artifact); returning from development to product happens explicitly through `product-process`, never by improvising business answers mid-development.

For documentation tasks, the equivalent entry point is `docs-system-orchestrator`.
```

- [ ] **Step 2: Bumpear el `version:` del frontmatter**

En `skills/using-awm/SKILL.md`, cambiar la línea de versión. Es un cambio de comportamiento aditivo, así que corresponde minor:

```
version: "1.2.3"
```

pasa a:

```
version: "1.3.0"
```

- [ ] **Step 3: Correr el test para verificar que pasa**

```bash
cd /home/user/awm-baseline-registry
node tests/r9-declared-orchestrators-contract.test.mjs
```

Esperado: PASS en los ocho tests, incluida la mutación RED.

- [ ] **Step 4: Correr los contratos vecinos que leen este mismo archivo**

```bash
cd /home/user/awm-baseline-registry
node tests/session-start.test.mjs
node tests/codex-session-start.test.mjs
node tests/r3-retro-contract.test.mjs
node tests/r8-sensor-gate-contract.test.mjs
```

Esperado: PASS los cuatro. Si alguno falla, la reescritura rompió una aserción que otro contrato hacía sobre `using-awm` — arreglar antes de seguir, nunca relajar el test ajeno.

- [ ] **Step 5: Commit**

```bash
cd /home/user/awm-baseline-registry
git add skills/using-awm/SKILL.md
git commit -m "feat(using-awm): considerar orquestadores declarados antes que los dos existentes"
```

---

### Task 3: Bump de bundle y catalog

_Requirements: R4.2_

**Files:**
- Modify: `bundles/dev/bundle.json`
- Modify: `catalog.json`

- [ ] **Step 1: Bumpear la version del bundle `dev`**

En `bundles/dev/bundle.json`, cambiar:

```json
  "version": "3.2.0",
```

por:

```json
  "version": "3.3.0",
```

- [ ] **Step 2: Bumpear la version duplicada en `catalog.json`**

En `catalog.json`, la fila del bundle `dev`:

```json
    { "name": "dev",       "source": "./bundles/dev",       "version": "3.2.0", "scope": "baseline" },
```

pasa a:

```json
    { "name": "dev",       "source": "./bundles/dev",       "version": "3.3.0", "scope": "baseline" },
```

- [ ] **Step 3: Correr el gate de versiones para verificar que pasa**

```bash
cd /home/user/awm-baseline-registry
./scripts/check-skill-version-bumps.sh origin/main HEAD
```

Esperado: exit 0, sin líneas `FAIL:`. Si reporta `changed but its frontmatter version is unchanged`, falta el bump de la Task 2 Step 2. Si reporta un bundle desactualizado, falta uno de los dos bumps de esta task.

- [ ] **Step 4: Commit**

```bash
cd /home/user/awm-baseline-registry
git add bundles/dev/bundle.json catalog.json
git commit -m "chore(dev): bump de bundle por cambio de contrato en using-awm"
```

---

### Task 4: Cablear el test nuevo en los dos workflows

_Requirements: R2.1, R2.2, R2.3, R2.4, R3.1, R3.2, R3.3, R5.3_

Sin esta task el test existe pero **nunca corre en CI**, y la garantía es decorativa.

**Files:**
- Modify: `.github/workflows/validate.yml:30`
- Modify: `.github/workflows/auto-tag.yml:57`

- [ ] **Step 1: Agregar el test a `validate.yml`**

Después de la línea `      - run: node tests/r8-sensor-gate-contract.test.mjs`, insertar:

```yaml
      - run: node tests/r9-declared-orchestrators-contract.test.mjs
```

- [ ] **Step 2: Agregar el test a `auto-tag.yml`**

En el bloque de tests, después de `          node tests/r8-sensor-gate-contract.test.mjs`, insertar:

```yaml
          node tests/r9-declared-orchestrators-contract.test.mjs
```

- [ ] **Step 3: Verificar que ambos workflows lo referencian**

```bash
cd /home/user/awm-baseline-registry
grep -c 'r9-declared-orchestrators-contract' .github/workflows/validate.yml .github/workflows/auto-tag.yml
```

Esperado: `1` en cada archivo. Un `0` significa que el test quedó huérfano.

- [ ] **Step 4: Correr el gate de release para verificar que sigue verde**

```bash
cd /home/user/awm-baseline-registry
node tests/release-skill-version-gate.test.mjs
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/awm-baseline-registry
git add .github/workflows/validate.yml .github/workflows/auto-tag.yml
git commit -m "ci: ejecutar el contrato de orquestadores declarados en validate y auto-tag"
```

---

### Task 5: Suite completa en verde antes de publicar

_Requirements: R2.1, R2.2, R2.3, R2.4, R3.1, R3.2, R3.3, R5.3_

- [ ] **Step 1: Correr la suite entera tal como la corre CI**

```bash
cd /home/user/awm-baseline-registry
node scripts/validate-portability.mjs
node tests/validate-portability.test.mjs
node tests/r3-release-metadata.test.mjs
node tests/r3-retro-contract.test.mjs
node tests/r8-sensor-gate-contract.test.mjs
node tests/r9-declared-orchestrators-contract.test.mjs
node tests/release-skill-version-gate.test.mjs
node tests/codex-session-start.test.mjs
node tests/session-start.test.mjs
```

Esperado: todos PASS. Cualquier fallo se arregla acá, no después del tag.

- [ ] **Step 2: Push de la rama**

```bash
cd /home/user/awm-baseline-registry
git push -u origin claude/notion-task-capture-integration-ymltjd
```

---

### Task 6: Guia de autoria de un registry con orquestador

_Requirements: R4.1_

**Files:**
- Create: `docs/guides/authoring-a-registry-with-an-orchestrator.md` (repo `agentic-workflow`)

- [ ] **Step 1: Escribir la guia**

Crear el archivo con este contenido:

```markdown
# Crear un registry que aporte un orquestador

Un registry externo puede aportar un **orquestador declarado**: un proceso propio que AWM considera al inicio de la sesión, antes de `development-process` y `product-process`. Esta guía es el método reproducible; no hace falta copiar nada del registry base a mano.

## 1. Layout mínimo

Un registry es un repositorio git con al menos uno de los directorios de contenido en su raíz. Para aportar un orquestador alcanza con `skills/`:

```
mi-registry/
├── awm-registry.json
├── catalog.json
├── bundles/
│   └── mi-proceso/
│       └── bundle.json
└── skills/
    └── mi-proceso/
        └── SKILL.md
```

`awm registry add` valida este layout y **rechaza el registry si colisiona por nombre** con contenido ya instalado, revirtiendo el clon. Elegí nombres de skill específicos.

## 2. `awm-registry.json`

Declara la versión mínima de CLI que tu contenido necesita:

```json
{
  "minCliVersion": "8.1.5"
}
```

## 3. `catalog.json`

Enumera tus bundles. `scope` es `baseline` si querés que se instale por defecto, o `project` si es opt-in por proyecto:

```json
{
  "version": 1,
  "bundles": [
    { "name": "mi-proceso", "source": "./bundles/mi-proceso", "version": "1.0.0", "scope": "project" }
  ]
}
```

## 4. `bundles/mi-proceso/bundle.json`

```json
{
  "name": "mi-proceso",
  "version": "1.0.0",
  "description": "Mi proceso de trabajo propio.",
  "scope": "project",
  "dependsOn": [],
  "skills": ["mi-proceso"],
  "workflows": [],
  "agents": []
}
```

La versión está **duplicada** a propósito entre `catalog.json` y `bundle.json`, y las dos deben avanzar juntas en cada release.

## 5. `skills/mi-proceso/SKILL.md`

El frontmatter y las cuatro cosas que el contrato exige: identidad, cuándo aplica, qué hace, y a quién le cede el control.

```markdown
---
name: mi-proceso
version: "1.0.0"
description: Use when <la condición concreta en la que este proceso aplica>. Declared orchestrator.
---

# Mi proceso

## Cuándo aplica

<Redactalo filoso. Es lo único que el agente lee para decidir si te activa.
Un disparador vago activa de más; uno demasiado angosto no activa nunca.>

## Qué hace

<Los pasos del proceso.>

## Terminación

Este orquestador cede el control a `development-process` cuando termina.

<Nombrá exactamente uno: otro orquestador declarado, `development-process`,
`product-process`, o ninguno. Si nombrás uno que puede no estar instalado,
el agente lo informa y sigue con el ruteo normal — no aborta.>
```

**Nunca pongas credenciales ni tokens acá.** El registry se publica; el acceso a sistemas externos se resuelve por fuera.

## 6. Validar antes de publicar

Instalalo desde la ruta local, sin publicar nada:

```bash
awm registry add /ruta/a/mi-registry --name mi-proceso
awm registry status
```

Si el layout está mal o hay colisión de nombres, el comando falla y revierte el clon. Para volver atrás:

```bash
awm registry remove mi-proceso
```

## 7. Publicar

```bash
git tag v1.0.0
git push origin v1.0.0
```

En las máquinas que lo usen:

```bash
awm update
```

## Aislamiento

El registry se instala bajo `~/.awm/registries/` y sus skills se enlazan a `~/.claude/skills/`. **Nada toca el árbol versionado de tu repositorio de trabajo**, así que un registry personal instalado en tu máquina es invisible para quien clone ese repositorio. Verificalo con `git status --porcelain` después de instalar: debe salir vacío.
```

- [ ] **Step 2: Verificar que la guia no quedo con placeholders**

```bash
cd /home/user/agentic-workflow
grep -nE 'TBD|TODO|XXX' docs/guides/authoring-a-registry-with-an-orchestrator.md || echo "sin placeholders"
```

Esperado: `sin placeholders`.

- [ ] **Step 3: Commit y push**

```bash
cd /home/user/agentic-workflow
git add docs/guides/authoring-a-registry-with-an-orchestrator.md
git commit -m "docs(guides): metodo para crear un registry con orquestador declarado"
git push -u origin claude/notion-task-capture-integration-ymltjd
```

---

### Task 7: Registry personal real — ACCION DEL DUENO

_Requirements: R4.1, R4.2, R5.2_

**Esta task no la ejecuta el agente.** Requiere crear un repositorio privado nuevo, fuera del alcance de GitHub de la sesión. El agente puede preparar el contenido en un directorio local, pero la creación del repo y su publicación son tuyas.

- [ ] **Step 1: Crear el repositorio privado**

Crear `mi-proceso-registry` (o el nombre que prefieras) como repo **privado** en tu cuenta.

- [ ] **Step 2: Poblarlo siguiendo la guia de la Task 6**

Seguir `docs/guides/authoring-a-registry-with-an-orchestrator.md` de punta a punta. Este es el ejercicio real de `R4.1`: si algún paso de la guía no alcanza, la guía tiene un hueco y hay que corregirla.

- [ ] **Step 3: Verificar aislamiento (R5.2)**

Desde un repositorio de la compañía, con el registry ya instalado:

```bash
cd <cualquier-repo-corporativo>
git status --porcelain
```

Esperado: **salida vacía**. Cualquier archivo listado significa que el registry ensució el árbol versionado y `R5.2` no se cumple.

- [ ] **Step 4: Verificar propagacion por tag (R4.2)**

```bash
cd /ruta/a/mi-proceso-registry
git tag v1.0.1 && git push origin v1.0.1
awm update
awm registry status
```

Esperado: `awm registry status` reporta la versión nueva sin ningún paso manual adicional.

- [ ] **Step 5: Verificar activacion end-to-end**

Abrir una sesión en un repo cualquiera bajo una condición que cumpla el disparador declarado, y confirmar que el agente considera el orquestador declarado antes que `development-process`. Después abrir una sesión que **no** cumpla el disparador y confirmar que no se lo menciona (`R2.3`).

---

## Traceability matrix

| Req | Task(s) | Test(s) / verificación |
|---|---|---|
| R2.1 | T1, T2, T4 | `R2.1: los orquestadores declarados se consideran antes que los dos existentes` |
| R2.2 | T1, T2, T4 | `R2.2: la precedencia entre declarados sale de la terminacion...` — chequea además la **ausencia** de campos `precedence/priority/order` |
| R2.3 | T1, T2, T4, T7 | `R2.3: sin declarados aplicables, el ruteo es el actual...` + T7 Step 5 (sesión que no cumple el disparador) |
| R2.4 | T1, T2, T4 | `R2.4: empate sin nombrarse => no aplicar ninguno` |
| R3.1 | T1, T2, T4 | `R3.1 y R3.2: terminacion explicita y un solo orquestador activo` |
| R3.2 | T1, T2, T4 | `R3.1 y R3.2: terminacion explicita y un solo orquestador activo` |
| R3.3 | T1, T2, T4 | `R3.3: destino no instalado degrada, no aborta` |
| R4.1 | T6, T7 | **Verificación manual** — T7 Step 2. `CA-4.1` exige que una persona siga la guía y produzca un registry instalable; no hay proxy automatizable honesto para eso |
| R4.2 | T3, T7 | T3 Step 3 (`check-skill-version-bumps.sh` exit 0) + T7 Step 4 (`awm update` trae la versión nueva) |
| R5.2 | T7 | T7 Step 3 — `git status --porcelain` vacío. Automatizable y ejecutado contra instalación real |
| R5.3 | T1, T2, T4 | `R5.3: el contrato de declaracion no admite secretos` |

**Precisión de la matriz.** Los tests de T1 no cuentan ocurrencias de un marcador genérico: cada uno ancla la frase específica de su requisito (por ejemplo `R2.2` verifica positivamente la mención de *termination* **y** negativamente la ausencia de un campo de precedencia). `R4.1` es el único que descansa en lectura manual, y queda declarado como tal en vez de disfrazarse con un grep.

## Analyze gate

- Todo requisito tiene ≥1 task y ≥1 verificación: **sí** (11/11).
- Ninguna task o test sin requisito anclado: **sí**. T5 es ejecución de la suite existente, no aporta cobertura nueva y por eso comparte los IDs de T1.

## Fuera de alcance de este plan

Todo lo asignado a Release 2 en el design doc: manifiesto formal de declaración, validación de declaraciones malformadas (`R1.2`), composición en `buildContext` y cierre del bypass de Claude Code. Ver el plan de Release 2.

**Deuda conocida y aceptada:** en Release 1 nadie valida una declaración malformada. Un registry con un `SKILL.md` mal escrito no es rechazado — simplemente el agente lo lee mal o lo ignora. Se cierra en Release 2 con `R1.2`.
