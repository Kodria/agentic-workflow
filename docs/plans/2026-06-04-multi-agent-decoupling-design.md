# Diseño — Desacople multi-agente: capa de inyección de contexto (Fase 3)
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

- **Fecha**: 2026-06-04
- **Estado**: Aprobado (architecture-advisor)
- **Rama**: feature/improvements-r5
- **Alcance de este documento**: Fase 3 del roadmap (desacople multi-agente). Las Fases 2 (versionado/resolver) y 4 (sources externos) quedan referenciadas pero fuera de alcance.

## 1. Contexto y motivación

AWM es un agente de desarrollo de software agéntico fuerte cuyo objetivo de producto secundario es ser un **distributable skills manager for teams**. Ese objetivo descansa sobre una premisa que hoy no se cumple: que AWM sea **agnóstico del agente** (Claude Code, OpenCode, Antigravity, Codex, Windsurf), no "skills de Claude Code".

Estado actual del desacople:

- La capa de **"dónde"** instalar artefactos **ya existe**: `cli/src/providers/index.ts` define `PROVIDERS` para `claude-code`, `antigravity` y `opencode`, con paths por tipo de artefacto (`skill`/`workflow`/`agent`) y scope (`global`/`local`).
- La capa de **"cómo inyectar el contexto/bootstrap"** está **acoplada a Claude Code**: el `HookConfig` de tipo `cc-settings-merge` (merge en `~/.claude/settings.json` + script en `~/.awm/hooks`, evento `SessionStart`) está hardcodeado. Es lo que inyecta los ~3088 chars de contexto AWM (using-awm + CONSTITUTION + profile) en cada sesión.

### Problema central que resuelve esta fase

El desacople real requiere una **capa Strategy** que abstraiga *cómo* cada agente recibe el contexto AWM, de forma agnóstica, sin romper el install vivo de Claude Code.

### El eje del diseño: dos paradigmas de inyección

La investigación de docs actuales (opencode.ai/docs/rules) reveló que los agentes inyectan contexto con dos paradigmas incompatibles:

| Paradigma | Mecanismo | Agentes |
|---|---|---|
| **Dinámico / computado** | Un hook *calcula e inyecta* contenido en cada sesión | Claude Code (`SessionStart` + merge en `settings.json`) |
| **Estático / por referencia** | La config *apunta a archivos* que el agente carga solo | OpenCode (`instructions[]` en `opencode.json`, o `AGENTS.md` auto-cargado); previsiblemente Codex/Cursor/Windsurf |

La tensión que la capa resuelve: Claude inyecta contenido *vivo*; OpenCode solo referencia *archivos*. **El puente es materializar el contenido computado a un archivo estable que la config estática referencie.**

## 2. Decisiones tomadas (architecture-advisor)

| # | Decisión | Valor |
|---|---|---|
| D1 | Alcance | Esta fase = Fase 3. F2 (versionado) y F4 (sources externos) diferidas. |
| D2 | Foco | "Ambos en secuencia": capa estructural agnóstica **+** un adapter concreto que la valida. |
| D3 | Agente que valida | **OpenCode** (ya tiene paths en `PROVIDERS`; su mecanismo estático fuerza a resolver el gap dinámico↔estático). |
| D4 | Enfoque arquitectónico | **Strategy sobre un Context Provider compartido** (Opción A). Descartadas: convención-única (clobbering, no nativo) y bespoke-por-agente (deuda). |
| D5 | Compatibilidad | El install actual de Claude Code se mantiene **intacto, sin migración forzada** (constraint duro). |
| D6 | Fuente de verdad | `ContextProvider` es la **única** computación del contenido; hook y archivo materializado consumen su salida → no pueden divergir. |
| D7 | Idempotencia | Basada en `sha256(markdown)`; se reescribe/reinyecta solo si el hash cambió (`InjectionState`: `injected`/`absent`/`stale`). |
| D8 | OpenCode: mecanismo | `instructions[]` (inclusión **eager**), **no** el patrón lazy `@`-ref de `AGENTS.md` (evita fallo silencioso). |
| D9 | Dependencias nuevas | **Cero**. Todo con built-ins de Node (`crypto`, `fs`, `JSON`). |

## 3. Principio de boundary

> **El "qué" (contenido) nunca conoce agentes. El "cómo" (cableado) nunca computa contenido.** Esa línea es lo que hace el desacople real.

```
                    ┌─────────────────────┐
   state engine ───▶│  ContextProvider    │  (agnóstico: computa el contenido canónico)
   (diagnostics)    └──────────┬──────────┘
                               │ AwmContext (markdown + hash + version)
                               ▼
                    ┌─────────────────────┐
                    │ ContextMaterializer │  (persiste a path estable, idempotente por hash)
                    └──────────┬──────────┘
                               │ MaterializedRef
                               ▼
        ┌──────────────────────────────────────────────┐
        │           InjectionOrchestrator               │  (único que conoce agente→estrategia)
        └───┬───────────────┬───────────────────┬───────┘
            │ selecciona por ProviderConfig.injection.type
   ┌────────▼───────┐ ┌─────▼────────────────┐ ┌▼──────────────────────┐
   │ HookMerge      │ │ ConfigInstructions   │ │ ConventionFile        │
   │ Strategy       │ │ Strategy             │ │ Strategy (fallback)   │
   │ (Claude, hoy)  │ │ (OpenCode) ◀── NUEVO │ │ (AGENTS.md)           │
   └────────────────┘ └──────────────────────┘ └───────────────────────┘
            implementan ── InjectionStrategy (interface)
```

## 4. Componentes y límites

| Componente | Responsabilidad | Interface | Depende de | Tipo | Estado |
|---|---|---|---|---|---|
| **ContextProvider** | Computa el contenido canónico AWM (using-awm + profile + puntero CONSTITUTION) desde el estado. Agnóstico de agente. | `buildContext(state) → AwmContext` | state engine, profile manager, registry | **Core** | Nuevo |
| **ContextMaterializer** | Persiste `AwmContext` a un path estable e idempotente; regenera en `awm sync`. | `materialize(ctx, path) → MaterializedRef` | filesystem | Commodity | Nuevo |
| **InjectionStrategy** (interface) | Contrato del "cómo": cablear/retirar/inspeccionar en el mecanismo nativo del agente. | `inject(ref, provider, scope)` · `remove(...)` · `status(...) → InjectionState` | — | **Core** | Nuevo |
| **HookMergeStrategy** | Variante `cc-settings-merge`: merge del hook en `settings.json` + script en `~/.awm/hooks`. | implementa `InjectionStrategy` | provider paths, `HookConfig` | Core | Refactor de `commands/hooks/*` tras la interface |
| **ConfigInstructionsStrategy** | Merge idempotente de una entrada centinela en `instructions[]` de `opencode.json` apuntando al `MaterializedRef`; preserva entradas del usuario. | implementa `InjectionStrategy` | provider paths, JSON-merge util | Core | **Nuevo — adapter OpenCode** |
| **ConventionFileStrategy** | Escribe/actualiza un *managed block* con marcadores en `AGENTS.md` (fallback). | implementa `InjectionStrategy` | marker util | Core | Nuevo (deferrable) |
| **ProviderConfig (extendido)** | Cada agente declara su descriptor de inyección (union discriminado) además de los paths. | `getProvider(agent)` · `getInjection(agent)` | — | **Core** | Extiende `providers/index.ts` |
| **InjectionOrchestrator** | Glue: resuelve provider → elige estrategia por `injection.type` → corre inject/remove/status. Único acoplado al mapeo agente→estrategia. | `installContext(agent, scope)` · `uninstallContext(...)` · `contextStatus(agent)` | ProviderRegistry, estrategias, Provider, Materializer | **Core** | Nuevo |
| **Diagnostics check (extendido)** | Check "contexto AWM inyectado para agente X" que alimenta el report; lo consumen `doctor` (lee) e `init` (actúa). | check en el state engine | Orchestrator.status | Commodity | Extiende `core/diagnostics/checks.ts` |

### Boundaries que protegen el desacople

1. **`ProviderConfig.injection` como union discriminado** — extiende el patrón ya existente (`HookConfig.type: 'cc-settings-merge'`). Agente nuevo = una variante + (si su mecanismo es nuevo) una estrategia. Nada más se toca.
2. **Idempotencia y reversibilidad por estrategia** — cada estrategia define cómo *retirar* limpio lo suyo (filtrar la entrada centinela, borrar el managed block, revertir el merge). Habilita `doctor`/`init`/`uninstall` fieles.
3. **El Orchestrator es el único acoplado al mapa agente→estrategia** — `doctor` e `init` hablan con el Orchestrator, no con estrategias concretas. Windsurf mañana no los cambia.

## 5. Decisiones tecnológicas

### 5.1 Ubicación de módulos

```
cli/src/core/context/
  types.ts              # AwmContext, MaterializedRef, InjectionState
  provider.ts           # ContextProvider.buildContext()         [core, nuevo]
  materializer.ts       # ContextMaterializer.materialize()       [commodity, nuevo]
  orchestrator.ts       # InjectionOrchestrator                   [core, nuevo]
  strategies/
    strategy.ts         # interface InjectionStrategy             [core, nuevo]
    hook-merge.ts       # HookMergeStrategy (envuelve commands/hooks/*)  [refactor]
    config-instructions.ts   # OpenCode                           [core, nuevo]
    convention-file.ts  # AGENTS.md fallback                      [core, deferrable]
cli/src/providers/index.ts          # ProviderConfig.injection (union)   [extiende]
cli/src/core/diagnostics/checks.ts  # check contextInjection             [extiende]
```

### 5.2 Contratos

```ts
type AwmContext = {
  markdown: string;        // payload canónico (using-awm + profile + puntero CONSTITUTION)
  sourceVersion: string;   // versión del registry que lo generó (trazabilidad)
  contentHash: string;     // sha256(markdown) — clave de idempotencia
};

type MaterializedRef = {
  absPath: string;
  scope: Scope;            // 'global' | 'local'
  contentHash: string;     // = AwmContext.contentHash; reescribe solo si cambia
};

type InjectionState = 'injected' | 'absent' | 'stale';  // stale = referenciado pero hash viejo
```

### 5.3 Path del archivo materializado

| Scope | Path | Git |
|---|---|---|
| global | `~/.awm/context/awm-context.md` | n/a |
| local | `.awm/context/awm-context.md` | **gitignored** (regenerable; solo se commitea `.awm/profile.json`) |

### 5.4 Merge idempotente de `opencode.json` (`ConfigInstructionsStrategy`)

- Lectura-parse-merge-escritura nativa (`JSON.parse`/`stringify`, indent 2). `opencode.json` es JSON estricto sin comentarios (per su `$schema`).
- **Centinela = el propio path** `.../.awm/context/awm-context.md` en `instructions[]`. Add solo si no está; remove = `filter` de entradas que matcheen `**/.awm/context/awm-context.md` → **preserva entradas del usuario**.
- Ausente → crea mínimo `{ "$schema": "...", "instructions": [<path>] }`.
- Global `~/.config/opencode/opencode.json` / local `./opencode.json`.

### 5.5 Managed block de `AGENTS.md` (`ConventionFileStrategy`, fallback)

```
<!-- AWM:BEGIN (managed — no editar) -->
…contenido materializado…
<!-- AWM:END -->
```
Idempotente: reemplaza entre marcadores; si no existen, *appendea*. Remove: borra el bloque. Preserva el contenido del usuario alrededor.

### 5.6 Fuente única de verdad

`ContextProvider` es la única computación. El script de hook de Claude y el Materializer (OpenCode) consumen su salida → no divergen. *Backward-compat:* `HookMergeStrategy` envuelve el comportamiento actual tal cual; **unificar el content-source del hook sobre `ContextProvider` es follow-up de bajo riesgo dentro de esta fase**.

## 6. Integraciones y riesgos

| Integración | Protocolo | Owner | Punto de fallo | Impacto en UX | Mitigación |
|---|---|---|---|---|---|
| Claude `settings.json` + `~/.awm/hooks` | merge JSON + script | Anthropic | JSON malformado; cambio de schema; hook manual previo | Hook no dispara → sin contexto en Claude | Merge idempotente con backup (ya existe); characterization tests; `doctor` reporta HEALTHY/degraded |
| OpenCode `opencode.json` → `instructions[]` | merge JSON | SST/opencode | JSON inválido; campo renombrado; config alterna/env | **Silencioso**: contexto no cargado → ignora `using-awm` | Parse-validate antes de escribir; **abortar con mensaje accionable, nunca clobbering**; backup; `doctor` expone `absent/stale` |
| Archivo materializado | escritura filesystem | AWM | permisos, path inexistente, disco | Config referencia archivo ausente | **Materializar ANTES de inyectar**; `inject` verifica el `MaterializedRef`; idempotente por hash |
| `AGENTS.md` managed block | merge por marcadores | usuario/equipo | usuario edita dentro; borra marcadores; conflicto git | Contexto stale/duplicado | Marcadores + aviso "no editar"; replace-between-markers; si faltan, append |
| Runtime OpenCode honra `instructions[]` | comportamiento | versión opencode | versión vieja ignora el campo; lazy vs eager | Contexto en config pero no en el modelo | Usar `instructions[]` (eager), no `@`-ref lazy; documentar versión mínima; `doctor` lo nota |
| Drift cross-máquina / sync | git + regeneración | AWM | teammate clona: `opencode.json` referencia `.awm/context/…` aún ausente | OpenCode avisa/skip al arrancar | `awm sync` regenera; documentar "correr `awm sync` tras clonar"; validar tolerancia a archivos ausentes |

### Riesgos transversales

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **Fallo silencioso de inyección** (agente corre sin AWM y nadie lo nota) | Alta | `InjectionState` (`injected`/`absent`/`stale`) de primera clase en `doctor`; `init` actúa sobre `absent`/`stale`. La observabilidad **es** la mitigación. |
| Reformateo del `opencode.json` del usuario (indent 2) | Baja | Aceptado y documentado; config generado. Lib format-preserving deferible. |
| Divergencia de contenido hook↔archivo | Media | `ContextProvider` única fuente; unificación del hook como follow-up marcado. |
| **Assumption: opencode tolera instruction files ausentes** | Media | **Spike de validación al inicio de la implementación**, antes de cablear el adapter. |

### Decisión de diseño derivada de los riesgos

> Usar **`instructions[]` (eager)** en vez del patrón lazy `@`-reference para OpenCode — la inyección lazy depende de que el modelo *decida* cargar el archivo, reintroduciendo el fallo silencioso. El contexto AWM debe estar siempre presente, no bajo demanda.

## 7. Entrega (lo nuevo vs lo reutilizable vs lo diferido)

- **Base estructural reutilizable**: `ContextProvider`, `ContextMaterializer`, `InjectionStrategy`, `InjectionOrchestrator`, `ProviderConfig` extendido.
- **Adapter específico que valida (OpenCode)**: `ConfigInstructionsStrategy` + variante `injection: { type: 'config-instructions', … }` en `PROVIDERS['opencode']`.
- **Refactor sin cambio de comportamiento**: mover el hook de Claude detrás de `HookMergeStrategy` (compatibilidad hacia atrás garantizada).
- **Deferible dentro de la fase**: `ConventionFileStrategy` (OpenCode no la necesita; se implementa cuando aparezca el primer agente convention-only); scope `local` de OpenCode (se puede shippear global-first).

## 8. Testing (estrategia)

| Componente | Estrategia |
|---|---|
| `ContextProvider` | unit sobre fixtures de estado sintético → markdown esperado |
| `ContextMaterializer` | temp dir: escribir 2× → 2ª no-op (hash igual); cambio → reescribe |
| `ConfigInstructionsStrategy` | fixtures de `opencode.json` (ausente/vacío/con entradas de usuario/ya inyectado) → add idempotente + remove limpio + preserva usuario |
| `HookMergeStrategy` | **characterization tests** — tests actuales del hook siguen verdes (refactor sin cambio de comportamiento) |
| `InjectionOrchestrator` | dado agente → despacha a la estrategia correcta (estrategias mockeadas) |
| diagnostics check | snapshot del report con/sin/stale inyección |

## 9. Fuera de alcance (fases siguientes, ya acordadas)

- **Fase 2**: tags `{bundle}--v{semver}` + resolver de rangos + `skills-lock.json` + pin por `ref`. *Enabler técnico de la Fase 4.*
- **Fase 4**: sources externos (`github`/`npm`/`git-subdir`) + canales stable/latest + allowlists. *Depende de Fase 2.*

> **Frontera de roadmap**: esta fase (3) es **independiente** de la cadena 2→4. Se prioriza por ser el norte de producto (desacople multi-agente) y por su alta readiness (el provider abstraction ya existe).

## 10. Fuentes

- [opencode.ai/docs/rules](https://opencode.ai/docs/rules) — `instructions[]` en `opencode.json`, `AGENTS.md`, carga eager vs lazy.

## 11. Resultado del spike (Task 1) — 2026-06-05

**Versión probada:** opencode 1.16.2

**Pregunta:** ¿`instructions[]` en `~/.config/opencode/opencode.json` carga el contenido del archivo en el contexto del agente?

**Resultado:**
- `instructions[]` con **ruta absoluta** en el **config global** (`~/.config/opencode/opencode.json`) → ✅ **carga eager confirmada**. El agente vio el token sentinela `AWM_PROBE_TOKEN_42` correctamente.
- `instructions[]` con **ruta relativa** en un **config de proyecto local** (`./opencode.json`) → ❌ no cargó (razón probable: OpenCode no leyó el config local, o la resolución de ruta relativa no aplica en ese contexto).

**Conclusión:** El diseño de `ConfigInstructionsStrategy` es correcto. AWM escribe la ruta absoluta `~/.awm/context/awm-context.md` en `~/.config/opencode/opencode.json`, y OpenCode la carga en cada sesión.

**Tolerancia a archivo ausente:** No probado (la validación manual se detuvo al confirmar la carga eager). Riesgo bajo — la estrategia crea el archivo antes de escribir el sentinel, y `regenerateGlobalContext()` lo regenera si queda stale.
