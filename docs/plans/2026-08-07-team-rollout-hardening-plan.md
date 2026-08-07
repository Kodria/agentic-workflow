# Team Rollout Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los defectos que impiden que equipos en Windows, GitLab,
Cursor/Copilot y repos legacy usen el flujo AWM de punta a punta, y dejar el
framework gobernado como producto.

**Architecture:** Ver `2026-08-07-team-rollout-hardening-design.md` (mismo
directorio) — decisiones D1–D7. Dos repos: `agentic-workflow` (CLI) y
`awm-baseline-registry` (contenido). Rama en ambos:
`claude/retomar-ramas-trabajo-2f9ws9`.

**Tech Stack:** TypeScript/Node 22, Jest (CLI); Markdown skills + JSON packs +
tests `.mjs` (registry). CI: GitHub Actions.

**Modo de ejecución:** interactivo

**Reglas de la corrida (retomable en cualquier entorno):**
- Cada release = commits propios + push inmediato a la rama. Nada vive solo en el
  contenedor.
- Cada release del CLI mergea por separado (cada merge publica a npm — el título
  del PR fija el bump: `fix` → patch, `feat` → minor).
- Al retomar en un entorno nuevo: leer este plan, `git log origin/main..HEAD` en
  ambos repos, y continuar desde la primera tarea sin checkbox.
- Registry: todo cambio de skill exige bump de `version` en frontmatter + bump del
  bundle `dev` en `catalog.json` Y `bundles/dev/bundle.json` (CI lo aplica).

---

## R1 — Hotfix Windows: resolución de binarios portable (CLI) — `fix`

_Contexto: H1/D1. Publicado roto en v3.9.0; en Windows preflight bloquea siempre._

### Task 1.1: Test que reproduce el fallo

**Files:**
- Test: `cli/tests/commands/sensors/status-windows.test.ts` (nuevo)

- [ ] Test con `process.platform` mockeado a `win32` (patrón de los tests de
  `exec.ts`): un sensor `cmd: "semgrep ..."` con binario resoluble debe dar
  `ok: true`; hoy da `not found in PATH` porque `which` no existe en Windows.
  Mockear la capa de ejecución, no el FS.
- [ ] Correrlo: debe FALLAR (rojo) contra el código actual.

### Task 1.2: Resolución portable en `status.ts`

**Files:**
- Modify: `cli/src/commands/sensors/status.ts:44-55`

- [ ] Extraer `resolveOnPath(bin): boolean`: `win32` → `where <bin>`; resto →
  `command -v <bin>` (garantizado POSIX; `which` no lo está).
- [ ] Test 1.1 en verde; casos existentes de `status` intactos.

### Task 1.3: Auditoría de POSIX-ismos en el camino preflight/status/exec

- [ ] `grep -rnE "execSync|spawn" cli/src/commands/{sensors,preflight,context-budget}/`
  y revisar cada comando construido por plataforma. Corregir lo que aparezca con
  el mismo patrón; si no aparece nada, dejar constancia en el commit.

### Task 1.4: Cierre R1

- [ ] `npx tsc --noEmit` + suite completa en verde.
- [ ] Commit `fix(sensors): resolve sensor binaries portably on Windows` + push.
- [ ] PR titulado `fix(...)` → patch release. Merge = hotfix publicado.

---

## R2 — Host de git agnóstico (registry) — `feat`

_Contexto: H2/D2. `gh` hardcodeado; GitLab no puede cerrar el ciclo._

### Task 2.1: Detección de host en `finishing-a-development-branch`

**Files:**
- Modify: `skills/finishing-a-development-branch/SKILL.md` (Opción 2 + paso previo)

- [ ] Paso de detección ANTES de iniciar el cierre: `git remote get-url origin` →
  `github.com` → `gh` | dominio con `gitlab` → `glab` | otro → modo degradado.
- [ ] Opción 2 con las tres ramas: `gh pr create ...` / `glab mr create ...` /
  degradación honesta (push + URL de compare/new-MR + reporte de qué faltó).
- [ ] Modo desatendido: la degradación es final VÁLIDO (pusheado + instrucción),
  nunca fallo mudo. Actualizar el texto del mandato desatendido si nombra "PR".

### Task 2.2: Check advisory `host` en preflight (CLI)

**Files:**
- Modify: `cli/src/commands/preflight/checks.ts`, `cli/src/commands/preflight/index.ts`
- Test: `cli/tests/commands/preflight/preflight.test.ts`

- [ ] Check `host`: detecta remote y presencia del CLI correspondiente (`gh`/`glab`
  vía `resolveOnPath` de R1). **Advisory: nunca cambia el exit code** — el reporte
  lo dice explícitamente. Tests: github+gh ok / gitlab sin glab advierte sin
  romper `ready` / sin remote silencioso.

### Task 2.3: Cierre R2

- [ ] Registry: bump `finishing-a-development-branch` + bundle `dev` (2 archivos);
  validadores + `check-skill-version-bumps.sh` en verde. Commit + push.
- [ ] CLI: suite en verde. Commit + push. PRs de ambos repos (CLI primero si 2.2
  entra en el mismo tren que R1; si no, independientes — 2.1 no depende de 2.2).

---

## R3 — Stacks como packs del registry (CLI + registry) — `feat`

_Contexto: H3/D3. Python fuera del registry; shell inexistente; `generic` = gate hueco._

### Task 3.1: Pack `python` en el registry

**Files:**
- Create: `sensor-packs/python/pack.json`, `sensor-packs/python/.semgrep.awm.yml`
  (+ configs de mypy/ruff que el pack decida shippear)

- [ ] `pack.json`: typecheck (mypy, fast), lint (ruff `--output-format json`, fast),
  security (semgrep), test (`pytest`, exit-code sensor), mutation disabled.
  `changedCmd`/`changedExtensions` (`.py`) en lint y security — mismo criterio D
  que js-ts: mypy NO se acota (whole-program).

### Task 3.2: Pack `shell` en el registry

**Files:**
- Create: `sensor-packs/shell/pack.json` (+ `.semgrep.awm.yml`)

- [ ] lint: `shellcheck --format json` sobre `{files}`/glob; security: semgrep.
  `changedExtensions`: `.sh`, `.bash`.

### Task 3.3: Eliminar `FALLBACK_DEFAULTS` del CLI

**Files:**
- Modify: `cli/src/commands/sensors/init.ts`
- Test: `cli/tests/commands/sensors/` (los que cubren init/fallback)

- [ ] Borrar `FALLBACK_DEFAULTS`. Stack detectado sin pack en registry alcanzable →
  manifest mínimo honesto que preflight reporta como degradado con remedio
  ("registry sin pack `<x>`: corré `awm update` / agregá el registry"), jamás
  defaults inventados por el CLI.
- [ ] Formatters: verificar que `ruff`/`shellcheck` JSON caen en un formatter
  razonable (¿`generic`? ¿nuevo formatter?). Si se necesita formatter nuevo, es
  parte de esta task (TDD: fixture de salida real → parser).

### Task 3.4: Detección + override explícito

**Files:**
- Modify: `cli/src/commands/sensors/init.ts`, `cli/src/commands/sensors/index.ts`
- Test: init/detección

- [ ] `detectStack`: agregar `shell` (archivos `*.sh` en raíz o `scripts/`, SOLO si
  no hay marcador js-ts/python). Orden de especificidad testeado.
- [ ] `awm sensors init --pack <name>`: override que salta la heurística; pack
  inexistente en registry → error claro listando los disponibles.

### Task 3.5: Cierre R3

- [ ] E2E local: repo fixture python y repo fixture shell → `awm sensors init` copia
  configs del pack correcto; `awm preflight` verde con tools presentes.
- [ ] Suite CLI + validadores registry en verde. Commits + push + PRs (registry
  primero o simultáneo; el CLI sin fallback depende de que el registry shippee
  `python`).

---

## R4 — Providers Cursor y GitHub Copilot (CLI + registry) — `feat`

_Contexto: H4/D4. La mitad del equipo no puede ni instalar AWM._

### Task 4.0: Verificar formatos vigentes (gate de la release)

- [ ] Contra docs oficiales actuales: formato de reglas de Cursor
  (`.cursor/rules/*.mdc`, frontmatter, `alwaysApply`) y de instructions de Copilot
  (`.github/instructions/*.instructions.md`, `applyTo`), y soporte real de
  `AGENTS.md` en ambos. Registrar hallazgos como comentario en este plan ANTES de
  implementar. Si algo difiere del diseño D4, ajustar D4 primero.

### Task 4.1: Provider configs

**Files:**
- Modify: `cli/src/providers/index.ts`
- Test: `cli/tests/providers/`

- [ ] `AGENT_TARGETS` += `cursor`, `copilot`. Configs por la tabla D4: skills
  local-only en Copilot (global → error claro con mensaje de por qué), `workflow`/
  `agent` = `null`, sin `hooks`, `injection.type = 'managed-agents-md'`.
- [ ] Tests: rutas de instalación por scope; `global` en Copilot falla con el
  mensaje esperado; `getInjection` devuelve la estrategia correcta.

### Task 4.2: Estrategia de contexto reutilizada

**Files:**
- Modify: `cli/src/core/context/` (solo lo que la generalización exija)
- Test: `cli/tests/core/context/`

- [ ] `CodexAgentsStrategy` parametrizada/reutilizada para cursor y copilot (si ya
  es genérica sobre `AGENTS.md`, este task es solo tests de wiring). El bloque
  gestionado instruye leer `SKILL.md` en los triggers (spine degradado a contexto
  leído — D4).

### Task 4.3: Renderers de skills por provider

**Files:**
- Modify: `cli/src/core/executor.ts` / renderers según arquitectura existente
- Test: instalación e2e con tmpdir por provider

- [ ] Cursor: `.mdc` con frontmatter mínimo que referencia el `SKILL.md` instalado.
- [ ] Copilot: `.instructions.md` con `applyTo` equivalente.
- [ ] `awm add` / `awm init` e2e en tmpdir para ambos providers.

### Task 4.4: Tier de capacidades visible

**Files:**
- Modify: `cli/src/commands/doctor.ts`; registry: `docs/runbook.md` Cap. 4

- [ ] `awm doctor` reporta tier por provider instalado (hooks nativos / AGENTS.md-
  managed / sin soporte de workflows). Runbook: matriz de capacidades por agente.

### Task 4.5: Cierre R4

- [ ] Suite completa + e2e de 4.3. Commits + push + PRs.

---

## R5 — Adopción en repos legacy (CLI + registry) — `feat`

_Contexto: H5/D5. El trinquete existe; nadie lo descubre._

### Task 5.1: Check advisory `baseline` en preflight

**Files:**
- Modify: `cli/src/commands/preflight/checks.ts`
- Test: `cli/tests/commands/preflight/preflight.test.ts`

- [ ] Sensores habilitados sin `sensors.baseline.json` → advisory con el hint del
  trinquete. No corre sensores (preflight sigue barato), no cambia exit code.

### Task 5.2: Guía de adopción

**Files:**
- Modify: registry `docs/runbook.md` (sección nueva en Cap. 2 o 4)

- [ ] "Adoptar AWM en un repo existente": init → primera corrida (esperá rojo
  masivo) → `awm sensors baseline` → el gate persigue solo hallazgos nuevos →
  re-baseline al reducir deuda. Con el porqué del diseño count-based.

### Task 5.3: Cierre R5 — suite + validadores, commits, push, PRs.

---

## R6 — CI del CLI (CLI) — `chore`/`fix`

_Contexto: H6/D6. Cada merge publica sin correr los tests._

### Task 6.1: `ci.yml` en pull_request

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] Matriz `ubuntu-latest` + `windows-latest`, Node 22: `npm ci`, `npm run build`,
  `npx tsc --noEmit`, `npx jest --runInBand`. La pata Windows es la red que faltó
  para H1.

### Task 6.2: Tests como precondición del release

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] `npx jest --runInBand` antes del paso Release. Rojo → no publica. El publish
  sigue automático; la condición nueva es estar verde.

### Task 6.3: Cierre R6 — verificar `ci.yml` corriendo en el PR de esta misma
release (se auto-demuestra). Merge.

---

## R7 — Gobierno en voz de producto (CLI repo) — `docs`

_Contexto: H7/D7. Último: documenta lo que ya quedó verdadero._

### Task 7.1: CONSTITUTION.md de `agentic-workflow`

- [ ] Secciones nuevas: **Matriz de soporte** (stacks R3, agentes R4 con tiers,
  hosts R2, OS con Windows post-R1) como declaración de contrato; **Frontera
  atendido/desatendido** (regla del registry, citada como política del producto);
  **Decisión pendiente registrada:** piso organizacional de sensores (qué es, por
  qué se pospone, qué lo activaría).

### Task 7.2: AGENTS.md de `agentic-workflow`

- [ ] Reencuadrar de notas personales a guía de mantenimiento del producto. Purgar
  entradas obsoletas (aplicar merge-and-prune; `awm context-budget` como evidencia
  del delta).

### Task 7.3: Cierre R7 — commit + push + PR final.

---

## Verificación global (al cerrar el plan)

- [ ] `awm preflight` verde en: repo js-ts (notion-tracker), fixture python,
  fixture shell — en Linux; en Windows al menos vía matriz CI de R6.
- [ ] `finishing-a-development-branch` produce cierre válido en fixture con remote
  gitlab sin `glab` (degradación honesta) — simulable con remote falso.
- [ ] `awm init` + `awm add` funcionan con target `cursor` y `copilot` en tmpdir.
- [ ] Los 4 PRs+ mergeados, releases npm cortadas, tags del registry al día.
