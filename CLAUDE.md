<!-- AWM:CONTEXT-KERNEL:START v1 -->
<!-- awm-context:CTX-CLAUDE-001 -->
# AWM Repository Principles

<!-- awm-context:CTX-CLAUDE-002 -->
This document codifies architectural and design principles for the Agentic Workflow Manager (AWM) repository to ensure consistency and prevent future design drift.

<!-- awm-context:CTX-CLAUDE-003 -->
## `~/.awm` es territorio del instalador — NUNCA tocarlo

<!-- awm-context:CTX-CLAUDE-004 -->
`~/.awm` (incluyendo `~/.awm/registries/`, hooks, config) se gestiona **exclusivamente** vía `awm init` y `awm update`. Desde una sesión de desarrollo en este repo está **prohibido** escribir, editar, borrar o "arreglar" cualquier cosa bajo `~/.awm`.

<!-- awm-context:CTX-CLAUDE-005 -->
**Este repo solo desarrolla el CLI.** El contenido (skills, bundles, sensor-packs, hooks) ya **no** vive aquí — se edita en los repos de contenido externos:

<!-- awm-context:CTX-CLAUDE-006 -->
- [`awm-baseline-registry`](https://github.com/Kodria/awm-baseline-registry) — registry base sembrado por defecto en `awm init`
- [`awm-documentation-registry`](https://github.com/Kodria/awm-documentation-registry) — registry de documentación, opt-in

<!-- awm-context:CTX-CLAUDE-007 -->
**El flujo correcto para contenido:** editar en el repo de registry correspondiente → commit → tag `vX.Y.Z` → `awm update` en las máquinas que usen ese registry. Los skills instalados en `~/.claude/skills/` son symlinks hacia `~/.awm/registries/<name>/skills/`, así que reflejan el registry instalado, no el working copy — la latencia entre editar el registry y verlo instalado es esperada y correcta; no se "atajea" editando la instalación.

<!-- awm-context:CTX-CLAUDE-008 -->
**El flujo correcto para el CLI:** todo cambio de CLI se hace en `cli/` → se commitea → se mergea a `main`. El publish a npm es **automático**: `.github/workflows/release.yml` corre en cada push a `main`, buildea `cli/` y ejecuta `cli/src/release/index.js` (bump de versión por conventional commits + `npm publish` vía OIDC Trusted Publisher, con `[skip ci]` en el commit de bump para no re-dispararse). **No se corre `npm publish` a mano, ni se crea un workflow paralelo de publish.** El gate son los tests en **las tres plataformas** (`ubuntu-latest`, `windows-latest`, `macos-latest`): el job `release` declara `needs: test`, así que rojo en cualquiera de ellas no publica — ver [`docs/decisions.md`](docs/decisions.md) D-005. El nivel de release sale del prefijo de conventional commit del merge (`feat`→minor, `fix`→patch, `!`/`BREAKING`→major). Los usuarios reciben la nueva versión con `npm i -g agentic-workflow-manager`.

<!-- awm-context:CTX-CLAUDE-009 -->
**Tests:** ningún test puede tocar el `~/.awm` real. Todos usan tmpdirs aislados con `process.env.HOME` y `process.env.AWM_HOME` sobreescritos (patrón de `cli/tests/commands/hooks/install.test.ts`).

<!-- AWM:CONTEXT-KERNEL:END v1 -->
