# Project-Local Templates Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement project-local template overrides in `template-wizard` and restrict `template-manager` to local-only writes within `docs/templates/`.

**Architecture:** 
1. `template-wizard`: Read global templates, then check for `docs/templates/`. If local templates exist, extract their `template_purpose` and use them to overwrite/append to the global catalog in memory before prompting the user.
2. `template-manager`: Restrict write operations strictly to `docs/templates/`. If editing a global template, copy it to the local folder, edit the copy, and save it there. 

**Tech Stack:** Node.js, `fs` (File System), `path`.

---

### Task 1: Add Local Support to `template-wizard` Discovery

**Files:**
- Modify: `registry/skills/template-wizard/SKILL.md` (Update the instructions to reflect local override support)

**Step 1: Write the failing test / preparation**
Read `SKILL.md` to identify where the discovery logic is documented.

Run: `cat registry/skills/template-wizard/SKILL.md`
Expected: Shows Step 2 "Fase de Descubrimiento" without mention of local templates.

**Step 2: Write minimal implementation**
Update `registry/skills/template-wizard/SKILL.md` to instruct the agent to overlay `./docs/templates/` on top of `TEMPLATES_DIR`.

```markdown
2. **Fase de Descubrimiento**
   - El agente DEBE listar y leer todos los archivos en el catálogo base `{TEMPLATES_DIR}` (plantillas globales).
   - Extraer el bloque YAML inicial prestando atención al campo `template_purpose`.
   - **Override Local:** El agente DEBE verificar si existe la carpeta `./docs/templates/` en el proyecto actual.
     - Si existe, listar y leer todos los archivos allí. Extraer su `template_purpose`.
     - Si un propósito local coincide con uno global, la plantilla local **reemplaza** a la global en el catálogo disponible para esta sesión. Si es nuevo, se agrega al catálogo.
```

**Step 3: Run test to verify it passes**
Run: `cat registry/skills/template-wizard/SKILL.md | grep "Override Local"`
Expected: PASS (Outputs the new section)

**Step 4: Commit**
```bash
git add registry/skills/template-wizard/SKILL.md
git commit -m "feat(template-wizard): support local template overrides from docs/templates"
```

### Task 2: Refactor `template-manager` Scope

**Files:**
- Modify: `registry/skills/template-manager/SKILL.md`

**Step 1: Write the failing test / preparation**
Run: `cat registry/skills/template-manager/SKILL.md`
Expected: Writing operations point to global `{TEMPLATES_DIR}`.

**Step 2: Write minimal implementation**
Update the algorithm in `registry/skills/template-manager/SKILL.md` to restrict writes exclusively to `./docs/templates/`.

```markdown
5. **Guardado Directo (Commitment)**
   - Cuando el usuario apruebe la versión explícitamente, escribir/sobrescribir el archivo en la carpeta local del proyecto `docs/templates/`.
   - **IMPORTANTE:** Si el usuario editó una plantilla global desde `{TEMPLATES_DIR}`, el resultado modificado NO SE GUARDA allí. Se guarda en `docs/templates/` para que actúe como un override local específico de este proyecto, protegiendo el registry global.
   - El nombre del archivo debe seguir la convención kebab-case (ej. `docs/templates/nuevo-modelo-template.md`). Crear la carpeta si no existe.
```

**Step 3: Run test to verify it passes**
Run: `cat registry/skills/template-manager/SKILL.md | grep "docs/templates/"`
Expected: PASS (Outputs the restricted path)

**Step 4: Commit**
```bash
git add registry/skills/template-manager/SKILL.md
git commit -m "feat(template-manager): restrict writes to local docs/templates directory"
```
