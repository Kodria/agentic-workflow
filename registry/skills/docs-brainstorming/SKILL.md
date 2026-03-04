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
