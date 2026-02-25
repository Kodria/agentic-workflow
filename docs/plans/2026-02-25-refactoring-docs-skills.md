# Refactoring Documentation Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generalize existing documentation skills by removing CSCTI branding, establish the orchestrator as an active router, and implement robust path-agnostic resource discovery for multi-agent compatibility.

**Architecture:** Use `git mv` to rename the `cscti-` prefixed folders and workflow markdown files. Update the `SKILL.md` files internally to adopt a generalized tone, implement Option A (Contextual Self-Discovery using file-search tools bounding the scope to `.agents` or `.gemini`) for template skills, and rewrite the `docs-system-orchestrator`'s decision tree to automatically follow through by invoking `view_file` on the target skill. Finally, update the `processes.json` and workflow internal names to wire everything back together.

**Tech Stack:** Markdown, JSON, Bash (Git)

---

### Task 1: Rename and Refactor `docs-assistant`

**Files:**
- Move: `registry/skills/cscti-docs-assistant` -> `registry/skills/docs-assistant`
- Move: `registry/workflows/cscti-docs-assistant.md` -> `registry/workflows/docs-assistant.md`
- Modify: `registry/skills/docs-assistant/SKILL.md`
- Modify: `registry/workflows/docs-assistant.md`

**Step 1: Rename files and folders**

```bash
cd registry/skills
git mv cscti-docs-assistant docs-assistant
cd ../workflows
git mv cscti-docs-assistant.md docs-assistant.md
cd ../..
```

**Step 2: Update `SKILL.md` contents**

Use the replace_file_content tool on `registry/skills/docs-assistant/SKILL.md` to:
- Change `name: cscti-docs-assistant` to `name: docs-assistant`.
- Change references of "CSCTI" and "estándar CSCTI" to "estándar del proyecto" or "Docs-as-Code Assistant".
- Make sure tone remains professional and generalized.

**Step 3: Update workflow contents**

Use the replace_file_content tool on `registry/workflows/docs-assistant.md` to:
- Change the description to mention "docs-assistant" instead of "cscti-docs-assistant".
- Update the path to `~/.agents/skills/docs-assistant/SKILL.md`.

**Step 4: Commit**

```bash
git add registry/skills/docs-assistant registry/workflows/docs-assistant.md
git add registry/skills/cscti-docs-assistant registry/workflows/cscti-docs-assistant.md
git commit -m "refactor(docs): generalize cscti-docs-assistant to docs-assistant"
```

---

### Task 2: Rename and Refactor `template-manager`

**Files:**
- Move: `registry/skills/cscti-template-manager` -> `registry/skills/template-manager`
- Move: `registry/workflows/cscti-template-manager.md` -> `registry/workflows/template-manager.md`
- Modify: `registry/skills/template-manager/SKILL.md`
- Modify: `registry/workflows/template-manager.md`

**Step 1: Rename files and folders**

```bash
cd registry/skills
git mv cscti-template-manager template-manager
cd ../workflows
git mv cscti-template-manager.md template-manager.md
cd ../..
```

**Step 2: Update `SKILL.md` contents**

Use the replace_file_content tool on `registry/skills/template-manager/SKILL.md` to:
- Change `name: cscti-template-manager` to `name: template-manager`.
- Add a new "Paso 0: Autodescubrimiento Contextual de Recursos" instructing the agent to dynamically find its resources folder `template-wizard/resources` via its file search tools within the current run context (`.agents` or `.gemini`) before executing any other logic.
- Replace all hardcoded occurrences of `~/.agents/skills/cscti-template-wizard/resources/templates/` with instructions to use the dynamically discovered path.

**Step 3: Update workflow contents**

Use the replace_file_content tool on `registry/workflows/template-manager.md` to:
- Change the description and title to mention "template-manager".
- Update the path to `~/.agents/skills/template-manager/SKILL.md`.

**Step 4: Commit**

```bash
git add registry/skills/template-manager registry/workflows/template-manager.md
git add registry/skills/cscti-template-manager registry/workflows/cscti-template-manager.md
git commit -m "refactor(docs): generalize cscti-template-manager and add contextual self-discovery"
```

---

### Task 3: Rename and Refactor `template-wizard`

**Files:**
- Move: `registry/skills/cscti-template-wizard` -> `registry/skills/template-wizard`
- Move: `registry/workflows/cscti-template-wizard.md` -> `registry/workflows/template-wizard.md`
- Modify: `registry/skills/template-wizard/SKILL.md`
- Modify: `registry/workflows/template-wizard.md`

**Step 1: Rename files and folders**

```bash
cd registry/skills
git mv cscti-template-wizard template-wizard
cd ../workflows
git mv cscti-template-wizard.md template-wizard.md
cd ../..
```

**Step 2: Update `SKILL.md` contents**

Use the replace_file_content tool on `registry/skills/template-wizard/SKILL.md` to:
- Change `name: cscti-template-wizard` to `name: template-wizard`.
- Add "Paso 0: Autodescubrimiento Contextual de Recursos" instructing the agent to dynamically find its own `resources/templates/` directory using file search tools.
- Replace all hardcoded references to `~/.agents/skills/cscti-template-wizard/resources/templates/` with instructions to use the dynamically discovered path.
- Remove "CSCTI" verbiage for pure generalization.

**Step 3: Update workflow contents**

Use the replace_file_content tool on `registry/workflows/template-wizard.md` to:
- Change description and title to "template-wizard".
- Update the path to `~/.agents/skills/template-wizard/SKILL.md`.

**Step 4: Commit**

```bash
git add registry/skills/template-wizard registry/workflows/template-wizard.md
git add registry/skills/cscti-template-wizard registry/workflows/cscti-template-wizard.md
git commit -m "refactor(docs): generalize cscti-template-wizard and add contextual self-discovery"
```

---

### Task 4: Upgrade `docs-system-orchestrator` to Automatic Router

**Files:**
- Modify: `registry/skills/docs-system-orchestrator/SKILL.md`

**Step 1: Update the skill logic**

Use the replace_file_content tool on `registry/skills/docs-system-orchestrator/SKILL.md` to:
- Update the "Inventario de Skills" section to reflect the new names (`docs-assistant`, `template-wizard`, etc.).
- Rewrite the "Árbol de Decisión / Enrutamiento" to clearly state that the Orchestrator MUST NOT suggest commands to the user. Instead, it MUST use `view_file` to inspect the target skill's `SKILL.md` (e.g. `~/.agents/skills/docs-assistant/SKILL.md` or via search if not found), assimilate its instructions into the current session context, and execute those steps automatically.

**Step 2: Commit**

```bash
git add registry/skills/docs-system-orchestrator/SKILL.md
git commit -m "refactor(docs-orchestrator): upgrade to automatic router pattern"
```

---

### Task 5: Update Master Registry `processes.json`

**Files:**
- Modify: `registry/processes.json`

**Step 1: Replace old references**

Use the replace_file_content tool on `registry/processes.json` to:
- Find any occurrences of `cscti-docs-assistant`, `cscti-template-wizard`, or `cscti-template-manager`.
- Replace them with their respective new non-prefixed names.

**Step 2: Commit**

```bash
git add registry/processes.json
git commit -m "chore(registry): sync process dependencies to renamed docs skills"
```
