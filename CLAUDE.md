# AWM Repository Principles

This document codifies architectural and design principles for the Agentic Workflow Manager (AWM) repository to ensure consistency and prevent future design drift.

## Sensores y packs — frontera genérico/específico

Los sensor-packs de AWM (`registry/sensor-packs/`) envían solo reglas **genéricas y agnósticas a clases de problema** (eval, secrets, SQL injection, validación de entradas). NO se hornean reglas nacidas de un bug puntual de un proyecto. Las reglas **específicas** las crece `harness-retro` **dentro del proyecto**, sobre los config files copiados (`.semgrep.awm.yml`, `eslint.config.awm.mjs`, `tests/structural/`). El framework nunca enumera bugs puntuales.

**Razonamiento:** Los packs de AWM están diseñados para ser agnósticos a clases de problema, reutilizables entre equipos e independientes de contexto corporativo. Cuando un proyecto tiene un bug singular (ej: `splitBill → Infinity` por división por cero en un caso edge), la regla que lo detenta es un **conocimiento específico del proyecto**. Hornear esa regla en el sensor-pack de AWM convierte un hallazgo local en una obligación global — violando el principio de que AWM es un portador de convenciones, no de bugs corporativos.

**El flujo correcto:**

1. Un `harness-retro` corre en el proyecto, marca el bug como "encontrado varias veces ≥2" (ver [Harness Shakedown Findings — Insight Central](docs/harness-shakedown/findings.md#-insight-central--la-distinción-alcance-vs-seguridad-falta-en-el-modelo-de-calidad)).
2. El equipo crea una **regla específica del proyecto** en `.semgrep.awm.yml` o `eslint.config.awm.mjs`.
3. Esa regla vive en el repositorio del proyecto, es versionada con su código, y se comparte vía contexto del proyecto (no vía AWM registry).
4. Si el patrón es **universalmente evitable** (ej: "nunca usar `eval`"), pertenece al sensor-pack genérico de AWM.

**Referencias relacionadas:**
- [Harness Shakedown Lab — Findings](docs/harness-shakedown/findings.md) — evidencia del lab que motivó esta doctrina.
- [Harness Shakedown Lab — Runbook](docs/harness-shakedown/runbook.md) — guía para repro y QA del gateo determinístico.
