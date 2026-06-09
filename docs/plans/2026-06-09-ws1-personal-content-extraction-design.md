# WS-1 — Extracción del contenido personal: registries adicionales (Design)

**Fecha:** 2026-06-09
**Workstream:** WS-1 `[F-4]` del [roadmap de distribución](2026-06-09-distribution-roadmap.md)
**Rama:** `feature/ws1-personal-content-extraction`
**Enfoque elegido:** B — comando `awm registry` + merge en discovery (de 3 enfoques evaluados; A = solo-config descartado por UX manual anti-distribuible, C = adelantar WS-2 descartado por YAGNI y disciplina de roadmap)

## Goal

Extraer el contenido personal (`personal-notion` + 3 skills NotionTracker) del repo distribuible hacia un registry privado aparte, introduciendo el mecanismo mínimo y genérico de "registry adicional" que WS-2 generalizará a multi-registry de equipo.

**Criterio de verificación (roadmap):** (a) un clone limpio del repo distribuible no contiene contenido personal; (b) las skills personales siguen funcionando en la máquina de Nicolás vía el nuevo mecanismo.

## Contexto

- El contenido personal vive hoy en `registry/bundles/personal-notion/` + `registry/skills/{career-goal-brainstorm,cristalizar-proceso,agregar-nodos-proceso}/`. `visibility: private` solo filtra `awm list` (`cli/src/index.ts:460`) — el contenido viaja en disco a cada clone.
- `discovery.ts` hardcodea una sola fuente: `SKILLS_DIR/WORKFLOWS_DIR/AGENTS_DIR` derivados de `REGISTRY_DIR` (`~/.awm/cli-source`). `bundles.ts` igual vía `REGISTRY_CONTENT_DIR`.
- Hecho clave verificado: cada artifact descubierto viaja con `path` absoluto y TODOS los consumidores downstream (symlinks de instalación, regeneración de contexto, `awm list`, hooks) consumen ese path → el merge multi-root es transparente para ellos.
- **Estado de la migración:** el repo privado `Kodria/awm-personal-registry` (verificado PRIVATE) ya existe en `/Users/cencosud/Developments/personal/awm-personal-registry`, con el contenido copiado y pusheado (commit `b1a2dab`). Falta: el mecanismo CLI + el borrado del contenido en el distribuible.

## Sección 1 — Arquitectura: módulo `registries` y seam único

Módulo core nuevo: `cli/src/core/registries.ts`.

```
~/.awm/
├── cli-source/            ← registry base (sin cambios)
├── registries.json        ← NUEVO: [{ "name": "...", "remote": "..." }]
└── registries/            ← NUEVO: clones de registries adicionales
    └── <name>/
        ├── skills/
        └── bundles/
```

- **`registries.json`:** array de `{ name, remote }`. El path se deriva: `~/.awm/registries/<name>`. Sin estado redundante. `remote` acepta cualquier cosa que `git clone` acepte (URL SSH/HTTPS o path local).
- **Layout del registry adicional:** la raíz del repo ES el content root (`skills/`, `bundles/`, `workflows/`, `agents/` en la raíz, sin nivel `registry/` — no llevan CLI).
- **Seam único:** `contentRoots(): string[]` → `[REGISTRY_CONTENT_DIR, ...rootsAdicionales]`. Es la única API que consume el resto del CLI. WS-2 enriquecerá esta función (precedencia, namespacing) sin tocar consumidores.
- API del módulo: `readRegistriesConfig()`, `writeRegistriesConfig()`, `listRegistries(): { name, remote, contentRoot }[]`, `contentRoots(): string[]`.

## Sección 2 — Merge en discovery y bundles

- `discoverSkills/Workflows/Agents` (`cli/src/core/discovery.ts`) y `discoverBundles/readCatalog` (`cli/src/core/bundles.ts`) iteran `contentRoots()` y concatenan resultados. Cada artifact conserva su `path` absoluto hacia su propio registry.
- **Colisión de nombres** (mismo artifact name en ≥2 roots): error explícito que nombra ambas fuentes y aborta la operación. Sin precedencia silenciosa (eso es WS-2).
- Consumidores que reciben `contentDir` por parámetro y deben volverse multi-root o recibir el root correcto: `reconcileAllSkillLinks` (`index.ts:356`), `repairGlobalSkills` (`core/init/steps.ts:147`), `bundle-install.ts` (`opts.contentDir`), `diagnostics/context.ts`. El plan detallará cada call-site.
- `sensors --registry-root` no cambia (los sensor-packs siguen siendo solo del base).

## Sección 3 — Comandos CLI

Grupo `awm registry` en `cli/src/index.ts`, implementación en `cli/src/commands/registry/`.

- **`awm registry add <git-url> [--name <n>]`** — nombre default: basename del remote sin `.git`. Secuencia: clone a `~/.awm/registries/<name>` → validar layout (≥1 de `skills/|bundles/|workflows/|agents/` en la raíz) → detectar colisiones contra contenido conocido → escribir config → regenerar contexto. Si cualquier paso falla antes de escribir config: limpiar el directorio clonado, no escribir config (atómico).
- **`awm registry list`** — tabla `name | remote | conteos de artifacts`.
- **`awm registry remove <name>`** — confirmación interactiva → borra entrada de config + clone → reconciliación de symlinks (limpia links muertos).
- **`awm update`** — paso nuevo tras el pull del base: por cada registry adicional, `reset --hard` + `pull` (mismo patrón que el base). Errores por-registry NO fatales (warning y continúa). Si el clone no existe en disco (máquina nueva / restaurado), `awm update` lo re-clona desde `remote`.

## Sección 4 — Migración del contenido personal

1. ✅ **Hecho:** repo privado `Kodria/awm-personal-registry` con `skills/{career-goal-brainstorm,cristalizar-proceso,agregar-nodos-proceso}/` + `bundles/personal-notion/` (conserva `visibility: private`), pusheado.
2. **En este repo:** `git rm -r` de las 3 skills + el bundle `personal-notion`.
3. **En la máquina de Nicolás, solo vía comandos (NUNCA tocando `~/.awm` a mano):** tras mergear y correr `awm update` (trae el CLI nuevo y el borrado del contenido base) → `awm registry add git@github.com:Kodria/awm-personal-registry.git` → la reconciliación re-apunta el symlink de `career-goal-brainstorm` (roto tras el borrado) al clone del registry personal.

## Sección 5 — Manejo de errores

| Caso | Comportamiento |
|------|---------------|
| Clone falla / layout inválido en `add` | No se escribe config, se limpia el dir, error claro |
| `registries.json` corrupto | Error explícito con path del archivo — nunca tratarlo como vacío en silencio |
| Nombre duplicado en `add` | Error: el registry ya existe |
| Colisión de artifact entre registries | Error nombrando ambas fuentes |
| Registry configurado sin clone en disco | `awm update` re-clona; discovery lo salta con warning |

## Sección 6 — Testing

- **Invariante de seguridad:** ningún test toca el `~/.awm` real. Tmpdirs aislados con `process.env.HOME` + `process.env.AWM_HOME` sobreescritos en `beforeEach/afterEach` + `jest.resetModules()` (patrón de `cli/tests/commands/hooks/resync.test.ts`).
- Unit: `registries.ts` (config CRUD, derivación de paths, `contentRoots()`, config corrupto).
- Merge: discovery/bundles con 2 roots de fixture; caso colisión → error con ambas fuentes.
- Comandos: `add/list/remove` contra repos git locales de fixture (`git init` en tmpdir — sin red); atomicidad de `add` cuando la validación falla.
- Update: multi-pull con registry adicional; re-clone cuando falta el dir; error no fatal.

## Fuera de alcance (→ WS-2)

Precedencia/namespacing entre registries, override de artifacts del base, gobernanza de equipo, `awm registry` para el registry base, multi-remote en `install.sh`.

## Cierre del workstream

Regla #3 del roadmap: el PR que cierre WS-1 actualiza la tabla de estado del roadmap (checkbox + link al plan) en el mismo PR. QA → `awm-qa-complete` en el plan de implementación.
