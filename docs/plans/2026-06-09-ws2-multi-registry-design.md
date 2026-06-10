# WS-2 — Multi-registry de equipo: capas + overrides por manifest (Design)

**Fecha:** 2026-06-09
**Workstream:** WS-2 `[F-2]` del [roadmap de distribución](2026-06-09-distribution-roadmap.md)
**Rama:** `feature/ws2-multi-registry`
**Enfoque elegido:** A — delta mínimo sobre el seam de WS-1 (de 3 enfoques evaluados; B = seam enriquecido `registrySources()` descartado por romper la estabilidad del seam sin necesidad presente, C = capa de resolución centralizada descartada por refactor grande de la ruta crítica con el mismo resultado funcional)

## Goal

Convertir AWM de "tus skills" en plataforma de equipo: el upstream Kodria sigue fluyendo intacto y el equipo agrega SU registry de contenido encima, con overrides **explícitos y declarados** de artifacts del base. Incluye el cierre mínimo del remote base hardcodeado y la instalación de bundles al agregar un registry.

**Criterio de verificación (roadmap):** un repo de contenido distinto al de Kodria funciona end-to-end como registry — **incluyendo override**: un registry con `awm-registry.json` que sobreescribe una skill del base, y la skill instalada apunta al clone del registry del equipo.

## Decisiones de diseño (del brainstorming)

1. **Escenario:** capas (upstream + registry del equipo), NO reemplazo del upstream. La gobernanza del equipo vive en su propio repo de contenido.
2. **Colisiones:** override **explícito declarado** — colisión sigue siendo error salvo declaración. Sin precedencia silenciosa (filosofía AWM).
3. **Gobernanza:** la declaración vive en un **manifest versionado en el repo del registry** (`awm-registry.json`), revisable por PR, recibido por todas las máquinas vía `awm update`.
4. **F-2 mínimo:** remote base configurable vía env/preferences + `install.sh` por env. El resto de F-2 (separación CLI/contenido) es WS-4.
5. **Gap UX de WS-1:** `awm registry add` ofrece instalar los bundles del registry nuevo.

## Contexto (estado tras WS-1)

- `cli/src/core/registries.ts`: config `~/.awm/registries.json` (`[{name, remote}]`), clones en `~/.awm/registries/<name>`, seam `contentRoots(): string[]` (base primero, luego adicionales presentes en disco, en orden de config).
- `cli/src/core/discovery.ts` y `bundles.ts`: merge multi-root; colisión de nombres → `collisionError` nombrando ambas fuentes (`discovery.ts:53`, `bundles.ts:113`).
- `cli/src/core/registry.ts:10`: `DEFAULT_REMOTE` hardcodeado a Kodria; `syncRegistry(remoteUrl?)` ya acepta override pero ningún caller se lo pasa.
- `install.sh:66`: `REPO_URL` hardcodeado.
- `~/.awm/preferences.json` (`cli/src/utils/config.ts`): `defaultAgent`, `installMethod`, `defaultScope` — lugar natural para el remote base.
- Gap conocido: tras `awm registry add`, los bundles del registry nuevo no se instalan (la reconciliación solo repara symlinks existentes, no crea nuevos).

## Sección 1 — Manifest del registry: `awm-registry.json`

Archivo **opcional** en la raíz del repo del registry adicional:

```json
{
  "overrides": ["brainstorming", "writing-plans"]
}
```

- `overrides`: nombres de artifacts (skills/bundles/workflows/agents — espacio de nombres plano, igual que la detección de colisiones actual) que este registry puede sobreescribir de roots **anteriores** (base o registries previos en el orden de config).
- **Sin manifest = sin overrides** → comportamiento WS-1 intacto. Cero migración para registries existentes (el personal de Nicolás no necesita cambios).
- API en `registries.ts`: `readRegistryManifest(root): RegistryManifest` — devuelve `{ overrides: Set<string> }` (vacío si no hay archivo).
- **Validación:** JSON corrupto, `overrides` que no sea array de strings → error explícito con el path del archivo (mismo patrón que `registries.json` corrupto — nunca tratarlo como vacío en silencio). Cada nombre pasa el guard completo de path-component de CONSTITUTION.md: rechazar vacío, `.`, `..`, `/`, `\`.

## Sección 2 — Resolución de overrides en discovery/bundles

- Orden de roots: el de `contentRoots()` (sin cambios — base primero, luego orden de config).
- En cada punto de colisión existente (`discoverSkills/Workflows/Agents`, `discoverAllBundles`): si el **root posterior** declara el nombre en su manifest → **reemplaza** la entrada (gana el posterior: es quien lo declaró); si no → el `collisionError` actual, intacto.
- Los manifests se leen una vez por operación de discovery (no por artifact).
- **Override huérfano** (declarado pero sin colisión — p.ej. el upstream renombró la skill): no es error. `awm registry list` lo marca como `override sin efecto`.
- **Procedencia visible:** `awm list` marca los artifacts sobreescritos: `brainstorming ← team-acme (override)`.
- El seam `contentRoots(): string[]` **no cambia**. Los consumidores downstream siguen recibiendo paths absolutos; el reemplazo en el merge es transparente para ellos (mismo hecho clave verificado en WS-1).

## Sección 3 — Remote base configurable (cierre F-2 mínimo)

- Resolución del remote base, en orden: env `AWM_BASE_REMOTE` > campo nuevo `baseRemote` en `preferences.json` > `DEFAULT_REMOTE` (Kodria).
- Nueva función `resolveBaseRemote(): string` en `registry.ts`; el handler de `awm update` la pasa a `syncRegistry()` (la firma ya lo acepta — solo falta cablear el caller).
- `install.sh:66` → `REPO_URL="${AWM_REPO_URL:-https://github.com/Kodria/agentic-workflow.git}"`.
- `preferences.json` conserva compatibilidad: `baseRemote` es opcional; `getPreferences()` no lo exige.

## Sección 4 — UX de `awm registry add`: instalar bundles

Tras un add exitoso (clone + validación + colisiones + config escrita + contexto regenerado):

1. Descubrir los bundles del registry recién agregado.
2. Si hay bundles: prompt interactivo (@clack multi-select) para elegir cuáles instalar; agente default de `preferences.json` con opción de cambiarlo.
3. Instalar vía la ruta existente de `installBundle()` (que ya resuelve `contentRoot` por bundle desde WS-1).
4. Flags no interactivos: `--install-all` (instala todos con el agente default) y `--no-install` (comportamiento WS-1). Sin TTY y sin flag → comportamiento `--no-install` con la sugerencia del comando exacto impresa.

Esto cierra el gap sufrido en la verificación de WS-1 (symlink de `career-goal-brainstorm` que hubo que reinstalar a mano con `awm install ... --agent ...`).

## Sección 5 — Manejo de errores

| Caso | Comportamiento |
|------|---------------|
| Manifest corrupto / `overrides` malformado | Error explícito con path del archivo — nunca tratarlo como vacío |
| Nombre en `overrides` con path traversal (vacío, `.`, `..`, `/`, `\`) | Error explícito (guard completo de CONSTITUTION.md) |
| Colisión sin declaración de override | Error actual de WS-1 nombrando ambas fuentes |
| Dos registries adicionales declaran override del mismo nombre | Gana el último en orden de config (ambos lo declararon — intencional); `awm list` muestra la cadena de procedencia |
| Override huérfano (sin colisión) | No-error; marcado `override sin efecto` en `awm registry list` |
| `AWM_BASE_REMOTE` inválido | El clone/pull falla con el error de git; el mensaje incluye qué remote se usó y de dónde salió (env/prefs/default) |
| Prompt de install sin TTY | Equivale a `--no-install` + sugerencia del comando exacto |

## Sección 6 — Testing

- **Invariante de seguridad (CONSTITUTION):** ningún test toca el `~/.awm` real. Tmpdirs aislados con `process.env.HOME` + `process.env.AWM_HOME` sobreescritos + `jest.resetModules()` + require tardío (patrón dual-tmpdir de AGENTS.md).
- Unit `registries.ts`: `readRegistryManifest` (ausente → vacío, corrupto → error con path, overrides malformado → error, traversal → error).
- Resolución: fixtures de 2-3 roots — override declarado (gana posterior), colisión sin declarar (error actual), huérfano (no-error), cadena de 2 registries declarando el mismo nombre (gana el último), y para los 4 tipos de artifact.
- Remote base: precedencia env > prefs > default; caller de `awm update` pasa el resuelto.
- `add` con `--install-all` / `--no-install` contra repos git locales de fixture (`git init`, sin red); atomicidad del add intacta cuando la fase de install falla (el add ya está commiteado a config — el install es post-add, su falla no revierte el add, se reporta).
- `awm list` / `awm registry list`: marcadores de procedencia y de override sin efecto.

## Fuera de alcance

Namespacing en nombres de artifacts, firma/verificación de contenido de registries, pinning de versiones y lockfile (WS-3), publicación npm y separación CLI/contenido (WS-4), `awm registry` para gestionar el registry base, multi-remote en `install.sh` más allá del env override.

## Cierre del workstream

Regla #3 del roadmap: el PR que cierre WS-2 actualiza la tabla de estado del roadmap (checkboxes + links) en el mismo PR. QA → `awm-qa-complete` en el plan de implementación.
