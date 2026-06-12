# WS-5 — Runbook maestro + flujo de equipo verificado — Implementation Plan
<!-- awm-qa-complete: 2026-06-12 -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar `docs/runbook.md` (manual maestro en inglés) absorbiendo getting-started + registry-guide, normalizar a inglés el baseline registry, y verificar manualmente los 4 escenarios del ciclo de equipo (release real, registry privado happy/sin-acceso, onboarding) — endureciendo con TDD solo lo que se rompa.

**Architecture:** Tres fases secuenciales: (A) autorear el runbook y reorganizar docs en este repo; (B) normalizar el baseline registry en un clone de trabajo externo y dejarlo listo para release; (C) ejecutar la verificación runbook-as-script en sandboxes (HOME/AWM_HOME en tmpdirs) donde el orden importa: el sandbox se siembra ANTES del tag v1.1.0 para que `awm update` tenga algo real que recibir.

**Tech Stack:** Markdown (docs), bash (verificación manual), TypeScript/Jest solo si hay hardening (contingencia).

**Design:** [2026-06-11-ws5-team-workflow-design.md](2026-06-11-ws5-team-workflow-design.md)

---

## Hechos establecidos (no re-derivar)

- Baseline registry: `git@github.com:Kodria/awm-baseline-registry.git`, único tag actual **v1.0.0**. El release de normalización será **v1.1.0**.
- Registry privado para verificación: `git@github.com:Kodria/awm-personal-registry.git` (existente, privado, la SSH key del usuario tiene acceso).
- Clone de trabajo del baseline: **no existe** → crear en `/Users/cencosud/Developments/personal/awm-baseline-registry`.
- Inventario de español en el baseline (grep `á|é|í|ó|ú|ñ|¿|¡`, 2026-06-11, cota inferior — hay español sin acentos):
  - Completos: `skills/architecture-advisor/SKILL.md` (60 líneas con acentos), `skills/cicd-proposal-builder/SKILL.md` (58), `skills/technology-evaluator/SKILL.md` (55), `skills/nfr-checklist-generator/SKILL.md` (53)
  - Parciales: `skills/post-implementation-qa/SKILL.md` (36), `skills/using-awm/SKILL.md` (11), `skills/harness-retro/SKILL.md` (10)
  - Bundles: `bundles/frontend/bundle.json`, `bundles/authoring/bundle.json`, `bundles/dev/bundle.json`
  - Sueltos (revisar caso a caso, puede ser contenido legítimo): `skills/frontend-craft/reference/design-taste-frontend.md` (3), `skills/verification-before-completion/SKILL.md` (2), `skills/subagent-driven-development/implementer-prompt.md` (2), `skills/impeccable/SKILL.md` (2), `skills/subagent-driven-development/SKILL.md` (1), `skills/impeccable/reference/{document,distill,brand}.md` (1 c/u), `skills/frontend-craft/reference/emil-design-eng.md` (1)
- Referencias a actualizar al eliminar docs absorbidos: `README.md:36,74,82` · `docs/cli-reference.md:5,227,229`.
- Stale post-WS-4 detectado en planning: `docs/cli-reference.md:96-98` dice que `awm update` "rebuilds the CLI binary" — falso desde WS-4 (CLI va por npm; update solo sincroniza registries). Corregir en Task 5.
- `cli-reference.md` NO documenta `awm registry add|list|remove` ni `awm pin/unpin` (WS-2/WS-3) — hueco a cerrar en Task 5. Surface real (de `cli/src/commands/registry/index.ts` y `cli/src/commands/pin.ts`):
  - `awm registry add <remote> [--name <name>] [--install-all] [--no-install]`
  - `awm registry list`
  - `awm registry remove <name> [-y, --yes]`
  - `awm pin <registry> <version>` (registry = `base` o nombre de registry adicional)
  - `awm unpin <registry>`
- Schema de `.awm/profile.json` (de `cli/src/core/profile.ts`): `{ "extensions": string[], "registries"?: { "<name>": "X.Y.Z" } }`. El campo `registries` son los pins de versión del proyecto.

## Reglas duras de ejecución

1. **`~/.awm` real y `~/.claude` real JAMÁS se tocan.** Toda verificación corre con `HOME` Y `AWM_HOME` exportados a tmpdirs (sobreescribir solo `AWM_HOME` NO basta: la instalación de skills escribe en `$HOME/.claude/skills`).
2. Con `HOME` falso, SSH pierde `~/.ssh` → para los escenarios SSH usar `GIT_SSH_COMMAND` explícito apuntando a la key real (happy path) o a identidad nula (sin-acceso). Determinar la key real con `ls /Users/cencosud/.ssh/` en el momento.
3. Tags en el registry: `git -c tag.gpgSign=false tag vX.Y.Z` (instrucción ya documentada del flujo de registries).
4. Hardening solo de lo que se rompa en la verificación, con TDD en `cli/` (patrón dual-tmpdir de AGENTS.md). **Sin E2E nuevo de simulación.**
5. Los push al registry (`awm-baseline-registry`) son parte del entregable (release real). Los push de ESTE repo siguen la regla de siempre: solo en release explícito.

## Protocolo de contingencia (hardening)

Aplica a cualquier Task de la Fase C donde la realidad diverja del runbook:

1. **Si el runbook está mal** (la maquinaria funciona pero el doc dice otra cosa): corregir `docs/runbook.md` en el momento, commit `docs(runbook): fix <sección> — verified against reality`.
2. **Si el CLI está mal** (cuelgue, error críptico, comportamiento roto): es un hallazgo → registrar en el ledger (`awm ledger add --polarity finding --class logica --signature ws5-<slug> --severity <sev> --desc "<qué pasó>"`), escribir test que reproduce la falla en `cli/tests/` (dual-tmpdir, red), fix mínimo (green), `awm sensors run` limpio, commit. Después continuar el escenario donde quedó.
3. **Evidencia siempre:** pegar el output real (recortado a lo relevante) en la sección "Evidencia de verificación" al final de este plan, bajo el escenario correspondiente.

---

## Fase A — Runbook maestro y reorganización de docs

### Task 1: `docs/runbook.md` — esqueleto + Cap. 1 (Install) + Cap. 2 (Project setup)

**Files:**
- Create: `docs/runbook.md`
- Read (fuente a absorber): `docs/getting-started.md` (líneas 1-149 cubren mental model, tracks, prerequisites, Part 1-2; líneas 151-250 cubren Part 3-6)

- [ ] **Step 1: Crear `docs/runbook.md` con el esqueleto completo y los capítulos 1-2 redactados**

Estructura obligatoria del archivo (los caps. 3-5 quedan como heading + `<!-- ch3: Task 2 -->` etc. — se rellenan en Tasks 2-4):

```markdown
# AWM Runbook

The complete operating manual for AWM: install it, wire a project, use it day to day,
set it up for a team, and extend it with your own content.

## Who this is for
(3 perfiles: individual dev / team lead setting up a shared registry / contributor authoring skills — con link al capítulo donde empieza cada uno)

## Mental model
(absorber de getting-started "Mental model": tabla de 2 layers machine/project, idempotencia de init, tabla per-agent Claude/OpenCode)

## Chapter 1 — Install & machine setup
### 1.1 Prerequisites          (git/node/npm, macOS/Linux, Windows → WSL)
### 1.2 Install the CLI        (npm i -g agentic-workflow-manager, awm --help)
### 1.3 Keeping the CLI itself up to date   (npm i -g agentic-workflow-manager@latest — el CLI va por npm; `awm update` actualiza CONTENIDO, no el CLI. Distinción nueva post-WS-4, no existe en getting-started)

## Chapter 2 — Project setup
### 2.1 Bootstrap: awm init    (absorber Part 2.1: qué hace, flags, qué deja para el agente)
### 2.2 Read the state: awm doctor   (absorber Part 2.2: glifos, "degradado no es bug")
### 2.3 Track A — greenfield   (absorber el bloque de 10 pasos tal cual, actualizando el paso 1 si aplica)
### 2.4 Track B — legacy       (absorber el bloque de 12 pasos + el "why the two extra steps")
### 2.5 Load the agent context (absorber Part 3)
### 2.6 Constitution & agent context files   (absorber Part 4.1-4.2)
### 2.7 Sensors: the quality gate   (absorber Part 5 completo, incluida la caja "Are sensors agnostic?")
### 2.8 Ready checklist        (absorber Part 6)

## Chapter 3 — Day-to-day in a project
<!-- ch3: Task 2 -->

## Chapter 4 — Team setup & customization
<!-- ch4: Task 3 -->

## Chapter 5 — Extensibility: authoring content
<!-- ch5: Task 4 -->

## Troubleshooting
(absorber la tabla de getting-started entera; se ampliará en Fase C con lo que aparezca)

## See also
(links: cli-reference.md, architecture.md)
```

Reglas de absorción: **curar, no copy-paste ciego** — verificar cada afirmación contra el estado post-WS-4 (ej.: getting-started Part 9 dice que `awm update` "rebuilds the CLI" → falso, corregir al absorber). Mantener el tono y los ejemplos del original donde sigan siendo correctos. Inglés en todo el archivo.

- [ ] **Step 2: Verificar estructura**

Run: `grep -c "^## Chapter" docs/runbook.md` → Expected: `5`
Run: `grep -nE "á|é|í|ó|ú|ñ|¿|¡" docs/runbook.md | grep -v "Generá\|Inicializá\|Adaptá\|qué skills" ` → Expected: vacío (los prompts de ejemplo al agente en español de getting-started se conservan como están — son citas literales de prompts que funcionan).

- [ ] **Step 3: Commit**

```bash
git add docs/runbook.md
git commit -m "docs(runbook): skeleton + ch1 install + ch2 project setup (absorbs getting-started)"
```

### Task 2: Runbook Cap. 3 — Day-to-day in a project

**Files:**
- Modify: `docs/runbook.md` (reemplazar `<!-- ch3: Task 2 -->`)
- Fuente: `docs/getting-started.md` Part 7 (tabla de triggers automáticos) y Part 8 (learning loop) — se absorben AQUÍ, no en ch2.

- [ ] **Step 1: Redactar el capítulo**

Contenido obligatorio (en inglés):

```markdown
## Chapter 3 — Day-to-day in a project

### 3.1 The development loop
(el ciclo: pides trabajo en lenguaje natural → development-process rutea
brainstorming → writing-plans → subagent-driven-development → post-implementation-qa →
harness-retro → finishing-a-development-branch; cross-cutting: TDD, systematic-debugging,
verification-before-completion. Absorber el contenido de getting-started Part 6 final.)

### 3.2 What happens automatically
(absorber tabla Part 7: triggers por sesión/edición/done/recurrencia, columnas Claude/OpenCode)

### 3.3 The quality gate in practice
(cadencia: per-edit fast sensors en Claude; gate completo `awm sensors run` sin flag al declarar done;
`--slow` NO es el gate; baseline ratchet: cuándo re-tomarlo deliberadamente)

### 3.4 The learning loop
(absorber Part 8: ledger por rama, harness-retro cura a remediation tree / CONSTITUTION / AGENTS.md,
"recurrence becomes a rule, not a repeated symptom fix", project-specific vs framework rules)

### 3.5 Update cadence
(qué corre el dev y cuándo: `awm update` para recibir contenido nuevo del equipo —
cuándo: al empezar el día o cuando avisan de un release; `awm doctor` cuando algo se siente raro;
re-run `awm init` tras updates grandes — idempotente. CLI updates: npm, ver ch 1.3.
NUEVO — no existe en docs actuales.)
```

- [ ] **Step 2: Verificar** — `grep -c "^### 3\." docs/runbook.md` → Expected: `5`

- [ ] **Step 3: Commit** — `git add docs/runbook.md && git commit -m "docs(runbook): ch3 day-to-day loop"`

### Task 3: Runbook Cap. 4 — Team setup & customization

**Files:**
- Modify: `docs/runbook.md` (reemplazar `<!-- ch4: Task 3 -->`)

Este capítulo es **nuevo** (no hay fuente que absorber) y es el corazón de F-12. Será verificado literalmente en Fase C — escribirlo como instrucciones ejecutables, no como prosa descriptiva.

- [ ] **Step 1: Redactar el capítulo**

Contenido obligatorio (en inglés):

```markdown
## Chapter 4 — Team setup & customization

### 4.1 The team model
(el ciclo F-12 explícito: senior authors a skill → PR to the team registry → tagged release
vX.Y.Z → teammates receive it with `awm update`; new dev → `git clone` + `awm sync`.
Diagrama de texto del flujo.)

### 4.2 Create your team registry
(estructura mínima del repo: skills/<name>/SKILL.md, bundles/<name>/bundle.json, catalog.json
con schema real `{version, bundles:[{name, source, version, scope}]}` — copiar el catalog.json
del baseline como referencia; puede ser repo privado desde el día 1)

### 4.3 Wire it: awm registry add
(`awm registry add <git-url> [--name <name>]` — clona bajo ~/.awm/registries/<name>/ y registra;
`awm registry list` / `awm registry remove <name>`. URLs: HTTPS para repos públicos,
SSH `git@github.com:org/repo.git` para privados)

### 4.4 Private registries (SSH)
(requisito: la SSH key del dev autorizada en el repo; el clone/fetch corre por git así que
respeta ssh-agent y ~/.ssh/config como cualquier repo; qué error esperar si NO tienes acceso
— redactar tras verificar en Fase C, escribir versión hipótesis ahora; CI/headless:
GIT_TERMINAL_PROMPT=0 para fallar rápido en vez de colgarse pidiendo credenciales)

### 4.5 Version pinning
(canal estable por defecto = último tag semver; `awm pin <registry> <version>` congela,
`awm unpin <registry>` libera; el pin vive en .awm/profile.json `registries` → comiteado
→ TODO el equipo queda pineado: el pin es un contrato del proyecto, no una preferencia local)

### 4.6 The shared profile: .awm/profile.json
(schema real con ejemplo: {"extensions": ["frontend"], "registries": {"baseline": "1.0.0"}};
qué se comitea (profile sí, ledger no) y por qué: el profile ES el onboarding)

### 4.7 Onboarding a new developer
(secuencia exacta, será verificada literalmente:
 1. npm i -g agentic-workflow-manager
 2. git clone <project> && cd <project>
 3. awm init        # machine layer + lee el profile comiteado
 4. awm sync        # materializa los symlinks que el profile declara
 5. awm doctor      # todo verde
)
```

- [ ] **Step 2: Verificar** — `grep -c "^### 4\." docs/runbook.md` → Expected: `7`

- [ ] **Step 3: Commit** — `git add docs/runbook.md && git commit -m "docs(runbook): ch4 team setup & customization (F-12 core)"`

### Task 4: Runbook Cap. 5 — Extensibility (absorbe registry-guide)

**Files:**
- Modify: `docs/runbook.md` (reemplazar `<!-- ch5: Task 4 -->`)
- Fuente: `docs/registry-guide.md` completo (134 líneas)

- [ ] **Step 1: Redactar el capítulo**

```markdown
## Chapter 5 — Extensibility: authoring content

### 5.1 Registry layout            (absorber: árbol skills/bundles/sensor-packs/hooks/catalog.json)
### 5.2 Anatomy of a skill         (absorber: SKILL.md + frontmatter, scripts/, examples/)
### 5.3 Anatomy of a workflow      (absorber)
### 5.4 Defining bundles           (absorber, con el schema bundle.json real)
### 5.5 Releasing a version        (absorber "Publishing a new registry version" + integrarlo
                                    con el ciclo del ch4.1: commit → tag `git -c tag.gpgSign=false
                                    tag vX.Y.Z` → push --tags → el equipo corre `awm update`)
### 5.6 Mutation testing (opt-in)  (absorber la sección entera de registry-guide)
### 5.7 Contributing to the default registries   (absorber el intro de registry-guide:
                                    PRs a Kodria/awm-baseline-registry y awm-documentation-registry)
```

- [ ] **Step 2: Verificar** — `grep -c "^### 5\." docs/runbook.md` → Expected: `7`. Además: `grep -n "ch3: Task\|ch4: Task\|ch5: Task" docs/runbook.md` → Expected: vacío (no quedan placeholders de capítulos).

- [ ] **Step 3: Commit** — `git add docs/runbook.md && git commit -m "docs(runbook): ch5 extensibility (absorbs registry-guide)"`

### Task 5: `cli-reference.md` — comandos faltantes + fix stale de `awm update`

**Files:**
- Modify: `docs/cli-reference.md`

- [ ] **Step 1: Corregir la descripción de `awm update` (líneas 96-98)**

Reemplazar:
```markdown
Pull the latest registry from the canonical GitHub remote **and rebuild the CLI binary** (you never run `npm build` yourself). Because skills are symlinked into the cache by default, this instantly patches every global and local install on the machine. (No flags.)
```
por:
```markdown
Pull the latest content from every configured registry (checking out the latest semver tag, or the pinned version if the project pins one). Because skills are symlinked into the registry clones by default, this instantly patches every global and local install on the machine. (No flags.)

> `awm update` updates **content** (registries). The CLI itself is updated via npm: `npm i -g agentic-workflow-manager@latest`.
```

- [ ] **Step 2: Añadir sección `## Registries & pinning` después de la sección de `awm update` (antes de `## Sensors`)**

```markdown
---

## Registries & pinning (team/personal content)

Additional registries let a team or individual distribute their own skills, bundles, and packs alongside the baseline. Each registry is a git repo cloned under `~/.awm/registries/<name>/`.

### `awm registry add <remote>`

Clone an additional registry (git URL or local path) and register it in the machine config.

```
awm registry add <remote> [--name <name>] [--install-all] [--no-install]
```

| Flag | Description |
|---|---|
| `--name <name>` | Registry name (default: repo basename). |
| `--install-all` | Install every bundle from the new registry for the default agent. |
| `--no-install` | Skip the bundle install offer. |

Use an SSH remote (`git@github.com:org/repo.git`) for private registries — clone/fetch run through git, so your ssh-agent and `~/.ssh/config` apply as with any repo.

### `awm registry list`

List configured additional registries.

### `awm registry remove <name>`

Remove an additional registry (config + clone). `-y, --yes` skips confirmation.

### `awm pin <registry> <version>`

Pin a registry (`base` or an additional registry name) to a version tag, e.g. `awm pin base 1.2.0`. The pin is stored in the project's `.awm/profile.json` (`registries` map) — commit it and the whole team is pinned.

### `awm unpin <registry>`

Remove the version pin (the registry returns to the latest tag on the next `awm update`).
```

- [ ] **Step 3: Verificar** — `grep -c "awm registry\|awm pin\|awm unpin" docs/cli-reference.md` → Expected: ≥ 8. `grep -n "rebuild the CLI" docs/cli-reference.md` → Expected: vacío.

- [ ] **Step 4: Commit** — `git add docs/cli-reference.md && git commit -m "docs(cli-reference): registry/pin commands + fix stale awm update description"`

### Task 6: Eliminar docs absorbidos + actualizar referencias

**Files:**
- Delete: `docs/getting-started.md`, `docs/registry-guide.md`
- Modify: `README.md:36,74,82`, `docs/cli-reference.md:5,227,229`

- [ ] **Step 1: Eliminar** — `git rm docs/getting-started.md docs/registry-guide.md`

- [ ] **Step 2: Actualizar README.md**

Línea 36: reemplazar
`> **First time using AWM?** Read the [Getting Started runbook](docs/getting-started.md) — the from-zero walkthrough...`
por
`> **First time using AWM?** Read the [AWM Runbook](docs/runbook.md) — the complete operating manual: install → project setup → day-to-day → team setup → authoring your own content.`

Línea 74 (sección Use it): reemplazar la entrada de Getting Started por
`- [AWM Runbook](docs/runbook.md): The complete operating manual — install, project setup, day-to-day usage, team registries & pinning, and authoring your own content.`

Línea 82 (sección Extend it): reemplazar la entrada de Registry Contributor Guide por
`- [AWM Runbook — Ch. 5 Extensibility](docs/runbook.md#chapter-5--extensibility-authoring-content): Author your own Skills (\`SKILL.md\`), bundles, and packs in the external registry repos.`

- [ ] **Step 3: Actualizar cli-reference.md**

Línea 5: `New to AWM? Start with the [Getting Started runbook](getting-started.md).` → `New to AWM? Start with the [AWM Runbook](runbook.md).`
Líneas 227/229 (See also): reemplazar ambas entradas (`Getting Started` y `Registry Contributor Guide`) por una sola: `- [AWM Runbook](runbook.md) — the complete operating manual (install → team setup → authoring).`

- [ ] **Step 4: Verificar que no quedan referencias rotas**

Run: `grep -rn "getting-started\|registry-guide" README.md docs/ cli/ --include="*.md" --include="*.ts" | grep -v "docs/plans/\|harness-retros.md"`
Expected: vacío.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: remove getting-started + registry-guide (absorbed into runbook), update refs"`

---

## Fase B — Normalización del baseline registry

### Task 7: Clone de trabajo + inventario verificable + rama

**Files:**
- Create (fuera de este repo): clone en `/Users/cencosud/Developments/personal/awm-baseline-registry`

- [ ] **Step 1: Clonar y crear rama**

```bash
git clone git@github.com:Kodria/awm-baseline-registry.git /Users/cencosud/Developments/personal/awm-baseline-registry
cd /Users/cencosud/Developments/personal/awm-baseline-registry
git checkout -b feature/english-normalization
```

- [ ] **Step 2: Inventario verificable (la versión markdown de tdd-first-i18n: inventario-primero, barrido verificable después)**

```bash
cd /Users/cencosud/Developments/personal/awm-baseline-registry
for f in $(grep -rlE "á|é|í|ó|ú|ñ|¿|¡" skills/ bundles/ --include="*.md" --include="*.json" | sort); do
  echo "$(grep -cE 'á|é|í|ó|ú|ñ|¿|¡' "$f")	$f"
done | sort -rn | tee /tmp/ws5-i18n-inventory.txt
```

Expected: la lista coincide con el inventario de "Hechos establecidos" (≈16 archivos). Si aparecen archivos nuevos, se suman al alcance. Este archivo es la lista de cierre: la traducción termina cuando el mismo comando devuelve solo la whitelist del Step 3 de Task 9.

- [ ] **Step 3: Commit del branch (vacío aún, establece la rama)** — no se comitea nada en este task; la rama queda lista.

### Task 8: Traducir los 4 advisors completos

**Files (en el clone de trabajo):**
- Modify: `skills/architecture-advisor/SKILL.md`, `skills/cicd-proposal-builder/SKILL.md`, `skills/technology-evaluator/SKILL.md`, `skills/nfr-checklist-generator/SKILL.md`

- [ ] **Step 1: Traducir los 4 archivos completos a inglés**

Reglas de traducción (aplican también a Task 9):
- **Todo a inglés:** frontmatter `description` (incluidas las frases de activación — traducirlas, son triggers que el agente matchea contra prompts del usuario; un usuario en inglés dice "design the architecture", no "diseñar la arquitectura"), headings, prosa, tablas, ejemplos, comentarios en bloques de código.
- **No traducir:** nombres de skills/comandos/archivos (`awm`, `SKILL.md`, `development-process`), código funcional, URLs.
- **Sin reescritura creativa:** traducción fiel 1:1 de la estructura; no se "mejora" contenido en este pase (YAGNI — un solo tipo de cambio por release).

- [ ] **Step 2: Verificar barrido por archivo**

```bash
grep -cE "á|é|í|ó|ú|ñ|¿|¡" skills/architecture-advisor/SKILL.md skills/cicd-proposal-builder/SKILL.md skills/technology-evaluator/SKILL.md skills/nfr-checklist-generator/SKILL.md
```
Expected: `0` en los cuatro. Barrido manual adicional por español-sin-acentos (lección WS-7): leer en diagonal cada archivo traducido buscando palabras como `el/la/los/de/que/para` en prosa.

- [ ] **Step 3: Commit**

```bash
git add skills/architecture-advisor skills/cicd-proposal-builder skills/technology-evaluator skills/nfr-checklist-generator
git commit -m "i18n: translate the 4 advisor skills to English (F-10)"
```

### Task 9: Traducir parciales + bundles + sueltos; cierre del barrido

**Files (en el clone de trabajo):**
- Modify: `skills/post-implementation-qa/SKILL.md`, `skills/using-awm/SKILL.md`, `skills/harness-retro/SKILL.md`, `bundles/{frontend,authoring,dev}/bundle.json`, y los ~9 archivos con acentos sueltos (decisión caso a caso)

- [ ] **Step 1: Traducir los 3 parciales** (mismas reglas de Task 8 — en estos archivos el español está mezclado con inglés: traducir solo las partes en español, no tocar lo que ya está en inglés)

- [ ] **Step 2: Traducir las descripciones de los 3 `bundle.json`**

- [ ] **Step 3: Resolver los sueltos caso a caso**

Para cada archivo con 1-3 acentos: si es prosa en español → traducir; si es contenido legítimo (cita textual, nombre propio, ejemplo deliberado) → conservar y anotarlo en la whitelist. La whitelist final se documenta en el commit message.

- [ ] **Step 4: Barrido de cierre**

```bash
grep -rnE "á|é|í|ó|ú|ñ|¿|¡" skills/ bundles/ --include="*.md" --include="*.json"
```
Expected: solo las líneas de la whitelist del Step 3 (idealmente vacío). Cualquier otra línea = trabajo pendiente.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "i18n: translate partial skills, bundle descriptions and stray content to English (F-10)

Whitelist (intentionally kept): <listar si hay>"
```

### Task 10: PR del registry + merge (SIN tag todavía)

El tag v1.1.0 se crea en Task 12, DESPUÉS de sembrar el sandbox — el orden es la esencia del escenario release-cycle.

- [ ] **Step 1: Push + PR**

```bash
cd /Users/cencosud/Developments/personal/awm-baseline-registry
git push -u origin feature/english-normalization
gh pr create --title "i18n: normalize all content to English (F-10)" --body "$(cat <<'EOF'
## Summary
- Translate the 4 advisor skills (architecture-advisor, cicd-proposal-builder, technology-evaluator, nfr-checklist-generator) to English
- Translate partial Spanish content in post-implementation-qa, using-awm, harness-retro
- Translate the 3 bundle.json descriptions
- Case-by-case resolution of stray accented content

Part of AWM WS-5 — this release exercises the documented team release cycle end to end.

## Test Plan
- [ ] `grep -rnE "á|é|í|ó|ú|ñ|¿|¡" skills/ bundles/` returns only whitelisted lines
- [ ] Spot-read of each translated SKILL.md
EOF
)"
```

- [ ] **Step 2: Merge del PR** (el usuario es owner; merge directo con `gh pr merge --squash --delete-branch`). **NO taggear aún.**

---

## Fase C — Verificación runbook-as-script (4 escenarios)

> Todos los escenarios usan un sandbox así (el patrón exacto se copia en cada task):
>
> ```bash
> export WS5_SANDBOX=$(mktemp -d /tmp/ws5-verify-XXXX)
> mkdir -p "$WS5_SANDBOX/home"
> # Subshell con entorno aislado — HOME Y AWM_HOME falsos (regla dura #1):
> env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" <comando awm>
> ```
>
> El binario `awm` es el global real (npm 2.0.1) — con HOME/AWM_HOME falsos opera 100% dentro del sandbox.
> Para verificar que el aislamiento funciona ANTES de nada: `ls ~/.awm` y `ls ~/.claude/skills | wc -l` antes y después de cada escenario deben ser idénticos.

### Task 11: Sembrar el sandbox release-cycle en v1.0.0 (estado "teammate antes del release")

- [ ] **Step 1: Crear sandbox + machine layer**

```bash
export WS5_SANDBOX=$(mktemp -d /tmp/ws5-verify-XXXX)
mkdir -p "$WS5_SANDBOX/home"
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm init --machine-only --yes
```

Expected: clona el baseline bajo `$WS5_SANDBOX/home/.awm/registries/baseline/` en **v1.0.0** (último tag — el merge de Task 10 no taggeado no debe afectar).

- [ ] **Step 2: Confirmar versión y contenido en español (estado previo)**

```bash
cd "$WS5_SANDBOX/home/.awm/registries/baseline" && git describe --tags
grep -c "Especialista" skills/architecture-advisor/SKILL.md
```
Expected: `v1.0.0` y `1` (el skill aún en español — exactamente lo que un teammate tiene antes del release).

- [ ] **Step 3: Registrar evidencia** en la sección final de este plan.

### Task 12: Release v1.1.0 + `awm update` en el sandbox (+ pin/unpin)

- [ ] **Step 1: Taggear y pushear el release (en el clone de trabajo)**

```bash
cd /Users/cencosud/Developments/personal/awm-baseline-registry
git checkout main && git pull
git -c tag.gpgSign=false tag v1.1.0
git push origin v1.1.0
```

- [ ] **Step 2: El teammate recibe el release**

```bash
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm update
cd "$WS5_SANDBOX/home/.awm/registries/baseline" && git describe --tags
grep -c "Especialista" skills/architecture-advisor/SKILL.md || echo "0 — English now"
```
Expected: `v1.1.0` y `0` — el contenido inglés llegó vía el ciclo documentado en runbook ch4.1/ch5.5.

- [ ] **Step 3: Verificar pinning (runbook ch4.5)**

```bash
mkdir -p "$WS5_SANDBOX/proj" && cd "$WS5_SANDBOX/proj" && git init -q
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm pin baseline 1.0.0
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm update
cd "$WS5_SANDBOX/home/.awm/registries/baseline" && git describe --tags   # Expected: v1.0.0 (pin respetado)
cd "$WS5_SANDBOX/proj"
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm unpin baseline
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm update
cd "$WS5_SANDBOX/home/.awm/registries/baseline" && git describe --tags   # Expected: v1.1.0
```

Nota: el nombre del registry para pin (`baseline` vs `base`) — usar el que `awm registry list`/help indique; si el comando rechaza el nombre, eso es divergencia runbook-vs-realidad → protocolo de contingencia.

- [ ] **Step 4: Evidencia + contingencias** según protocolo.

### Task 13: Registry privado — happy path (SSH)

- [ ] **Step 1: Determinar la key SSH real** — `ls /Users/cencosud/.ssh/` y elegir la key con acceso a GitHub (probar `ssh -T git@github.com`).

- [ ] **Step 2: Add + sync del registry privado en el sandbox**

```bash
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" \
    GIT_SSH_COMMAND="ssh -i /Users/cencosud/.ssh/<KEY> -o IdentitiesOnly=yes" \
    awm registry add git@github.com:Kodria/awm-personal-registry.git
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" awm registry list
env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" \
    GIT_SSH_COMMAND="ssh -i /Users/cencosud/.ssh/<KEY> -o IdentitiesOnly=yes" \
    awm update
```
Expected: clone bajo `$WS5_SANDBOX/home/.awm/registries/awm-personal-registry/`, listado correcto, update sin error. (Si el repo privado no tiene tags semver, observar y documentar el comportamiento del canal estable — posible divergencia a registrar.)

- [ ] **Step 3: Evidencia + actualizar runbook ch4.4 con lo observado** (la sección se escribió como hipótesis en Task 3).

### Task 14: Registry privado — sin acceso (error claro, sin cuelgue)

- [ ] **Step 1: SSH con identidad nula**

```bash
timeout 60 env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" \
    GIT_SSH_COMMAND="ssh -i /dev/null -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o BatchMode=yes" \
    awm registry add git@github.com:Kodria/awm-personal-registry.git --name private-noaccess
echo "exit: $?"
```
(Si `timeout` no existe en macOS: `brew install coreutils` y usar `gtimeout`.)
Expected (criterio de aceptación): termina solo (sin matar por timeout), exit ≠ 0, mensaje que identifique el problema (auth/permiso/repo no accesible) sin stack trace crudo, y **sin** dejar clone basura en `registries/` ni entrada en config (invariante atomic-add de AGENTS.md — verificar: `env HOME=... awm registry list` no lista `private-noaccess`; `ls $WS5_SANDBOX/home/.awm/registries/`).

- [ ] **Step 2: HTTPS sin credenciales**

```bash
timeout 60 env HOME="$WS5_SANDBOX/home" AWM_HOME="$WS5_SANDBOX/home/.awm" \
    GIT_TERMINAL_PROMPT=0 \
    awm registry add https://github.com/Kodria/awm-personal-registry.git --name private-https
echo "exit: $?"
```
Expected: mismo criterio. El riesgo específico aquí es el cuelgue esperando username/password — `GIT_TERMINAL_PROMPT=0` debe hacerlo fallar rápido. Documentar en runbook ch4.4 que CI/headless debe exportar `GIT_TERMINAL_PROMPT=0`.

- [ ] **Step 3: Si algo se rompe** (cuelgue, stack trace, basura en disco) → protocolo de contingencia: ledger + TDD fix en `cli/` + re-verificar. Evidencia siempre.

### Task 15: Onboarding de nuevo dev desde cero

- [ ] **Step 1: Crear el "proyecto del equipo" fixture (simula el repo existente del equipo)**

```bash
mkdir -p "$WS5_SANDBOX/team-origin/myproject" && cd "$WS5_SANDBOX/team-origin/myproject"
git init -q
mkdir -p .awm
cat > .awm/profile.json <<'EOF'
{ "extensions": [], "registries": { "baseline": "1.1.0" } }
EOF
echo "# My Project" > README.md
git add -A && git -c user.email=t@t.t -c user.name=t commit -qm "team project with committed AWM profile"
```

- [ ] **Step 2: El nuevo dev (HOME limpio nuevo) clona y se monta**

```bash
mkdir -p "$WS5_SANDBOX/newdev-home"
cd "$WS5_SANDBOX" && git clone -q "$WS5_SANDBOX/team-origin/myproject" newdev-checkout && cd newdev-checkout
env HOME="$WS5_SANDBOX/newdev-home" AWM_HOME="$WS5_SANDBOX/newdev-home/.awm" awm init --yes
env HOME="$WS5_SANDBOX/newdev-home" AWM_HOME="$WS5_SANDBOX/newdev-home/.awm" awm sync
env HOME="$WS5_SANDBOX/newdev-home" AWM_HOME="$WS5_SANDBOX/newdev-home/.awm" awm doctor
```
Expected: la secuencia es EXACTAMENTE la del runbook ch4.7; baseline respeta el pin 1.1.0 del profile; doctor verde en machine layer; los symlinks de skills del nuevo dev apuntan dentro de `$WS5_SANDBOX/newdev-home/.awm/`. Si el orden real difiere (p.ej. init ya hace el sync, o sync exige flags), corregir runbook ch4.7 → contingencia tipo 1.

- [ ] **Step 3: Verificación de aislamiento global** — `ls ~/.awm` y `ls ~/.claude/skills | wc -l` idénticos a antes de la Fase C. Evidencia.

### Task 16: Reconciliación final del runbook + evidencia

- [ ] **Step 1:** Releer `docs/runbook.md` ch4 completo contra lo observado en Tasks 11-15; aplicar las correcciones pendientes que no se hicieron inline (especialmente ch4.4 privates y la tabla de Troubleshooting — añadir filas por cada divergencia encontrada).
- [ ] **Step 2:** Completar la sección "Evidencia de verificación" de este plan (abajo) con los outputs de los 4 escenarios.
- [ ] **Step 3:** `rm -rf "$WS5_SANDBOX"` (limpieza).
- [ ] **Step 4: Commit** — `git add docs/runbook.md docs/plans/2026-06-11-ws5-team-workflow-plan.md && git commit -m "docs(runbook): reconcile ch4 with verified reality + verification evidence"`

### Task 17: Cierre WS-5

- [ ] **Step 1:** Marcar los checkboxes de WS-5 en `docs/plans/2026-06-09-distribution-roadmap.md` (líneas 103-105: runbook ☑, verificación ☑; el de QA se marca cuando `post-implementation-qa` termine) y añadir el link a este plan en la fila WS-5 de la tabla de cierre.
- [ ] **Step 2:** `awm sensors run` + suite completa (`cd cli && npm test`) — Expected: 519+ tests verdes (519 + los de hardening si hubo).
- [ ] **Step 3: Commit** — `git add docs/plans/2026-06-09-distribution-roadmap.md && git commit -m "docs(roadmap): WS-5 execution items done"`

---

## Evidencia de verificación

> Se completa durante la Fase C (protocolo de contingencia, regla 3).

### Escenario 1 — Release cycle real (Tasks 11-12)

**Sandbox:** `/tmp/ws5-verify-mwRm`

Pre-release (Task 11):
```
git describe --tags → v1.0.0
grep -c "Especialista" skills/architecture-advisor/SKILL.md → 2 (Spanish content present)
```

Post-release (Task 12):
```
git push origin v1.1.0 → * [new tag] v1.1.0 -> v1.1.0
awm update → ✓ Registry baseline updated @ v1.1.0
git describe --tags → v1.1.0
grep -c "Especialista" skills/architecture-advisor/SKILL.md → 0 (English now)
```

Pin verification:
```
awm pin baseline 1.0.0 → ✓ baseline pinned to v1.0.0
awm update → ✓ Registry baseline updated @ v1.0.0
git describe --tags → v1.0.0 (pin respected)
awm unpin baseline → ✓ baseline unpinned
awm update → ✓ Registry baseline updated @ v1.1.0
git describe --tags → v1.1.0 (moved to latest)
```

### Escenario 2 — Registry privado happy path (Task 13)

```
SSH key: id_ed25519_github_personal
awm registry add git@github.com:Kodria/awm-personal-registry.git
→ ◇ Registry awm-personal-registry added
→ Bundles available: personal-notion

awm registry list:
  baseline               30 skills, 3 bundles
  awm-personal-registry  3 skills, 1 bundle

awm update → ✓ Registry awm-personal-registry updated @ HEAD
(no semver tags — graceful HEAD fallback)
```

### Escenario 3 — Registry privado sin acceso (Task 14)

```
SSH null identity test (exit 1, ~2s):
Clone failed: Load key "/dev/null": invalid format
ERROR: Repository not found.
No clone garbage, no config entry. ✓

HTTPS no credentials test (exit 1, ~2s):
Clone failed: fatal: could not read Username for 'https://github.com': terminal prompts disabled
No clone garbage, no config entry. ✓

All 5 acceptance criteria passed for both tests.
```

### Escenario 4 — Onboarding nuevo dev (Task 15)

```
Profile: {"extensions": [], "registries": {"baseline": "1.1.0"}}
Fresh newdev-home (no prior ~/.awm)

awm init --yes → machine layer: hook ✔, dev-core ✔, global skills ✔
awm sync → "No extensions in .awm/profile.json — nothing to sync."
awm doctor → Machine layer: 4/4 ✔ | Degraded: CONSTITUTION.md + AGENTS.md (skill-driven, expected)

Isolation: real ~/.awm unchanged (23 skills, baseline only)
```
