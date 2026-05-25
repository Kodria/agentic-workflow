# Harness Engineering — Design

**Fecha:** 2026-05-25
**Contexto:** Investigación previa en `tmp/investigation-harness.md`. AWM está al ~65% del framework de Böckeler (ThoughtWorks): ~90% feedforward cubierto por superpowers, ~20% de sensores computacionales. Este diseño cierra ese gap con una arquitectura unificada para P1–P5.

---

## 1. Arquitectura General

### Marco de referencia

```
HARNESS ENGINEERING (Böckeler / ThoughtWorks)
├── Guides / Feedforward
│   ├── ✅ Skills, brainstorming, writing-plans, SDD (superpowers ~90%)
│   ├── ✅ using-awm hook (SessionStart — HEALTHY en producción)
│   └── ✨ NUEVO: Project Constitution (CONSTITUTION.md inyectado por hook)
└── Sensors / Feedback
    ├── ✅ Inferencial: code-quality-reviewer en SDD
    ├── ✨ NUEVO P1: Sensores computacionales (tsc, ESLint, Semgrep, dep-cruiser)
    ├── ✨ NUEVO P2: Harness de comportamiento (Stryker mutation testing)
    └── ✨ NUEVO P4: Steering loop (harness-retro — cross-cutting)
```

### Componentes nuevos

| Tipo | Componente | Descripción |
|------|-----------|-------------|
| CLI | `awm sensors init/run/status/packs/install` | Backbone — discovery, runner, formatter |
| Registry | `sensor-packs/js-ts/`, `python/`, `generic/` | Templates de config por lenguaje |
| Skill | `setup-sensors` | Configuración guiada + Context7 |
| Skill | `project-constitution` | Genera `CONSTITUTION.md` |
| Skill | `harness-retro` | Bug recurrente → artefacto de remediación |
| Hook | PostToolUse | Sensores rápidos post-write (nuevo) |
| Hook | SessionStart | Extender para inyectar `CONSTITUTION.md` (existente) |

### Componentes modificados

| Componente | Modificación |
|-----------|-------------|
| `verification-before-completion` | Añadir `awm sensors run --slow` antes de cualquier claim de done |
| `systematic-debugging` | Al final: proponer `harness-retro` si el patrón es recurrente |
| `code-quality-reviewer` (SDD) | Si detecta patrón sistémico: recomendar `harness-retro` |
| `receiving-code-review` | Si el mismo issue aparece en múltiples PRs: recomendar `harness-retro` |
| `session-start` (hook script) | Leer `$PWD/CONSTITUTION.md` e inyectar en `additionalContext` si existe |

### Principio de integración

AWM no es el origen de los sensores — el proyecto objetivo lo es. La mayoría de proyectos modernos ya tienen tsc, ESLint, mypy instalados. AWM aporta tres cosas: **discovery** (detecta qué existe), **running** (ejecuta en el momento correcto), y **formatting** (convierte output crudo a instrucciones accionables para el LLM).

---

## 2. Sensor Packs

### Estructura en el registry

```
registry/
└── sensor-packs/
    ├── js-ts/
    │   ├── pack.json                  ← metadata + lógica de detección
    │   ├── eslint.config.awm.mjs      ← reglas LLM-friendly (ESLint v9 flat config)
    │   ├── eslint.config.awm.cjs      ← fallback ESLint v8
    │   ├── tsconfig.awm.json          ← strict mode completo
    │   ├── .dep-cruiser.awm.js        ← fronteras de arquitectura
    │   ├── .semgrep.awm.yml           ← reglas de seguridad JS/TS
    │   └── stryker.conf.awm.js        ← mutation testing config
    ├── python/
    │   ├── pack.json
    │   ├── mypy.awm.ini
    │   ├── ruff.awm.toml
    │   └── .semgrep.awm.yml
    └── generic/
        ├── pack.json
        └── .semgrep.awm.yml           ← Semgrep multi-language (fallback)
```

MVP: packs `js-ts`, `python`, `generic`. Go y otros packs son trabajo futuro.

### pack.json — schema

```json
{
  "name": "js-ts",
  "description": "JavaScript / TypeScript sensor pack",
  "detects": ["package.json", "tsconfig.json", "*.ts", "*.tsx"],
  "sensors": {
    "typecheck": {
      "fast": true,
      "defaultCmd": "npx tsc --noEmit",
      "configFile": "tsconfig.awm.json",
      "formatter": "tsc"
    },
    "lint": {
      "fast": true,
      "defaultCmd": "npx eslint . --format json",
      "configFile": "eslint.config.awm.mjs",
      "configFileFallback": "eslint.config.awm.cjs",
      "formatter": "eslint-llm"
    },
    "security": {
      "fast": false,
      "defaultCmd": "semgrep --config .semgrep.awm.yml --json .",
      "configFile": ".semgrep.awm.yml",
      "formatter": "semgrep"
    },
    "depcheck": {
      "fast": false,
      "defaultCmd": "npx depcruise --config .dep-cruiser.awm.js src",
      "configFile": ".dep-cruiser.awm.js",
      "formatter": "generic"
    },
    "mutation": {
      "fast": false,
      "defaultCmd": "npx stryker run",
      "configFile": "stryker.conf.awm.js",
      "formatter": "stryker",
      "enabled": false
    }
  }
}
```

### Patrón extend — no replace

Los archivos AWM extienden la config existente del proyecto. Nunca la reemplazan.

```js
// eslint.config.awm.mjs — extiende la config del proyecto
import projectConfig from './eslint.config.mjs';

export default [
  ...projectConfig,
  {
    rules: {
      'no-unused-vars': ['error', {
        message: "SENSOR[lint]: Variable '{{name}}' declared but never used. Fix: remove it or use it. File: {{file}}, Line: {{line}}"
      }]
    }
  }
];
```

```json
// tsconfig.awm.json — extiende el tsconfig del proyecto
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true
  }
}
```

### .awm/sensors.json — manifest por repo

Generado por `awm sensors init`. Commitable junto al código. El proyecto puede sobrescribir cualquier comando.

```json
{
  "pack": "js-ts",
  "sensors": {
    "typecheck": { "cmd": "npx tsc -p tsconfig.awm.json --noEmit" },
    "lint":      { "cmd": "npx eslint . --config eslint.config.awm.mjs --format awm-llm" },
    "security":  { "cmd": "semgrep --config .semgrep.awm.yml --json .", "fast": false },
    "depcheck":  { "cmd": "npx depcruise --config .dep-cruiser.awm.js src", "fast": false },
    "mutation":  { "enabled": false }
  }
}
```

### Archivos generados en el repo objetivo

```
my-project/
├── .awm/
│   └── sensors.json          ← manifest (awm sensors init)
├── CONSTITUTION.md           ← principios no-negociables (skill project-constitution)
├── eslint.config.awm.mjs    ← extends config existente + reglas LLM-friendly
├── tsconfig.awm.json        ← strict mode, extiende tsconfig del proyecto
└── .semgrep.awm.yml         ← reglas curadas de seguridad
```

### Detección de stack

| Archivo encontrado | Pack seleccionado |
|-------------------|------------------|
| `package.json` | `js-ts` |
| `pyproject.toml` | `python` |
| `go.mod` | `go` (futuro) |
| ninguno | `generic` |
| varios (monorepo) | detecta el primario por raíz, avisa al usuario |

---

## 3. CLI — `awm sensors`

Sigue el mismo patrón que `awm hooks`.

### Comandos

#### `awm sensors init [--configure]`

1. Detecta stack buscando archivos indicadores en el CWD
2. Detecta versión de herramientas clave (ESLint v8 vs v9 tienen formatos incompatibles)
3. Escribe `.awm/sensors.json` con los comandos del pack detectado
4. `--configure`: además copia los archivos de config del pack al repo (`eslint.config.awm.mjs`, `tsconfig.awm.json`, etc.)
5. Idempotente: merge conservativo si el manifest ya existe

#### `awm sensors run [--fast|--slow|--all]`

1. Lee `.awm/sensors.json` del CWD
2. Si no existe → `exit 0` silencioso (hook-safe)
3. Filtra sensores por `fast: true/false` según el flag
4. Corre cada sensor, captura stdout+stderr con timeout configurable
5. Pasa output por el formatter correspondiente
6. Emite JSON estructurado a stdout

Output:
```json
{
  "sensors": [
    { "name": "typecheck", "status": "pass" },
    { "name": "lint", "status": "fail", "errors": [
      "SENSOR[lint] src/index.ts:42 — Variable 'x' declared but never used. Fix: remove or use it. Rule: no-unused-vars"
    ]}
  ],
  "overall": "fail"
}
```

#### `awm sensors status`

Verifica manifest presente, config files en el repo, y binarios en PATH. Retorna HEALTHY / DEGRADED / NOT_CONFIGURED.

#### `awm sensors packs`

Lista packs disponibles en `~/.awm/sensor-packs/` con estado de instalación.

#### `awm sensors install`

Instala el PostToolUse hook en `~/.claude/settings.json`. Mismo mecanismo de merge que `awm hooks install`.

### Estructura de archivos CLI

```
cli/src/commands/sensors/
├── index.ts           ← registerSensorsCommand(program)
├── init.ts            ← detectStack(), writeManifest(), copyPackFiles()
├── run.ts             ← readManifest(), runSensors(), formatOutput()
├── status.ts          ← checkSensorHealth(): SensorStatus
├── packs.ts           ← listPacks(), installHook()
└── formatters/
    ├── tsc.ts
    ├── eslint.ts
    ├── semgrep.ts
    └── generic.ts
```

### Formatters LLM-friendly

Cada sensor tiene su formatter. Convierten output crudo en instrucciones accionables. Böckeler llama a esto "prompt injection positivo".

`awm sensors run` siempre captura la salida de cada herramienta en formato estructurado (JSON cuando la herramienta lo soporta, texto para las que no) y aplica el formatter AWM internamente. No se requiere ningún formatter personalizado instalado en el repo.

| Formatter | Input | Output |
|-----------|-------|--------|
| `tsc` | `src/auth.ts(23,7): error TS2322: Type 'string \| undefined'...` | `SENSOR[typecheck] src/auth.ts line 23 — Value may be undefined. Fix: add null check or change type.` |
| `eslint-llm` | `src/index.ts:42:5 error 'x' is assigned a value but never used` | `SENSOR[lint] src/index.ts:42 — Variable 'x' declared but never used. Fix: remove or use it.` |
| `semgrep` | JSON de Semgrep | `SENSOR[security] src/db.ts:15 — SQL injection risk. Fix: use parameterized queries.` |
| `generic` | cualquier output crudo | `SENSOR[raw] <output crudo con prefijo>` |

---

## 4. Skills

### `setup-sensors` — Configuración guiada con Context7

Complemento inteligente al CLI wizard. Se usa cuando la config existente es compleja o las versiones de herramientas requieren adaptación.

**Flujo:**
1. Corre `awm sensors status` → identifica gaps
2. Detecta versiones exactas instaladas (`eslint --version`, `tsc --version`)
3. Usa Context7 para obtener documentación actualizada del tool+versión
4. Analiza la config existente del proyecto
5. Propone cambios mínimos (no reemplaza, extiende)
6. Genera archivos de config adaptados
7. Corre `awm sensors status` para validar

**Cuándo usar vs CLI wizard:**
- CLI wizard (`awm sensors init --configure`): proyecto nuevo, stack estándar, setup rápido
- Skill + Context7: config existente no estándar, versión inusual, monorepo, necesita razonamiento

**Ejemplo Context7:** ESLint v9 detectado → config AWM del pack usa formato v8 (`extends`). La skill consulta Context7 sobre ESLint v9 flat config, obtiene el formato actualizado, genera `eslint.config.awm.mjs` correcto en lugar del template genérico.

### `project-constitution` — Principios no-negociables

Genera `CONSTITUTION.md` desde el contexto del proyecto. Inyectado en cada sesión por el hook SessionStart.

**Flujo:**
1. Lee `CLAUDE.md` / `AGENTS.md` del proyecto si existen
2. Analiza stack, estructura, convenciones detectadas
3. Lee `.awm/sensors.json` para incluir reglas de sensores
4. Genera borrador sección por sección
5. Usuario revisa y aprueba
6. Escribe `CONSTITUTION.md` en la raíz del repo

**Estructura del `CONSTITUTION.md`:**
```markdown
# Project Constitution

## Testing
- TDD always: test first, red-green-refactor
- Tests for critical paths reviewed by human, not AI-generated

## Architecture
- Module boundaries defined in .dep-cruiser.awm.js
- No circular dependencies

## Sensors
- All sensors must pass before declaring done
- LLM-friendly sensor errors are autocorrection triggers, not warnings

## Code style
- TypeScript strict mode (tsconfig.awm.json)
- ESLint AWM rules are non-negotiable
```

**Integración SessionStart:** El script `session-start` agrega:
```bash
if [ -f "$PWD/CONSTITUTION.md" ]; then
  CONSTITUTION=$(cat "$PWD/CONSTITUTION.md")
  # append to additionalContext with header
fi
```
Sin `CONSTITUTION.md` → comportamiento actual sin cambios.

### `harness-retro` — Steering loop

Cross-cutting. Cualquier fase puede proponerla cuando detecta un patrón recurrente.

**Quién la propone:**
- `systematic-debugging`: al final de cada debug session
- `code-quality-reviewer` (SDD): si detecta patrón sistémico
- `receiving-code-review`: si el mismo issue aparece en múltiples PRs
- El usuario en cualquier momento

**Árbol de remediación:**
```
Bug escapó ≥2 veces
├── estructural → nueva regla de linter/tsc → agrega a eslint.config.awm.mjs
├── de lógica  → nuevo test estructural → escrito por humano, no IA
├── de proceso → regla en CONSTITUTION.md o nueva skill
└── de seguridad → regla Semgrep nueva → agrega a .semgrep.awm.yml
```

---

## 5. Flujos de Datos

### Flujo 1 — Session Start (feedforward completo)

```
Claude Code inicia (startup|clear|compact)
  → SessionStart hook dispara session-start script
  → Lee ~/.awm/hooks/using-awm.md (siempre)
  → Si $PWD/CONSTITUTION.md existe → lo lee y agrega
  → Emite JSON: { hookSpecificOutput: { additionalContext: "..." } }
  → Agente arranca con reglas AWM + principios del proyecto
```

### Flujo 2 — Sensor rápido (PostToolUse automático)

```
Agente escribe archivo (Write/Edit/MultiEdit)
  → PostToolUse hook: awm sensors run --fast --cwd $PWD
  → Si no hay .awm/sensors.json → exit 0 silencioso
  → Si hay manifest → corre tsc + eslint (<3s)
  → Formatter convierte output crudo a LLM-friendly
  → Agente recibe errores con instrucción de fix
  → Agente autocorrige sin intervención humana
```

### Flujo 3 — Sensor lento (verification-before-completion)

```
Agente va a declarar "listo"
  → verification-before-completion: awm sensors run --slow
  → Corre semgrep + depcheck (+ mutation si habilitado)
  → ¿Pasa? → puede declarar done con evidencia de sensores
  → ¿Falla? → autocorrige, re-corre sensores, luego declara done
```

### Flujo 4 — Setup de proyecto nuevo

```
awm sensors init --configure    → detecta stack, instala templates, escribe manifest
awm sensors status              → verifica binarios y configs
skill: setup-sensors            → si gaps complejos, usa Context7 para adaptar
awm sensors install             → instala PostToolUse hook en ~/.claude/settings.json
skill: project-constitution     → genera CONSTITUTION.md
→ Harness activo: feedforward (using-awm + CONSTITUTION) + feedback (fast post-write, slow pre-done)
```

### Flujo 5 — Steering loop (harness-retro)

```
Bug detectado ≥2 veces por cualquier fase
  → harness-retro propuesto al usuario
  → Clasifica: estructural / lógica / proceso / seguridad
  → Genera artefacto de remediación
  → Harness se mejora: el bug no puede escapar de nuevo
```

---

## 6. Error Handling

**Principio: silencioso en ausencia, útil en presencia.**

| Escenario | Comportamiento |
|-----------|---------------|
| Sin `.awm/sensors.json` | `exit 0` silencioso — zero overhead en repos no configurados |
| Binario no en PATH | Sensor marcado SKIPPED, los demás continúan. `awm sensors status` reporta DEGRADED |
| Timeout de sensor | SKIPPED con advertencia (default: fast=10s, slow=120s, configurable en manifest) |
| Formatter no parsea output | Fallback a `generic`: output crudo prefijado con `SENSOR[raw]` |
| `awm sensors init` sobre manifest existente | Merge conservativo: no sobrescribe sensores ya configurados. Muestra diff antes de aplicar |
| Sin `CONSTITUTION.md` | `session-start` funciona igual que hoy. Bloque de Constitution es un `if` opcional |

---

## 7. Testing

Sigue el mismo patrón TDD que `cli/src/commands/hooks/`.

### Tests unitarios (Jest)

| Archivo | Qué cubre |
|---------|-----------|
| `formatters/tsc.test.ts` | Output crudo → `SensorError[]` con file, line, Fix. Output malformado. |
| `formatters/eslint.test.ts` | ESLint v8 y v9 → LLM-friendly correcto por versión |
| `formatters/semgrep.test.ts` | JSON de Semgrep → errores con Fix message |
| `init.test.ts` | Detección de stack (3 casos), merge conservativo, idempotencia |
| `run.test.ts` | Sin manifest → exit 0. Con manifest + mock → JSON correcto. Timeout → SKIPPED |
| `status.test.ts` | HEALTHY / DEGRADED / NOT_CONFIGURED |
| `packs.test.ts` | PostToolUse install idempotente, no rompe entries existentes |

### Tests de integración (shell)

| Archivo | Qué cubre |
|---------|-----------|
| `test-session-start-constitution.sh` | Con CONSTITUTION.md → output lo incluye. Sin él → output idéntico al actual |
| `tests/registry/sensor-packs.test.ts` | Cada pack.json es JSON válido. Config files válidos por pack |

### Protocolo E2E manual

Mismo formato que `cli/tests/integration/README.md`: repo temporal con tsc instalado, error intencional introducido, verificar que el PostToolUse hook inyecta el error LLM-friendly en el contexto del agente.

### Cobertura mínima por módulo

- **formatters**: happy path + output malformado + versión distinta
- **init**: 3 stacks + merge conservativo + idempotente
- **run**: sin manifest + con errores + timeout + binario faltante
- **status**: HEALTHY + DEGRADED + NOT_CONFIGURED

---

## 8. Orden de Implementación

| Paso | Componente | Impacto |
|------|-----------|---------|
| 1 | `awm sensors run` + formatters (tsc, eslint) | Valor central — usable manualmente desde día 1 |
| 2 | `awm sensors init` + sensor pack js-ts | Setup del proyecto, templates |
| 3 | `awm sensors install` + PostToolUse hook | Automatización del loop |
| 4 | `session-start` extension + skill `project-constitution` | Feedforward completo |
| 5 | Skill `setup-sensors` + Context7 | Casos de configuración complejos |
| 6 | Skill `harness-retro` + modificaciones a skills existentes | Steering loop + sensor pack python |

---

## Referencias

- `tmp/investigation-harness.md` — análisis completo de Harness Engineering (Böckeler, ThoughtWorks, 2026-04-02)
- `docs/plans/2026-05-22-pendientes-proximas-sesiones.md` — P1–P5 priorizados
- `cli/src/commands/hooks/` — patrón de implementación a seguir
- `registry/hooks/session-start` — script a extender para Constitution
