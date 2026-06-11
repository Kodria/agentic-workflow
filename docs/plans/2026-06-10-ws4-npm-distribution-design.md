# WS-4 — Distribución npm + separación CLI/contenido — Design

**Fecha:** 2026-06-10
**Workstream:** WS-4 del roadmap de distribución ([2026-06-09-distribution-roadmap.md](2026-06-09-distribution-roadmap.md)), hallazgo F-3.
**Rama:** `feature/ws4-npm-distribution`
**Estado:** aprobado en brainstorming interactivo (sesión 2026-06-10).

## Problema

La distribución actual es source-based y frágil: cada máquina necesita git + node + npm + clone del monorepo + build local (`install.sh`, 105 líneas). Peor: `~/.awm/cli-source` conflanta dos productos con ciclos de vida distintos —el CLI (herramienta compilada, semver) y el registry base (contenido, tags vX.Y.Z)— con un bug latente demostrable: `buildCli()` compila desde `cli-source/cli` (`registry.ts:78`) y `syncRegistry` hace checkout del **tag de contenido** en ese mismo directorio, así que pinear `base@1.0.0` (un pin de contenido, WS-3) rebuilda el CLI a su versión vieja. Pinear contenido degrada la herramienta.

WS-2 ya construyó la arquitectura correcta para los registries adicionales (repos de contenido puro, clonados a `~/.awm/registries/<name>`, intercambiables). El registry base es el único que no la sigue.

## Decisión: separación total (enfoque A)

Se evaluaron tres enfoques: (A) separación total en repos dedicados, (B) monorepo publicando a npm desde `cli/` con el contenido aún acoplado, (C) monorepo de desarrollo + mirror de contenido generado por CI. Se eligió **A**: B mantiene todos los problemas de acoplamiento (es un parche), C agrega maquinaria de CI antes de necesitarla (queda disponible como evolución futura, es aditivo sobre A). El patrón de referencia es Homebrew: CLI en su repo, contenido en taps; el cliente instala la herramienta una vez y el contenido fluye por otro canal.

### Topología de repos

| Repo | Contenido | Distribución | Versionado |
|---|---|---|---|
| `Kodria/agentic-workflow` (este) | `cli/` + docs de desarrollo + CONSTITUTION + harness propio | npm: `agentic-workflow-manager` | semver npm, arranca **2.0.0** (cambio de modelo de distribución) |
| `Kodria/awm-baseline-registry` (nuevo, público, sin historial) | bundles `dev` + `frontend` + `authoring` con sus skills, `hooks/`, `sensor-packs/`, `references/`, workflow+agent `development-process`, `catalog.json`, `awm-registry.json` | git clone/pull vía AWM, sembrado por defecto en `awm init` | tags `vX.Y.Z`, arranca v1.0.0 — pins/channels de WS-3 aplican tal cual |
| `Kodria/awm-documentation-registry` (nuevo, público, sin historial) | bundle `docs` (11 skills), workflow+agent `docs-system-orchestrator`, `catalog.json`, `awm-registry.json` | git, **opt-in** vía `awm registry add` | tags `vX.Y.Z`, arranca v1.0.0 |

Estado al momento del design: ambos repos ya existen vacíos en GitHub con working copies locales en `/Users/cencosud/Developments/personal/awm-registry/awm-{baseline,documentation}-registry`. ⚠ `awm-documentation-registry` quedó PRIVATE — debe pasarse a PUBLIC antes del cierre (decisión: ambos públicos; el contenido es genérico por doctrina y la fricción de credenciales en onboarding contradice el objetivo de F-3).

Los repos de contenido llevan `skills/`, `bundles/`, `workflows/`, `agents/` **en la raíz** — el layout que WS-2 ya exige (`validateRegistryLayout`). El corte por bundles es seguro: se verificó que ninguna skill no-docs referencia skills de docs (dependencia unidireccional docs → dev, cubierta por `dependsOn: ["dev"]`, que resuelve cross-registry porque `discoverAllBundles`/`resolveBundleClosure` operan sobre el merge de todos los roots). Única referencia inversa: una mención blanda de una línea en `using-awm` a `docs-system-orchestrator` — un puntero, no una dependencia de flujo; se mantiene.

`registry/` desaparece del monorepo. El monorepo retiene su nombre, historia, docs y el desarrollo del CLI. La historia del contenido queda preservada en el monorepo; los repos nuevos nacen frescos con un commit inicial.

### Layout en disco

```
~/.awm/
├── registries/
│   ├── baseline/          ← entry "baseline" en registries.json, sembrado por awm init
│   ├── documentation/     ← opt-in (awm registry add)
│   └── personal/          ← registries del usuario (WS-1), igual que hoy
├── registries.json        ← baseline es una entrada MÁS (la primera)
├── preferences.json       ← pins/channel de WS-3; la clave de pin es "baseline" (deja de existir la clave reservada "base")
├── update-check.json      ← cache del chequeo de versión del CLI (capa 1)
└── hooks/                 ← copias instaladas, igual que hoy
```

`~/.awm/cli-source` **deja de existir**. El CLI vive donde npm lo ponga.

**Resolución por capacidad, no por nombre:** el CLI no sabe qué registry es "el base". `contentRoots()` = todos los registries configurados en orden de `registries.json` (baseline primero porque init lo siembra primero; semántica de overrides de WS-2 sin cambios). `hooks/` y `sensor-packs/` se buscan en el primer root configurado que tenga ese directorio. Un equipo puede reemplazar el baseline entero por el suyo sin que el CLI tenga nada horneado — `AWM_BASE_REMOTE` sigue funcionando como override del remote que `awm init` siembra (cadena WS-2: env > preferences > default).

## Flujos

### Instalación desde cero (criterio de cierre del roadmap)

```
npm i -g agentic-workflow-manager
awm init
```

`npm i -g` deja solo el binario (npm no crea `~/.awm` ni clona contenido). `awm init` conserva su flujo actual de proyecto (sync, hooks, bundles, profile, sensores) y gana un paso previo de bootstrap de máquina: si `~/.awm` no existe, lo crea y siembra `registries.json` con la entrada `baseline` (remote default horneado del repo público, overridable), clonando al último tag. Idempotente: en máquinas ya bootstrapeadas solo corre la parte de proyecto.

**`install.sh` se elimina** (no se reduce: se borra). El README documenta los dos comandos. Es el estándar de las CLIs npm.

### `awm update` — 100% contenido + chequeo de CLI

1. Sincroniza **todos** los registries con un único loop uniforme (`syncAdditionalRegistries` pasa a ser el sync general, baseline incluido; muere el sync especial del base). Por registry: pin > último tag > HEAD, error individual no-fatal (invariante WS-2), reporte de versión (WS-3).
2. Regenera contexto, reconcilia symlinks, resync de hooks — igual que hoy, leyendo del root con capacidad `hooks/`.
3. Capa 2 de actualización del CLI (abajo). Muere `buildCli()`.

### Modelo de actualización del CLI en tres capas

Con npm no existe self-update silencioso legítimo (npm es dueño de los archivos del paquete; sobreescribirlos por fuera rompe su contabilidad). El modelo:

- **Capa 1 — aviso pasivo:** al terminar cualquier comando, leer `~/.awm/update-check.json` (`{lastCheck, latest}`); si hay versión más nueva cacheada, imprimir una línea: `⬆ awm vX.Y.Z disponible → npm i -g agentic-workflow-manager`. Si el cache tiene >24h, disparar un child detached que lo refresca en background (fetch a `https://registry.npmjs.org/agentic-workflow-manager/latest`, timeout 2s, falla en silencio). Ningún comando se bloquea por el check. Implementación in-house (~50 líneas), sin dependencia nueva.
- **Capa 2 — update asistido con confirmación:** en `awm update`, consultar npm inline (no-fatal sin red); si hay versión nueva, preguntar con `@clack/prompts` (`¿Actualizar awm v2.0.0 → v2.1.0 ahora?`); con confirmación, ejecutar `npm i -g agentic-workflow-manager@latest`; si npm falla (permisos, nvm), degradar al aviso con el comando exacto. Reemplazar los archivos de un proceso node ya cargado es seguro.
- **Capa 3 — gate `minCliVersion`:** el `awm-registry.json` de cada registry gana el campo opcional `minCliVersion: "X.Y.Z"` (validado semver en `readRegistryManifest`). Tras el checkout de cada registry, el CLI compara su versión (de `package.json`) con el comparador semver de WS-3:
  - En `awm update`: CLI < mínimo → error por-registry con remedio (`El registry baseline requiere CLI ≥ X.Y.Z — corré: npm i -g agentic-workflow-manager`), los demás registries siguen.
  - En `awm sync`: mismo chequeo como **gate de contrato, antes de cualquier early-exit** (regla CONSTITUTION § Implementación, nacida de WS-3/B1) → exit 1 con remedio.
  - Sin campo → no se verifica (opt-in, como los pins).

Los repos de contenido nuevos nacen con `minCliVersion: "2.0.0"` — un CLI 1.x apuntado a ellos falla con remedio en vez de comportarse raro.

### Migración de instalaciones existentes

**Cero código de migración.** Población instalada: una persona. Teardown manual documentado como runbook de una vez:

1. `npm rm -g agentic-workflow-manager` (elimina el npm link viejo)
2. `rm -rf ~/.awm`
3. Symlinks rotos en `~/.claude/skills/` → los poda `reconcileAllSkillLinks` en el primer update/init
4. `npm i -g agentic-workflow-manager` + `awm init`; en cada proyecto, `awm sync` re-instala desde `.awm/profile.json` (los profiles viven en los repos de los proyectos y sobreviven al teardown — son el mecanismo de recuperación)
5. Proyectos con pins `registries: {"base": ...}` en su profile renombran la clave a `baseline`

## Cambios en el código

### Muere

- `install.sh`
- `REGISTRY_DIR` (`cli-source`), `BASE_CONTENT_DIR` (registries.ts), `REGISTRY_CONTENT_DIR` (bundles.ts), `buildCli()` — `registry.ts` queda reducido a `resolveBaseRemote()`/`resolveBaseRemoteInfo()` (init los usa para sembrar)
- El sync especial del base en `awm update` (handler queda con un solo loop)
- El caso reservado `'base'` en `profile-pins.ts` (los pins referencian registries por su nombre configurado)
- El path horneado `cli-source/registry` en `sensors/run.ts` (pasa a resolución por capacidad)
- La reserva del nombre `cli-source` en `registry add`

### Nace

- `cli/src/core/update-check.ts`: capas 1 y 2 (cache, refresh detached, prompt de confirmación, ejecución de `npm i -g`, degradación)
- `minCliVersion` en el manifest `awm-registry.json` + gates en `sync` (exit 1, antes de early-exits) y `update` (no-fatal por registry)
- Helper de resolución por capacidad para `hooks/` y `sensor-packs/` (primer root que tenga el directorio)
- Siembra de la entrada `baseline` en `registries.json` durante el bootstrap de `awm init`
- `cli/package.json`: `version: "2.0.0"`, `files: ["dist"]`, `repository`, listo para `npm publish` manual desde `cli/` (`prepublishOnly` ya buildea)

### Repos de contenido (parte del WS)

- Poblar `awm-baseline-registry` y `awm-documentation-registry` desde `registry/` con dirs en raíz, `catalog.json` propio por repo, `awm-registry.json` con `minCliVersion: "2.0.0"`; commit inicial + tag `v1.0.0` + push
- Pasar `awm-documentation-registry` a PUBLIC
- Borrar `registry/` del monorepo; actualizar README (sección de instalación), CLAUDE.md y AGENTS.md — **el ciclo de edición de skills cambia de repo:** editar contenido pasa a hacerse en los repos de registry (editar → commit → tag → `awm update`), no en este monorepo

## Testing

- Patrones existentes: dual-tmpdir (`tmpHome`+`tmpWork`, HOME/AWM_HOME sobreescritos, `jest.resetModules()` + require tardío), fixtures git locales con tags (`-c tag.gpgSign=false`), sin red.
- Nuevos casos: siembra de `baseline` en init (primera vez crea, segunda no duplica), loop uniforme de update (baseline + adicionales, error no-fatal), gate `minCliVersion` (sync exit 1 con remedio / update no-fatal / sin campo no verifica / campo malformado error explícito), `update-check` con fetch inyectado (cache fresco no consulta, cache viejo refresca, sin red falla en silencio, versión nueva imprime aviso), resolución por capacidad (hooks en primer root, ausente en todos → comportamiento actual de "registry hooks missing").
- Tests existentes del sync base (`registry-versioned-sync.test.ts`, `profile-pins`) se adaptan al modelo uniforme.
- **E2E sin publicar:** `npm pack` del CLI → instalar el tarball en un prefix npm temporal → `AWM_BASE_REMOTE` a un git fixture local → `awm init` → assert de skills instaladas. Cumple el criterio "máquina limpia sin clone del monorepo" sin tocar npm real.
- Runbook manual: `npm publish` real, teardown + reinstalación de la máquina del autor, `awm registry add` del documentation registry.

## Fuera de alcance

- CI/CD de publishing (npm publish manual por ahora; el mirror-por-CI del enfoque C queda como evolución futura)
- Windows (F-11, WS-7), política de idioma (F-10, WS-7)
- Flujo de equipo documentado (F-12, WS-5)
- Agnosticismo fase 2 / Antigravity (F-5, WS-6)
- Scope/org npm, provenance, firma de paquetes
