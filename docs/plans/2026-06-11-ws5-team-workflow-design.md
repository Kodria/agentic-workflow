# WS-5 — Runbook maestro + flujo de equipo verificado — Design

> Workstream WS-5 `[F-12]` del [roadmap de distribución](2026-06-09-distribution-roadmap.md).
> Rama: `feature/ws5-team-workflow`. Doc interno en español (F-10); el entregable de usuario va en inglés.

## Problema

El ciclo de equipo de AWM (senior autorea skill → PR al registry del equipo → release taggeado → teammates reciben con `awm update`; nuevo dev → `git clone` + `awm sync`) ya existe como maquinaria (WS-2/3/4) pero **no está documentado como flujo ni verificado contra GitHub real**. Además, la documentación de usuario está fragmentada: instalación/config en `getting-started.md`, lado contributor en `registry-guide.md`, y faltan por completo el **uso día a día en un proyecto** y la **personalización/setup de equipo** (registry propio, privado, pinning, profile compartido) como narrativa.

## Decisiones de diseño (aprobadas en brainstorming)

1. **Runbook maestro único** — un solo manual integral `docs/runbook.md` que absorbe `getting-started.md` y `registry-guide.md`, en vez de un doc complementario. Los docs absorbidos se eliminan y sus referencias se actualizan.
2. **La normalización a inglés del baseline registry queda dentro de WS-5** como caso real del release cycle (cierra además el trabajo derivado de F-10 pendiente).
3. **Registry privado de verificación:** `git@github.com:Kodria/awm-personal-registry.git` (privado, existente desde WS-1). No se crea repo efímero. El happy path se prueba con la SSH key del usuario (= teammate con acceso); el caso sin-acceso se simula con `GIT_SSH_COMMAND` (identidad nula) y `GIT_TERMINAL_PROMPT=0` — no se necesita otra cuenta.
4. **Enfoque runbook-as-script:** el runbook se escribe primero como hipótesis y luego se ejecuta al pie de la letra; el doc es el test. Divergencias → se corrige el runbook; defectos del CLI → hardening con TDD.

## Entregable 1 — `docs/runbook.md` (inglés)

Manual organizado por la vida del usuario con AWM:

| Cap. | Contenido | Origen |
|---|---|---|
| 1. Install & machine setup | `npm i -g agentic-workflow-manager`, `awm init`, `awm doctor`, diferencias Claude Code / OpenCode | absorbe `getting-started.md` |
| 2. Project setup | init por repo, sensores, `CONSTITUTION.md`, learning loop | absorbe `getting-started.md` |
| 3. Day-to-day in a project | loop diario: ciclo development-process, gate de sensores, ledger/retro, cadencia de `awm sync` / `awm update` | **nuevo** |
| 4. Team setup & customization | registry de equipo (público o **privado por SSH**), `awm registry add`, `profile.json` compartido, pinning (`awm pin`/`unpin`), overrides; onboarding de nuevo dev = `git clone` + `awm sync` | **nuevo** |
| 5. Extensibility | autorear skills / bundles / sensor-packs; ciclo de release: PR → tag `vX.Y.Z` → `awm update` | absorbe `registry-guide.md` |

**Reorganización de docs:**

- `docs/getting-started.md` y `docs/registry-guide.md` se **eliminan** (contenido absorbido, curado — no copy-paste ciego: se actualiza lo que WS-2/3/4 hayan dejado obsoleto).
- Referencias a actualizar: `README.md` (3), `docs/cli-reference.md` (3), link interno de getting-started.
- `docs/cli-reference.md` y `docs/architecture.md` quedan como están (referencia exhaustiva ≠ runbook).

## Entregable 2 — Verificación manual (el runbook es el test)

Cada flujo documentado se ejecuta siguiendo el runbook literalmente. **Restricción dura:** toda verificación usa `HOME`/`AWM_HOME` apuntando a tmpdirs desde la shell — el `~/.awm` real jamás se toca.

| Escenario | Qué se ejecuta | Qué valida |
|---|---|---|
| Release cycle real | Normalización del baseline en clone de trabajo → PR → merge → tag → `awm update` (AWM_HOME tmpdir) | Cap. 5: que un release real llegue a un teammate |
| Registry privado (happy) | `awm registry add git@github.com:Kodria/awm-personal-registry.git` + `awm sync`/`update` por SSH | Cap. 4: clone/fetch autenticado vía simple-git |
| Registry privado (sin acceso) | Mismo flujo con `GIT_SSH_COMMAND="ssh -i /dev/null -o IdentitiesOnly=yes"` y HTTPS con `GIT_TERMINAL_PROMPT=0` | Que AWM falle con error claro y accionable: sin colgarse esperando credenciales, sin stack trace críptico |
| Onboarding nuevo dev | HOME limpio (tmpdir) → install → `git clone` de un proyecto con `.awm/profile.json` → `awm sync` | Cap. 4: onboarding de cero |

**Hardening:** solo de lo que se rompa en la verificación, con TDD en `cli/`. **Sin E2E nuevo de simulación** (re-alcance 2026-06-11 — duplicaría `registries-sync`, `sync-gates`, `profile-pins`, `versioning`, `update-check`, `pack-e2e`). Ningún test toca el `~/.awm` real (patrón dual-tmpdir de AGENTS.md).

## Entregable 3 — Normalización a inglés del baseline registry

Se hace en un **clone de trabajo** de `Kodria/awm-baseline-registry` (fuera de `~/.awm`, p.ej. junto a este repo). Inventario (grep `á|é|í|ó|ú|ñ|¿|¡` sobre el registry instalado, 2026-06-11):

- **4 skills completos en español:** `architecture-advisor`, `cicd-proposal-builder`, `technology-evaluator`, `nfr-checklist-generator` (~50-60 líneas con acentos c/u)
- **3 parciales:** `post-implementation-qa` (36), `using-awm` (11), `harness-retro` (10)
- **3 `bundle.json`** con descripciones en español: `frontend`, `authoring`, `dev`
- **Acentos sueltos en ~7 archivos** (`verification-before-completion`, `subagent-driven-development`, `impeccable` + references, `frontend-craft` references) — revisión caso a caso: puede haber contenido legítimo (citas, nombres) que no se traduce
- **Ojo con español sin acentos** (lección WS-7): el grep de acentos es cota inferior; barrido manual por archivo tocado

Flujo: traducir → PR al registry → merge → tag semver nuevo → ese release es el vehículo del escenario "release cycle real".

## Fuera de alcance

- E2E automatizado de simulación del ciclo (re-alcance explícito).
- Cambios al CLI no derivados de fallas observadas en la verificación.
- Normalizar `awm-documentation-registry` (solo baseline).
- Windows (F-11: WSL es la vía; ya documentado en WS-7).

## Criterio de cierre

1. `docs/runbook.md` publicado; `getting-started.md` y `registry-guide.md` eliminados; referencias actualizadas; todo flujo del runbook ejecutado al menos una vez tal como está escrito.
2. Los 4 escenarios de verificación ejecutados con evidencia (output en el plan/QA); hardening aplicado a lo que se haya roto.
3. Release del baseline normalizado publicado y recibido vía `awm update` (en tmpdir).
4. QA → `awm-qa-complete`; checkbox WS-5 del roadmap marcado en el mismo PR (regla #3).
