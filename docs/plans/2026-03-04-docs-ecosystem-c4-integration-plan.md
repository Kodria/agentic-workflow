# Docs Ecosystem C4 Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate `c4-architecture` into the documentation ecosystem by creating `docs-brainstorming`, evolving `docs-assistant` and `template-manager` with a subdelegation protocol, and updating the orchestrator's routing catalog.

**Architecture:** Create a new `docs-brainstorming` skill that acts as the collaborative discovery phase for documentation needs. Evolve `docs-assistant` and `template-manager` to support dual-mode operation (Plan Mode + Direct Mode) and a shared subdelegation protocol for invoking support skills. Update the orchestrator catalog and `processes.json` to wire everything together.

**Tech Stack:** Markdown SKILL.md files (no executable code), JSON config (`processes.json`)

**Design Doc:** `docs/plans/2026-03-04-docs-ecosystem-c4-integration-design.md`

---

## Task 1: Create `docs-brainstorming` skill

**Files:**
- Create: `registry/skills/docs-brainstorming/SKILL.md`

**Context:** This is the core new skill. It must follow the same YAML frontmatter convention as all other skills in `registry/skills/`. Reference existing skills for tone and structure: `registry/skills/brainstorming/SKILL.md` (for the collaborative dialogue pattern) and `registry/skills/template-wizard/SKILL.md` (for the autodiscovery pattern of templates).

**Step 1: Create the directory**

```bash
mkdir -p registry/skills/docs-brainstorming
```

**Step 2: Write `SKILL.md`**

Create `registry/skills/docs-brainstorming/SKILL.md` with the following complete content:

```markdown
---
name: docs-brainstorming
description: "Use before any documentation work — explores user intent, analyzes repository context, and produces a documentation plan. Routes to docs-assistant (for documents) or template-manager (for templates)."
---

# Documentation Brainstorming

## Overview

Help turn documentation needs into fully formed documentation plans through natural collaborative dialogue.

Start by autonomously exploring the project context, then ask questions one at a time to refine the documentation need. Once you understand what needs to be documented, present the plan and get user approval.

<HARD-GATE>
Do NOT invoke any execution skill, write any document, or take any implementation action until you have presented a documentation plan and the user has approved it. This applies to EVERY documentation request regardless of perceived simplicity.
</HARD-GATE>

## Checklist

You MUST create a task for each of these items and complete them in order:

1. **Explore project context** — analyze repo structure, existing docs, and available templates
2. **Ask clarifying questions** — one at a time, understand what to document and for whom
3. **Classify the need** — documentation (→ docs-assistant) or template (→ template-manager)
4. **Present documentation plan** — with entregables, destinos, and support skills needed
5. **Write plan document** — save to `docs/plans/YYYY-MM-DD-docs-<topic>-plan.md`
6. **Transfer control** — invoke the executor skill indicated in the plan

## Process Flow

### Step 0: Autonomous Context Exploration

Before asking the user anything, gather context silently:

1. **Read `AGENTS.md`** in the project root (if it exists). Parse the YAML frontmatter (`agent_context`) to extract:
   - `docs_path` — the root documentation directory.
   - `directories.dir_drafts` — the drafts directory.
2. **Scan existing documentation** in `{docs_path}/` to understand what is already documented.
3. **Autodiscover templates** (both global and local):
   - **Global templates:** Use file search tools to find `template-wizard/resources/templates` across skill directories (`.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.). These are read-only reference templates installed by the AWM CLI.
   - **Local templates:** Check `{docs_path}/templates/` or `docs/templates/` relative to the project root. These are project-specific overrides.
4. **Scan source code** if the request appears to involve technical or architecture documentation — identify key modules, services, and structure.

### Step 1: Collaborative Dialogue

Ask questions **one at a time** to refine the documentation need:

- What do you want to document? (module, architecture, process, standard, etc.)
- Who is the target audience? (developers, PMs, DevOps, executives)
- Is this new documentation or improvement of existing?
- Do you need architecture diagrams? (C4 context, containers, components)
- What type of document? (or detect from context)
- Any specific constraints or requirements?

**Principles:**
- **One question at a time** — do not overwhelm the user
- **Prefer multiple choice** when possible
- **Use discovered context** — reference what you found in Step 0 to make questions more relevant (e.g., "I see you already have docs for module X but not Y, is Y what you want to document?")

### Step 2: Classify the Need

Based on the dialogue, determine the executor:

| Need | Executor | When |
|------|----------|------|
| Create/improve/format documentation | `docs-assistant` | Any document that will live in `{docs_path}/` |
| Create/edit a reusable template | `template-manager` | Work on template standards in `docs/templates/` |

### Step 3: Generate Documentation Plan

Write a documentation plan to `docs/plans/YYYY-MM-DD-docs-<topic>-plan.md` with this format:

~~~markdown
# Plan de Documentación: [Título]

> **Para el ejecutor:** Este plan fue generado por `docs-brainstorming`.
> Usa la skill indicada en "Ejecutor" para implementarlo entregable por entregable.

**Objetivo:** [Una oración describiendo qué se busca]
**Ejecutor:** `docs-assistant` | `template-manager`
**Audiencia:** [Para quién es la documentación]
**Idioma:** Español

---

## Contexto Recopilado

[Todo el contexto descubierto: estructura del repo, docs existentes,
código analizado, templates disponibles, decisiones del usuario.
Este bloque debe ser suficiente para que el ejecutor trabaje sin
preguntar nada adicional sobre contexto.]

## Entregables

### Entregable 1: [Nombre del documento/template]
- **Tipo:** Documento técnico | ADR | Runbook | Template | ...
- **Destino:** `{docs_path}/architecture/c4-context.md`
- **Plantilla base:** `adr-template.md` (si aplica)
- **Requiere skill de apoyo:** `c4-architecture` | `template-wizard` | ninguna
- **Contexto específico:** [Detalle de qué debe contener este entregable,
  información relevante del código, decisiones del usuario]

### Entregable N: [Nombre]
- **Tipo:** ...
- **Destino:** ...
- **Requiere skill de apoyo:** ...
- **Contexto específico:** ...

---

## Criterios de Aceptación
- [ ] [Criterio 1]
- [ ] [Criterio 2]
~~~

**Critical rules for the plan:**
- The "Contexto Recopilado" section must be **self-contained** — the executor must be able to work without asking context questions.
- Each entregable must specify whether it requires a support skill and which one.
- The plan must be written in **Spanish** (matching the documentation ecosystem convention).

### Step 4: User Approval

Present the plan to the user. Wait for explicit approval.
- If the user requests changes → iterate on the plan.
- If the user approves → save the plan and proceed to Step 5.

### Step 5: Transfer Control

1. Save the plan document to `docs/plans/`.
2. Inform the user: *"Plan aprobado y guardado. Transfiriendo control a `[executor skill]`."*
3. Locate and read the executor skill's `SKILL.md` using dynamic autodiscovery.
4. Execute the executor skill's instructions, passing the plan as context.

**The terminal state is invoking the executor skill.** Do NOT invoke any other skill. The ONLY skills you transfer to are `docs-assistant` or `template-manager`.

## Key Principles

- **One question at a time** — Don't overwhelm with multiple questions
- **Multiple choice preferred** — Easier to answer than open-ended when possible
- **Context-driven** — Use what you discovered in Step 0 to make dialogue efficient
- **Self-contained plans** — The plan document must have ALL context the executor needs
- **YAGNI** — Don't suggest documentation the user hasn't asked for
- **No hallucination** — Only include information explicitly discovered or stated by the user
```

**Step 3: Verify the file**

Run: `cat registry/skills/docs-brainstorming/SKILL.md | head -3`
Expected: The YAML frontmatter header with `name: docs-brainstorming`

**Step 4: Commit**

```bash
git add registry/skills/docs-brainstorming/SKILL.md
git commit -m "feat: create docs-brainstorming skill for collaborative documentation discovery"
```

---

## Task 2: Evolve `docs-assistant` — Add Plan Mode and Subdelegation Protocol

**Files:**
- Modify: `registry/skills/docs-assistant/SKILL.md` (replace entire content)

**Context:** The current `docs-assistant` is a rigid 6-step state machine (51 lines). We need to restructure it to support dual-mode operation (Plan Mode when a documentation plan exists, Direct Mode preserving the current behavior) and add the subdelegation protocol. Read the current file at `registry/skills/docs-assistant/SKILL.md` before modifying.

**Step 1: Write the evolved `SKILL.md`**

Replace the entire content of `registry/skills/docs-assistant/SKILL.md` with:

```markdown
---
name: docs-assistant
description: "Use this skill to create, review, format, and finalize documentation following Docs-as-Code standards. Supports plan-driven execution with subdelegation to support skills (e.g., c4-architecture for diagrams)."
---

# Docs-as-Code Assistant

## Context

You are the Docs-as-Code Assistant, a strict but collaborative AI document creator and formatter. Your goal is to produce high-quality documentation adhering to the *Docs-as-Code* standards defined in the repository's `AGENTS.md` contract.

**CRITICAL RULE:** Do NOT hallucinate or invent architectural details, processes, or scope. Only use information explicitly provided by the user or included in the documentation plan.

## Step 0: Read Repository Contract

- **Read `AGENTS.md`** in the project root. Parse the YAML frontmatter block (`agent_context`) to extract:
  - `docs_path` — the root documentation directory.
  - `directories.dir_drafts` — the drafts directory (defaults to `{docs_path}/drafts`).
- **Use these paths** for all subsequent path references.

## Step 1: Detect Mode of Operation

Determine how this skill was invoked:

- **Plan Mode:** A documentation plan (generated by `docs-brainstorming`) was provided or referenced. The plan is a `.md` file in `docs/plans/` with the format `YYYY-MM-DD-docs-*-plan.md` containing structured entregables.
  → Proceed to **Plan Mode Execution** (Step 2P).

- **Direct Mode:** No documentation plan exists. The user is invoking this skill directly (e.g., to format a draft, improve an existing document).
  → Proceed to **Direct Mode Execution** (Step 2D).

---

## Plan Mode Execution

### Step 2P: Read and Parse the Plan

1. Read the documentation plan `.md` file.
2. Extract:
   - **Contexto Recopilado** — use this as your primary source of information. Do NOT ask context questions that are already answered here.
   - **Entregables** — the list of deliverables to produce, with their types, destinations, support skill requirements, and specific context.
   - **Criterios de Aceptación** — the definition of done.

### Step 3P: Execute Entregable by Entregable

For each entregable in the plan, execute the following loop:

**a. Evaluate support skill need:**
- Check the entregable's "Requiere skill de apoyo" field.
- Also evaluate implicitly: does this entregable contain blocks that require specialized capabilities?
- If a support skill is needed → follow the **Subdelegation Protocol** (below).

**b. Generate/compose the document:**
- Use the "Contexto específico" from the plan as input.
- If a "Plantilla base" is specified, locate the template using dynamic autodiscovery (search `template-wizard/resources/templates` across `.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.) and use it as the structural base.
- Incorporate any output from support skills into the appropriate sections.

**c. Apply Docs-as-Code formatting:**
- Validate filename is `kebab-case.md`.
- Validate basic Markdown syntax (single H1 title, proper heading hierarchy).
- Ensure tone is professional, direct, and in Spanish.

**d. Present to user:**
- Show the complete document to the user for review.

**e. Iterate until approval:**
- If the user requests changes → apply modifications and present again.
- If the user approves → finalize this entregable and proceed to the next one.

### Step 4P: Finalization

After all entregables are approved:
1. Move/write each document to its designated destination (the "Destino" field in the plan).
2. Update the relevant `README.md` index file in the target directory with a link to the new document.
3. DO NOT modify the root repository `README.md` or governance files like `CODEOWNERS` or `CONTRIBUTING.md`.
4. Report completion to the user.

---

## Direct Mode Execution (Legacy Flow)

This mode preserves the original behavior for direct invocations without a plan.

### Step 2D: Context Gathering
- Ask the user a short initial questionnaire:
  - "What is the general topic of this document?"
  - "What type of document is this? (e.g., ADR, Standard, Process, Runbook, Overview)"
- Wait for the user's reply before proceeding.

### Step 3D: Format Analysis
- Check the files in `{dir_drafts}/`.
- Validate filename is `kebab-case.md`.
- Validate basic Markdown syntax (e.g., a single H1 title).
- Automatically correct format errors or instruct the user if manual intervention is needed.

### Step 4D: Structure Analysis
- Use file search tools to dynamically locate the folder `template-wizard/resources/templates` within your execution environment. Search across common skill directories (`.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.). Store the discovered absolute path for subsequent use.
- Compare the draft against the official template based on the document type defined in step 2D.
- Identify any missing required sections.

### Step 5D: Content Refinement
- Initiate an iterative Q&A loop.
- Ask **exactly ONE question per missing or incomplete section** at a time.
- Wait for their answer and fill the document section.
- If the user explicitly says a section is "Not Applicable", document the justification instead of forcing it.
- Ensure the tone is professional, direct, and in Spanish.

### Step 6D: Finalization & Indexing
- Perform a final check (Professional tone, Spanish, No project-specific leaks unless it belongs in the appropriate directory).
- Move the file from `{dir_drafts}/` to its final directory.
- Update the relevant `README.md` index file in that specific target directory with a link to the new document.
- DO NOT modify the root repository `README.md` or governance files like `CODEOWNERS` or `CONTRIBUTING.md`.
- Conclude by notifying the user that the document is ready.

---

## Subdelegation Protocol for Support Skills

When executing an entregable (in Plan Mode) or a document section (in Direct Mode) and you encounter a block that requires specialized capabilities, follow this protocol:

### SD-1: Detection

Identify the need for support via:
- **Explicit:** The documentation plan indicates "Requiere skill de apoyo: `<name>`" in the entregable.
- **Implicit:** During execution you detect that a document block requires specialized capabilities (e.g., an "Architecture" section that needs C4 diagrams).

### SD-2: Registry Lookup

Check the Support Skills Registry (below) for a skill that covers the detected need.
- If a match exists → proceed to SD-3.
- If NO match exists → inform the user that no support skill is available for this block type. Offer: (a) generate the content with your best judgment, or (b) leave the section marked as `<!-- TODO: pending — requires specialized skill -->` for manual completion.

### SD-3: User Confirmation

Before invoking the support skill, inform the user:
- Which skill you will invoke and why.
- What context you will pass to it.
- **Wait for explicit approval.**

### SD-4: Invocation

1. Locate the support skill's `SKILL.md` using dynamic autodiscovery (search across `.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.).
2. Read the `SKILL.md` to load its instructions.
3. Pass relevant context from the documentation plan:
   - The "Contexto Recopilado" block.
   - The specific entregable being worked on.
   - Clear instructions of what output is needed.
4. Execute the support skill's workflow.

### SD-5: Incorporation

- Take the output generated by the support skill.
- Incorporate it into the document you are building, in the correct location.
- Continue with the next block or entregable.

### Support Skills Registry

| Block Type | Skill | Detect when... |
|------------|-------|----------------|
| C4 architecture diagrams | `c4-architecture` | The entregable requires system context, container, component, deployment, or dynamic flow diagrams |
| Document from existing template | `template-wizard` | An entregable needs to instantiate a new document based on an official template (ADR, Runbook, etc.) |

> **Extensibility:** To add a new support skill, add a row to this table with the block type it covers, the skill name, and the detection conditions.
```

**Step 2: Verify the file**

Run: `head -3 registry/skills/docs-assistant/SKILL.md`
Expected: YAML frontmatter with `name: docs-assistant`

Run: `grep -c "## " registry/skills/docs-assistant/SKILL.md`
Expected: A count showing all major sections are present (approximately 18-20 headings)

**Step 3: Commit**

```bash
git add registry/skills/docs-assistant/SKILL.md
git commit -m "feat: evolve docs-assistant with Plan Mode and subdelegation protocol"
```

---

## Task 3: Evolve `template-manager` — Add Plan Mode and Subdelegation Protocol

**Files:**
- Modify: `registry/skills/template-manager/SKILL.md` (replace entire content)

**Context:** The current `template-manager` has 71 lines with a 5-step flow (Ingreso → Evaluación → Bifurcación → Aprobación → Guardado). We add the same dual-mode pattern as `docs-assistant`. Read the current file at `registry/skills/template-manager/SKILL.md` before modifying.

**Step 1: Write the evolved `SKILL.md`**

Replace the entire content of `registry/skills/template-manager/SKILL.md` with:

```markdown
---
name: template-manager
description: "Administra las plantillas de documentación del proyecto. Úsala cuando necesites crear un nuevo formato de documentación transversal o mejorar uno existente. Supports plan-driven execution with subdelegation to support skills."
---

# Template Manager

## Paso 0: Autodescubrimiento Contextual de Recursos

Before interacting with the user or reading project files, you MUST dynamically locate your template directories.

### 0.1 Plantillas Globales (`TEMPLATES_DIR`) — Solo Lectura (Referencia)
- Use file search tools (e.g., `find_by_name`) to find the pattern `template-wizard/resources/templates` within your execution environment.
- Search across: `.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.
- Store the discovered absolute path as `TEMPLATES_DIR`.
- **Do NOT hardcode paths.** If the directory is not found, inform the user and stop.
- **⚠️ READ-ONLY.** Global templates come from the AWM central registry and must NEVER be modified by this skill.

### 0.2 Plantillas Locales (`LOCAL_TEMPLATES_DIR`) — Directorio de Trabajo
- Define `LOCAL_TEMPLATES_DIR` as `docs/templates/` relative to the current project root.
- If the directory does not exist, it will be created when the user approves saving a template.
- **All write operations (create, edit, overwrite) happen EXCLUSIVELY here.**

## Paso 1: Detección de Modo de Operación

Determine how this skill was invoked:

- **Modo Plan:** A documentation plan (generated by `docs-brainstorming`) was provided or referenced. The plan is a `.md` file in `docs/plans/` with structured entregables of type "Template".
  → Proceed to **Modo Plan** (Paso 2P).

- **Modo Directo:** No documentation plan exists. The user is invoking this skill directly.
  → Proceed to **Modo Directo** (Paso 2D).

---

## Modo Plan

### Paso 2P: Lectura del Plan

1. Read the documentation plan `.md` file.
2. Extract:
   - **Contexto Recopilado** — primary source of information.
   - **Entregables** — the list of template deliverables with types, destinations, and support skill requirements.
   - **Criterios de Aceptación** — definition of done.

### Paso 3P: Ejecución por Entregable

For each entregable in the plan:

**a. Evaluate support skill need:**
- Check the entregable's "Requiere skill de apoyo" field.
- If a support skill is needed → follow the **Protocolo de Subdelegación** (below).

**b. Execute the corresponding flow:**
- Determine whether this entregable requires Creation, Edition, or Override based on the plan context and the current state of global/local templates.
- **Creación:** Generate template body in Markdown + YAML frontal metadata (`template_purpose`, `interview_questions`).
- **Edición:** Apply modifications to an existing local template.
- **Override:** Copy a global template to local, apply modifications.

**c. Present to user:**
- Show the complete template (Markdown + YAML) for review.

**d. Iterate until approval:**
- If the user requests changes → apply and present again.
- If the user approves → save and proceed to the next entregable.

### Paso 4P: Guardado

- Write/overwrite the approved template(s) to `{LOCAL_TEMPLATES_DIR}`.
- **IMPORTANT:** Results are NEVER saved to `{TEMPLATES_DIR}` (global). Always to `docs/templates/`.
- Create the directory if it does not exist.
- Filenames must follow `kebab-case` convention.

---

## Modo Directo (Legacy Flow)

This mode preserves the original behavior for direct invocations without a plan.

### Paso 2D: Ingreso del Concepto
- Extract the intention from the user's request (e.g., "A DB standard" or "Improve the ADR template").

### Paso 3D: Evaluación de Similitudes
- List and read YAML metadata from files in **both** directories:
  - `{TEMPLATES_DIR}` (global templates — read-only).
  - `{LOCAL_TEMPLATES_DIR}` (local templates — if exists).
- Reason whether the concept is already covered (fully or partially) by an existing template, analyzing `template_purpose`.
- If a match is found, present it to the user indicating whether it is **global** or **local**, and offer:
  - **A) Local Override** (if global: copy to `docs/templates/` and edit the copy).
  - **B) Edit/Update** (only if already local).
  - **C) Create from scratch** (in `docs/templates/`).
- If no match, proceed transparently to "Creation from Scratch".

### Paso 4D: Bifurcación de Flujos

**Flow A: Creation from Scratch**
- Ask only the high-level clarification questions needed to understand scope.
- In a single autonomous step, propose the Markdown body and the YAML frontal metadata with `template_purpose` and `interview_questions`.

**Flow B: Edit Existing Local Template**
- Ask what aspects of the current template the user wants to evolve.
- Propose the rewritten template (Markdown + YAML) incorporating changes coherently.

**Flow C: Local Override of Global Template**
- Copy the complete content of the selected global template.
- Apply the modifications requested by the user on the copy.
- **IMPORTANT:** The original file in `{TEMPLATES_DIR}` is NOT touched.

### Paso 5D: Aprobación Conversacional
- Present the proposed design (Markdown + YAML) complete in the chat.
- Wait for feedback. Adjust iteratively if the user requests modifications.

### Paso 6D: Guardado Directo
- When the user explicitly approves, write/overwrite the file in `{LOCAL_TEMPLATES_DIR}`.
- Create `docs/templates/` if it does not exist.
- Filename must follow `kebab-case` convention.
- Confirm to the user that the task is complete.

---

## Protocolo de Subdelegación a Skills de Apoyo

When executing an entregable and you encounter a block that requires specialized capabilities, follow this protocol:

### SD-1: Detección

Identify the need via:
- **Explícita:** The plan indicates "Requiere skill de apoyo: `<name>`" in the entregable.
- **Implícita:** During execution you detect that a template block requires specialized capabilities.

### SD-2: Consulta del Registro

Check the Support Skills Registry (below).
- If a match exists → proceed to SD-3.
- If NO match exists → inform the user. Offer: (a) generate the content with best judgment, or (b) leave the section marked as pending.

### SD-3: Confirmación con el Usuario

Before invoking, inform the user:
- Which skill you will invoke and why.
- What context you will pass.
- **Wait for explicit approval.**

### SD-4: Invocación

1. Locate the skill's `SKILL.md` using dynamic autodiscovery.
2. Read the `SKILL.md` to load instructions.
3. Pass relevant context from the plan.
4. Execute the support skill's workflow.

### SD-5: Incorporación

- Take the output and incorporate it into the template in the correct location.
- Continue with the next block or entregable.

### Registro de Skills de Apoyo

| Tipo de Bloque | Skill | Detectar cuando... |
|----------------|-------|--------------------|
| Diagramas de arquitectura C4 | `c4-architecture` | El entregable requiere diagramas de contexto, contenedores, componentes, despliegue o flujos dinámicos |
| Documento desde plantilla existente | `template-wizard` | Un entregable necesita instanciar un documento nuevo basado en una plantilla oficial |

> **Extensibilidad:** Para agregar una nueva skill de apoyo, agregar una fila a esta tabla.
```

**Step 2: Verify the file**

Run: `head -3 registry/skills/template-manager/SKILL.md`
Expected: YAML frontmatter with `name: template-manager`

Run: `grep "Modo Plan\|Modo Directo\|Protocolo de Subdelegación" registry/skills/template-manager/SKILL.md`
Expected: All three major new sections present

**Step 3: Commit**

```bash
git add registry/skills/template-manager/SKILL.md
git commit -m "feat: evolve template-manager with Plan Mode and subdelegation protocol"
```

---

## Task 4: Update `docs-system-orchestrator` catalog

**Files:**
- Modify: `registry/skills/docs-system-orchestrator/SKILL.md:23-35` (replace the catalog table)

**Context:** The orchestrator's skill catalog needs two new entries: `docs-brainstorming` as the main entry point for documentation work, and `c4-architecture` as a direct route for diagram-only requests. The existing entries for `docs-assistant`, `template-wizard`, and `template-manager` are preserved but annotated as "direct" routes.

**Step 1: Replace the catalog section**

In `registry/skills/docs-system-orchestrator/SKILL.md`, replace the current catalog table (lines 23-35, from `## Catálogo de Skills` through the last table row) with:

```markdown
## Catálogo de Skills

Identifica el requerimiento según la siguiente tabla:

| Necesidad / Estado | Skill Destino | Cuándo usar |
|--------------------|---------------|-------------|
| **Crear/Mejorar Documentación** | `docs-brainstorming` | Cualquier necesidad de documentación nueva, mejora, diagramas o redacción. Punto de entrada principal del flujo de documentación. |
| **Crear Diagramas de Arquitectura (solo)** | `c4-architecture` | Cuando el usuario pide EXCLUSIVAMENTE diagramas C4, sin documentación narrativa adicional. |
| **Inicializar Documentación Base** | `project-context-init` | Iniciar proyectos, crear o actualizar el `AGENTS.md` dinámico del entorno. |
| **Documentar Código Desarrollado** | `documenting-modules` | Documentación técnica post-desarrollo. Extraer el "Cómo", diagramas y flujos de código o infraestructura. |
| **Documentar Funcionalidad / Negocio** | `business-documenting-modules` | Documentación funcional orientada a PMs/Negocio (ej. para Notion). Extraer el "Qué" y "Por qué" del código existente. |
| **Mejorar/Oficializar Borrador (directo)** | `docs-assistant` | Formatear un borrador existente directamente, sin pasar por brainstorming. Uso rápido para tareas puntuales. |
| **Crear Documento desde Plantilla (directo)** | `template-wizard` | Instanciar un nuevo documento (ADR, Runbook, Guía, etc) directamente desde una plantilla existente. Uso rápido. |
| **Crear/Editar una Plantilla (directo)** | `template-manager` | Crear o editar un archivo de plantilla directamente, sin pasar por brainstorming. Uso rápido para tareas puntuales. |
```

**Step 2: Verify the change**

Run: `grep "docs-brainstorming\|c4-architecture" registry/skills/docs-system-orchestrator/SKILL.md`
Expected: Both new skill names appear in the catalog

Run: `grep -c "Skill Destino" registry/skills/docs-system-orchestrator/SKILL.md`
Expected: 1 (single table header)

**Step 3: Commit**

```bash
git add registry/skills/docs-system-orchestrator/SKILL.md
git commit -m "feat: update orchestrator catalog with docs-brainstorming and c4-architecture routes"
```

---

## Task 5: Update `processes.json` — Add new skills to `docs` process

**Files:**
- Modify: `registry/processes.json:12` (update the skills array of the `docs` process)

**Context:** The `docs` process bundle needs to include `docs-brainstorming` and `c4-architecture` so the CLI installs them together when a user runs `awm add` for the docs process.

**Step 1: Update the skills array**

In `registry/processes.json`, replace the current `docs` skills array:

```json
"skills": ["docs-system-orchestrator", "docs-assistant", "template-manager", "template-wizard", "documenting-modules", "business-documenting-modules"]
```

With:

```json
"skills": ["docs-system-orchestrator", "docs-brainstorming", "docs-assistant", "template-manager", "template-wizard", "documenting-modules", "business-documenting-modules", "c4-architecture"]
```

**Step 2: Verify valid JSON**

Run: `cat registry/processes.json | python3 -m json.tool > /dev/null && echo "Valid JSON"`
Expected: "Valid JSON"

Run: `grep "docs-brainstorming\|c4-architecture" registry/processes.json`
Expected: Both skill names appear in the docs process skills array

**Step 3: Commit**

```bash
git add registry/processes.json
git commit -m "feat: add docs-brainstorming and c4-architecture to docs process bundle"
```

---

## Summary of All Tasks

| Task | Action | File(s) | Description |
|------|--------|---------|-------------|
| 1 | Create | `registry/skills/docs-brainstorming/SKILL.md` | New skill for collaborative documentation discovery |
| 2 | Modify | `registry/skills/docs-assistant/SKILL.md` | Add Plan Mode + Subdelegation Protocol |
| 3 | Modify | `registry/skills/template-manager/SKILL.md` | Add Plan Mode + Subdelegation Protocol |
| 4 | Modify | `registry/skills/docs-system-orchestrator/SKILL.md` | Update routing catalog |
| 5 | Modify | `registry/processes.json` | Add new skills to docs bundle |

**Total: 5 tasks, 5 files, 5 commits.**
