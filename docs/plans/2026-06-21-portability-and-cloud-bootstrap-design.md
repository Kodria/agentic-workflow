# Brief de Producto — Era de Portabilidad y Arranque en la Nube

**Fecha:** 2026-06-21
**Estado:** BRIEF — en discusión. No es un plan de implementación; define problema, alcance, decisiones tomadas y preguntas abiertas antes de abrir workstreams.
**Autor de la sesión:** Nicolás (`nicolasf1402@gmail.com`)
**Contexto:** Cerrada la "Era de Distribución" (2026-06-12, AWM distribuible a equipos vía npm + multi-registry + versionado), surgen dos necesidades nuevas que esa era dejó explícitamente diferidas o sin contemplar:

1. **Portabilidad de SO.** El equipo trabaja en Windows y Linux; AWM hoy asume layout Unix (macOS/Linux). Esto activa el trigger de demanda de **F-11**, que la Era de Distribución dejó como diferido documentado.
2. **Arranque en entornos efímeros de nube.** Nicolás usa Claude Code en la web (VMs efímeras como la de esta sesión), donde AWM no está instalado y no hay credenciales git. Los registries privados no se pueden clonar. Este escenario **no estaba en ningún plan previo** — es necesidad nueva.

Este brief nace de la misma disciplina del roadmap de distribución (`2026-06-09-distribution-roadmap.md`): registro de hallazgos F-n, workstreams con ciclo completo, nada se marca hecho sin verificación.

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
- **PA-1:** ¿El hook SessionStart de AWM (`~/.claude/settings.json`) llega a dispararse dentro de una sesión web, o el entorno web gestiona su propio contexto y lo ignora? Si no dispara, el valor de AWM en la nube se reduce a "skills instaladas" sin el bootstrap imperativo. **Hay que verificarlo empíricamente en una sesión web real.**
- **PA-2:** ¿El `awm init` corre en el *setup script* del entorno (una vez, al crear) o en cada arranque de sesión? Esto define idempotencia y latencia.

### 4.2 Token git por variable de entorno (D-3)

**Lo que ya funciona:** `AWM_BASE_REMOTE=https://x-access-token:<TOKEN>@github.com/Kodria/awm-baseline-registry.git` hace que el baseline se clone autenticado, sin cambios de código.

**El hueco real — registries adicionales.** Los registries que no son baseline persisten su `remote` en `registries.json` (`cli/src/core/registries.ts:63-66`) y se clonan con ese valor literal en `syncRegistries()` (línea 119). No hay override por env para ellos. Propuesta a evaluar:

- Un mecanismo de **inyección de credencial agnóstico al registry**: el CLI, al clonar/pull, reescribe `https://github.com/...` → `https://x-access-token:<TOKEN>@github.com/...` tomando el token de una env var única (p.ej. `AWM_GIT_TOKEN`) cuando el remote es HTTPS de un host conocido. Así un solo secreto cubre baseline + N registries privados del mismo host.

**Consideraciones de seguridad a resolver en el design:**
- **PA-3:** Si el token viaja embebido en la URL de `AWM_BASE_REMOTE`, se persiste a `registries.json` en disco. En VM efímera el riesgo es acotado, pero conviene preferir el modelo "token en env var separada, nunca persistido" (`AWM_GIT_TOKEN`) por encima de embeber el token en la URL guardada.
- **PA-4:** Alcance del token: ¿un PAT clásico, o fine-grained tokens read-only por repo? Recomendación: fine-grained, solo lectura de Contents, sobre los repos de registry. **Decisión de Nicolás.**
- **PA-5:** ¿Las sesiones de nube necesitan **solo el baseline**, o también registries privados de equipo/personales? Esto define si un solo secreto basta o hace falta el modelo multi-credential. **Decisión de Nicolás.**

### 4.3 Sensibilidad al SO (D-1)

**Ahora (esta era):**
- Capa de **detección de plataforma** y normalización de home: usar `os.homedir()` con fallback robusto en vez de `process.env.HOME` directo donde aún se asuma.
- **Endurecer Linux** (es lo que corre en la nube): verificar que symlinks, hook y paths funcionan en una distro limpia sin las particularidades de macOS.
- **Documentar WSL** como vía única para Windows hoy, con detección que oriente al usuario si corre en Windows nativo.

**Fase 2 (diferida, D-1):** estrategia nativa Windows — fallback symlink→copia (ya existe `installMethod: 'copy'`, `cli/src/commands/hooks/install.ts:18-28`, reutilizable), `run-hook.cmd` validado en cmd.exe/PowerShell, paths con `USERPROFILE`/`APPDATA`.

---

## 5. Registro de hallazgos

| ID | Hallazgo | Fuente | Workstream |
|----|----------|--------|------------|
| G-1 | **Arranque en nube no contemplado.** AWM no se autoinstala en VMs efímeras; depende de instalación manual previa. | Sesión 2026-06-21 | WS-A |
| G-2 | **Auth de registry privado imposible sin credenciales host.** `simpleGit().clone` usa auth del host; en VM efímera no hay. Solo el baseline tiene override por env; los registries adicionales no. | `registries.ts:119`, `registry.ts:13` | WS-B |
| G-3 | **Token potencialmente persistido en disco.** Embeber el token en `AWM_BASE_REMOTE` lo escribe a `registries.json`. Falta modelo "token en env, no persistido". | `registries.ts:63-66` | WS-B |
| G-4 | **SO Unix asumido (3 puntos).** Symlinks, `run-hook.cmd` stub, paths `HOME`. Trigger de F-11 activado por demanda real del equipo. | `install.ts:73`, README "Platform support" | WS-C |
| G-5 | **Hook SessionStart sin verificar en entorno web.** Desconocido si dispara dentro de Claude Code web. | PA-1, sesión 2026-06-21 | WS-A |

---

## 6. Workstreams propuestos (orden de prioridad sugerido)

> Propuesta. El orden y el corte se confirman con Nicolás antes de abrir el primero.

### WS-A — Arranque automático en Claude Code web `[G-1, G-5]`
Setup script de entorno + `awm init --yes` + verificación empírica de si el hook dispara en web (PA-1/PA-2). **Entregable de valor:** una sesión web nueva arranca con AWM funcionando.

### WS-B — Credenciales de registry privado por token `[G-2, G-3]`
Modelo de inyección de token agnóstico al registry (`AWM_GIT_TOKEN`), sin persistir el secreto. Resuelve PA-3/PA-4/PA-5. **Entregable de valor:** clonar registries privados desde una VM sin exponerlos ni hacerlos públicos.

> WS-A y WS-B son interdependientes: el arranque en nube **necesita** la auth privada para que el `awm init` no falle al clonar. Probablemente se diseñan juntos y se ejecutan B→A.

### WS-C — Sensibilidad al SO, fase 1 (Linux duro + WSL documentado) `[G-4]`
Detección de plataforma, endurecimiento Linux, documentación WSL para Windows. **Sin** Windows nativo (D-1). **Entregable de valor:** el equipo Linux y el equipo Windows-vía-WSL tienen un camino soportado y documentado.

### WS-D — Windows nativo `[G-4]` — **DIFERIDO (D-1, fase 2)**
Symlink→copia, `run-hook.cmd` validado, paths Windows. Se reactiva tras WS-C según demanda.

---

## 7. Preguntas abiertas pendientes de decisión (para Nicolás)

Ninguna bloquea redactar este brief, pero todas afectan los designs de WS-A/WS-B:

- **PA-1 / PA-2** (técnicas, se resuelven verificando en una sesión web real): ¿dispara el hook en web? ¿el init corre al crear el entorno o en cada sesión?
- **PA-4:** tipo y alcance del token (recomendación: fine-grained read-only por repo).
- **PA-5:** ¿en la nube hace falta solo el baseline, o también registries privados de equipo/personales? Define single-secret vs multi-credential.

---

## 8. Próximo paso

Validar este brief con Nicolás → confirmar orden de workstreams y responder PA-4/PA-5 → abrir el primer workstream (probablemente WS-B + WS-A juntos) con su ciclo `development-process`.
