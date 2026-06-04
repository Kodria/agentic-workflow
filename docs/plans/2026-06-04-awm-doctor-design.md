# Diseño — `awm doctor` (Sub-fase 1c del release de bundles)

- **Fecha**: 2026-06-04
- **Rama**: `feature/improvements-r3`
- **Sub-fase**: 1c del roadmap de bundles. Predecesoras 1a y 1b completas y mergeadas en `main` (commit `1348d48`).
- **Contexto madre**: [`2026-06-02-harness-bundles-activation-design.md`](2026-06-02-harness-bundles-activation-design.md), secciones §7.2 (motor de estado y `awm doctor`) y §8 (entrega por sub-fases).
- **Sucesora**: 1d (`awm init` orquestador) consumirá el motor de estado construido aquí, añadiendo una capa *actuator*. 1c **no** implementa `init`.

## 1. Objetivo

Entregar `awm doctor`: un comando **read-only** que computa e imprime el estado del harness (nivel máquina + nivel proyecto) según el dashboard del §7.2. El valor central no es solo el comando, sino el **motor de diagnóstico compartido** que `doctor` imprime y que `init` (1d) accionará — construido completo desde 1c para evitar refactor posterior.

### Decisiones de alcance (brainstorming)

| # | Decisión | Resolución |
|---|---|---|
| D1 | ¿Cuánto del motor compartido se construye en 1c? | **Motor completo ahora.** Módulo reutilizable (probe + checks). `doctor` solo imprime; `init` (1d) reusará `gatherContext` + `runChecks` sin refactor. |
| D2 | ¿Qué formatos de salida? | **Dashboard humano (default) + `--json` + exit codes semánticos.** Habilita consumo por agentes/CI, alineado con la visión de desacople multi-agente. |
| D3 | ¿Qué conjunto de checks? | **Lista completa del §7.2**, incluyendo los agente-remediados (CONSTITUTION.md, CLAUDE.md/AGENTS.md), mostrados con puntero a skill sin actuar. |
| D4 | ¿Cómo estructurar el motor? | **Enfoque B: dos capas Probe + Check.** Una pasada de I/O recolecta `HarnessContext`; checks puros lo evalúan. Testeable sin tocar disco; frontera CLI↔agente codificada en los datos. |

## 2. Arquitectura

Tres capas con frontera clara. El motor vive en `cli/src/core/diagnostics/`; el comando en `cli/src/commands/`.

```
cli/src/core/diagnostics/
  context.ts    ← PROBE:  gatherContext(cwd) → HarnessContext   (única capa que toca disco/git)
  checks.ts     ← CHECK:  runChecks(ctx) → CheckReport          (funciones puras)
  types.ts      ← contratos: HarnessContext, CheckResult, CheckReport, Remedy
cli/src/commands/
  doctor.ts     ← RENDER: imprime dashboard | --json; mapea overall → exit code
```

**Flujo de datos (unidireccional):**

```
cwd ──> gatherContext() ──HarnessContext──> runChecks() ──CheckReport──> render/exit
         (disco/git)        (hechos crudos)   (puro)                      (doctor.ts)
```

- **`context.ts`** es el único módulo con I/O. Lee:
  - *Máquina*: `~/.awm/cli-source` (presencia + git status), `~/.claude/settings.json` (entrada hook SessionStart), symlinks de dev-core en `~/.claude/skills/`, `~/.awm/config.json` (ambient bundles deseados) vs lo instalado en global.
  - *Proyecto* (solo si `findProjectRoot(cwd) !== null`): `.awm/profile.json`, symlinks de bundles del proyecto en `<repo>/.claude/skills/`, `.awm/sensors.json`, `CONSTITUTION.md`, `CLAUDE.md`/`AGENTS.md`.
  - Reutiliza `findProjectRoot`/`readProfile` (`core/profile.ts`) y la lógica de detección de hook extraída de `commands/hooks/status.ts`.
- **`checks.ts`** no toca disco: recibe `HarnessContext`, devuelve `CheckReport`. Es lo que 1d consumirá.
- **`doctor.ts`** solo presenta y traduce a exit code. Cero lógica de diagnóstico.

**Garantía de no-refactor en 1d:** `init` reusará `gatherContext` + `runChecks` tal cual y añadirá una capa *actuator* que opera sobre los `CheckResult` con `remedy.kind === 'command'`.

## 3. Modelo de datos (`types.ts`)

```typescript
type CheckLevel  = 'machine' | 'project';
type CheckStatus = 'ok' | 'warn' | 'missing';   // ✔ / ⚠ / ✖

// Frontera CLI↔agente codificada en los datos
type Remedy =
  | { kind: 'command'; value: string }   // accionable por init (1d), p.ej. "awm add personal-notion"
  | { kind: 'skill';   value: string }   // lo redacta el agente, p.ej. "project-constitution"
  | { kind: 'none' };                    // ok, sin acción

interface CheckResult {
  id: string;            // estable: 'machine.hook', 'project.constitution'… (clave de --json, init y tests)
  level: CheckLevel;
  label: string;         // texto humano del dashboard
  status: CheckStatus;
  detail?: string;       // contexto corto: versión, ruta rota, motivo
  remedy: Remedy;        // qué hacer si status ≠ ok
}

interface HarnessContext {
  machine: {
    cliSource: { present: boolean; version?: string; gitState?: 'clean' | 'behind' | 'dirty' | 'unknown' };
    hook:      { present: boolean; degraded?: boolean };
    devCore:   { present: boolean; brokenLinks: string[] };
    ambient:   { wanted: string[]; installed: string[] };
  };
  project: null | {
    root: string;
    profile:       { present: boolean; extensions: string[] };
    activeBundles: { expected: string[]; linked: string[]; broken: string[] };
    sensors:       { present: boolean };
    constitution:  { present: boolean };
    context:       { present: boolean; file?: 'CLAUDE.md' | 'AGENTS.md' };
  };
}

interface CheckReport {
  results: CheckResult[];
  overall: 'healthy' | 'degraded';   // degraded ⇔ ≥1 status === 'missing'
  hasProject: boolean;
}
```

**Decisiones del modelo:**

- **`id` estable** es la columna vertebral: lo usa `--json`, lo usará `init` para mapear check→actuator, y los tests para aserciones precisas.
- **`remedy` discriminada por `kind`** materializa la frontera del §7.3: `command` = CLI lo ejecuta (1d); `skill` = lo razona el agente; `none` = sano. `init` filtrará exactamente `remedy.kind === 'command' && status !== 'ok'`.
- **`overall`**: `degraded` solo ante algún `missing`. Los `warn` **no** degradan (advisory).
- **`project: null`** cuando no hay repo → el dashboard omite el bloque Proyecto.

## 4. Catálogo de checks (`runChecks`)

### Nivel máquina (siempre)

| `id` | label | ✔ ok cuando… | ✖/⚠ y `remedy` |
|---|---|---|---|
| `machine.cli` | CLI vX.Y.Z | `cliSource.present` && `gitState==='clean'` | `behind`→⚠ `{command:'awm update'}`; `dirty`/`unknown`→⚠ `{kind:'none'}` (advisory, sin acción); ausente→✖ `{command:'awm init'}` |
| `machine.hook` | hook SessionStart | `hook.present && !degraded` | degraded→⚠; ausente→✖ · `{command:'awm init'}` |
| `machine.devCore` | dev-core (baseline) | `devCore.present && brokenLinks==[]` | links rotos→⚠; ausente→✖ · `{command:'awm init'}` |
| `machine.ambient.<b>` | `<bundle>` (ambient) | bundle en `installed` | falta→✖ · `{command:'awm add <b>'}` — una fila por bundle `wanted` no instalado |

### Nivel proyecto (solo si `ctx.project !== null`)

| `id` | label | ✔ ok cuando… | ✖/⚠ y `remedy` |
|---|---|---|---|
| `project.profile` | `.awm/profile.json (<exts>)` | `profile.present` | ausente→✖ · `{command:'awm init'}` |
| `project.activation` | bundles activos | `broken==[]` && `linked⊇expected` | faltan/rotos→✖ · `{command:'awm sync'}` |
| `project.sensors` | sensores | `sensors.present` | ausente→✖ · `{command:'awm sensors init'}` |
| `project.constitution` | CONSTITUTION.md | `constitution.present` | ausente→✖ · `{skill:'project-constitution'}` |
| `project.context` | CLAUDE.md / AGENTS.md | `context.present` | ausente→⚠ · `{skill:'project-context-init'}` |

**Notas de semántica (alineadas al §7.2):**

- **`machine.ambient.<b>` es dinámico**: genera N filas según `~/.awm/config.json`. Si no hay ambient deseados, no aparece ninguna fila (no es ✖).
- **`project.constitution` → ✖** (degrada) con `remedy.skill` — se **señala**, no se ejecuta. **`project.context` → ⚠** (advisory, no degrada), también `skill`. Refleja el ejemplo del §7.2 (CONSTITUTION ✖, CLAUDE ⚠).
- **"expected" en `project.activation`**: bundles esperados = `profile.extensions` resueltos contra el catálogo (reutiliza `core/bundles.ts`); "linked" = symlinks reales en `<repo>/.claude/skills/`.
- La frontera CLI↔agente queda **en los datos**: lo auto-reparable por 1d es exactamente `remedy.kind==='command'`; los dos `skill` quedan como pendientes señalados.

## 5. Salida y exit codes

### Comando

```
awm doctor              # dashboard humano (default)
awm doctor --json       # CheckReport serializado (consumo programático)
```

### Dashboard humano (default)

Render desde `CheckReport`, agrupado por `level`, glifos por `status`, `remedy` alineado a la derecha cuando no es `ok`:

```
AWM · estado del harness

Máquina (global)
  ✔ CLI v1.0.0   ✔ hook SessionStart   ✔ dev-core (baseline)
  ✖ personal-notion (ambient)            → awm add personal-notion

Proyecto: belanz
  ✔ .awm/profile.json (frontend)         ✔ bundles activos
  ✖ sensores no inicializados            → awm sensors init
  ✖ CONSTITUTION.md ausente              → skill: project-constitution
  ⚠ CLAUDE.md ausente                    → skill: project-context-init

estado: degradado · 3 acciones sugeridas
```

- Si `ctx.project === null`: se omite el bloque "Proyecto" y se imprime una línea tenue `(sin proyecto en el cwd)`.
- Glifos: `✔` ok, `⚠` warn, `✖` missing. `remedy.command` → `→ awm …`; `remedy.skill` → `→ skill: <nombre>`.
- Colores con dependencia ya presente (`chalk`/`picocolors`): verde/amarillo/rojo; degrada a sin-color si no hay TTY.
- Línea final: `estado: sano|degradado · N acciones sugeridas`.

### `--json`

Emite el `CheckReport` tal cual (`results` + `overall` + `hasProject`), sin colores ni decoración. El `id` estable garantiza contrato estable para agentes/CI. `--json` **no** cambia el exit code.

### Exit codes

| Código | Cuándo | Uso |
|---|---|---|
| `0` | `overall === 'healthy'` (sin `missing`; los `warn` no cuentan) | CI verde / agente: harness sano |
| `1` | `overall === 'degraded'` (≥1 `missing`) | CI rojo / agente: hay que actuar |
| `2` | Error interno del propio doctor (excepción al sondear) | distinguible de "degradado" |

## 6. Testing

La separación probe/check/render permite testear el grueso **sin tocar disco**.

1. **Checks puros (`checks.test.ts`) — el corazón.** `HarnessContext` literales en memoria; aserción del `CheckResult` por `id`. Casos: todo sano → `healthy`/exit 0; cada `missing` individual → `degraded` + `remedy` correcto; `warn` (CLAUDE.md, CLI behind) no degrada; `project===null` → sin checks de proyecto; `machine.ambient.<b>` dinámico → N filas según `wanted` vs `installed`.
2. **Probe (`context.test.ts`) — I/O aislado en `tmp`.** HOME/repo sintético en directorio temporal (patrón ya usado en tests de `bundle-install`/`profile`); verifica el mapeo de hechos: cache presente/ausente, hook en settings.json, symlinks de dev-core (incluyendo uno roto), profile, sensores/CONSTITUTION/CLAUDE. Limpieza del tmp al final.
3. **Render + exit code (`doctor.test.ts`).** Dado un `CheckReport` fijo: captura stdout y asierta bloques presentes/omitidos (proyecto null), glifos, línea de resumen, y que `--json` emite JSON parseable con los `id` esperados. Mapeo `overall → exit code` (0/1) verificado directo.

**Disciplina TDD:** cada step escribe primero el test que falla (checks → context → render), luego la implementación mínima. Runner `jest --runInBand` ya configurado.

**Fuera de alcance de tests en 1c:** no se testea `init` actuando sobre los remedios (es 1d); 1c garantiza solo que el motor produce el `CheckReport` correcto y que `doctor` lo presenta.

## 7. Componentes y límites (diseño para aislamiento)

| Componente | Hace | Depende de | Lo consume |
|---|---|---|---|
| `diagnostics/context.ts` | Sondea el entorno → `HarnessContext` | `fs`, `git`, `profile.ts`, lógica de hook | `doctor.ts`, (1d) `init` |
| `diagnostics/checks.ts` | Evalúa contexto → `CheckReport` (puro) | solo `types.ts` + `bundles.ts` (resolución de catálogo, sin I/O) | `doctor.ts`, (1d) `init` |
| `diagnostics/types.ts` | Contratos | — | todos |
| `commands/doctor.ts` | Render + exit code | `diagnostics/*`, `chalk` | `index.ts` (registro de comando) |

**Refactor habilitante:** extraer de `commands/hooks/status.ts` la detección de la entrada SessionStart a una función reutilizable que `context.ts` invoque, evitando duplicar el parseo de `settings.json`. Cambio acotado, sin tocar el comportamiento de `hooks status`.

## 8. Fuera de alcance (1c)

- `awm init` y su capa *actuator* (sub-fase 1d).
- Auto-reparación de cualquier check (doctor es estrictamente read-only).
- Nuevos checks fuera de la lista del §7.2 (p.ej. `infra`, sources externos — fases futuras).
- Tags semver por bundle (Fase 2).

## 9. Registro del comando

`awm doctor` se registra en `cli/src/index.ts` junto a los comandos existentes (`add`, `sync`, `list`, …), con la flag `--json`. Sin subcomandos.
