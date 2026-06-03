# Diseño — Bundles, activación por proyecto y disciplina del harness (Fase 0 + Fase 1)

- **Fecha**: 2026-06-02
- **Estado**: Aprobado (brainstorming)
- **Rama**: feature/review-gentle-ai
- **Alcance de este documento**: Fase 0 + Fase 1 del roadmap. Fases 2-4 quedan referenciadas pero fuera de alcance.

## 1. Contexto y motivación

AWM es, ante todo, **un agente de desarrollo de software agéntico fuerte**; la distribución a equipos es un objetivo secundario que se apoya en lo mismo. Hoy el harness empaqueta todo de forma plana:

- `registry/processes.json` es una lista plana de 5 "processes" (core-dev con 30 skills, docs, notion-*, frontend-design), **sin versión individual ni dependencias**.
- Las 44 skills se instalan **globales** en `~/.claude/skills/`, por lo que su menú (name+description, ~3.2k tokens) se carga en **todos** los proyectos, generando sobre-disparo y ruido de decisión al iniciar cualquier desarrollo, independientemente del tipo de proyecto.
- La configuración del harness se hace con múltiples comandos sueltos (`awm hooks install`, `awm sensors init`, activación de skills, etc.), sin un punto de entrada único ni visibilidad del estado.

Investigación previa (gentle-ai + sistema de plugins/marketplace de Claude Code) mostró el modelo convergente a adoptar: **catálogo → bundle → skill**, con activación por ubicación de instalación y un orquestador/health-check (`init` + `doctor`).

### Problema central que resuelve este release

1. **Curación**: separar el dev-core (el producto) de capas satélite (frontend, docs) y personales (notion), para que cada sesión cargue solo lo relevante.
2. **Activación por proyecto**: que el harness sepa, por proyecto, qué cargar y qué no (belanz → frontend; una API → solo dev), reduciendo el sobre-disparo.
3. **Disciplina**: un único `awm init` idempotente que deje el harness en estado conocido-bueno, y un `awm doctor` que muestre visualmente qué falta.

## 2. Decisiones tomadas (brainstorming)

| # | Decisión | Valor |
|---|---|---|
| D1 | Roadmap | Este release = Fase 0 + Fase 1. F2/F3/F4 diferidas. |
| D2 | Taxonomía | 5 bundles base+extensiones (no hermanos planos). |
| D3 | Migración | **Corte limpio (breaking)**: se elimina `processes.json`. |
| D4 | Política de disparo | `using-awm` **por niveles** (tiered). |
| D5 | Scope de bundle | `baseline` / `project` / `ambient`, default por bundle + override manual. |
| D6 | notion | **ambient/global** (anclado a MCP, gatillable en cualquier lado), `awm init` no lo toca. |
| D7 | `writing-skills` | Bundle `authoring` (project), activado solo en el repo agentic-workflow. |
| D8 | `harness-retro` | Permanece en dev-core (mejorar el harness es parte del core). |
| D9 | discovery/story-mapping | Permanecen en `docs` por ahora. |
| D10 | `awm init` | Un solo comando context-aware (auto-detecta máquina/proyecto), idempotente. |
| D11 | Artefactos de agente | `init`/`doctor` **solo los señalan** como pendientes (CLI no los redacta). |

## 3. Modelo conceptual: catálogo → bundle → skill

```
catalog.json (índice)
  ├── dev              (baseline — espina SDD + gates + sensors + harness-retro + advisory)
  │     ├── frontend   (extensión, dependsOn: dev)
  │     ├── docs        (extensión, dependsOn: dev)
  │     └── authoring   (extensión, dependsOn: dev — solo en repo agentic-workflow)
  └── personal-notion  (ambient, independiente, private)
            ↓ cada bundle referencia skills por nombre
registry/skills/   (store plano único — fuente de verdad de cada skill, sin duplicar)
```

**Principios:**
- Las skills **no se duplican** por bundle; viven una sola vez en `registry/skills/` y los bundles las referencian por nombre.
- Los bundles forman un **grafo de dependencias** (base + extensiones), no hermanos planos. `frontend dependsOn dev` ⇒ al instalar `frontend` se resuelve e instala `dev`.
- La conexión dev↔frontend ya existe vía el orquestador `development-process` (`brainstorming → ui-design → writing-plans`): la espina vive en dev y las skills de frontend son capacidades que la espina activa cuando la tarea es UI.

## 4. Estructura física (registry)

```
registry/
  catalog.json                      # índice: name, source, version, scope, visibility por bundle
  bundles/
    dev/bundle.json
    frontend/bundle.json
    docs/bundle.json
    authoring/bundle.json
    personal-notion/bundle.json
  skills/                           # SIN CAMBIOS — store plano de skills (44)
  sensor-packs/  hooks/  agents/  workflows/   # sin cambios
```

### 4.1 Forma de los manifests

```jsonc
// catalog.json
{
  "version": 1,
  "bundles": [
    { "name": "dev",             "source": "./bundles/dev",             "version": "1.0.0", "scope": "baseline" },
    { "name": "frontend",        "source": "./bundles/frontend",        "version": "1.0.0", "scope": "project" },
    { "name": "docs",            "source": "./bundles/docs",            "version": "1.0.0", "scope": "project" },
    { "name": "authoring",       "source": "./bundles/authoring",       "version": "1.0.0", "scope": "project" },
    { "name": "personal-notion", "source": "./bundles/personal-notion", "version": "1.0.0", "scope": "ambient", "visibility": "private" }
  ]
}
```

```jsonc
// bundles/frontend/bundle.json
{
  "name": "frontend",
  "version": "1.0.0",
  "description": "Capa de craft e implementación frontend.",
  "scope": "project",
  "dependsOn": ["dev"],
  "skills": [
    "impeccable", "ui-design", "extract-design-md",
    "code-to-design", "react-components", "frontend-craft"
  ],
  "workflows": [],
  "agents": []
}
```

```jsonc
// bundles/dev/bundle.json — las especializadas se marcan onSignal (alimenta el tiered de using-awm)
{
  "name": "dev",
  "version": "1.0.0",
  "scope": "baseline",
  "dependsOn": [],
  "skills": [
    { "name": "using-awm" }, { "name": "development-process" },
    { "name": "brainstorming" }, { "name": "writing-plans" }, { "name": "executing-plans" },
    { "name": "subagent-driven-development" }, { "name": "test-driven-development" },
    { "name": "requesting-code-review" }, { "name": "receiving-code-review" },
    { "name": "post-implementation-qa" }, { "name": "finishing-a-development-branch" },
    { "name": "verification-before-completion" }, { "name": "systematic-debugging" },

    { "name": "dispatching-parallel-agents", "onSignal": true },
    { "name": "using-git-worktrees", "onSignal": true },
    { "name": "project-context-init", "onSignal": true },
    { "name": "project-constitution", "onSignal": true },
    { "name": "setup-sensors", "onSignal": true },
    { "name": "harness-retro", "onSignal": true },
    { "name": "architecture-advisor", "onSignal": true },
    { "name": "cicd-proposal-builder", "onSignal": true },
    { "name": "nfr-checklist-generator", "onSignal": true },
    { "name": "technology-evaluator", "onSignal": true }
  ]
}
```

> Nota de fronteras de fase: el campo `version` por bundle existe pero es **informativo** en este release (un solo `git pull` sincroniza todo). La convención de tags `{bundle}--v{semver}` y el resolver de rangos son **Fase 2**. `dependsOn` se resuelve por nombre, sin rangos.

### 4.2 Contenido de los 5 bundles (reparto completo de las 44 skills)

**dev** (baseline, 23):
- *Espina + gates (always-on, 13)*: using-awm, development-process, brainstorming, writing-plans, executing-plans, subagent-driven-development, test-driven-development, requesting-code-review, receiving-code-review, post-implementation-qa, finishing-a-development-branch, verification-before-completion, systematic-debugging.
- *Especializadas (onSignal, 10)*: dispatching-parallel-agents, using-git-worktrees, project-context-init, project-constitution, setup-sensors, harness-retro, architecture-advisor, cicd-proposal-builder, nfr-checklist-generator, technology-evaluator.

**frontend** (project, dependsOn dev, 6): impeccable, ui-design, extract-design-md, code-to-design, react-components, frontend-craft.

**docs** (project, dependsOn dev, 11): docs-system-orchestrator, docs-brainstorming, docs-assistant, template-manager, template-wizard, documenting-modules, business-documenting-modules, c4-architecture, init-docs-repo, discovery-assistant, story-mapping.

**authoring** (project, dependsOn dev, 1): writing-skills. *(Activado solo en el repo agentic-workflow.)*

**personal-notion** (ambient, global, private, 3): career-goal-brainstorm, cristalizar-proceso, agregar-nodos-proceso.

Total: 23 + 6 + 11 + 1 + 3 = **44** ✓

## 5. Modelo de activación por proyecto

### 5.1 Tres ubicaciones (solo dos las lee el agente)

| Ubicación | ¿La lee el agente? | Efecto |
|---|---|---|
| `~/.awm/cli-source/registry/skills/` (**cache**) | No | Almacén. Aquí viven TODAS las skills siempre. |
| `~/.claude/skills/` (**global**) | Sí | Carga en **todos** los proyectos. |
| `<proyecto>/.claude/skills/` (**local**) | Sí | Carga **solo** en ese proyecto. |

"Activar una skill" = crear un symlink desde el cache hacia una de las dos ubicaciones que el agente lee. El scoping por proyecto lo da **la ubicación de instalación**, no un hook (un SessionStart hook puede *añadir* contexto pero no *quitar* skills del menú).

### 5.2 Scope por bundle

- `scope: baseline` → install **global**, siempre (dev-core). `awm init` lo garantiza.
- `scope: project` → `awm init` lo **propone** según el repo, install **local** (frontend, docs, authoring).
- `scope: ambient` → install **global** siempre, `awm init` **lo ignora** (personal-notion).

Default sensato por bundle, **sobrescribible**: `awm add frontend --global`, `awm add personal-notion --local`.

### 5.3 Perfil de proyecto (portabilidad)

```jsonc
// <proyecto>/.awm/profile.json  ← SE COMMITEA (portable)
{ "extensions": ["frontend"] }   // dev-core es implícito (baseline)
```

- `.awm/profile.json` es la **fuente de verdad portable** y se versiona en el repo. Un compañero clona, corre `awm sync`, y se le materializan los symlinks localmente.
- Los symlinks en `.claude/skills/` son **machine-specific** → van gitignored; los reconstruye `awm sync`. Patrón: *perfil = fuente de verdad; symlinks = materialización local*.

## 6. Fase 0 — Mecánica

### 6.1 Versión por skill
Añadir `version: "1.0.0"` al frontmatter de cada `SKILL.md`. Informativa en este release (consumida por el resolver en Fase 2).

### 6.2 `using-awm` por niveles (tiered)
Se elimina el mandato general "si hay 1% de probabilidad, DEBES invocar". Nueva política:

- **Espina/gates (always-on)**: se consideran siempre (disciplina del proceso SDD garantizada).
- **Especializadas (onSignal)**: se invocan **solo ante señal clara** del contexto (hablar de arquitectura → architecture-advisor; configurar CI → cicd; etc.).

La pertenencia a cada tier la declara el `bundle.json` (`onSignal: true`). El bootstrap (SessionStart) **anota el menú** con esa marca para que la política sea explícita al agente.

## 7. Fase 1 — CLI

Corte limpio: `catalog.json` + `bundle.json` (×5) reemplazan a `processes.json`. Se elimina la lectura de `processes.json`.

### 7.1 Comandos

| Comando | Qué hace |
|---|---|
| `awm init` | Único, context-aware, idempotente. Orquesta setup de máquina y (si está en repo) de proyecto. Ver §7.3. |
| `awm doctor` | Read-only. Dashboard del estado del harness (máquina + proyecto). Ver §7.2. |
| `awm sync` | Reconstruye symlinks desde `.awm/profile.json` (otra máquina / compañero que clona). |
| `awm add <bundle> [--global\|--local]` | Instala un bundle resolviendo `dependsOn`; override de scope. |
| `awm list [--all]` | Lee `catalog.json`; oculta `visibility: private` salvo `--all`. |

`~/.awm/config.json` (nuevo): config de máquina que recuerda las decisiones globales del usuario (qué bundles `ambient` quiere instalados), para que `awm init` no pregunte cada vez.

### 7.2 Motor de estado y `awm doctor`

Un único **motor de diagnóstico** computa el estado; `doctor` lo imprime read-only, `init` actúa sobre él.

**Detección de contexto** (patrón git/npm):
- *Máquina*: rutas fijas — cache `~/.awm/cli-source` (git status), hook en `~/.claude/settings.json`, dev-core en `~/.claude/skills/`, ambient bundles en global.
- *Proyecto*: camina hacia arriba desde `cwd` buscando raíz (`.git/`, `.awm/profile.json` o `package.json`). Si existe, inspecciona ese repo.

**Salida visual (ejemplo):**
```
AWM · estado del harness
Máquina (global)
  ✔ CLI v1.0.0   ✔ hook SessionStart   ✔ dev-core (baseline)   ✔ cache sync
  ✖ personal-notion (ambient)            → awm add personal-notion
Proyecto: belanz
  ✔ .awm/profile.json (frontend)         ✔ frontend activo
  ✖ sensores no inicializados            → awm sensors init
  ✖ CONSTITUTION.md ausente              → skill: project-constitution
  ⚠ CLAUDE.md ausente                    → skill: project-context-init
```

### 7.3 `awm init` — pasos (idempotente)

Cada paso chequea primero y solo actúa sobre lo que falta (✖); lo ya hecho (✔) se salta.

**Nivel máquina (siempre):**
1. **Cache** — si falta `~/.awm/cli-source` → clona; si está viejo → `git pull`. *(CLI)*
2. **Hook** — si falta la entrada SessionStart en `~/.claude/settings.json` → la instala. *(CLI)*
3. **dev-core baseline** — si faltan symlinks en `~/.claude/skills/` → los crea. *(CLI)*
4. **Ambient bundles** — según `~/.awm/config.json`; si faltan → los instala global. *(CLI)*

**Nivel proyecto (solo si está en repo):**
5. **Detección** — escanea package.json / Dockerfile / docs/ → propone extensiones. *(CLI)*
6. **Profile** — escribe/actualiza `.awm/profile.json` con lo confirmado. *(CLI)*
7. **Activación** — symlinkea bundles `project` en `<repo>/.claude/skills/`. *(CLI)*
8. **Sensores** — `awm sensors init` (detecta stack → `.awm/sensors.json`) + hook PostToolUse del proyecto. *(CLI)*
9. **CONSTITUTION.md** — si falta → lo **señala** pendiente con "skill: project-constitution". *(agente)*
10. **AGENTS.md/CLAUDE.md** — si falta → lo **señala** pendiente con "skill: project-context-init". *(agente)*

Frontera CLI↔agente: la CLI hace 1-8; 9-10 requieren razonar sobre el repo (las redacta el modelo vía skill), por lo que `init` solo las marca como pendientes con la skill exacta.

### 7.4 Reglas de detección (paso 5)

| Señal en el repo | Extensión propuesta |
|---|---|
| `next`/`react`/`vue`/`astro` en package.json; `/landing`, `/pages` | `frontend` |
| `docs/`, mkdocs/docusaurus | `docs` |
| solo `express`/`fastapi`/`nest` sin frontend | ninguna (dev-core basta) |
| `Dockerfile`, `*.k8s.yaml`, `helm/`, `terraform/` | `infra` *(bundle futuro; regla extensible)* |

La detección es **bootstrap** (una vez por proyecto). En sesiones siguientes `init`/`doctor` solo leen el perfil.

## 8. Entrega por sub-fases (cada una shippable)

- **1a — Estructura + curación**: `catalog.json` + `bundle.json` (×5) + dev-core curado + `version` por skill + `using-awm` tiered + install baseline/ambient global. *(Corte limpio de processes.json.)*
- **1b — Activación por proyecto**: `.awm/profile.json` + `awm sync` + `awm add --local` + scope `project`.
- **1c — `awm doctor`**: motor de estado + dashboard visual.
- **1d — `awm init` orquestador**: detección + bootstrap idempotente sobre el motor de estado, señalando pasos agente-requeridos.

## 9. Fuera de alcance (fases siguientes, ya acordadas)

- **Fase 2**: tags `{bundle}--v{semver}` + resolver de rangos para skills compartidas + `skills-lock.json` como salida del resolver + pin por `ref`.
- **Fase 3**: desacople multi-agente (capa Adapter/Strategy: paths *dónde* + estrategias *cómo* inyectar; bootstrap agnóstico; Codex/OpenCode/Antigravity/Windsurf).
- **Fase 4**: sources externos (`github`/`npm`/`git-subdir`) en el catálogo + canales stable/latest + allowlists.

## 10. Componentes y límites (diseño para aislamiento)

| Unidad | Propósito | Depende de |
|---|---|---|
| **Catalog reader** | Lee `catalog.json`, expone bundles disponibles | filesystem cache |
| **Bundle resolver** | Resuelve `dependsOn` (sin rangos) → lista de skills a instalar | catalog reader |
| **Installer** | Crea/quita symlinks según scope (global/local) | bundle resolver, providers |
| **Profile manager** | Lee/escribe `.awm/profile.json` | filesystem proyecto |
| **State engine** | Computa estado máquina+proyecto (detección git-style) | catalog, installer, providers, sensors, hooks |
| **Doctor** | Render read-only del state engine | state engine |
| **Init orchestrator** | Aplica acciones idempotentes sobre el state engine; señala pasos de agente | state engine, installer, profile, sensors, hooks |
| **Detector** | Reglas repo → extensiones propuestas | filesystem proyecto |

El **state engine** es el núcleo compartido: se construye una vez y lo consumen tanto `doctor` (lee) como `init` (actúa). Esto evita duplicar la lógica de detección/diagnóstico.

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Corte limpio rompe el install actual del usuario | Único consumidor real; se re-instala con `awm init`. |
| Symlinks committeados no portan entre máquinas | Solo se commitea `.awm/profile.json`; symlinks gitignored, regenerados por `awm sync`. |
| dev-core sigue en 23 skills (no 15) | Tiered triggering: solo ~13 hacen ruido de menú efectivo; las 10 especializadas callan hasta señal. |
| Footgun de doble versión (bundle.json vs catalog) | En este release `version` es informativa y vive en una sola fuente; la disciplina de tags se define en Fase 2. |
| `init` parece tocar artefactos que no puede redactar | Frontera explícita: pasos 9-10 solo se señalan, nunca se generan por CLI. |

## 12. Testing (estrategia)

- **catalog/bundle reader + resolver**: unit tests sobre fixtures de `catalog.json`/`bundle.json` (incluye `dependsOn`, scope, `onSignal`).
- **installer**: tests de symlink/copy en global vs local; idempotencia (re-run no duplica).
- **state engine**: tests con repos sintéticos (con/sin `.git`, con/sin profile, hook presente/ausente, sensores sí/no) verificando la matriz de estado.
- **detector**: fixtures de proyectos (next, fastapi, docs) → extensiones esperadas.
- **init idempotente**: ejecutar dos veces deja el mismo estado; segundo run no realiza cambios.
- **doctor**: snapshot del render para estados representativos.
```
