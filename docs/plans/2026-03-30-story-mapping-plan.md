# Story Mapping Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a `story-mapping` skill that facilitates User Story Mapping sessions (Jeff Patton methodology) with markdown as source of truth and future Miro visual sync capability.

**Architecture:** New skill following existing patterns (discovery-assistant as reference). SKILL.md with 3 operational modes (Generate, Live Accompaniment, Update). Story map template for template-wizard. Integration with docs-system-orchestrator routing and discovery-assistant suggestion.

**Tech Stack:** Markdown (SKILL.md, template), JSON (processes.json registration)

---

### Task 1: Create the Story Map template for template-wizard

**Files:**
- Create: `registry/skills/template-wizard/resources/templates/story-map-template.md`

**Step 1: Write the template file**

The template follows the exact pattern of `discovery-template.md` — YAML frontmatter with `template_purpose` and `interview_questions`, then markdown body with the Story Map structure from the design doc.

```markdown
---
template_purpose: "Framework de User Story Mapping para planificación de producto. Permite documentar progresivamente el mapa de historias de usuario a través de sesiones de planning colaborativas, siguiendo la metodología de Jeff Patton."
interview_questions:
  - "nombre_proyecto: ¿Cuál es el nombre del proyecto o producto?"
  - "personas: ¿Quiénes son los usuarios o personas principales del producto?"
  - "objetivo_producto: ¿Cuál es el objetivo principal del producto desde la perspectiva del usuario?"
  - "contexto_inicial: ¿Hay documentación existente del proyecto (discovery, specs, notas) que deba leer?"
  - "releases_planificados: ¿Cuántos releases o incrementos tienen en mente? (ej. MVP, Release 2, Backlog)"
---

# Story Map — {nombre_proyecto}

## Personas

### {Persona 1}
- **Rol:** …
- **Objetivo:** …
- **Pain points:** …

## Backbone

### 🟪 {Actividad 1}

#### Step: {Paso 1.1}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: _ | Acceptance: …

#### Step: {Paso 1.2}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: _ | Acceptance: …

## Release Summary

| Release | Stories | Effort estimate | Goal |
|---------|---------|-----------------|------|
| MVP | 0 | — | … |
| Release 2 | 0 | — | … |
| Backlog | 0 | — | … |

## Changelog

- [YYYY-MM-DD] Sesión 1: Story Map creado — …
```

**Step 2: Verify template follows existing patterns**

Run: `head -15 registry/skills/template-wizard/resources/templates/discovery-template.md`
Expected: YAML frontmatter with `template_purpose` and `interview_questions` — same pattern as our new template.

**Step 3: Commit**

```bash
git add registry/skills/template-wizard/resources/templates/story-map-template.md
git commit -m "feat: add story-map template for template-wizard"
```

---

### Task 2: Create the SKILL.md for story-mapping

**Files:**
- Create: `registry/skills/story-mapping/SKILL.md`

**Step 1: Create the skill directory and SKILL.md**

The SKILL.md follows the exact pattern of `discovery-assistant/SKILL.md`:
- YAML frontmatter with `name` and `description` (including trigger phrases)
- Paso 0: Context auto-discovery
- Paso 1: Mode detection table
- Modes A/B/C with numbered substeps
- Transversal rules
- Termination phase with `<TERMINATION_PHASE>` tags

```markdown
---
name: story-mapping
description: "Facilita sesiones de User Story Mapping (metodología Jeff Patton). Usa esta skill cuando el usuario quiera crear un Story Map desde documentación existente, ser acompañado en tiempo real durante una sesión de planning, o actualizar un Story Map existente. Activa ante frases como: 'quiero hacer un story mapping del proyecto X', 'vamos a hacer el story map', 'acompáñame en la sesión de planning', 'actualiza el story map con estas historias', 'repriorizar el story map', 'continuar el story mapping del proyecto X'."
---

# Story Mapping Assistant

Facilita el ciclo completo de User Story Mapping para planificación de producto. Opera en 3 modos según el contexto del usuario, documentando progresivamente en el repositorio del proyecto siguiendo la metodología de Jeff Patton.

**Principio core:** El Story Map es un artefacto vivo que organiza las necesidades del usuario en dos dimensiones — horizontal (el viaje del usuario) y vertical (la prioridad de entrega). Markdown es la fuente de verdad; herramientas visuales (Miro, etc.) son capas de presentación opcionales.

**Estructura del mapa (Jeff Patton):**
- **Backbone** (eje horizontal): Actividades de alto nivel del usuario → Steps/pasos dentro de cada actividad
- **Stories** (eje vertical): Historias de usuario debajo de cada step, ordenadas por prioridad
- **Releases** (cortes horizontales): MVP, Release 2, Backlog — cada slice entrega valor end-to-end

---

## Paso 0: Autodescubrimiento de Contexto

Antes de hacer cualquier pregunta al usuario:

1. **Lee `AGENTS.md`** en la raíz del repositorio activo (si existe). Extrae:
   - `docs_path` — directorio raíz de documentación
   - Estructura de directorios disponible
2. **Localiza el template de Story Map** usando búsqueda dinámica del patrón `template-wizard/resources/templates/story-map-template.md`
3. **Busca un Story Map existente** del proyecto mencionado en `{docs_path}/` (busca archivos que contengan "story-map" o el nombre del proyecto)
4. **Si el usuario indicó documentos fuente**, léelos y extrae: personas, flujos, problemas, scope/MVP
5. **Si el usuario NO indicó documentos fuente**, busca en el repositorio de documentación: discovery documents, specs, notas de reunión, cualquier documento relevante del proyecto

---

## Paso 1: Detectar Modo de Operación

Según el contexto del usuario, determina cuál de los 3 modos aplica:

| Señal del usuario | Modo |
|-------------------|------|
| "Quiero crear un story map", "genera el story map desde la documentación", "haz el story mapping del proyecto X" | **Modo A: Generar** |
| "Acompáñame en la sesión de planning", "vamos a mapear historias", "estamos en una sesión de story mapping" | **Modo B: Acompañar en Vivo** |
| "Actualiza el story map", "agrega estas historias", "reprioriza el MVP", "continuar el story mapping" | **Modo C: Actualizar** |

Si no queda claro, pregunta: *"¿Quieres que genere un Story Map desde documentación existente, que te acompañe en una sesión de planning en vivo, o que actualice un Story Map que ya existe?"*

---

## Modo A: Generar — Story Map desde documentación

Sigue estos pasos en orden:

### A1. Identificar fuentes de contexto

Si el usuario indicó documentos específicos, úsalos. Si no:
1. Busca en el repositorio de documentación del proyecto
2. Prioriza: discovery documents > specs > notas de reunión > cualquier otro documento
3. Presenta al usuario qué documentos encontraste y de cuáles extraerás contexto
4. Espera confirmación

### A2. Extraer y proponer Personas

Del contexto extraído:
1. Identifica los usuarios/actores principales
2. Propone las Personas con rol, objetivo y pain points
3. Presenta al usuario para confirmación: *"Identifiqué estas personas del proyecto. ¿Son correctas? ¿Falta alguna?"*

### A3. Proponer Backbone

Con las personas confirmadas:
1. Identifica las actividades de alto nivel que cada persona necesita completar
2. Para cada actividad, propone los steps/pasos en orden cronológico
3. Presenta el backbone completo: *"Este es el backbone propuesto — las actividades principales y sus pasos. ¿Ajustamos algo?"*

### A4. Proponer Stories por Release

Con el backbone confirmado:
1. Para cada step, propone user stories en formato: _Como {persona}, quiero {acción} para {beneficio}_
2. Organiza las stories en releases (MVP, Release 2, Backlog) según la prioridad detectada en la documentación
3. Presenta por actividad: *"Estas son las stories para la actividad {X}. ¿Ajustamos prioridades o agregamos algo?"*

### A5. Generar documento

1. Crea el archivo en `{docs_path}/50-projects/{nombre-proyecto}/story-map.md` usando el template
2. Rellena con las personas, backbone, stories y releases confirmados
3. Genera el Release Summary con conteo de stories por release
4. Agrega entrada en Changelog: `[{fecha}] Sesión 1: Story Map generado desde documentación — {n} actividades, {n} steps, {n} stories`
5. Presenta la ruta del documento y un resumen final

---

## Modo B: Acompañar en Vivo

El usuario está en una sesión de planning y quiere al asistente como copiloto en tiempo real.

### B1. Setup inicial

Carga o confirma el documento de Story Map del proyecto (si no existe, créalo con el template base).

Pregunta: *"¿Qué proyecto estamos mapeando? ¿Quiénes participan en la sesión?"*

### B2. Fase guiada — Backbone

Opera pregunta por pregunta para construir la estructura del mapa:

1. **Personas:** *"¿Para quién estamos construyendo? Descríbeme los usuarios principales."*
   - Registra cada persona con rol y objetivo
2. **Actividades:** *"¿Cuáles son las actividades principales que {persona} necesita hacer? Piensa en los grandes bloques de su recorrido."*
   - Registra cada actividad como elemento del backbone
3. **Steps:** Para cada actividad: *"¿Qué pasos concretos hace {persona} dentro de {actividad}? En orden cronológico."*
   - Registra los steps debajo de cada actividad

Tras completar el backbone: *"Backbone definido: {n} actividades con {n} steps. ¿Pasamos a las historias de usuario? Puedes describirlas en cualquier orden — yo las ubico en el lugar correcto."*

### B3. Fase captura libre — Stories

Cambia a modo reactivo. El usuario describe stories en cualquier orden:

**El usuario describe una story** → Tú:
1. La ubicas en el step y actividad correctos
2. Le asignas un release (pregunta si no es claro)
3. La redactas en formato: _Como {persona}, quiero {acción} para {beneficio}_
4. Confirmas brevemente: *"Registrada en {Actividad} > {Step} como [MVP]. ¿Sigo?"*

**El usuario quiere repriorizar** → Mueve la story al release indicado y confirma.

**El usuario quiere volver al modo guiado** → Retoma la secuencia de preguntas donde se dejó.

**El usuario dice "anota esto"** → Captura directamente sin reformatear.

### B4. Cierre de sesión

Cuando el usuario señale que la sesión terminó:
1. Genera o actualiza el documento con todo lo capturado
2. Actualiza el Release Summary con conteos
3. Agrega entrada en Changelog: `[{fecha}] Sesión {n}: {resumen de qué se hizo}`
4. Muestra resumen: actividades, steps, stories por release, decisiones tomadas
5. Pregunta: *"¿Hay algo que quieras ajustar antes de guardar?"*

---

## Modo C: Actualizar — Story Map existente

### C1. Cargar documento existente

Busca y carga el Story Map del proyecto. Si no lo encuentra, informa y ofrece crear uno (→ Modo A o B).

### C2. Mostrar estado actual

Presenta:
- Última entrada del Changelog
- Stats: n actividades, n steps, n stories por release
- Release Summary actual

### C3. Aceptar actualizaciones

Opera en modo reactivo:

**Nuevas stories** → Ubica en step y release correctos, actualiza conteos.
**Repriorización** → Mueve stories entre releases, actualiza Release Summary.
**Refinamiento** → Actualiza acceptance criteria, effort, status de stories existentes.
**Nuevo step o actividad** → Agrega al backbone en la posición correcta.

### C4. Cierre

1. Actualiza Changelog con resumen de cambios
2. Actualiza Release Summary
3. Muestra diff de cambios realizados
4. Pregunta: *"¿Algo más que actualizar?"*

---

## Reglas Transversales

- **No inventes stories.** Solo documenta lo que el usuario confirma explícitamente o lo que se extrae de documentación existente.
- **El template es inmutable.** No modifiques el template global. Solo modifica el documento de instancia del proyecto.
- **Un campo vacío es mejor que uno inventado.** Si no tienes dato para un campo, déjalo con su placeholder.
- **Confirma el backbone antes de las stories.** El backbone es la columna vertebral — si está mal, todo lo demás se desalinea.
- **Respeta la estructura Jeff Patton.** Actividades → Steps → Stories. No mezcles niveles.
- **Releases son cortes horizontales completos.** Cada release debe entregar valor end-to-end al usuario, no features aisladas. Si un release solo tiene stories de una actividad, señálalo como riesgo.

---

## <TERMINATION_PHASE>

Cuando el modo de operación concluya (documento generado, sesión cerrada, o actualización guardada), **DETENTE**.

Tu único paso final es:
1. Confirmar al usuario la ruta del documento actualizado y un resumen de cambios
2. Preguntar: *"¿Necesitas algo más del Story Map? Puedo acompañarte en otra sesión, actualizar con más historias, o si quieres continuar con otro paso de documentación, invoca `docs-system-orchestrator`."*
3. Esperar confirmación. No proceder automáticamente.
```

**Step 2: Verify directory was created**

Run: `ls -la registry/skills/story-mapping/`
Expected: `SKILL.md` file listed

**Step 3: Commit**

```bash
git add registry/skills/story-mapping/SKILL.md
git commit -m "feat: add story-mapping skill with 3 operational modes"
```

---

### Task 3: Register story-mapping in processes.json

**Files:**
- Modify: `registry/processes.json:8-15` (add `"story-mapping"` to the `docs` process skills array)

**Step 1: Add skill to docs process**

In the `docs` process object, add `"story-mapping"` to the `skills` array, after `"discovery-assistant"`:

```json
"skills": ["docs-system-orchestrator", "docs-brainstorming", "docs-assistant", "template-manager", "template-wizard", "documenting-modules", "business-documenting-modules", "c4-architecture", "init-docs-repo", "project-context-init", "discovery-assistant", "story-mapping", "architecture-advisor", "cicd-proposal-builder", "nfr-checklist-generator", "technology-evaluator"]
```

**Step 2: Verify JSON is valid**

Run: `python3 -c "import json; json.load(open('registry/processes.json'))"`
Expected: No output (valid JSON)

**Step 3: Commit**

```bash
git add registry/processes.json
git commit -m "feat: register story-mapping skill in docs process"
```

---

### Task 4: Add routing entry to docs-system-orchestrator

**Files:**
- Modify: `registry/skills/docs-system-orchestrator/SKILL.md:27-42` (add new row to routing table)

**Step 1: Add routing entry**

Add a new row to the routing table after the `discovery-assistant` entry (line 38):

```markdown
| **User Story Mapping** | `story-mapping` | Crear, actualizar o facilitar sesiones de Story Mapping para planificación de producto. Invocable directamente o sugerida desde discovery cuando el proyecto tiene suficiente contexto. |
```

**Step 2: Verify table renders correctly**

Read the modified section to ensure markdown table alignment is correct.

**Step 3: Commit**

```bash
git add registry/skills/docs-system-orchestrator/SKILL.md
git commit -m "feat: add story-mapping routing entry to docs-system-orchestrator"
```

---

### Task 5: Add Story Mapping suggestion to discovery-assistant

**Files:**
- Modify: `registry/skills/discovery-assistant/SKILL.md` (add suggestion in Mode C close and Mode B post-session)

**Step 1: Add suggestion to discovery-assistant termination phase**

Modify the `<TERMINATION_PHASE>` section (line 285-293). Update the question in step 2 to include a Story Mapping suggestion when the project has enough context:

Replace the existing termination question:
```markdown
2. Preguntar: *"¿Necesitas algo más del Discovery? Puedo actualizar con más información, acompañarte en la próxima sesión, o si quieres continuar con otro paso de documentación, invoca `docs-system-orchestrator`."*
```

With:
```markdown
2. Preguntar: *"¿Necesitas algo más del Discovery? Puedo actualizar con más información, acompañarte en la próxima sesión, o si quieres continuar con otro paso de documentación, invoca `docs-system-orchestrator`."*
3. **Sugerencia contextual de Story Mapping:** Si el documento de Discovery tiene la Etapa 1 (Alineación y Framing) sustancialmente completada — personas definidas, problema claro, scope/MVP esbozado — agrega: *"El proyecto tiene suficiente contexto para iniciar un User Story Map. ¿Quieres que invoque `story-mapping` para mapear las historias de usuario?"*
```

**Step 2: Verify the edit is clean**

Read the modified termination section to ensure formatting is correct.

**Step 3: Commit**

```bash
git add registry/skills/discovery-assistant/SKILL.md
git commit -m "feat: add story-mapping suggestion to discovery-assistant termination"
```

---

## Task Dependency Summary

```
Task 1 (template) ──┐
                     ├──→ Task 3 (processes.json) ──→ Task 4 (orchestrator routing) ──→ Task 5 (discovery suggestion)
Task 2 (SKILL.md) ──┘
```

Tasks 1 and 2 are independent and can be executed in parallel. Tasks 3-5 are independent of each other but depend on Tasks 1-2 being committed first.
