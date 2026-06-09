# Plan A — Vendoring de skills de diseño al registry AWM
<!-- awm-plan-closed: 2026-06-09 — superseded por 2026-05-31-new-skills-consolidated-plan.md (que fue ejecutado y cerrado con QA); cierre administrativo -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Traer las skills de diseño (frontend-craft + impeccable + 3 stitch-skills de Google) al `registry/` de AWM, registradas en `processes.json` y `skills-lock.json`, instalables vía `awm add`.

**Architecture:** `frontend-craft` es una skill nueva orquestadora con emil-design-eng y design-taste-frontend como referencias internas (sin colisión de triggers). `impeccable` se vendoriza con alcance acotado (knowledge + detector estático + sub-comandos no-live; sin la capa `live`/Codex). Las 3 stitch-skills de Google se copian desde su repo. La validación es estructural (tests jest sobre `registry/`), no funcional de prompts.

**Tech Stack:** Markdown (skills), JSON (processes.json, skills-lock.json), TypeScript + Jest (tests de validación del registry), Node (scripts de impeccable, intactos salvo paths).

**Scope:** Este es el Plan A (vendoring). El Plan B (integración al pipeline: Design Brief, gate frontend-craft, loop visual) se escribe después de ejecutar A, porque sus tareas referencian skills/paths que A crea.

**Spec de referencia:** `docs/plans/2026-05-29-design-skills-integration-design.md`

---

## File Structure

**Crear:**
- `registry/skills/frontend-craft/SKILL.md` — orquestador (único trigger frontend)
- `registry/skills/frontend-craft/reference/emil-design-eng.md` — conocimiento (copia del body de emil)
- `registry/skills/frontend-craft/reference/design-taste-frontend.md` — conocimiento (copia del body de design-taste)
- `registry/skills/impeccable/**` — árbol vendorizado y podado (motor de craft no-live)
- `registry/skills/extract-design-md/**` — stitch-skill de Google
- `registry/skills/code-to-design/**` — stitch-skill de Google
- `registry/skills/react-components/**` — stitch-skill de Google
- `cli/tests/registry/design-skills.test.ts` — test de validación estructural

**Modificar:**
- `registry/processes.json` — añadir `frontend-craft` a `core-dev`; crear proceso `frontend-design`
- `skills-lock.json` — añadir procedencia de las skills externas

**Fuentes en disco (ya instaladas vía skills.sh):**
- `~/.agents/skills/emil-design-eng/SKILL.md`
- `~/.agents/skills/design-taste-frontend/SKILL.md`
- `~/.agents/skills/impeccable/**`

---

## Task 1: Test de validación estructural (ancla TDD)

Define el estado final esperado del registry. Se escribe primero y falla; las tareas siguientes lo hacen pasar por bloques.

**Files:**
- Create: `cli/tests/registry/design-skills.test.ts`

- [ ] **Step 1: Escribir el test (falla en su totalidad al inicio)**

```typescript
import fs from 'fs';
import path from 'path';

const REGISTRY = path.join(__dirname, '..', '..', '..', 'registry');
const SKILLS = path.join(REGISTRY, 'skills');
const PROCESSES_FILE = path.join(REGISTRY, 'processes.json');
const LOCK_FILE = path.join(__dirname, '..', '..', '..', 'skills-lock.json');

function frontmatter(skill: string): string {
  const content = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  expect(match).not.toBeNull();
  return match![1];
}

describe('frontend-craft skill', () => {
  it('exists with valid frontmatter', () => {
    const fm = frontmatter('frontend-craft');
    expect(fm).toMatch(/^name:\s*frontend-craft\s*$/m);
    expect(fm).toMatch(/^description:\s*.+$/m);
  });

  it('bundles emil and taste as internal references', () => {
    const ref = path.join(SKILLS, 'frontend-craft', 'reference');
    expect(fs.existsSync(path.join(ref, 'emil-design-eng.md'))).toBe(true);
    expect(fs.existsSync(path.join(ref, 'design-taste-frontend.md'))).toBe(true);
  });

  it('SKILL.md points to its reference files', () => {
    const content = fs.readFileSync(path.join(SKILLS, 'frontend-craft', 'SKILL.md'), 'utf-8');
    expect(content).toMatch(/reference\/emil-design-eng\.md/);
    expect(content).toMatch(/reference\/design-taste-frontend\.md/);
  });
});

describe('impeccable skill (non-live scope)', () => {
  const base = path.join(SKILLS, 'impeccable');

  it('exists with valid frontmatter', () => {
    expect(fs.existsSync(path.join(base, 'SKILL.md'))).toBe(true);
  });

  it('has no literal .agents/skills/impeccable paths in markdown', () => {
    const mdFiles = [
      path.join(base, 'SKILL.md'),
      ...fs.readdirSync(path.join(base, 'reference')).map((f) => path.join(base, 'reference', f)),
    ];
    for (const f of mdFiles) {
      const content = fs.readFileSync(f, 'utf-8');
      expect(content).not.toMatch(/\.agents\/skills\/impeccable/);
    }
  });

  it('dropped the live/Codex layer', () => {
    expect(fs.existsSync(path.join(base, 'agents'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'reference', 'live.md'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'reference', 'codex.md'))).toBe(false);
    const liveScripts = fs.readdirSync(path.join(base, 'scripts')).filter((f) => /^live-/.test(f) || f === 'modern-screenshot.umd.js');
    expect(liveScripts).toEqual([]);
  });

  it('kept the static detector and non-live support scripts', () => {
    const scripts = path.join(base, 'scripts');
    for (const keep of ['detect.mjs', 'context.mjs', 'critique-storage.mjs', 'impeccable-paths.mjs']) {
      expect(fs.existsSync(path.join(scripts, keep))).toBe(true);
    }
    expect(fs.existsSync(path.join(scripts, 'detector'))).toBe(true);
  });

  it('removed the live row from the commands table', () => {
    const content = fs.readFileSync(path.join(base, 'SKILL.md'), 'utf-8');
    expect(content).not.toMatch(/\|\s*`live`\s*\|/);
  });
});

describe('google stitch skills', () => {
  for (const s of ['extract-design-md', 'code-to-design', 'react-components']) {
    it(`${s} exists with SKILL.md`, () => {
      expect(fs.existsSync(path.join(SKILLS, s, 'SKILL.md'))).toBe(true);
    });
  }
});

describe('processes.json', () => {
  const processes = JSON.parse(fs.readFileSync(PROCESSES_FILE, 'utf-8')) as Array<{
    name: string; skills: string[]; workflows: string[]; agents?: string[];
  }>;

  it('core-dev includes frontend-craft', () => {
    const core = processes.find((p) => p.name === 'core-dev');
    expect(core).toBeDefined();
    expect(core!.skills).toContain('frontend-craft');
  });

  it('frontend-design process exists with the heavy design skills', () => {
    const fd = processes.find((p) => p.name === 'frontend-design');
    expect(fd).toBeDefined();
    for (const s of ['impeccable', 'ui-design', 'extract-design-md', 'code-to-design', 'react-components']) {
      expect(fd!.skills).toContain(s);
    }
  });

  it('every skill referenced by any process exists on disk', () => {
    for (const p of processes) {
      for (const skill of p.skills) {
        expect(fs.existsSync(path.join(SKILLS, skill, 'SKILL.md'))).toBe(true);
      }
    }
  });
});

describe('skills-lock.json', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as { version: number; skills: Record<string, { source: string; sourceType: string }> };

  it('records provenance for the new external skills', () => {
    for (const s of ['emil-design-eng', 'design-taste-frontend', 'impeccable', 'extract-design-md', 'code-to-design', 'react-components']) {
      expect(lock.skills[s]).toBeDefined();
      expect(lock.skills[s].source).toMatch(/.+\/.+/);
      expect(lock.skills[s].sourceType).toBe('github');
    }
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd cli && npx jest tests/registry/design-skills.test.ts`
Expected: FAIL — todos los `describe` fallan (los archivos/entradas aún no existen).

- [ ] **Step 3: Commit**

```bash
git add cli/tests/registry/design-skills.test.ts
git commit -m "test(registry): validación estructural de skills de diseño (failing)"
```

---

## Task 2: Crear frontend-craft con emil y design-taste como referencias

Hace pasar el bloque `describe('frontend-craft skill')`.

**Files:**
- Create: `registry/skills/frontend-craft/reference/emil-design-eng.md`
- Create: `registry/skills/frontend-craft/reference/design-taste-frontend.md`
- Create: `registry/skills/frontend-craft/SKILL.md`

- [ ] **Step 1: Copiar el conocimiento de emil y design-taste como referencias**

```bash
mkdir -p registry/skills/frontend-craft/reference
cp ~/.agents/skills/emil-design-eng/SKILL.md registry/skills/frontend-craft/reference/emil-design-eng.md
cp ~/.agents/skills/design-taste-frontend/SKILL.md registry/skills/frontend-craft/reference/design-taste-frontend.md
```

- [ ] **Step 2: En cada referencia, neutralizar el frontmatter para que NO dispare como skill**

Editar el frontmatter de ambos archivos copiados. En `reference/emil-design-eng.md` y `reference/design-taste-frontend.md`, reemplazar el bloque `---\nname: ...\ndescription: ...\n---` por un encabezado de referencia plano (sin frontmatter de skill), p.ej. la primera línea:

```markdown
# Referencia: Emil Kowalski — Design Engineering (conocimiento de craft/animación)
```
y para el otro:
```markdown
# Referencia: tasteskill — Anti-Slop Frontend (Design Read, dials, hard-rules)
```
Eliminar las líneas `---`/`name:`/`description:` originales. Conservar TODO el resto del contenido (cuerpo íntegro). Esto evita que el discovery o el harness los traten como skills triggerables.

- [ ] **Step 3: Escribir el SKILL.md orquestador de frontend-craft**

```markdown
---
name: frontend-craft
description: Use during development when implementing or adjusting any frontend/UI surface (landing pages, dashboards, components, forms, layouts, responsive behavior, styling, animation, polish). The single entry point for frontend craft — applies anti-slop, typography, color and responsive rules, and escalates to the impeccable engine for UI-centric work. NOT for backend, API, CLI, or non-UI tasks.
---

# Frontend Craft

The single orchestrator for frontend craft during development. It exists because LLM-built UI defaults to generic, templated output. This skill injects taste and rules, and decides how deep to go.

**Announce at start:** "I'm using the frontend-craft skill to apply frontend craft."

## Knowledge base

This skill draws on two bundled references. Read the relevant one before acting:
- `reference/design-taste-frontend.md` — Design Read (infer the brief), dials, anti-slop tells, layout/typography/color hard-rules. Read FIRST for any new surface.
- `reference/emil-design-eng.md` — animation decision framework, springs, easing, micro-interactions, component polish. Read when motion/interaction quality matters.

## When invoked

1. **Read the Design Direction.** If the design doc has a `## Design Direction` section (from brainstorming), treat it as the brief. If absent, infer it using `reference/design-taste-frontend.md` §0 (Read the Room) before writing UI.
2. **Apply the always-on rules** from the references: typography scale, color calibration, spacing rhythm, responsive hard-rules, and the anti-slop / AI-tells checklist. These are mandatory for every UI task.
3. **Decide depth:**
   - **Minor change** (button, copy, single component tweak) → apply the rules directly, no escalation.
   - **UI-centric work** (a landing, a dashboard, a full page or redesign) → escalate to the `impeccable` engine: invoke its matching sub-command (`craft`/`shape` to build, `polish`/`audit`/`critique` to refine) per its routing rules.
4. **Self-check** against the anti-slop checklist before declaring the UI task done.

## Escalation contract

When escalating, hand impeccable the surface/target and the Design Direction. impeccable owns its own flow from there; return to the calling execution skill when it finishes.

## Boundaries

- Does NOT design screens from scratch in a tool — that is `ui-design` (Stitch), which runs earlier in the pipeline.
- Does NOT do backend/API/CLI work.
```

- [ ] **Step 4: Correr el bloque para verificar que pasa**

Run: `cd cli && npx jest tests/registry/design-skills.test.ts -t "frontend-craft skill"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add registry/skills/frontend-craft
git commit -m "feat(skills): frontend-craft orquestador con emil + design-taste como referencias"
```

---

## Task 3: Vendorizar impeccable (copiar árbol completo)

**Files:**
- Create: `registry/skills/impeccable/**` (copia desde `~/.agents/skills/impeccable`)

- [ ] **Step 1: Copiar el árbol completo**

```bash
mkdir -p registry/skills/impeccable
cp -R ~/.agents/skills/impeccable/. registry/skills/impeccable/
```

- [ ] **Step 2: Verificar la copia**

Run: `ls registry/skills/impeccable && ls registry/skills/impeccable/scripts | head`
Expected: aparecen `SKILL.md`, `agents/`, `reference/`, `scripts/`.

- [ ] **Step 3: Commit (snapshot intacto antes de podar)**

```bash
git add registry/skills/impeccable
git commit -m "chore(skills): vendor impeccable (snapshot intacto)"
```

---

## Task 4: Podar la capa live/Codex de impeccable

Hace pasar `it('dropped the live/Codex layer')` y `it('kept the static detector...')`.

**Files:**
- Delete: `registry/skills/impeccable/agents/` (dir completo)
- Delete: `registry/skills/impeccable/scripts/live-*.mjs`, `live-browser*.js`, `modern-screenshot.umd.js`
- Delete: `registry/skills/impeccable/reference/live.md`, `reference/codex.md`

- [ ] **Step 1: Eliminar la capa live/Codex**

```bash
cd registry/skills/impeccable
rm -rf agents
rm -f scripts/live-*.mjs scripts/live-browser.js scripts/live-browser-session.js scripts/modern-screenshot.umd.js
rm -f reference/live.md reference/codex.md
cd -
```

- [ ] **Step 2: Verificar que solo quedan scripts no-live**

Run: `ls registry/skills/impeccable/scripts | grep -E "^live|modern-screenshot" || echo "OK: sin scripts live"`
Expected: `OK: sin scripts live`

- [ ] **Step 3: Verificar que sobreviven los scripts clave**

Run: `ls registry/skills/impeccable/scripts/{detect.mjs,context.mjs,critique-storage.mjs,impeccable-paths.mjs} registry/skills/impeccable/scripts/detector`
Expected: todos existen.

- [ ] **Step 4: Commit**

```bash
git add -A registry/skills/impeccable
git commit -m "refactor(impeccable): podar capa live/Codex (fuera de alcance)"
```

---

## Task 5: Arreglar paths y quitar la fila `live` de impeccable

Hace pasar `it('has no literal .agents/skills/impeccable paths...')` y `it('removed the live row...')`.

**Files:**
- Modify: `registry/skills/impeccable/SKILL.md`
- Modify: `registry/skills/impeccable/reference/init.md`
- Modify: `registry/skills/impeccable/reference/critique.md`
- Modify: `registry/skills/impeccable/reference/polish.md`

- [ ] **Step 1: Reemplazar las invocaciones literales de path por resolución contra el dir de la skill**

En los 4 archivos de arriba, reemplazar TODA ocurrencia del prefijo literal:
```
.agents/skills/impeccable/scripts/
```
por una invocación relativa al directorio de la skill. Como las skills de Claude Code se invocan con un "Base directory" conocido, usar la forma:
```
"$CLAUDE_PLUGIN_ROOT/scripts/"
```
Si `$CLAUDE_PLUGIN_ROOT` no aplica en el harness destino, usar la ruta absoluta de instalación del skill. Patrón de reemplazo (ejemplo en SKILL.md):

- Antes: `` Run `node .agents/skills/impeccable/scripts/context.mjs` once per session. ``
- Después: `` Run `node "$CLAUDE_PLUGIN_ROOT/scripts/context.mjs"` once per session. ``

Aplicar el mismo reemplazo de prefijo a `context-signals.mjs`, `detect.mjs`, `pin.mjs` y cualquier otra invocación en init.md/critique.md/polish.md.

- [ ] **Step 2: Eliminar la fila `live` de la tabla de comandos en SKILL.md**

Borrar la línea de la tabla "## Commands":
```
| `live` | Iterate | Visual variant mode: pick elements in the browser, generate alternatives | [reference/live.md](reference/live.md) |
```
Y en "### Routing rules" / "## Pin / Unpin", eliminar las menciones a `live` (la regla del `devServer.running → live` y el bloque que invoca `live`). Donde el texto recomiende `live` para iteración visual, reemplazar por: "para iteración visual usá el loop de verificación visual del pipeline (Playwright)".

- [ ] **Step 3: Verificar que no quedan paths literales ni fila live**

Run: `grep -rn "\.agents/skills/impeccable" registry/skills/impeccable/SKILL.md registry/skills/impeccable/reference/ ; grep -n "\`live\`" registry/skills/impeccable/SKILL.md || echo "OK"`
Expected: sin coincidencias de `.agents/skills/impeccable`; sin fila `live`.

- [ ] **Step 4: Correr el bloque impeccable del test**

Run: `cd cli && npx jest tests/registry/design-skills.test.ts -t "impeccable skill"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add registry/skills/impeccable
git commit -m "fix(impeccable): resolver paths contra dir de skill + quitar comando live"
```

---

## Task 6: De-tuning de prosa GPT→Claude en impeccable

Calidad, no testeable estructuralmente. Acotado a prosa.

**Files:**
- Modify: `registry/skills/impeccable/SKILL.md` y `registry/skills/impeccable/reference/*.md` (los que mencionen GPT)

- [ ] **Step 1: Listar archivos con prosa GPT**

Run: `grep -rln "GPT\|Codex\|codex" registry/skills/impeccable/SKILL.md registry/skills/impeccable/reference/`
Expected: lista de archivos (SKILL.md + varias refs).

- [ ] **Step 2: Reescribir las menciones de prosa**

En cada archivo listado, reemplazar las frases con sabor GPT por su equivalente neutro/Claude. Reemplazos concretos:
- "GPT is capable of extraordinary work. Don't hold back." → "Produce extraordinary work. Don't hold back."
- "GPT" como sujeto que actúa → "you" / "the agent".
- Referencias a `reference/codex.md` (ya borrado) → eliminar la línea/enlace.
- Menciones a flujos Codex-only de `live` → eliminar (la capa live ya no existe).

NO tocar bloques de código ni nombres de scripts; solo prosa instruccional.

- [ ] **Step 3: Verificar que no quedan menciones GPT/Codex en prosa**

Run: `grep -rn "GPT\|Codex" registry/skills/impeccable/SKILL.md registry/skills/impeccable/reference/ || echo "OK: prosa de-tuneada"`
Expected: `OK: prosa de-tuneada` (o solo coincidencias en bloques de código legítimos, si los hubiera — revisar a mano).

- [ ] **Step 4: Commit**

```bash
git add registry/skills/impeccable
git commit -m "refactor(impeccable): de-tuning de prosa GPT a Claude"
```

---

## Task 7: Vendorizar las 3 stitch-skills de Google

Hace pasar `describe('google stitch skills')`.

**Files:**
- Create: `registry/skills/extract-design-md/**`
- Create: `registry/skills/code-to-design/**`
- Create: `registry/skills/react-components/**`

- [ ] **Step 1: Clonar el repo de Google en un temporal**

```bash
git clone --depth 1 https://github.com/google-labs-code/stitch-skills.git /tmp/stitch-skills
```
Expected: clona el repo.

- [ ] **Step 2: Copiar las 3 skills a registry/skills**

```bash
cp -R /tmp/stitch-skills/plugins/stitch-design/skills/extract-design-md registry/skills/extract-design-md
cp -R /tmp/stitch-skills/plugins/stitch-design/skills/code-to-design registry/skills/code-to-design
cp -R /tmp/stitch-skills/plugins/stitch-build/skills/react-components registry/skills/react-components
```

- [ ] **Step 3: Verificar que cada una tiene SKILL.md**

Run: `ls registry/skills/{extract-design-md,code-to-design,react-components}/SKILL.md`
Expected: los 3 existen. (Si la ruta interna del repo difiere, ajustar con `find /tmp/stitch-skills -name SKILL.md -path '*extract-design-md*'`.)

- [ ] **Step 4: Limpiar el temporal**

```bash
rm -rf /tmp/stitch-skills
```

- [ ] **Step 5: Correr el bloque stitch del test**

Run: `cd cli && npx jest tests/registry/design-skills.test.ts -t "google stitch skills"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add registry/skills/extract-design-md registry/skills/code-to-design registry/skills/react-components
git commit -m "feat(skills): vendor stitch-skills de Google (extract-design-md, code-to-design, react-components)"
```

---

## Task 8: Registrar en processes.json

Hace pasar `describe('processes.json')`.

**Files:**
- Modify: `registry/processes.json`

- [ ] **Step 1: Añadir `frontend-craft` al array `skills` del proceso `core-dev`**

En el objeto con `"name": "core-dev"`, agregar `"frontend-craft"` al final del array `skills` (antes del cierre `]`). Queda, p.ej., `..., "project-constitution", "frontend-craft"]`.

- [ ] **Step 2: Añadir el nuevo proceso `frontend-design`**

Agregar este objeto al array de processes (tras `core-dev` o al final):

```json
{
  "name": "frontend-design",
  "description": "Capa de diseño e implementación frontend: motor de craft (impeccable), diseño visual con Stitch (ui-design) y handoff Stitch→código (extract-design-md, code-to-design, react-components).",
  "skills": ["impeccable", "ui-design", "extract-design-md", "code-to-design", "react-components"],
  "workflows": [],
  "agents": []
}
```

- [ ] **Step 3: Verificar JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('registry/processes.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 4: Correr el bloque processes del test**

Run: `cd cli && npx jest tests/registry/design-skills.test.ts -t "processes.json"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add registry/processes.json
git commit -m "feat(registry): frontend-craft en core-dev + proceso frontend-design"
```

---

## Task 9: Registrar procedencia en skills-lock.json

Hace pasar `describe('skills-lock.json')`.

**Files:**
- Modify: `skills-lock.json`

- [ ] **Step 1: Añadir entradas de procedencia**

Dentro del objeto `"skills"` de `skills-lock.json`, agregar (el campo `computedHash` queda fuera de alcance: ninguna herramienta del CLI lo consume hoy; se registra solo `source` + `sourceType`):

```json
"emil-design-eng": { "source": "emilkowalski/skill", "sourceType": "github" },
"design-taste-frontend": { "source": "Leonxlnx/taste-skill", "sourceType": "github" },
"impeccable": { "source": "pbakaus/impeccable", "sourceType": "github" },
"extract-design-md": { "source": "google-labs-code/stitch-skills", "sourceType": "github" },
"code-to-design": { "source": "google-labs-code/stitch-skills", "sourceType": "github" },
"react-components": { "source": "google-labs-code/stitch-skills", "sourceType": "github" }
```

- [ ] **Step 2: Verificar JSON válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('skills-lock.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 3: Correr el bloque lock del test**

Run: `cd cli && npx jest tests/registry/design-skills.test.ts -t "skills-lock.json"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills-lock.json
git commit -m "chore(registry): registrar procedencia de skills de diseño en skills-lock"
```

---

## Task 10: Verificación completa del registry

**Files:** (ninguno nuevo — verificación)

- [ ] **Step 1: Correr toda la suite del CLI**

Run: `cd cli && npm test`
Expected: PASS, incluyendo `tests/registry/design-skills.test.ts` completo y sin romper los tests existentes de discovery/registry.

- [ ] **Step 2: Verificar discovery (dry-run de descubrimiento)**

Run desde `cli/`: `npx ts-node -e "import('./src/core/discovery').then(d=>{const s=new Set(d.discoverSkills().map(x=>x.name)); ['frontend-craft','impeccable','extract-design-md','code-to-design','react-components'].forEach(n=>console.log(n, s.has(n)));})"`

> Nota: `discoverSkills()` escanea `REGISTRY_DIR` (`~/.awm/registry/registry/skills`), que es el espejo remoto, no este repo. Este dry-run confirma la lógica; el descubrimiento real requiere que estos cambios estén en el remoto `Kodria/agentic-workflow` y un `awm update`. Verificar que el código de discovery no requiere cambios (solo lee directorios con SKILL.md — las skills nuevas cumplen).

Expected: la lógica reconoce skills con SKILL.md; no se necesita cambiar `discovery.ts`.

- [ ] **Step 3: Self-review final**

Confirmar:
- `frontend-craft` no colisiona (emil/design-taste sin frontmatter de skill).
- impeccable sin paths literales, sin capa live, sin prosa GPT.
- processes.json y skills-lock.json válidos y con todas las entradas.

---

## Self-Review (writing-plans)

**Spec coverage:**
- Inventario/roles → Task 2 (frontend-craft + refs).
- Vendoring impeccable + fix paths + de-tuning + alcance no-live → Tasks 3-6.
- Stitch-skills de Google → Task 7.
- processes.json (core-dev + frontend-design) → Task 8.
- skills-lock.json → Task 9.
- Validación → Tasks 1 y 10.
- **Fuera de alcance (Plan B):** Design Brief, gate en ejecución, loop visual. Documentado arriba.

**Placeholder scan:** Sin TBD/TODO. Los pasos de prosa (de-tuning) dan reemplazos concretos. Las rutas internas de las stitch-skills de Google se confirman con `find` en Task 7 Step 3 si difieren.

**Type consistency:** Nombres de skills consistentes entre processes.json, skills-lock.json y los directorios. El test (Task 1) referencia exactamente esos nombres.

**Riesgo conocido:** `$CLAUDE_PLUGIN_ROOT` (Task 5) depende del harness; si no resuelve, usar ruta absoluta de instalación. El test solo exige ausencia del path literal viejo, no la forma nueva, así que no bloquea.
