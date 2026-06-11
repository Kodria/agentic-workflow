# AWM Repository Principles

This document codifies architectural and design principles for the Agentic Workflow Manager (AWM) repository to ensure consistency and prevent future design drift.

## `~/.awm` es territorio del instalador — NUNCA tocarlo

`~/.awm` (incluyendo `~/.awm/registries/`, hooks, config) se gestiona **exclusivamente** vía `awm init` y `awm update`. Desde una sesión de desarrollo en este repo está **prohibido** escribir, editar, borrar o "arreglar" cualquier cosa bajo `~/.awm`.

**Este repo solo desarrolla el CLI.** El contenido (skills, bundles, sensor-packs, hooks) ya **no** vive aquí — se edita en los repos de contenido externos:

- [`awm-baseline-registry`](https://github.com/Kodria/awm-baseline-registry) — registry base sembrado por defecto en `awm init`
- [`awm-documentation-registry`](https://github.com/Kodria/awm-documentation-registry) — registry de documentación, opt-in

**El flujo correcto para contenido:** editar en el repo de registry correspondiente → commit → tag `vX.Y.Z` → `awm update` en las máquinas que usen ese registry. Los skills instalados en `~/.claude/skills/` son symlinks hacia `~/.awm/registries/<name>/skills/`, así que reflejan el registry instalado, no el working copy — la latencia entre editar el registry y verlo instalado es esperada y correcta; no se "atajea" editando la instalación.

**El flujo correcto para el CLI:** todo cambio de CLI se hace en `cli/` → se commitea → se publica vía `npm publish` desde `cli/`. Los usuarios reciben la nueva versión con `npm i -g agentic-workflow-manager`.

**Tests:** ningún test puede tocar el `~/.awm` real. Todos usan tmpdirs aislados con `process.env.HOME` y `process.env.AWM_HOME` sobreescritos (patrón de `cli/tests/commands/hooks/install.test.ts`).

## Sensores y packs — frontera genérico/específico

Los sensor-packs de AWM (en `awm-baseline-registry`) envían solo reglas **genéricas y agnósticas a clases de problema** (eval, secrets, SQL injection, validación de entradas). NO se hornean reglas nacidas de un bug puntual de un proyecto. Las reglas **específicas** las crece `harness-retro` **dentro del proyecto**, sobre los config files copiados (`.semgrep.awm.yml`, `eslint.config.awm.mjs`, `tests/structural/`). El framework nunca enumera bugs puntuales.

**Razonamiento:** Los packs de AWM están diseñados para ser agnósticos a clases de problema, reutilizables entre equipos e independientes de contexto corporativo. Cuando un proyecto tiene un bug singular (ej: `splitBill → Infinity` por división por cero en un caso edge), la regla que lo detenta es un **conocimiento específico del proyecto**. Hornear esa regla en el sensor-pack de AWM convierte un hallazgo local en una obligación global — violando el principio de que AWM es un portador de convenciones, no de bugs corporativos.

**El flujo correcto:**

1. Un `harness-retro` corre en el proyecto, marca el bug como "encontrado varias veces ≥2" (ver [Harness Shakedown Findings — Insight Central](docs/harness-shakedown/findings.md#-insight-central--la-distinción-alcance-vs-seguridad-falta-en-el-modelo-de-calidad)).
2. El equipo crea una **regla específica del proyecto** en `.semgrep.awm.yml` o `eslint.config.awm.mjs`.
3. Esa regla vive en el repositorio del proyecto, es versionada con su código, y se comparte vía contexto del proyecto (no vía AWM registry).
4. Si el patrón es **universalmente evitable** (ej: "nunca usar `eval`"), pertenece al sensor-pack genérico de AWM.

**Referencias relacionadas:**
- [Harness Shakedown Lab — Findings](docs/harness-shakedown/findings.md) — evidencia del lab que motivó esta doctrina.
- [Harness Shakedown Lab — Runbook](docs/harness-shakedown/runbook.md) — guía para repro y QA del gateo determinístico.
