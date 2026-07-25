# Codex Baseline Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que los 37 skills del baseline estable `v1.5.2`, el agente `development-process` y la recuperación de sesión sean canónicos y ejecutables en Codex sin crear forks por provider.

**Architecture:** El registry conservará un único cuerpo por skill y expresará operaciones en vocabulario neutral; las equivalencias exactas vivirán en referencias de provider. Un validador Node sin dependencias externas bloqueará vocabulario runtime obsoleto, divergencias estructurales y regresiones del contrato del orquestador.

**Tech Stack:** Markdown con frontmatter, Node.js 20+ para validación y hook, shell sólo para comandos de verificación, JSON de bundles/catalog.

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

## Orden y dependencias

Este es el plan 2 de 3 y se ejecuta en `/Users/cencosud/Developments/personal/awm-baseline-registry`.

Prerequisito: completar el plan `docs/plans/2026-07-24-codex-cli-provider-plan.md` en el repo `agentic-workflow`. El checkout de trabajo observado al escribir este plan estaba en `v1.4.0`, mientras el release público actual es `v1.5.2` con el bundle `product`, `mermaid-diagrams` y versiones de bundle posteriores; antes de crear la rama de implementación se debe ejecutar `git fetch origin --tags --prune` y basarla en `origin/main`, verificando que contiene `v1.5.2` o una versión posterior. No se debe publicar/taggear el registry hasta que exista una versión estable publicada del CLI con soporte Codex. Los archivos no rastreados preexistentes `.awm/` y `skills/ui-ux-pro-max/scripts/__pycache__/` no pertenecen al trabajo y no se deben añadir, modificar ni borrar.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `scripts/validate-portability.mjs` | Validar los 37 skills estables, el agente, referencias y vocabulario runtime |
| `tests/portability-allowlist.json` | Excepciones exactas para material histórico o documentación de terceros |
| `.github/workflows/validate.yml` | Ejecutar el validador en cada PR/push |
| `skills/using-awm/SKILL.md` | Declarar el contrato neutral de capacidades e invocación |
| `references/codex-tools.md` | Mapear operaciones neutrales a la superficie Codex estable actual |
| `skills/development-process/SKILL.md` | Mantener lifecycle y resolver skills desde rutas compartidas |
| `skills/*/SKILL.md` y prompts runtime | Eliminar instrucciones acopladas a herramientas obsoletas |
| `agents/development-process.md` | Seguir siendo la única fuente canónica renderizable |
| `hooks/codex-session-start` | Recuperar plan/ledger/constitución y emitir JSON nativo Codex |
| `bundles/*/bundle.json`, `catalog.json` | Versionar el contenido portable sin adelantar el gate del CLI |

### Task 1: Validador de portabilidad y CI del registry

_Requirements: R8, R9, R19, R19.1_

**Files:**
- Create: `scripts/validate-portability.mjs`
- Create: `tests/portability-allowlist.json`
- Create: `.github/workflows/validate.yml`

**Skills:** writing-skills

- [ ] **Step 1: Crear el allowlist exacto**

Crear `tests/portability-allowlist.json`:

```json
[
  {
    "path": "skills/systematic-debugging/CREATION-LOG.md",
    "reason": "historical provenance, not runtime instructions"
  },
  {
    "path": "skills/writing-skills/anthropic-best-practices.md",
    "reason": "upstream provider documentation retained as a named reference"
  }
]
```

- [ ] **Step 2: Escribir el validador inicialmente contra el estado actual**

Crear `scripts/validate-portability.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(root, 'skills');
const allowlist = new Set(JSON.parse(
  fs.readFileSync(path.join(root, 'tests/portability-allowlist.json'), 'utf8'),
).map((entry) => entry.path));
const failures = [];

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

const skillDirs = fs.readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (skillDirs.length !== 37) {
  failures.push(`expected 37 skill directories, found ${skillDirs.length}`);
}

for (const skill of skillDirs) {
  const file = path.join(skillsRoot, skill, 'SKILL.md');
  if (!fs.existsSync(file)) {
    failures.push(`${rel(file)} is missing`);
    continue;
  }
  const body = fs.readFileSync(file, 'utf8');
  const frontmatter = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    failures.push(`${rel(file)} has no frontmatter`);
    continue;
  }
  const name = frontmatter[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1];
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (name !== skill) failures.push(`${rel(file)} name must equal ${skill}`);
  if (!description) failures.push(`${rel(file)} needs a non-empty description`);
}

const agentFile = path.join(root, 'agents/development-process.md');
const agent = fs.readFileSync(agentFile, 'utf8');
for (const phrase of [
  'name: development-process',
  'description:',
  'Invoke the `development-process` skill.',
  'You do NOT write code directly.',
  'NEVER invoke a downstream skill without user approval',
]) {
  if (!agent.includes(phrase)) failures.push(`agents/development-process.md missing: ${phrase}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`portable: ${skillDirs.length} skills validated\n`);
```

- [ ] **Step 3: Ejecutar el validador estructural**

Run: `node scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`. Este primer gate es estructural y queda verde antes de añadir reglas de vocabulario en los tasks que también corrigen cada grupo.

- [ ] **Step 4: Añadir CI**

Crear `.github/workflows/validate.yml`:

```yaml
name: Validate registry

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  portability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: node scripts/validate-portability.mjs
```

- [ ] **Step 5: Verificar que el workflow es parseable y el test está verde**

Run: `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/validate.yml'); puts 'workflow yaml: ok'"`

Expected: `workflow yaml: ok`.

Run: `node scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`.

- [ ] **Step 6: Commit**

```bash
git add scripts/validate-portability.mjs tests/portability-allowlist.json .github/workflows/validate.yml
git commit -m "test: enforce provider-neutral registry content"
```

### Task 2: Contrato neutral `using-awm` y referencia Codex actual

_Requirements: R3, R9_

**Files:**
- Modify: `skills/using-awm/SKILL.md`
- Modify: `references/codex-tools.md`
- Modify: `references/README.md`

**Skills:** writing-skills

- [ ] **Step 1: Añadir una comprobación roja específica del contrato**

En `scripts/validate-portability.mjs`, después de cargar `codexReference`, añadir:

```js
const codexReference = fs.readFileSync(path.join(root, 'references/codex-tools.md'), 'utf8');
for (const obsolete of ['close_agent', '[features]\\nmulti_agent = true']) {
  if (codexReference.includes(obsolete)) failures.push(`references/codex-tools.md contains obsolete ${obsolete}`);
}
for (const current of ['spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent', 'list_agents', 'update_plan']) {
  if (!codexReference.includes(current)) failures.push(`references/codex-tools.md missing ${current}`);
}

const usingAwm = fs.readFileSync(path.join(root, 'skills/using-awm/SKILL.md'), 'utf8');
for (const phrase of [
  'Use the active platform’s native skill-loading mechanism',
  'create or update a task plan',
  'dispatch, steer, wait for, or stop a subagent',
  'request user approval',
]) {
  if (!usingAwm.includes(phrase)) failures.push(`skills/using-awm/SKILL.md missing capability contract: ${phrase}`);
}
```

Run: `node scripts/validate-portability.mjs`

Expected: FAIL con los mensajes `missing capability contract`, `close_agent`, `multi_agent` y mappings actuales ausentes.

- [ ] **Step 2: Reemplazar el acceso acoplado a herramientas**

En `skills/using-awm/SKILL.md`, reemplazar `## How to Access Skills` por este bloque:

```markdown
## How to Access Skills

Use the active platform’s native skill-loading mechanism. A skill may be exposed
as a dedicated invocation, a listed local instruction package, or a readable
`SKILL.md`. Load the named skill before acting and follow its complete
instructions. Do not assume another provider’s tool names exist.

## Platform capability contract

AWM runtime instructions describe capabilities, not vendor APIs:

- invoke a named skill;
- create or update a task plan;
- dispatch, steer, wait for, or stop a subagent;
- read, edit, or inspect a file;
- run a shell command;
- request user approval.

Use the active platform’s native tool for each capability. When an exact mapping
is necessary, consult the provider reference installed with AWM. A provider
reference may map names, but it never overrides the callable tools exposed in
the current session.
```

Cambiar el red flag `"INVOKE IT"` por `"LOAD AND FOLLOW IT"` donde el texto se refiera al mecanismo, preservando la política de tiers y prioridad.

- [ ] **Step 3: Actualizar `references/codex-tools.md`**

Reemplazar la tabla y eliminar el feature flag obsoleto:

```markdown
# Codex Tool Mapping

AWM skills describe platform-neutral capabilities. On the current stable Codex
surface, use these native equivalents when they are available in the session:

| AWM capability | Codex equivalent |
|---|---|
| Dispatch a subagent | `spawn_agent` |
| Send context to a running subagent | `send_message` |
| Trigger follow-up work in an idle subagent | `followup_task` |
| Wait for subagent progress | `wait_agent` |
| Stop active subagent work | `interrupt_agent` |
| Inspect live subagents | `list_agents` |
| Create or update a task plan | `update_plan` |
| Read, edit, or inspect files | Codex native filesystem tools |
| Run a shell command | Codex native execution tool |
| Request approval or input | Codex native user-input surface |

Multi-agent support is enabled by default in the supported stable Codex line.
Do not add a legacy `[features].multi_agent` setting. Do not assume every
session exposes delegation: when the callable surface lacks subagent tools,
execute sequentially or report the missing capability when the selected AWM
workflow requires delegation.

`wait_agent` waits for spawned-agent progress. The code-mode `wait` operation
resumes a yielded execution cell by `cell_id`; these are different operations.

## Controller and worker boundary

A controller owns lifecycle routing, plan state, reviews, ledger reconciliation,
and completion. A dispatched worker executes only the bounded task in its
prompt, invokes task-required craft and verification skills, and returns its
result to the controller. A worker does not start a second orchestration
lifecycle.
```

Conservar las secciones vigentes de worktrees y finishing, ajustando cualquier afirmación de sandbox para que sea detección de capacidades, no una suposición universal de Codex App.

- [ ] **Step 4: Actualizar el índice de referencias**

En `references/README.md`, describir `codex-tools.md` como “current stable Codex capability mapping and controller/worker boundary”, sin afirmar que todos los skills usan nombres Claude.

- [ ] **Step 5: Ejecutar el validador**

Run: `node scripts/validate-portability.mjs`

Expected: los errores de `using-awm` y `references/codex-tools.md` desaparecen; permanecen los de otros skills.

- [ ] **Step 6: Commit**

```bash
git add skills/using-awm/SKILL.md references/codex-tools.md references/README.md scripts/validate-portability.mjs
git commit -m "docs: define provider-neutral AWM capabilities"
```

### Task 3: Portar el spine de ejecución y subagentes

_Requirements: R3, R3.1, R9_

**Files:**
- Modify: `skills/development-process/SKILL.md`
- Modify: `skills/executing-plans/SKILL.md`
- Modify: `skills/subagent-driven-development/SKILL.md`
- Modify: `skills/subagent-driven-development/implementer-prompt.md`
- Modify: `skills/subagent-driven-development/spec-reviewer-prompt.md`
- Modify: `skills/subagent-driven-development/code-quality-reviewer-prompt.md`
- Modify: `skills/dispatching-parallel-agents/SKILL.md`
- Modify: `skills/writing-plans/SKILL.md`

**Skills:** writing-skills

- [ ] **Step 1: Añadir checks rojos de invariantes del lifecycle**

En `scripts/validate-portability.mjs`, añadir el scanner primero sólo para los archivos de este task:

```js
const prohibited = [
  { label: 'imperative Skill tool', pattern: /\b(?:Use|Invoke) the `?Skill`? tool\b/i },
  { label: 'imperative Read tool', pattern: /\bNever use the Read tool\b/i },
  { label: 'TodoWrite runtime API', pattern: /\bTodoWrite\b/ },
  { label: 'Claude Task call', pattern: /\bTask\s*\(/ },
];
const spineFiles = [
  'skills/development-process/SKILL.md',
  'skills/executing-plans/SKILL.md',
  'skills/subagent-driven-development/SKILL.md',
  'skills/subagent-driven-development/implementer-prompt.md',
  'skills/subagent-driven-development/spec-reviewer-prompt.md',
  'skills/subagent-driven-development/code-quality-reviewer-prompt.md',
  'skills/dispatching-parallel-agents/SKILL.md',
  'skills/writing-plans/SKILL.md',
];
for (const name of spineFiles) {
  const body = fs.readFileSync(path.join(root, name), 'utf8');
  for (const rule of prohibited) {
    if (rule.pattern.test(body)) failures.push(`${name}: ${rule.label}`);
  }
}

const developmentProcess = fs.readFileSync(path.join(root, 'skills/development-process/SKILL.md'), 'utf8');
for (const invariant of [
  'brainstorming',
  'writing-plans',
  'subagent-driven-development',
  'post-implementation-qa',
  'harness-retro',
  'finishing-a-development-branch',
  'Never invoke the next skill without user confirmation.',
]) {
  if (!developmentProcess.includes(invariant)) {
    failures.push(`development-process lifecycle lost invariant: ${invariant}`);
  }
}
for (const location of [
  '"$HOME/.agents/skills/$skill"',
  '".agents/skills/$skill"',
  '"$HOME/.claude/skills/$skill"',
  '".claude/skills/$skill"',
]) {
  if (!developmentProcess.includes(location)) {
    failures.push(`development-process missing skill location ${location}`);
  }
}
```

Run: `node scripts/validate-portability.mjs`

Expected: FAIL por la ruta global `~/.agents/skills` y por vocabulario acoplado dentro del spine.

- [ ] **Step 2: Portar resolución de skills del orquestador**

En el gate frontend de `skills/development-process/SKILL.md`, usar:

```bash
MISSING=""
for skill in ui-design frontend-craft; do
  FOUND=""
  for d in "$HOME/.agents/skills/$skill" ".agents/skills/$skill" \
           "$HOME/.claude/skills/$skill" ".claude/skills/$skill"; do
    [ -d "$d" ] && FOUND="$d" && break
  done
  [ -z "$FOUND" ] && MISSING="$MISSING $skill"
done
[ -n "$MISSING" ] && echo "missing:$MISSING"
```

No cambiar la máquina de estados, gates de aprobación, QA, retro ni finishing.

- [ ] **Step 3: Sustituir tracking y dispatch imperativos por capacidades**

Aplicar estos reemplazos semánticos en `executing-plans`, `subagent-driven-development`, sus tres prompts y `dispatching-parallel-agents`:

| Antes | Después |
|---|---|
| `Create TodoWrite` | `Create or update the task plan with one item per checklist entry` |
| `Mark task complete in TodoWrite` | `Mark the matching task-plan item complete` |
| `Task("...")` | `Dispatch a subagent with the bounded task and required context` |
| `Skill tool` | `native skill-loading mechanism` |
| `Read tool` | `native file-reading mechanism` |

En los diagramas DOT, usar labels neutrales exactos. En los ejemplos, representar dispatch así:

```text
Controller: Dispatch a subagent for "Fix agent-tool-abort.test.ts failures"
Controller: Dispatch a separate subagent for "Fix batch-completion-behavior.test.ts failures"
Controller: Wait for both results, then reconcile each diff against its task
```

Preservar las reglas “no implementar en paralelo dentro de subagent-driven-development”, las dos revisiones por task, sensor gate, ledger gate y termination phase.

- [ ] **Step 4: Hacer portable el header producido por writing-plans**

En `skills/writing-plans/SKILL.md`, cambiar únicamente los nombres requeridos en el header a los nombres canónicos instalados:

```markdown
> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.
```

Actualizar los ejemplos internos que todavía digan `superpowers:*`, sin cambiar el formato obligatorio del plan salvo esos nombres.

- [ ] **Step 5: Ejecutar el validador y revisión textual de invariantes**

Run: `node scripts/validate-portability.mjs`

Expected: los errores de spine desaparecen.

Run:

```bash
rg -n "brainstorming|writing-plans|post-implementation-qa|harness-retro|finishing-a-development-branch|Never invoke the next skill" skills/development-process/SKILL.md
```

Expected: cada fase y el gate interactivo siguen presentes.

- [ ] **Step 6: Commit**

```bash
git add skills/development-process skills/executing-plans skills/subagent-driven-development skills/dispatching-parallel-agents skills/writing-plans scripts/validate-portability.mjs
git commit -m "refactor: make execution spine provider neutral"
```

### Task 4: Auditar los 37 skills y rutas runtime restantes

_Requirements: R6, R9, R19, R19.1_

**Files:**
- Modify: `skills/project-constitution/SKILL.md`
- Modify: `skills/product-process/SKILL.md`
- Modify: `skills/product-brief/references/brief-template.md`
- Modify: `skills/ui-design/SKILL.md`
- Modify: `skills/ui-ux-pro-max/SKILL.md`
- Modify: `skills/impeccable/reference/craft.md`
- Modify: `skills/impeccable/reference/document.md`
- Modify: `skills/writing-skills/SKILL.md`
- Modify: `skills/writing-skills/persuasion-principles.md`
- Modify: `scripts/validate-portability.mjs`

**Skills:** writing-skills

- [ ] **Step 1: Añadir checks específicos de entrega de constitución y skill roots**

En `scripts/validate-portability.mjs`, ampliar el scanner desde `spineFiles` a todos los Markdown runtime no allowlisted:

```js
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const runtimeMarkdown = walk(skillsRoot)
  .filter((file) => file.endsWith('.md'))
  .filter((file) => !allowlist.has(rel(file)));
for (const file of runtimeMarkdown) {
  const body = fs.readFileSync(file, 'utf8');
  for (const rule of prohibited) {
    if (rule.pattern.test(body)) failures.push(`${rel(file)}: ${rule.label}`);
  }
}

const constitution = fs.readFileSync(path.join(root, 'skills/project-constitution/SKILL.md'), 'utf8');
for (const phrase of [
  'Claude Code',
  'OpenCode',
  'Codex',
  'AGENTS.md',
  'CONSTITUTION.md',
]) {
  if (!constitution.includes(phrase)) {
    failures.push(`project-constitution missing provider delivery contract: ${phrase}`);
  }
}

for (const file of [
  'skills/development-process/SKILL.md',
  'skills/product-process/SKILL.md',
  'skills/ui-design/SKILL.md',
  'skills/ui-ux-pro-max/SKILL.md',
]) {
  const body = fs.readFileSync(path.join(root, file), 'utf8');
  if (!body.includes('$HOME/.agents/skills/')) {
    failures.push(`${file} does not search the shared global skill root`);
  }
}
```

- [ ] **Step 2: Actualizar `project-constitution` para los tres providers**

Reemplazar la descripción de entrega por:

```markdown
AWM delivers `CONSTITUTION.md` through the provider’s supported context channel:

- Claude Code: the AWM `SessionStart` hook;
- OpenCode: the project `opencode.json` `instructions[]` entry;
- Codex local/cloud/GitHub review: the AWM-managed project block in `AGENTS.md`,
  which instructs Codex to read and obey `CONSTITUTION.md`.
```

En pasos de verificación, usar:

```markdown
6. **Verify AWM delivery**
   - Claude Code: run `awm hooks status --agent claude-code`.
   - OpenCode: confirm `opencode.json` includes `CONSTITUTION.md`.
   - Codex: confirm the project `AGENTS.md` has exactly one
     `<!-- AWM:START -->` / `<!-- AWM:END -->` block that names
     `CONSTITUTION.md`; use `awm doctor --agent codex` for observed state.
```

- [ ] **Step 3: Corregir discovery de skills global/local**

En `development-process`, `product-process`, `ui-design` y `ui-ux-pro-max`, usar el mismo orden:

```bash
for d in "$HOME/.agents/skills/$skill" ".agents/skills/$skill" \
         "$HOME/.claude/skills/$skill" ".claude/skills/$skill"; do
  [ -d "$d" ] && SKILL_DIR="$d" && break
done
```

Cuando el skill fijo sea `ui-design` o `ui-ux-pro-max`, sustituir `$skill` por el nombre literal. Esto conserva Claude y añade el global compartido de OpenCode/Codex.

- [ ] **Step 4: Neutralizar solicitudes de input e invocación restantes**

En los dos documentos `skills/impeccable/reference/*.md`, reemplazar “AskUserQuestion tool” por “native user-input surface” y conservar la obligación de agrupar preguntas. En `skills/writing-skills/SKILL.md`:

- cambiar “future Claude” por “future agent” cuando se trate de discovery general;
- cambiar instrucciones de `TodoWrite` por task-plan items;
- mantener `anthropic-best-practices.md` explícitamente rotulado como referencia externa allowlisted, no como contrato runtime;
- no renombrar la sección histórica “Claude Search Optimization” sin una migración de contenido; describirla como técnica de discovery aplicable a metadatos de skills.

En `persuasion-principles.md`, usar “task-plan tracking” en vez de `TodoWrite`.

En `skills/product-brief/references/brief-template.md`, reemplazar la audiencia fija `implementing agent (Claude Code)` por `implementing agent (provider-neutral)`. No cambiar el contrato de handoff del brief ni las decisiones del producto.

- [ ] **Step 5: Ejecutar auditoría de los 37 skills**

Run: `node scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`.

Run:

```bash
rg -n "TodoWrite|Task\\(|close_agent|\\[features\\][[:space:]]*$|Use the .*Skill.*tool|Never use the Read tool" skills references/codex-tools.md
```

Expected: sólo resultados en los dos archivos allowlisted; cualquier otro resultado se corrige antes del commit.

- [ ] **Step 6: Commit**

```bash
git add skills/project-constitution/SKILL.md skills/product-process/SKILL.md skills/product-brief/references/brief-template.md skills/ui-design/SKILL.md skills/ui-ux-pro-max/SKILL.md skills/impeccable/reference/craft.md skills/impeccable/reference/document.md skills/writing-skills/SKILL.md skills/writing-skills/persuasion-principles.md scripts/validate-portability.mjs
git commit -m "docs: complete Codex portability audit"
```

### Task 5: Agente canónico y hook de recuperación Codex

_Requirements: R3, R3.1, R8, R9, R18_

**Files:**
- Modify: `agents/development-process.md`
- Create: `hooks/codex-session-start`
- Create: `tests/codex-session-start.test.mjs`
- Modify: `scripts/validate-portability.mjs`

**Skills:** writing-skills

- [ ] **Step 1: Añadir checks rojos del hook**

En `scripts/validate-portability.mjs`:

```js
const codexHook = path.join(root, 'hooks/codex-session-start');
if (!fs.existsSync(codexHook)) {
  failures.push('hooks/codex-session-start is missing');
} else {
  const mode = fs.statSync(codexHook).mode & 0o777;
  if ((mode & 0o111) === 0) failures.push('hooks/codex-session-start is not executable');
  const body = fs.readFileSync(codexHook, 'utf8');
  for (const phrase of [
    'startup',
    'resume',
    'clear',
    'compact',
    'CONSTITUTION.md',
    'docs/plans',
    'awm ledger',
    'heartbeat.json',
    'additionalContext',
  ]) {
    if (!body.includes(phrase)) failures.push(`hooks/codex-session-start missing ${phrase}`);
  }
}
```

Run: `node scripts/validate-portability.mjs`

Expected: FAIL con `hooks/codex-session-start is missing`.

- [ ] **Step 2: Mantener el agente como única fuente canónica**

En `agents/development-process.md`, conservar el frontmatter y reemplazar la sección de inicio por:

```markdown
## On Every Conversation Start

1. **Invoke the `development-process` skill** with the active platform’s native
   skill-loading mechanism. The skill contains state detection, lifecycle
   phases, decision rules, and the complete routing catalog.
2. Follow that skill exactly. It decides the current phase and obtains any
   required approval before routing downstream.
```

Conservar literalmente:

```markdown
You are a development orchestrator. You do NOT write code directly.
```

y:

```markdown
- NEVER invoke a downstream skill without user approval
```

El renderer del plan 1 ignorará `mode: primary` para Codex y lo conservará para providers que lo usen.

- [ ] **Step 3: Crear el hook Node ejecutable**

Crear `hooks/codex-session-start`:

```js
#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function readInput() {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function activePlan(cwd) {
  const plansDir = path.join(cwd, 'docs/plans');
  if (!fs.existsSync(plansDir)) return null;
  return fs.readdirSync(plansDir)
    .filter((name) => name.endsWith('-plan.md') && !name.includes('-design'))
    .map((name) => {
      const file = path.join(plansDir, name);
      return { file, mtime: fs.statSync(file).mtimeMs, body: fs.readFileSync(file, 'utf8') };
    })
    .filter((entry) => /^- \[ \]/m.test(entry.body))
    .filter((entry) => !/<!-- awm-(plan|qa)-complete/.test(entry.body))
    .sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file))[0] || null;
}

function ledgerItems(cwd) {
  try {
    return execFileSync('awm', ['ledger', 'list'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).split(/\r?\n/).filter(Boolean).slice(0, 8);
  } catch {
    return [];
  }
}

function buildContext(cwd) {
  const sections = ['AWM is active. Invoke and follow `using-awm` and `development-process` before development work.'];
  const constitution = path.join(cwd, 'CONSTITUTION.md');
  if (fs.existsSync(constitution) && fs.statSync(constitution).size > 0) {
    sections.push(`## Project Constitution\n\n${fs.readFileSync(constitution, 'utf8').trim()}`);
  }
  const plan = activePlan(cwd);
  if (plan) {
    const goal = plan.body.match(/^\*\*Goal:\*\*\s*(.+)$/m)?.[1] ||
      plan.body.match(/^#\s+(.+)$/m)?.[1] || path.basename(plan.file);
    const items = plan.body.match(/^- \[ \].+$/gm)?.slice(0, 8) || [];
    sections.push([
      '## Re-anchor (startup, resume, clear, compact)',
      `Active plan: ${path.basename(plan.file)}`,
      `Goal: ${goal}`,
      ...(items.length ? ['Open plan items:', ...items] : []),
      ...(() => {
        const ledger = ledgerItems(cwd);
        return ledger.length ? ['Open ledger items:', ...ledger] : [];
      })(),
    ].join('\n'));
  }
  return sections.join('\n\n');
}

function writeHeartbeat(scriptDir, input) {
  const script = fs.readFileSync(__filename);
  const heartbeat = {
    version: 1,
    scriptHash: crypto.createHash('sha256').update(script).digest('hex'),
    event: typeof input.source === 'string' ? input.source : 'startup',
    writtenAt: new Date().toISOString(),
  };
  const file = path.join(scriptDir, 'heartbeat.json');
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(heartbeat, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}

const input = readInput();
const cwd = typeof input.cwd === 'string' && fs.existsSync(input.cwd) ? input.cwd : process.cwd();
const scriptDir = path.dirname(__filename);
const context = buildContext(cwd);
writeHeartbeat(scriptDir, input);
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}) + '\n');
```

Hacerlo ejecutable con `chmod +x hooks/codex-session-start`.

- [ ] **Step 4: Crear y ejecutar el test del hook en un workspace temporal**

Crear `tests/codex-session-start.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-codex-hook-'));
const plans = path.join(workspace, 'docs/plans');
fs.mkdirSync(plans, { recursive: true });
fs.writeFileSync(path.join(workspace, 'CONSTITUTION.md'), '# Rules\n');
fs.writeFileSync(
  path.join(plans, '2026-07-24-demo-plan.md'),
  '# Demo Implementation Plan\n\n**Goal:** prove recovery\n\n- [ ] open item\n',
);

const installed = path.join(workspace, 'installed-hook');
fs.copyFileSync(path.join(root, 'hooks/codex-session-start'), installed);
fs.chmodSync(installed, 0o755);
const result = spawnSync(installed, [], {
  input: JSON.stringify({ source: 'compact', cwd: workspace }),
  encoding: 'utf8',
});

assert.equal(result.status, 0, result.stderr);
const output = JSON.parse(result.stdout);
assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
assert.match(output.hookSpecificOutput.additionalContext, /Project Constitution/);
assert.match(output.hookSpecificOutput.additionalContext, /Active plan:/);
assert.match(output.hookSpecificOutput.additionalContext, /open item/);
const heartbeat = JSON.parse(fs.readFileSync(path.join(workspace, 'heartbeat.json'), 'utf8'));
assert.equal(heartbeat.event, 'compact');
assert.match(heartbeat.scriptHash, /^[a-f0-9]{64}$/);
fs.rmSync(workspace, { recursive: true, force: true });
process.stdout.write('codex session hook: ok\n');
```

Run: `node tests/codex-session-start.test.mjs`

Expected: `codex session hook: ok`.

- [ ] **Step 5: Ejecutar el validador**

Run: `node scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`.

- [ ] **Step 6: Commit**

```bash
git add agents/development-process.md hooks/codex-session-start tests/codex-session-start.test.mjs scripts/validate-portability.mjs
git commit -m "feat: add Codex session recovery adapter"
```

### Task 6: Versionar el contenido portable sin publicarlo prematuramente

_Requirements: R9, R19, R19.1, R21_

**Files:**
- Modify: `bundles/dev/bundle.json`
- Modify: `bundles/product/bundle.json`
- Modify: `bundles/frontend/bundle.json`
- Modify: `bundles/authoring/bundle.json`
- Modify: `catalog.json`
- Modify: `scripts/validate-portability.mjs`

**Skills:** writing-skills

- [ ] **Step 1: Añadir checks rojos de consistencia de versiones**

En `scripts/validate-portability.mjs`:

```js
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
for (const entry of catalog.bundles) {
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'bundles', entry.name, 'bundle.json'), 'utf8'));
  if (entry.version !== bundle.version) {
    failures.push(`catalog ${entry.name}@${entry.version} != bundle ${bundle.version}`);
  }
}
```

Run: `node scripts/validate-portability.mjs`

Expected: PASS antes del bump, estableciendo el gate.

- [ ] **Step 2: Aplicar bumps de contenido**

Actualizar:

```json
// bundles/dev/bundle.json
"version": "2.1.0"
```

```json
// bundles/product/bundle.json
"version": "1.2.0"
```

```json
// bundles/frontend/bundle.json
"version": "2.1.0"
```

```json
// bundles/authoring/bundle.json
"version": "1.1.0"
```

Actualizar las tres versiones correspondientes en `catalog.json`. No cambiar aún `awm-registry.json:minCliVersion`: el valor correcto debe ser la versión estable realmente publicada por el release automático del CLI y se fija en el plan 3.

- [ ] **Step 3: Verificar contenido y working tree**

Run: `node scripts/validate-portability.mjs`

Expected: `portable: 37 skills validated`.

Run: `git diff --check`

Expected: sin output.

Run: `git status --short`

Expected: sólo archivos de este plan; `.awm/` y `skills/ui-ux-pro-max/scripts/__pycache__/` continúan sin trackear y sin staging.

- [ ] **Step 4: Commit**

```bash
git add bundles/dev/bundle.json bundles/product/bundle.json bundles/frontend/bundle.json bundles/authoring/bundle.json catalog.json scripts/validate-portability.mjs
git commit -m "feat: release provider-neutral baseline content"
```

## Traceability matrix

| Req | Task(s) | Test(s) |
|---|---|---|
| R3 | T2, T3, T5 | `using-awm` capability checks; lifecycle invariant checks; hook `additionalContext` smoke |
| R3.1 | T3, T5 | lifecycle recovery invariants; temporary-workspace hook smoke |
| R6 | T4, T5 | provider delivery phrase checks; hook constitution output |
| R8 | T1, T5 | canonical agent structural checks and renderer-required fields |
| R9 | T1–T6 | 37-skill structural/vocabulary validation, canonical agent checks, catalog consistency |
| R18 | T5 | executable/hash heartbeat checks and smoke |
| R19 | T1, T4, T6 | Claude provider delivery and path checks; full validator |
| R19.1 | T1, T4, T6 | OpenCode provider delivery and shared-root checks; full validator |
| R21 | T6 | registry remains public-content-only; version consistency validator |

The complete cloud-public-registry proof for R21 is performed in plan 3.

## Analyze gate

- Forward coverage: every requirement assigned here has a task and a targeted validation.
- Backward coverage: the validator, hook, content edits and version bumps are all required by R3/R6/R8/R9/R18/R19/R19.1/R21.
- Provider forks: no `skills/<name>-codex` or provider-specific copy is introduced.
- Release boundary: no tag, push or `minCliVersion` change occurs until plan 3 resolves the actual released CLI version.
