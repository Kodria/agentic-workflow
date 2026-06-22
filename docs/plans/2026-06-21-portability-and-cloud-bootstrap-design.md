# Brief de Producto — Era de Portabilidad y Arranque en la Nube

**Fecha:** 2026-06-21 · **Validación empírica:** 2026-06-22
**Estado:** BRIEF — spikes WS-A y WS-B validados empíricamente en sesión web real (ver §0). PA-1/PA-2/PA-3 cerradas con evidencia. No es un plan de implementación; define problema, alcance, decisiones tomadas y resultados de validación antes de abrir workstreams de ejecución.
**Autor de la sesión:** Nicolás (`nicolasf1402@gmail.com`)
**Contexto:** Cerrada la "Era de Distribución" (2026-06-12, AWM distribuible a equipos vía npm + multi-registry + versionado), surgen dos necesidades nuevas que esa era dejó explícitamente diferidas o sin contemplar:

1. **Portabilidad de SO.** El equipo trabaja en Windows y Linux; AWM hoy asume layout Unix (macOS/Linux). Esto activa el trigger de demanda de **F-11**, que la Era de Distribución dejó como diferido documentado.
2. **Arranque en entornos efímeros de nube.** Nicolás usa Claude Code en la web (VMs efímeras como la de esta sesión), donde AWM no está instalado y no hay credenciales git. Los registries privados no se pueden clonar. Este escenario **no estaba en ningún plan previo** — es necesidad nueva.

Este brief nace de la misma disciplina del roadmap de distribución (`2026-06-09-distribution-roadmap.md`): registro de hallazgos F-n, workstreams con ciclo completo, nada se marca hecho sin verificación.

---

## 0. Resultados de validación empírica (2026-06-22)

Antes de abrir workstreams de ejecución se corrieron dos spikes en una sesión real de Claude Code web. **Ambos positivos.** Esto cambia el diagnóstico: lo que se temía un rediseño es esencialmente un setup script.

### Spike WS-A — arranque en nube + hook SessionStart `[cierra G-1, G-5; resuelve PA-1, PA-2]`

- **Setup script probado** (corre una vez al crear el entorno, cacheado por la web — confirma PA-2):
  ```bash
  npm i -g agentic-workflow-manager
  awm init --yes
  ```
- **Verificado en la VM:** `awm --version` → `2.0.1`; `awm doctor` → Machine global sano (CLI ✅, hook SessionStart ✅, baseline `dev-core` ✅, skills globales ✅).
- **PA-1 RESUELTA POSITIVO:** el hook **SÍ dispara** en la sesión web. El bloque de contexto "You have AWM" fue inyectado tal cual en el system prompt de la sesión. El mecanismo: `awm init` escribe `~/.claude/settings.json` **nativamente dentro de la VM**, y Claude Code web lo lee en runtime. La duda previa ("user-level settings no se copian del laptop") era un falso negativo: *no copiarse* ≠ *ser ignorado un settings.json escrito en la propia VM*.
- **Consecuencia:** WS-A **no requiere rediseño** — se reduce al setup script de 2 líneas. G-5 cerrado.

### Spike WS-B — registry privado por token `[cierra G-2, G-3; resuelve PA-3]`

- **Setup script probado** con un registry privado real (`awm-personal-registry`):
  ```bash
  git config --global url."https://x-access-token:${AWM_GIT_TOKEN}@github.com/".insteadOf "https://github.com/"
  npm i -g agentic-workflow-manager
  awm init --yes || true
  awm registry add "https://github.com/<owner>/awm-personal-registry.git" --name personal --no-install || true
  ```
- **Variable de entorno:** `AWM_GIT_TOKEN` (fine-grained, read-only, *Contents: Read* — D-6), inyectada como secreto del entorno web.
- **Verificado:** el registry privado **se clonó correctamente** desde la VM efímera sin credenciales de host. El token se inyecta en la capa de transporte git (`url.insteadOf`), **no** en `registries.json` ni en `.git/config` del registry → **PA-3 satisfecha**: el secreto nunca se persiste en disco.
- **Consecuencia:** G-2 y G-3 cerrados empíricamente. El mecanismo `url.insteadOf` resuelve el hueco de "registries adicionales sin override por env" **sin tocar código del CLI** — prefigura la solución de diseño de §4.2.

### Qué queda

La validación demuestra **factibilidad end-to-end** con mecanismos existentes (setup script + `git config insteadOf`). Lo que resta es **producto, no factibilidad**: decidir si el mecanismo `url.insteadOf` se documenta como receta operativa o se hornea dentro del CLI (`AWM_GIT_TOKEN` nativo, §4.2), y ejecutar WS-C (sensibilidad al SO). Ver §6/§8.

---

## 1. Diagnóstico técnico (verificado en código, no asumido)

### 1.1 Modelo de distribución actual

- **CLI ya desacoplado y publicado:** `agentic-workflow-manager@2.0.1` en npm. Instalable en cualquier VM con `npm i -g`. ✅ La mitad "instalá el binario" del problema de nube **ya está resuelta**.
- **Contenido en registries git separados.** `awm init` siembra `baseline` y clona vía `simpleGit().clone(remote)` (`cli/src/core/registries.ts:119`). El clone usa **las credenciales git de la máquina host**. En el Mac de Nicolás funciona por su auth git local; en una VM efímera **no hay credenciales** → si el registry es privado, el clone falla. **Esta es la raíz del problema de nube.**
- **`awm init` ya es no-interactivo.** Flags `--yes`, `--machine-only`, `--agent`, `--json` (`cli/src/commands/init.ts:155-170`). Un script de arranque puede correr `awm init --yes` sin TTY. ✅ El bootstrap automático es factible hoy.
- **El baseline ya admite remote por env.** `seedBaselineRegistry()` → `resolveBaseRemote()` respeta `AWM_BASE_REMOTE` (`cli/src/core/registry.ts:13`). Un token embebido en esa URL HTTPS ya funcionaría para el baseline.

### 1.2 Dónde el SO está asumido como Unix (3 puntos concretos)

| Punto | Ubicación | Implicación en Windows nativo |
|---|---|---|
| Skills instalados como **symlinks** | `cli/src/commands/hooks/install.ts:73`, `docs/architecture.md:36` | Symlinks requieren Developer Mode; hay que caer a copia |
| Hook wrapper `run-hook.cmd` es **stub** | `awm-baseline-registry` (hooks) | El polyglot bat+bash existe pero la rama Windows no está validada |
| Paths asumen layout Unix | `~/.awm`, `~/.claude/skills/`, uso de `process.env.HOME` | Windows usa `USERPROFILE`/`APPDATA`; separadores `\` |

**Nota:** ya existe `AWM_HOME` como override (`cli/src/core/registries.ts:11`), pero el fallback es `process.env.HOME` — vacío en Windows nativo.

### 1.3 Estado de los hallazgos previos relevantes

- **F-11 (Windows nominal):** decidido en WS-7 como *"no soportado por ahora, WSL recomendado, diferido con trigger de demanda"*. **La necesidad de hoy es ese trigger.**
- **F-2/WS-2 (multi-registry + `AWM_BASE_REMOTE`):** entregado. Pieza reutilizable para inyectar credenciales.
- **Escenario VM efímera / Claude Code en la nube:** sin precedente en `docs/plans/`. Necesidad genuinamente nueva.

---

## 2. Decisiones de producto tomadas (sesión 2026-06-21)

Registradas vía consulta directa a Nicolás. Son el marco no negociable del brief.

| # | Decisión | Elección | Consecuencia de alcance |
|---|---|---|---|
| D-1 | **Soporte Windows** | **Nativo, pero más adelante.** WSL es la vía recomendada *ahora*; el soporte nativo es una fase 2 con su propio alcance. | La portabilidad nativa (symlink→copia, `run-hook.cmd` real, normalización de paths) se diseña pero no se ejecuta en esta primera vuelta. Ahora: detectar SO + documentar WSL + endurecer Linux. |
| D-2 | **Entornos de nube objetivo** | **Solo Claude Code en la web.** | No se diseña para GitHub Actions / Codespaces / Docker genérico en esta era. El mecanismo de arranque se apoya en *setup scripts* + variables de entorno del entorno web. |
| D-3 | **Auth de registries privados** | **Token git por variable de entorno** (HTTPS con PAT/fine-grained token inyectado como secreto del entorno). | Los repos siguen **privados**. No se hace público nada. Reusa la cadena `AWM_BASE_REMOTE`; hay que extender el modelo a registries adicionales (ver §4). |
| D-4 | **Entregable de esta sesión** | **Doc markdown en el repo** (este archivo), commiteado a la rama de feature. | — |
| D-5 | **Modelo de credencial** (resuelve PA-5) | **Un solo secreto.** Las sesiones de nube son solo para Nicolás y sus repos, todos en su cuenta de GitHub. Un único token cubre baseline + cualquier registry privado suyo. | No hace falta modelo multi-credential. WS-B se simplifica a un solo `AWM_GIT_TOKEN`. |
| D-6 | **Tipo de token** (resuelve PA-4) | **Fine-grained token, read-only, permiso *Contents***, sobre los repos de registry de Nicolás. | El usuario lo crea una vez en GitHub y lo inyecta como variable de entorno del entorno web. |
| D-7 | **Forma de entrega del token** (cierra la decisión WS-B) | **Receta de setup script** (`git config url.insteadOf` + `AWM_GIT_TOKEN`), no `AWM_GIT_TOKEN` nativo en el CLI. | Costo cero, ya validado (§0). WS-B queda **cerrado**, sin abrir ciclo de desarrollo en `cli/`. La receta se documenta como parte de WS-C. |

---

## 3. Alcance de esta era

### Dentro de alcance

- **Arranque automático de AWM en Claude Code web** vía script de inicio del entorno: `npm i -g agentic-workflow-manager` → `awm init --yes` no-interactivo.
- **Acceso a registries privados desde la VM** usando un token git inyectado por variable de entorno, sin exponer ningún repo.
- **Sensibilidad al SO:** detección de plataforma, mensajería clara, y endurecimiento de la vía Linux (que es la que corre en la nube y la que ya está semi-soportada).
- **Documentación operativa** del flujo de nube y del flujo Windows-vía-WSL para el equipo.

### Fuera de alcance (diferido con trigger)

- **Soporte Windows nativo** (D-1): se diseña la estrategia pero se ejecuta en fase 2.
- **Otros entornos de nube** (D-2): Actions, Codespaces, devcontainers, Docker genérico.
- **Distribución de contenido como paquetes** (tarballs/GitHub Packages) en vez de git clone: alternativa descartada en D-3 a favor del token.

---

## 4. Aproximación propuesta (a validar)

> Esta sección es propuesta de diseño de alto nivel, **no** implementación. Cada workstream abre su propio ciclo `development-process → design → plan → ejecución → QA`.

### 4.1 Arranque en Claude Code web (D-2)

El entorno web soporta un *setup script* al crear el entorno y variables de entorno por entorno (documentado en https://code.claude.com/docs/en/claude-code-on-the-web). Flujo propuesto:

```
# setup script del entorno (conceptual)
npm i -g agentic-workflow-manager
awm init --yes            # no-interactivo; siembra baseline + clona + instala hook + skills
```

**Preguntas abiertas (PA):**
- **PA-1 — RESUELTA POSITIVO (spike 2026-06-22, ver §0):** el hook SessionStart **sí dispara** en la sesión web; el bloque "You have AWM" se inyecta en el system prompt. `awm init` escribe `~/.claude/settings.json` nativamente en la VM y la web lo lee en runtime.
- **PA-2 — RESUELTA (spike 2026-06-22, ver §0):** el `awm init` corre en el *setup script* del entorno, **una vez al crear** (cacheado por la web), no por sesión.

### 4.2 Token git por variable de entorno (D-3)

**Lo que ya funciona:** `AWM_BASE_REMOTE=https://x-access-token:<TOKEN>@github.com/Kodria/awm-baseline-registry.git` hace que el baseline se clone autenticado, sin cambios de código.

**El hueco real — registries adicionales.** Los registries que no son baseline persisten su `remote` en `registries.json` (`cli/src/core/registries.ts:63-66`) y se clonan con ese valor literal en `syncRegistries()` (línea 119). No hay override por env para ellos. Propuesta a evaluar:

- Un mecanismo de **inyección de credencial agnóstico al registry**: el CLI, al clonar/pull, reescribe `https://github.com/...` → `https://x-access-token:<TOKEN>@github.com/...` tomando el token de una env var única (p.ej. `AWM_GIT_TOKEN`) cuando el remote es HTTPS de un host conocido. Así un solo secreto cubre baseline + N registries privados del mismo host.

**Consideraciones de seguridad a resolver en el design:**
- **PA-3 — RESUELTA (spike 2026-06-22, ver §0):** validado el modelo "token en env var separada, nunca persistido". `git config --global url."https://x-access-token:${AWM_GIT_TOKEN}@github.com/".insteadOf "https://github.com/"` inyecta el token en la capa de transporte git; el clone autentica pero **ni `registries.json` ni `.git/config` guardan el secreto** (quedan con la URL limpia). El embeber-en-URL de `AWM_BASE_REMOTE` queda como anti-patrón a evitar.
- **PA-4 — RESUELTA (D-6):** fine-grained token, read-only, permiso *Contents*, sobre los repos de registry de Nicolás.
- **PA-5 — RESUELTA (D-5):** un solo secreto. Las sesiones de nube son solo para Nicolás y sus repos (todos en su cuenta de GitHub), así que un único `AWM_GIT_TOKEN` cubre baseline + cualquier registry privado suyo. Sin modelo multi-credential.

### 4.3 Sensibilidad al SO (D-1)

**Ahora (esta era):**
- Capa de **detección de plataforma** y normalización de home: usar `os.homedir()` con fallback robusto en vez de `process.env.HOME` directo donde aún se asuma.
- **Endurecer Linux** (es lo que corre en la nube): verificar que symlinks, hook y paths funcionan en una distro limpia sin las particularidades de macOS.
- **Documentar WSL** como vía única para Windows hoy, con detección que oriente al usuario si corre en Windows nativo.

**Fase 2 (diferida, D-1):** estrategia nativa Windows — fallback symlink→copia (ya existe `installMethod: 'copy'`, `cli/src/commands/hooks/install.ts:18-28`, reutilizable), `run-hook.cmd` validado en cmd.exe/PowerShell, paths con `USERPROFILE`/`APPDATA`.

---

## 5. Registro de hallazgos

| ID | Hallazgo | Fuente | Workstream | Estado |
|----|----------|--------|------------|--------|
| G-1 | **Arranque en nube no contemplado.** AWM no se autoinstala en VMs efímeras; depende de instalación manual previa. | Sesión 2026-06-21 | WS-A | ✅ **Cerrado** — setup script de 2 líneas validado (§0) |
| G-2 | **Auth de registry privado imposible sin credenciales host.** `simpleGit().clone` usa auth del host; en VM efímera no hay. Solo el baseline tiene override por env; los registries adicionales no. | `registries.ts:119`, `registry.ts:13` | WS-B | ✅ **Cerrado** — `git config url.insteadOf` + `AWM_GIT_TOKEN` clona registry privado desde la VM (§0) |
| G-3 | **Token potencialmente persistido en disco.** Embeber el token en `AWM_BASE_REMOTE` lo escribe a `registries.json`. Falta modelo "token en env, no persistido". | `registries.ts:63-66` | WS-B | ✅ **Cerrado** — `insteadOf` no persiste el token; `registries.json`/`.git/config` quedan limpios (§0) |
| G-4 | **SO Unix asumido (3 puntos).** Symlinks, `run-hook.cmd` stub, paths `HOME`. Trigger de F-11 activado por demanda real del equipo. | `install.ts:73`, README "Platform support" | WS-C | ✅ **Cerrado** — `core/paths.ts` single source of truth, symlink→copy fallback, `warnIfUnsupportedPlatform`, docs WSL operativa (2026-06-22) |
| G-5 | **Hook SessionStart sin verificar en entorno web.** Desconocido si dispara dentro de Claude Code web. | PA-1, sesión 2026-06-21 | WS-A | ✅ **Cerrado** — dispara; contexto "You have AWM" inyectado (§0) |

---

## 6. Workstreams propuestos (orden de prioridad sugerido)

> Propuesta. El orden y el corte se confirman con Nicolás antes de abrir el primero.

### WS-A — Arranque automático en Claude Code web `[G-1, G-5]` — ✅ **VALIDADO (spike 2026-06-22)**
Setup script de entorno + `awm init --yes`. Hook verificado disparando en web (PA-1/PA-2 resueltas, §0). **Entregable de valor logrado:** una sesión web nueva arranca con AWM funcionando. **Resta solo** convertir la receta en documentación operativa (parte de WS-C/§docs).

### WS-B — Credenciales de registry privado por token `[G-2, G-3]` — ✅ **VALIDADO (spike 2026-06-22)**
Mecanismo validado: `git config --global url.insteadOf` + `AWM_GIT_TOKEN`, sin persistir el secreto (PA-3 resuelta, §0). **Entregable de valor logrado:** clonar registries privados desde una VM sin exponerlos. **Decisión de producto pendiente:** ¿se deja como receta de setup script, o se hornea `AWM_GIT_TOKEN` nativo en el CLI (§4.2) para que `awm init`/`awm sync` lo apliquen sin que el usuario configure git a mano?

> Ambos workstreams quedan probados end-to-end con mecanismos existentes (setup script + `insteadOf`), **sin tocar código del CLI**. La pregunta ya no es factibilidad sino ergonomía/producto.

### WS-C — Sensibilidad al SO, fase 1 (Linux duro + WSL documentado) `[G-4]` — ✅ **CERRADO (2026-06-22)**
Detección de plataforma, endurecimiento Linux, documentación WSL para Windows. **Sin** Windows nativo (D-1). **Entregable de valor:** el equipo Linux y el equipo Windows-vía-WSL tienen un camino soportado y documentado. `core/paths.ts` centraliza HOME/AWM_HOME, symlink→copy fallback para EPERM, `warnIfUnsupportedPlatform` en init/sync/doctor, `docs/operations/cloud-and-platforms.md` con guías de VM + token + WSL. Branch `feat/ws-c-os-sensitivity` mergeado a main.

### WS-D — Windows nativo `[G-4]` — **DIFERIDO (D-1, fase 2)**
Symlink→copia, `run-hook.cmd` validado, paths Windows. Se reactiva tras WS-C según demanda.

---

## 7. Preguntas abiertas pendientes de decisión (para Nicolás)

Todas las preguntas abiertas quedaron resueltas. PA-4/PA-5 vía D-5/D-6 (§2); PA-1/PA-2/PA-3 vía spikes (§0):

- **PA-1 / PA-2 — RESUELTAS (spike 2026-06-22):** el hook dispara en web; el init corre una vez al crear el entorno (cacheado).
- **PA-3 — RESUELTA (spike 2026-06-22):** `git config url.insteadOf` + `AWM_GIT_TOKEN` no persiste el secreto.

**Única decisión de producto que queda (no técnica, no bloqueante):** receta de setup script vs. `AWM_GIT_TOKEN` nativo en el CLI (ver WS-B/§4.2).

---

## 8. Próximo paso

Decisiones de producto cerradas (D-1..D-6) y **factibilidad de WS-A/WS-B validada empíricamente** (spikes 2026-06-22, §0). El arranque en nube con registry privado **ya funciona** con setup script + `AWM_GIT_TOKEN`, sin cambios de código.

**Decisión WS-B cerrada (D-7):** se queda la receta `url.insteadOf` como mecanismo; no se hornea `AWM_GIT_TOKEN` en el CLI. WS-A y WS-B quedan completos.

Lo que queda, en orden:

1. **WS-C — sensibilidad al SO (Linux duro + WSL documentado):** ✅ **CERRADO 2026-06-22.** Todos los hallazgos G-4 resueltos, branch mergeado.
2. **WS-D — Windows nativo:** diferido (D-1, fase 2). Próximo paso si hay demanda.
