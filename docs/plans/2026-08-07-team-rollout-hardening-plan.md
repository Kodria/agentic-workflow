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

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

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

- [x] Test con `process.platform` mockeado a `win32` (patrón de los tests de
  `exec.ts`): un sensor `cmd: "semgrep ..."` con binario resoluble debe dar
  `ok: true`; hoy da `not found in PATH` porque `which` no existe en Windows.
  Mockear la capa de ejecución, no el FS.
- [x] Correrlo: debe FALLAR (rojo) contra el código actual.

### Task 1.2: Resolución portable en `status.ts`

**Files:**
- Modify: `cli/src/commands/sensors/status.ts:44-55`

- [x] Extraer `resolveOnPath(bin): boolean`: `win32` → `where <bin>`; resto →
  `command -v <bin>` (garantizado POSIX; `which` no lo está). Implementado vía
  `isWindowsNative()` (ya existente en `core/paths.ts`), no un check inline nuevo.
- [x] Test 1.1 en verde; casos existentes de `status` intactos.

### Task 1.3: Auditoría de POSIX-ismos en el camino preflight/status/exec

- [x] `grep -rnE "execSync|execFileSync|spawn" cli/src/commands/{sensors,preflight,context-budget}/`
  y revisar cada comando construido por plataforma. Corregir lo que aparezca con
  el mismo patrón; si no aparece nada, dejar constancia en el commit.
  **Hallazgo real:** `changed.ts`'s `shellQuote()` tenía el mismo bug (quoting
  POSIX-only en un string ejecutado con `shell:true`) — corregido, incluida una
  ronda de fix sobre la convención de escape (`""` → `\"`, real Win32
  `CommandLineToArgvW`). `preflight/` y `context-budget/` confirmados limpios
  (cero `child_process`).
  **Nota de atribución:** el `isWindowsNative()` swap en `exec.ts`
  (`killTree`'s `taskkill` vs. `process.kill(-pid)`, y `detached: !isWindowsNative()`
  en `spawn()`) no salió de este barrido — vino de la ronda de fixup
  review-driven de las Tasks 1.1+1.2 (misma pasada que portó `status.ts` a
  `where`/`command -v`). El hallazgo propio y nuevo de esta Task 1.3 es,
  específicamente, el bug de `changed.ts`'s `shellQuote()` descrito arriba.

### Task 1.4: Cierre R1

- [x] `npx tsc --noEmit` + suite completa en verde. (145 suites / 1284 tests)
- [x] Commit `fix(sensors): resolve sensor binaries portably on Windows` + push.
- [x] PR titulado `fix(...)` → patch release: #27 (https://github.com/Kodria/agentic-workflow/pull/27). Merge = hotfix publicado.

> **Nota de ciclo (no es el marcador de plan completo):** este plan cubre R1–R7;
> `<!-- awm-qa-complete -->`/`<!-- awm-retro-complete -->` a nivel de plan (que
> `development-process` lee para el plan ENTERO) solo corresponden cuando R7
> también esté cerrado — ponerlos ahora leería mal el estado de R2–R7 en una
> sesión futura. **R1 completa su propio ciclo QA + retro + PR** (release
> independiente, según "Reglas de la corrida"): post-implementation-qa corrió
> Track A + panel Track B completo sobre el diff de R1, encontró 2 blockers de
> seguridad (shellQuote en Windows) resueltos vía systematic-debugging con
> investigación de causa raíz contra fuentes primarias (algoritmo
> `CommandLineToArgvW` de Microsoft + investigación BatBadBut/CVE-2024-27980),
> más varios findings menores, todos cerrados y re-revisados. harness-retro
> corrió sobre el ledger acumulado de R1 (curó 2 lecciones en AGENTS.md: shell-quoting contra fuente primaria, y desduplicar `awm ledger list` antes de confiar en conteos de recurrencia) — ver `docs/harness-retros.md`. El ledger NO se archiva todavía: R2-R7 acumulan sobre la misma rama.

---

## R2 — Host de git agnóstico (registry) — `feat`

_Contexto: H2/D2. `gh` hardcodeado; GitLab no puede cerrar el ciclo._

> **Corrección post-verificación (2026-08-07):** el barrido fino encontró un SEGUNDO
> skill acoplado a GitHub: `receiving-code-review/SKILL.md:206` usa
> `gh api repos/.../pulls/.../comments/.../replies` para responder review comments
> inline. R2 lo cubre con la misma detección de host (equivalente `glab`, o
> degradación: reportar la respuesta en el cuerpo del texto si no hay CLI del host).

### Task 2.1: Detección de host en `finishing-a-development-branch` y `receiving-code-review`

**Files:**
- Modify: `skills/finishing-a-development-branch/SKILL.md` (Opción 2 + paso previo)

- [x] Paso de detección ANTES de iniciar el cierre: `git remote get-url origin` →
  `github.com` → `gh` | dominio con `gitlab` → `glab` | otro → modo degradado.
- [x] Opción 2 con las tres ramas: `gh pr create ...` / `glab mr create ...` /
  degradación honesta (push + URL de compare/new-MR + reporte de qué faltó).
- [x] Modo desatendido: la degradación es final VÁLIDO (pusheado + instrucción),
  nunca fallo mudo. Actualizado (incluye hedge simétrico gh/glab tras 2 rondas
  de review). Registry: PR #23 mergeado (https://github.com/Kodria/awm-baseline-registry/pull/23),
  bundle `dev` 2.6.0→2.7.0.

### Task 2.2: Check advisory `host` en preflight (CLI)

**Files:**
- Modify: `cli/src/commands/preflight/checks.ts`, `cli/src/commands/preflight/index.ts`
- Test: `cli/tests/commands/preflight/preflight.test.ts`

- [x] Check `host`: detecta remote y presencia del CLI correspondiente (`gh`/`glab`
  vía `resolveOnPath` de R1). **Advisory: nunca cambia el exit code** — el reporte
  lo dice explícitamente. Tests: github+gh ok / gitlab sin glab advierte sin
  romper `ready` / sin remote silencioso. `extractHost()` implementado con
  `new URL(remote).hostname` (2 rondas de fix — ver harness-retro
  `prefer-stdlib-over-hand-rolled-parsing`).

### Task 2.3: Cierre R2

- [x] Registry: bump `finishing-a-development-branch` + bundle `dev` (2 archivos);
  validadores + `check-skill-version-bumps.sh` en verde. Commit + push. PR #23
  mergeado.
- [x] CLI: suite en verde (145 suites / 1302 tests). Commit + push. PR
  independiente (2.1 no dependía de 2.2, y R1/PR #27 ya está mergeado — sin
  riesgo de mezclar trenes de release).

> **Cierre R2 (2026-08-07):** post-implementation-qa corrió sobre Task 2.2
> (robustness + logic lenses); encontró `extractHost` con manejo de userinfo
> ambiguo (2 rondas de fix), resuelto reemplazando la regex hand-rolled por
> `new URL(remote).hostname`. harness-retro curó la lección
> `prefer-stdlib-over-hand-rolled-parsing` en AGENTS.md, conectándola con la de
> R1 (shellQuote) — mismo patrón sistémico, dos ocurrencias en la misma sesión.
> Ledger NO se archiva — R3-R7 acumulan sobre la misma rama.

---

## R3 — Stacks como packs del registry (CLI + registry) — `feat`

_Contexto: H3/D3. Python fuera del registry; shell inexistente; `generic` = gate hueco._

### Task 3.1: Pack `python` en el registry

**Files:**
- Create: `sensor-packs/python/pack.json`, `sensor-packs/python/.semgrep.awm.yml`
  (+ configs de mypy/ruff que el pack decida shippear)

- [x] `pack.json`: typecheck (mypy, fast), lint (ruff `--output-format json`, fast),
  security (semgrep), test (`pytest`, exit-code sensor), mutation disabled.
  `changedCmd`/`changedExtensions` (`.py`) en lint y security — mismo criterio D
  que js-ts: mypy NO se acota (whole-program). PR/merge:
  `awm-baseline-registry@0a3f20d` (bundle `dev` 2.7.0→2.8.0).

### Task 3.2: Pack `shell` en el registry

**Files:**
- Create: `sensor-packs/shell/pack.json` (+ `.semgrep.awm.yml`)

- [x] lint: `shellcheck --format json` sobre `{files}`/glob; security: semgrep.
  `changedExtensions`: `.sh`, `.bash`. Mismo commit que 3.1.

> **Nota de cierre 3.1+3.2 (2026-08-07):** el implementador original (subagent en
> background) quedó huérfano por un reinicio de sesión/contenedor a mitad de
> tarea — sus archivos (packs + `tests/sensor-pack-shape.test.mjs`, nuevo) habían
> quedado escritos en disco pero sin commit ni review. El controlador retomó
> directamente: corrió los validadores, encontró y arregló un bug real en el test
> nuevo (exigía `changedExtensions` siempre que hay `changedCmd`, rompía contra
> `generic`/`js-ts`.security preexistentes que la omiten a propósito), y descubrió
> dos gaps de tooling preexistentes no relacionados: `.gitignore`'s `*.awm.*`
> ocultaba en silencio los archivos `.semgrep.awm.yml` nuevos de `git status`
> (arreglado, eliminando la línea), y `check-skill-version-bumps.sh` usaba diff de
> 3 puntos contra un merge-base obsoleto — falsaba en esta misma rama de
> multi-release (arreglado a 2 puntos). spec-review: compliant. code-quality
> review: 2 hallazgos importantes (CHANGELOG con el header 2.7.0 pisado en vez de
> insertar uno nuevo; regla semgrep `awm-sh-no-eval` disparando doble sobre
> `eval $(...)` junto con `awm-sh-unquoted-command-substitution`) — ambos
> corregidos y re-revisados, verdict `approved`.

### Task 3.3: Eliminar `FALLBACK_DEFAULTS` del CLI

**Files:**
- Modify: `cli/src/commands/sensors/init.ts`
- Test: `cli/tests/commands/sensors/` (los que cubren init/fallback)

- [x] Borrar `FALLBACK_DEFAULTS`. Stack detectado sin pack en registry alcanzable →
  manifest mínimo honesto que preflight reporta como degradado con remedio
  ("registry sin pack `<x>`: corré `awm update` / agregá el registry"), jamás
  defaults inventados por el CLI.
- [x] Formatters: verificar que `ruff`/`shellcheck` JSON caen en un formatter
  razonable (¿`generic`? ¿nuevo formatter?). Si se necesita formatter nuevo, es
  parte de esta task (TDD: fixture de salida real → parser). Nuevos formatters
  `mypy`/`ruff`/`shellcheck` + campo `SensorConfig.formatter` (dispatch por
  campo, fallback a nombre de sensor para manifests preexistentes). commits
  `1ccff19` + `abd1d3d` (gap de cobertura end-to-end encontrado por spec-review
  y cerrado). spec-review + code-quality review: approved, 0 findings finales.

### Task 3.4: Detección + override explícito

**Files:**
- Modify: `cli/src/commands/sensors/init.ts`, `cli/src/commands/sensors/index.ts`
- Test: init/detección

- [x] `detectStack`: agregar `shell` (archivos `*.sh` en raíz o `scripts/`, SOLO si
  no hay marcador js-ts/python). Orden de especificidad testeado.
- [x] `awm sensors init --pack <name>`: override que salta la heurística; pack
  inexistente en registry → error claro listando los disponibles. commits
  `723bfc8` + `65220db` (2 fixes menores de code-quality-review: filtro
  `isFile()` en detección shell, cobertura del throw de registry sin
  `sensor-packs/`). spec-review + code-quality review: approved.

### Task 3.5: Cierre R3

- [x] E2E local: repo fixture python y repo fixture shell → `awm sensors init` copia
  configs del pack correcto; `awm preflight` verde con tools presentes. Confirmado
  directo (no subagent): manifest generado correcto para ambos packs (`formatter`
  incluido), `.semgrep.awm.yml` copiado, `awm preflight` → `ready` en ambos tras
  agregar `AGENTS.md`. `awm sensors run --fast` confirmó extremo a extremo: mypy y
  ruff parsean hallazgos reales correctamente vía los nuevos formatters; shell pack
  corre limpio.
- [x] Suite CLI + validadores registry en verde. Commits + push + PRs (registry
  primero o simultáneo; el CLI sin fallback depende de que el registry shippee
  `python`). **R3 cerrado (2026-08-08):** `awm-baseline-registry` PR #24 mergeado
  (`40f551a`), `agentic-workflow` PR #29 mergeado (`c6853d2`). Ambas ramas
  requirieron rebase (`--onto origin/main <last-already-merged-commit> HEAD`)
  antes del merge — la rama de sesión larga había divergido del squash-merge de
  R2 en ambos repos (conflicto real en `CHANGELOG.md`/`AGENTS.md`, resuelto sin
  pérdida de contenido, árbol final verificado idéntico pre/post-rebase).

> **post-implementation-qa (2026-08-07):** Track A (fidelidad vs prosa del plan,
> sin IDs de requirement en este plan) + panel Track B (robustness/security, logic,
> tests) sobre el diff completo de R3 en el lado CLI. Encontró 1 blocker + 5
> important + 2 minor, todos corregidos y re-verificados (commit `7ab9ea3`):
> - **Blocker:** `buildManifest` perdía el campo `formatter` al re-mergear sobre un
>   manifest preexistente (el path de upgrade real de usuarios ya publicados en
>   npm bajo el `FALLBACK_DEFAULTS` viejo) — merge cambiado de reemplazo de objeto
>   completo por sensor a merge por campo.
> - **Important (5):** `ruff`/`shellcheck` formatters crasheaban con JSON válido
>   pero de forma inesperada (mismo patrón sistémico en los 2 archivos — sin
>   validación de forma en runtime tras `JSON.parse`); `status.ts`/`run.ts` sin el
>   guard `?? {}` que `checkManifest` ya tenía (mismo patrón sistémico, aplicado
>   inconsistente); `STACK_DETECTORS` de python no incluía `requirements.txt`/
>   `Pipfile` pese a que el propio `pack.json` del registry los declara en
>   `detects`; `getFormatter` cascadeaba a mis-parseo silencioso ante un
>   `formatter` no reconocido; `checkTools` no reflejaba el estado degradado
>   honesto de manifest vacío.
> - **Minor (2):** cobertura de regresión para el fix `isFile()` de Task 3.4;
>   honestidad del comentario del caso "sin corchete `[code]`" en el test de mypy.
> Ledger acumulado (no archivado — R4-R7 siguen sobre la misma rama).

> **harness-retro R3 (2026-08-07):** `awm ledger recurring --min 2` sobre el
> ledger acumulado de R1-R3 (114 entradas) mostró 17 clusters convergentes.
> Curados 2 en `AGENTS.md`: `defensive-guard-consistency` (nuevo bullet — una
> guarda agregada a una función debe revisarse contra toda función hermana que
> lea el mismo campo) y una tercera instancia confirmada de
> `prefer-stdlib-over-hand-rolled-parsing` (extendido — un tipo TS sobre
> `JSON.parse()` sin validación runtime es la misma clase de falla que la regex
> hand-rolled de `shellQuote`/`extractHost`, ahora generalizada). El resto de
> los clusters son wins/confirmaciones de verificación o hallazgos ya curados
> como fix directo dentro del mismo ciclo de QA — no ameritan lección nueva.
> Ledger sigue sin archivar — R4-R7 acumulan sobre la misma rama.

---

## R4 — Providers Cursor y GitHub Copilot (CLI + registry) — `feat`

_Contexto: H4/D4. La mitad del equipo no puede ni instalar AWM._

### Task 4.0: Verificar formatos vigentes (gate de la release)

- [x] **Verificado 2026-08-07 contra fuentes web** (no memoria de entrenamiento):
  - **Cursor lee `AGENTS.md` nativamente**, y es el ÚNICO formato que su Agent
    mode lee en corridas autónomas (no lee `.cursorrules`). `.cursor/rules/*.mdc`
    vigente, con frontmatter y modos de activación; subdirectorios soportados.
  - **Copilot coding agent soporta `AGENTS.md`** (changelog GitHub 2025-08-28),
    además de `.github/copilot-instructions.md` y
    `.github/instructions/**.instructions.md` con frontmatter `applyTo` (glob)
    (changelog 2025-07-23). Bonus: dentro de `AGENTS.md` se pueden incluir otros
    archivos con `@ruta/relativa` — mecanismo directo para referenciar SKILL.md.
  - Conclusión: D4 validado. La estrategia `managed-agents-md` es el vehículo
    correcto para ambos.
- [x] Re-confirmado 2026-08-08 contra fuentes primarias frescas (WebSearch/WebFetch,
  no memoria) antes de fijar renderers. **Dos correcciones reales sobre la
  verificación del 07-08, ambas de diseño, no solo de implementación — ver nota
  en D4 de `2026-08-07-team-rollout-hardening-design.md`:**
  - Cursor: el Background/Cloud Agent NO lee `AGENTS.md` de forma confiable — bug
    abierto y reconocido por staff de Cursor en su foro, sin fix (Agent mode
    interactivo sí lo lee, sin cambios). Decisión: emitir `AGENTS.md` +
    `.cursor/rules/awm.mdc` (`alwaysApply: true`) como carrier redundante — nunca
    un solo canal cuando uno de los dos modos del agente objetivo lo tiene roto.
  - Copilot: `AGENTS.md` anidado está apagado por default (docs.github.com), y el
    mecanismo `@ruta/relativa` para incluir `SKILL.md` NO existe en ninguna
    fuente primaria — el mecanismo real es "AGENTS.md anidado, el más cercano
    gana". Decisión: único `AGENTS.md` en la raíz, referencia a `SKILL.md` con
    link markdown relativo estándar, nunca sintaxis `@`.
  - Hallazgo no bloqueante: `.instructions.md` soporta `excludeAgent:
    "code-review"|"cloud-agent"` (changelog 2025-11-12) — capacidad disponible
    del renderer si Task 4.3 la necesita, no requirement obligatorio.

### Task 4.1: Provider configs

**Files:**
- Modify: `cli/src/providers/index.ts`
- Test: `cli/tests/providers/`

- [x] `AGENT_TARGETS` += `cursor`, `copilot`. Configs por la tabla D4: skills
  local-only en Copilot (global → error claro con mensaje de por qué), `workflow`/
  `agent` = `null`, sin `hooks`, `injection.type = 'managed-agents-md'`.
  `ArtifactConfig.global`/`InjectionConfig.globalPath` ampliados a `string |
  null` (Copilot sin global confirmado; Cursor sin global sin confirmar,
  dejado `null` explícitamente en vez de adivinado).
- [x] Tests: rutas de instalación por scope; `global` en Copilot falla con el
  mensaje esperado; `getInjection` devuelve la estrategia correcta. commits
  `ad1e819`+`6d109fe`+`e906ca6`. code-quality-review encontró 2 blockers reales
  (`agentsSharingSkillTarget`/`assertCompleteSharedGroup` crasheaban el install
  completo de CUALQUIER agente si Copilot estaba meramente habilitado, no
  seleccionado — mismo patrón que un guard ya correcto en
  `mutation-targets.ts`, no aplicado en estos 2 call sites) + 1 minor (mensaje
  de error duplicado 3 veces). Todos corregidos, re-revisado: approved.

### Task 4.2: Estrategia de contexto generalizada

**Files:**
- Modify: `cli/src/core/context/strategies/codex-agents.ts`, `cli/src/core/init/steps.ts`
- Test: `cli/tests/core/context/`

_Verificado 2026-08-07: NO es solo wiring. Tres acoplamientos reales a Codex:_
- [x] `injectGlobal()` hardcodea `~/.codex/AGENTS.md` (`codex-agents.ts:86`) →
  parametrizar por `provider.injection.globalPath` (el camino `inject()` ya lo
  hace bien — igualar).
- [x] `assertGlobalInput` solo acepta scope global → decidir scope por provider
  (Copilot no tiene AGENTS.md global de repo; su bloque va a nivel proyecto).
  Generalizado a `requiredScope(provider)`/`targetFile(...)` — primer uso real
  de scope `'local'` en este módulo (antes solo tipado, nunca ejercido).
- [x] `init/steps.ts:82` instancia `CodexAgentsStrategy` para `injectProject` —
  revisar la condición de agente que lo rodea para que cubra cursor/copilot.
  Confirmado ya agnóstica al agente (gatea por `injection.type`, no por nombre)
  — sin cambios necesarios ahí.
- [x] El bloque gestionado instruye leer `SKILL.md` en los triggers (spine
  degradado a contexto leído — D4).
- [x] Referenciar `SKILL.md` desde el bloque gestionado con link markdown
  relativo estándar (`[nombre](ruta/relativa/SKILL.md)`) — NUNCA sintaxis
  `@ruta/relativa` (no existe en ninguna fuente primaria de Copilot ni Cursor;
  corrección de Task 4.0, 2026-08-08). Confirmado: la sintaxis `@path` nunca
  existió en este código — `buildContext()` embebe el `SKILL.md` completo
  inline, no lo referencia. Nada que corregir.
- [x] Copilot: `injectProject` escribe SOLO `AGENTS.md` en la raíz del repo,
  nunca anidado (soporte fuera de la raíz apagado por default — corrección de
  Task 4.0). Confirmado ya cumplido — sin lógica de anidado en el código.
- [x] Cursor: además del `AGENTS.md` vía `managed-agents-md`, `injectProject`
  también escribe `.cursor/rules/awm.mdc` (`alwaysApply: true`) con el mismo
  bloque gestionado como carrier redundante — el Background/Cloud Agent de
  Cursor no lee `AGENTS.md` de forma confiable (bug abierto sin fix; corrección
  de Task 4.0). Este archivo se genera del mismo contenido fuente que el bloque
  de `AGENTS.md`, no es una estrategia de inyección nueva. commits
  `33f6b99`+`c7fa13d`. code-quality-review: 2 important (gate por
  `provider.label` en vez de `AgentTarget` tipado; return value ignoraba el
  resultado del carrier) + 1 minor, corregidos; re-revisado: approved.

> **Pendiente para Task 4.4 (no scope creep aquí):** `contextGlobalCheck`
> (`cli/src/core/diagnostics/provider-checks.ts:167`) hardcodea `scope:
> 'global'`, así que el chequeo de contexto de `awm doctor` para Cursor/Copilot
> (ambos legítimamente scope local ahora) siempre lee `'absent'` incluso tras
> una inyección local correcta — no es un crash nuevo (mismo estado visible
> `'absent'` que antes de este diff, por un camino de excepción distinto), pero
> vuelve invisible para `doctor` la capacidad de scope local que esta task
> agregó. Task 4.4 ("tier de capacidades visible") es dueña de `awm doctor`'s
> reporte por provider — la corrección va ahí.

### Task 4.3: Renderers de skills por provider

**Files:**
- Modify: `cli/src/providers/index.ts` (`RendererId`, `assertLinkRenderer`),
  nuevo módulo de rendering (ubicación según convención al implementar)
- Test: instalación e2e con tmpdir por provider

_Verificado 2026-08-07: `executor.ts` son 63 líneas de primitivas symlink/copy —
NO es el punto de extensión. El renderer vive en providers:
`RendererId = 'link' | 'codex-agent-toml'` y `assertLinkRenderer` TIRA para
cualquier renderer no-link ("not implemented yet"). Esta task agrega renderer ids
nuevos e implementa su rendering — no toca executor._
- [x] `RendererId` += `cursor-mdc`, `copilot-instructions`; implementar rendering
  (Cursor: `.mdc` con frontmatter refiriendo el `SKILL.md`; Copilot:
  `.instructions.md` con `applyTo`) y levantar la restricción de
  `assertLinkRenderer` para los nuevos ids. **Corrección post-review:** la
  restricción de `assertLinkRenderer` NO se levantó — ver nota abajo.
- [x] `awm add` / `awm init` e2e en tmpdir para ambos providers. commits
  `a7d00b7`+`c97bde2`. code-quality-review encontró 1 blocker + 2 important,
  corregidos, re-revisado: approved.

> **Corrección real vs. plan literal:** el plan pedía "levantar la restricción
> de `assertLinkRenderer` para los nuevos ids" — implementado así en la primera
> ronda, pero code-quality-review encontró que `assertLinkRenderer` es
> exclusivo de callers legacy de copia/symlink cruda (`core/provider-artifacts.ts`,
> `src/index.ts`'s `awm add` interactivo), que NUNCA pueden renderizar —
> levantar la restricción ahí producía un archivo sin extensión `.mdc`/
> `.instructions.md` ni frontmatter, que ni Cursor ni Copilot reconocen. El
> pipeline real (`commands/add.ts` → `install-planner.ts` →
> `install-transaction.ts`) nunca llama a `assertLinkRenderer` — no necesita el
> permiso. Revertido: `assertLinkRenderer` sigue rechazando cursor-mdc/
> copilot-instructions, igual que siempre rechazó `codex-agent-toml`.

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
