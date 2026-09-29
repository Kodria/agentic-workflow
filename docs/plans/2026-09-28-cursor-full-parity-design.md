# Diseño — Paridad completa de AWM para Cursor

- **Fecha:** 2026-09-28
- **Estado:** Aprobado por el dueño (2026-09-28), secciones §1–§8
- **Rama:** `feat/cursor-full-parity`
- **Base:** `main` @ `v9.14.0` (`b3f791f`)
- **Repositorios afectados:** `agentic-workflow` (CLI), `awm-baseline-registry` (hooks)
- **Superficies objetivo:** Cursor IDE (Agent) y Cursor Agent CLI (`agent`), tanto en sesión interactiva como en ejecución desatendida con `agent -p`. Cloud Agents quedan fuera de esta entrega (ver §8).
- **Entrega:** capas 1 y 2, y la ejecución interactiva/desatendida en su forma vigente (§7.1). El routing de modelo/esfuerzo queda bajo la pausa de R2 (§7.2).
- **Relacionado:** [#126](https://github.com/Kodria/agentic-workflow/issues/126) (tokens: R3–R5 aplican su principio de núcleo fijo pequeño sin duplicados).

## Requirements

### Transversales

- **R1 — Autosuficiencia:** WHILE Cursor is an enabled agent, THE AWM CLI SHALL install every artifact Cursor needs (skills, agents, hook, project guidance) in locations Cursor reads natively, independent of whether Claude Code or Codex are installed or enabled.
- **R2 — No dependencia de importaciones de terceros:** THE Cursor integration SHALL NOT rely on Cursor's third-party imports (`~/.claude/*`, `~/.codex/*`) to deliver any AWM capability.
- **R3 — Unicidad de entrega:** WHEN a Cursor session starts on a machine with any non-empty subset of {Claude Code, Codex, Cursor} enabled, THE AWM installation SHALL deliver `using-awm` exactly once, and each AWM skill and agent name exactly once, to that session.
- **R3.1 — Gate de subconjuntos:** THE CLI test suite SHALL verify R3 for all seven non-empty subsets of {Claude Code, Codex, Cursor} with isolated `HOME`/`AWM_HOME`.
- **R4 — Prioridad de tokens:** WHERE two delivery channels could carry the same AWM content to a Cursor session, THE Cursor integration SHALL keep the channel that is guaranteed by R1 and suppress the other.
- **R5 — Presupuesto del payload:** IF the Cursor session-start payload exceeds 24 KiB or the re-anchor payload exceeds 4 KiB, THEN THE hook SHALL truncate with a visible marker and `awm context-budget` SHALL report the overrun.
- **R5.1 — Excepción declarada:** THE only content allowed to reach a Cursor session through two carriers SHALL be `PROJECT_GUIDANCE` (project `AGENTS.md` and `.cursor/rules/awm.mdc`, about 60 tokens), kept for modes that do not read `AGENTS.md`.

### Capa 1 — Artefactos y contexto

- **R6 — Ubicación de skills:** THE Cursor provider SHALL install global skills in `~/.agents/skills` and project skills in `.agents/skills` with the `link` renderer.
- **R7 — Grupo compartido:** THE Cursor provider SHALL participate in the existing shared skill target group with Codex and OpenCode, so that R14/R15/R16 of the Codex parity design apply unchanged.
- **R8 — Migración de `.mdc`:** WHEN `awm update` or `awm init --agent cursor` runs and finds AWM-managed skill rules rendered by `cursor-mdc` in `~/.cursor/rules` or `.cursor/rules`, THE AWM CLI SHALL remove only those managed files after the `SKILL.md` target is installed.
- **R8.1 — Preservación:** IF a `.mdc` file in those directories is not recorded as AWM-managed, THEN THE AWM CLI SHALL leave it untouched.
- **R9 — Agents nativos:** WHEN a bundle contains a canonical agent, THE Cursor provider SHALL install it under `~/.cursor/agents` or `.cursor/agents` (per scope) as a markdown file whose frontmatter Cursor accepts.
- **R10 — Guía de proyecto mínima:** WHEN AWM initializes a project for Cursor, THE AWM CLI SHALL write only the short `PROJECT_GUIDANCE` managed block to the project `AGENTS.md`, not the full `using-awm` body.
- **R11 — Carrier de proyecto versionado:** THE AWM CLI SHALL keep writing `.cursor/rules/awm.mdc` (`alwaysApply: true`) with `PROJECT_GUIDANCE` as the repository-versioned carrier.

### Capa 2 — Hooks y diagnóstico

- **R12 — Hook nativo:** WHEN `awm init --agent cursor` or `awm hooks install --agent cursor` runs, THE AWM CLI SHALL merge into `~/.cursor/hooks.json` (`version: 1`) exactly one AWM entry for each of `sessionStart`, `preCompact` and `postToolUse`, each pointing to its installed script under `~/.awm/hooks/cursor/`.
- **R13 — Merge seguro:** IF `~/.cursor/hooks.json` is not valid JSON, has an unknown `version`, or contains more than one current AWM entry for the same event, THEN THE AWM CLI SHALL abort without writing and report the reason.
- **R13.1 — Preservación y poda:** WHEN the AWM CLI writes `~/.cursor/hooks.json`, THE AWM CLI SHALL back it up, preserve every non-AWM entry and remove dead or stale AWM entries.
- **R14 — Payload de inicio:** WHEN a Cursor session starts, THE Cursor session-start hook SHALL emit `{"additional_context": ...}` with `using-awm`, the project constitution and the active plan/ledger state, reading the project root from `CURSOR_PROJECT_DIR`.
- **R14.1 — Foto marcada:** THE session-start payload SHALL label its dynamic state as a snapshot taken at session start and direct the agent to re-read the plan for current state.
- **R14.2 — Sin repetición de portadores estáticos:** IF the project `AGENTS.md` managed block already contains `using-awm`, THEN THE Cursor session-start hook SHALL omit `using-awm` from its payload.
- **R14.3 — Fail-open:** IF any probe inside the hook fails or exceeds its timeout, THEN THE hook SHALL omit that section and still exit 0 with valid JSON.
- **R15 — Supresión del hook de Claude:** WHILE the Claude Code `session-start` hook runs with `CURSOR_VERSION` set AND `~/.awm/hooks/cursor/session-start` exists, THE Claude Code hook SHALL emit no context.
- **R16 — Re-anclaje diferido:** WHEN Cursor fires `preCompact`, THE Cursor integration SHALL write a compaction marker and record the compaction in the ledger, and on the next `postToolUse` SHALL inject the current dynamic state once via `additional_context` and delete the marker.
- **R16.1 — Costo nulo sin compactación:** WHILE no compaction marker exists, THE `postToolUse` hook SHALL exit without output.
- **R16.2 — Degradación:** IF real-Cursor verification shows that `postToolUse` `additional_context` is not delivered to the model, or the no-marker path of the `postToolUse` hook exceeds 50 ms at p95 over 100 measured invocations, THEN THE implementation SHALL remove the `preCompact`/`postToolUse` entries and the support matrix SHALL mark compaction re-anchor as unsupported by the provider.
- **R17 — Heartbeat:** WHEN the Cursor session-start hook runs, THE hook SHALL write `heartbeat.json` (`{hash, ts}`) next to the installed script.
- **R17.1 — Estado:** THE AWM diagnostics SHALL report the Cursor hook as `pending-first-run` without a heartbeat, `stale` when the heartbeat hash differs from the installed script, and `healthy` otherwise.
- **R18 — Tier:** THE Cursor provider SHALL be classified `hooks-native` once `hooks` is declared.
- **R19 — Doctor:** THE `awm doctor` output for Cursor SHALL report global skills, native agents, hook state, context carrier and an informational duplicate-delivery check.
- **R20 — Orden de release:** THE registry SHALL publish the Cursor hook scripts under a version tag before the CLI release that installs them declares that version as its minimum.

### Capa 3 — Ejecución (forma vigente, sin routing)

- **R21 — Admisión interactiva:** WHEN `awm plan admit --provider cursor` runs in `interactivo` mode on a valid plan with the verified evidence of R26, THE AWM CLI SHALL admit with the same gates applied to Claude Code and Codex.
- **R22 — Admisión desatendida nativa:** WHEN `awm plan admit --provider cursor --execution-mode desatendido --controller-autonomy approval-free` runs on a `compact-slices/v1` plan with no journal on its branch, THE AWM CLI SHALL admit with `journal: "not-required"`.
- **R22.1 — Postura obligatoria:** IF unattended admission for Cursor lacks a declared controller autonomy posture, THEN THE AWM CLI SHALL block with `ADMISSION_CONTROLLER_AUTONOMY_REQUIRED`.
- **R23 — Custodia opt-in:** WHERE a branch has opted into durable custody, THE `awm watch --provider cursor` supervisor SHALL launch the Cursor controller through a `ControllerAdapter` whose `approval-free` flags are taken from the real `agent --help` output.
- **R24 — Sin ternarios por provider:** THE adapter selection and autonomy-mapping lookup SHALL read a per-provider table that a structural test proves covers every watch-capable provider.
- **R25 — Routing excluido:** WHILE the R2 line remains paused, THE Cursor provider SHALL keep `modelOverride`, `effortOverride` and `observedModelEvidence` as `unverified`, and a `compact-slices/v2` plan on Cursor SHALL block with the existing routing diagnostics.
- **R26 — Evidencia del binario:** THE implementation SHALL NOT set any Cursor execution capability to `supported`, nor declare a Cursor `versionCommand` or autonomy flag, without a run of the real `agent` binary that shows the corresponding behavior, recorded as a playbook under `docs/testing/` in this repository.
- **R26.1 — Degradación honesta:** IF the discovery run cannot confirm a Cursor execution fact, THEN THE corresponding capability SHALL remain `unverified` and admission SHALL block with the existing diagnostic.

## 1. Contexto y propósito

AWM soporta hoy Claude Code y Codex con paridad de proceso (skills, agentes nativos, hook `SessionStart` con re-anclaje y diagnóstico). Cursor existe como `AgentTarget`, pero modelado sobre un contrato viejo: skills renderizadas a `.mdc` en `~/.cursor/rules`, sin agentes, sin hooks y solo con `AGENTS.md` de proyecto. Cursor ya no depende de ese camino: su skill incorporado `/migrate-to-skills` convierte exactamente el formato que AWM genera.

El objetivo es paridad de comportamiento, no implementación idéntica, en un sistema **compartido**: cada usuario puede tener cualquier combinación de providers. Dos restricciones gobiernan todo el diseño:

1. **Autosuficiencia (R1, R2):** Cursor funciona aunque Claude y Codex no existan en la máquina.
2. **Unicidad y tokens (R3–R5):** cuando existen, nada se entrega dos veces. El costo en tokens es prioridad de diseño.

## 2. Contrato de Cursor confirmado

Fuentes: `cursor.com/docs` (Skills, Hooks, Third Party Hooks, Subagents, Rules, CLI parameters/configuration/installation), consultadas el 2026-09-26, más observación directa de una sesión de Cursor IDE en la máquina del dueño.

| Capacidad | Contrato |
|---|---|
| Skills (usuario) | `~/.agents/skills/`, `~/.cursor/skills/`; compatibilidad: `~/.claude/skills/`, `~/.codex/skills/` |
| Skills (proyecto) | `.agents/skills/`, `.cursor/skills/` (también anidados); compatibilidad: `.claude/skills/`, `.codex/skills/` |
| Deduplicación de skills | Observado: mismo nombre en `~/.claude/skills` y `~/.agents/skills` (mismo destino de symlink) se lista una vez. No documentado. |
| Sync a Cloud Agents | Solo `~/.cursor/skills/` |
| Agents | `~/.cursor/agents`, `.cursor/agents`; compatibilidad `.claude/agents`, `.codex/agents`. `.cursor/` gana por nombre. |
| Frontmatter de agent | `name`, `description`, `model` (default `inherit`), `readonly`, `is_background` |
| Rules | `.cursor/rules/*.mdc` sigue soportado. User Rules viven en la app, no en archivo. |
| AGENTS.md | Raíz y subdirectorios del proyecto. Sin equivalente global. |
| Hooks de usuario | `~/.cursor/hooks.json`, `version: 1`, comandos relativos a `~/.cursor/`. Sin paso de aprobación. |
| `sessionStart` | Input `{session_id, is_background_agent, composer_mode}`; output `{env, additional_context}`. Fire-and-forget. Solo conversaciones nuevas. |
| `preCompact` | Observacional; output solo `user_message`. |
| `postToolUse` | Output `additional_context`. |
| Env en hooks | `CURSOR_PROJECT_DIR`, `CURSOR_VERSION`, `CURSOR_TRANSCRIPT_PATH`, `CLAUDE_PROJECT_DIR` |
| Hooks de terceros | Ejecuta `~/.claude/settings.json` (activado por defecto), mapea `SessionStart`→`sessionStart`, acepta `hookSpecificOutput`. |
| Config home | `CURSOR_CONFIG_DIR` solo reubica `cli-config.json`; no se usa como override (D-011). |
| CLI | Binario `agent` (alias `cursor-agent`), instalado en `~/.local/bin`, que el instalador pide agregar al `PATH`. `-p`, `--output-format text|json|stream-json`, `--resume [chatId]`, `--continue`, `--model`, `-f/--force` (alias `--yolo`), `--auto-review`, `--sandbox enabled|disabled`, `--trust`, `--workspace`. Evidencia: `agent --help` real, versión `2026.09.26-dd393fe`, capturada el 2026-09-28. |
| Versión del CLI | Formato por fecha `AAAA.MM.DD-<hash>`, no semver. `compareSemver` lo ordena correctamente como `[AAAA, M, D]`. |

## 3. Enfoque arquitectónico

Se extienden las fronteras existentes; no se agregan condicionales `agent === 'cursor'` en los handlers de comandos.

| Componente | Cambio |
|---|---|
| `ProviderConfig` (`cli/src/providers/index.ts`) | Cursor: skills `~/.agents/skills` / `.agents/skills` con `link`; agents `~/.cursor/agents` / `.cursor/agents`; `hooks: { type: 'cursor-hooks-json', ... }`. |
| Renderers (`cli/src/core/renderers/`) | `cursor-mdc` deja de ser el renderer de skills de Cursor; se conserva solo para leer/migrar instalaciones previas. |
| `InstallPlanner` | Sin cambios de lógica: Cursor entra al grupo compartido por igualdad de directorio. |
| Hooks (`cli/src/commands/hooks/`) | Nuevo adapter `cursor.ts` (install/status/uninstall/resync) sobre el patrón de `codex.ts`. |
| Contexto (`cli/src/core/context/`) | La guía de proyecto de Cursor pasa a `PROJECT_GUIDANCE`; el contexto global lo entrega el hook. |
| Diagnóstico (`cli/src/core/diagnostics/`) | Checks de Cursor, estado `pending-first-run`, check informativo de duplicación. |
| Registry (`awm-baseline-registry/hooks/`) | `cursor-session-start`, `cursor-post-tool-use`/`cursor-pre-compact`, guarda en `session-start`. |
| Admisión y controller (`cli/src/core/admission/`, `cli/src/core/journal/adapter.ts`) | Fila Cursor de capacidades de ejecución condicionada a evidencia; `cursorAdapter`; selección de adapter por tabla (§7.1). |

## 4. Capa 1 — Artefactos y contexto

### 4.1 Skills

Cursor lee `~/.agents/skills` de forma nativa, así que se une al dominio compartido de Codex y OpenCode (R6, R7). Consecuencias:

- Con solo Cursor habilitado, AWM escribe `~/.agents/skills` (R1).
- Con Codex u OpenCode habilitados, es la misma operación física (R15 del diseño Codex).
- Con Claude habilitado, `~/.claude/skills` también existe; Cursor lo deduplica por nombre (observado). No es un canal del que Cursor dependa (R2).

Se descartó `~/.cursor/skills`: triplicaría entradas con Claude y Codex habilitados y la sincronización a Cloud Agents de symlinks hacia `~/.awm/registries` no está verificada. Cloud Agents se tratan en §8.

### 4.2 Migración de `.mdc`

Los `.mdc` que `cursor-mdc` instaló están en el registro de artefactos gestionados. La reconciliación de `awm update` / `awm init` instala primero el `SKILL.md` y luego elimina solo esos registros (R8). Un `.mdc` no registrado nunca se toca (R8.1). `awm.mdc` no es un skill y no entra en la migración (R11).

### 4.3 Agents

El agente canónico (`agents/development-process.md`) ya lo carga Cursor desde `~/.claude/agents` en la máquina del dueño, con su clave extra `mode` ignorada. Se instala con `link` en `~/.cursor/agents` (R9). La precedencia de `.cursor/` evita la doble entrada con las copias de Claude/Codex. La verificación confirma que Cursor tolera claves desconocidas; si no, se agrega un renderer que emite solo `name`/`description`/cuerpo.

### 4.4 Contexto

| Portador | Contenido | Rol |
|---|---|---|
| Hook `sessionStart` | `using-awm` + constitución + foto del plan/ledger | Único portador global (R14) |
| `AGENTS.md` (bloque gestionado) | `PROJECT_GUIDANCE` (3 líneas) | Guía de proyecto (R10) |
| `.cursor/rules/awm.mdc` | `PROJECT_GUIDANCE` | Carrier versionado para modos que no leen AGENTS.md (R11) |

Si otro provider (Copilot) ya dejó `using-awm` completo en el bloque de `AGENTS.md`, el hook lo detecta y lo omite (R14.2). `PROJECT_GUIDANCE` llega por dos portadores en el modo interactivo; es la única excepción aceptada (R5.1), porque cuesta unos 60 tokens y mantiene el portador versionado que necesitarán los Cloud Agents. Estimación en la máquina del dueño: de hasta ~3k tokens por request por concepto de `using-awm` a ~1k.

## 5. Capa 2 — Hooks

### 5.1 Instalación

`cursor-hooks-json` escribe en `~/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "<AWM_HOME>/hooks/cursor/session-start" }],
    "preCompact":   [{ "command": "<AWM_HOME>/hooks/cursor/pre-compact" }],
    "postToolUse":  [{ "command": "<AWM_HOME>/hooks/cursor/post-tool-use" }]
  }
}
```

Rutas absolutas, sin matcher. Merge, backup y poda según R12–R13.1, con la misma lógica de entradas muertas/viejas que `codex.ts`.

### 5.2 Scripts del registry

- `cursor-session-start`: mismo contrato funcional que `codex-session-start` (constitución, plan, ledger, heartbeat), con tres diferencias: raíz desde `CURSOR_PROJECT_DIR`, salida plana `additional_context`, evento siempre `startup`. Un test de paridad corre ambos sobre el mismo fixture adversarial (CONSTITUTION del registry).
- `cursor-pre-compact`: escribe el marcador por proyecto bajo `~/.awm/hooks/cursor/` y registra la compactación en el ledger. Sin salida.
- `cursor-post-tool-use`: si no hay marcador, sale sin salida (R16.1); si hay, emite el estado dinámico una vez y borra el marcador. Implementación mínima para cumplir un presupuesto de latencia medido.
- `session-start` (Claude): guarda de supresión (R15).

### 5.3 Límites y degradación

- Sin re-anclaje en `/clear`: Cursor no expone el evento. `/clear` abre conversación nueva y dispara `sessionStart`.
- El re-anclaje diferido depende de verificar en Cursor real que `postToolUse.additional_context` llega al modelo y de medir la latencia. Si falla, R16.2.
- Windows: verificar cómo Cursor ejecuta scripts sin shebang; si no, wrapper `.cmd` como el de Claude.

### 5.4 Diagnóstico

Estados del hook: `NOT_INSTALLED`, `pending-first-run`, `stale`, `healthy` (R17.1). Cursor no pide aprobación de hooks de usuario, por eso no se usa `pending-trust`. El check de duplicación es informativo: reporta cuando Claude está habilitado y las importaciones de terceros de Cursor podrían entregar contenido redundante, con el remedio exacto.

## 6. Verificación

- Unit y estructurales con `HOME`/`AWM_HOME` aislados (CLAUDE.md).
- Gate de subconjuntos R3.1.
- Matriz de soporte regenerada (`npm run docs:matrix`).
- Verificación en Cursor real, registrada como playbook, de: deduplicación de skills en modo copia (Windows), tolerancia de `mode` en agents, disparo del hook de Claude dentro de Cursor, entrega de `postToolUse.additional_context` y latencia, persistencia de `additional_context` de `sessionStart` tras compactar.
- Hasta tener esa evidencia, la matriz marca la entrega de contexto de Cursor como `⚠ Unverified`.

## 7. Capa 3 — Ejecución

La capa 3 se divide en dos. La ejecución (interactiva y desatendida) entra en esta entrega **en su forma funcional vigente** (CLI 9.14.0, #204). El routing de modelo/esfuerzo queda fuera, bajo la pausa de R2.

### 7.1 Incluido: ejecución interactiva y desatendida en su forma vigente

Forma vigente, idéntica a la de Claude Code y Codex:

- **Sesión nativa (default de `proveedor-nativo` / `compact-slices/v1`).** Sin journal en la rama, `awm plan admit --execution-mode desatendido` admite con `journal: "not-required"` y el trabajo corre en una sola sesión del provider, que despacha sus propios subagentes y corre su verificación. Exige postura de autonomía declarada (`--controller-autonomy approval-free`) y todos los demás gates.
- **Custodia durable (opt-in).** `awm watch --init --plan` activa supervisor, journal y jobs; el supervisor lanza el controller a través de un `ControllerAdapter` por provider.

Cambios necesarios para Cursor:

| Pieza | Hoy | Cambio |
|---|---|---|
| `PROVIDER_EXECUTION_CAPABILITIES.cursor` (`cli/src/core/admission/index.ts`) | todo `unverified` → admisión bloquea con `ADMISSION_CAPABILITY_UNVERIFIED` | `interactiveExecution`, `unattendedController`, `durableResume` a `supported` **solo** con la evidencia de R26 |
| `ControllerAdapter` (`cli/src/core/journal/adapter.ts`) | solo `codex`, `claude-code`; `WATCH_PROVIDERS` cerrado a esos dos | `cursorAdapter`: `['agent', ...(approval-free ? ['--force', '--trust'] : []), '-p', <prompt>]`. Flags confirmadas en `agent --help` 2026.09.26; `autonomyMapping: 'verified'` solo después de que la corrida de R26 muestre que una sesión `-p` con esas flags no se detiene pidiendo aprobación |
| Selección de adapter y mapeo de postura | ternarios `codex`/`claude-code` en `adapterFor`, `controllerAutonomyMapping` y `ControllerAdapter.provider` | tabla por provider en vez de ternarios; test de exhaustividad |
| Versión del binario (`providers/index.ts`) | Cursor sin `versionCommand` | `{ command: 'agent', args: ['--version'], versionPattern: /^(\d{4}\.\d{2}\.\d{2})-[0-9a-f]+$/ }`, `minimumVersion: '2026.09.26'` |

`agent` se resuelve por `PATH`, igual que `codex` y `claude`. No se codifica `~/.local/bin`: si el binario no está en el `PATH` del proceso, el probe de versión reporta el error existente "not installed or not available on PATH", y `awm doctor` lo muestra con el remedio del instalador. `--auto-review` no se mapea a ninguna postura: `ControllerAutonomy` solo admite grados medidos (#168).

Fuera de esta entrega aunque viva en la misma área: los defectos de custodia durable independientes del provider ([#196](https://github.com/Kodria/agentic-workflow/issues/196), [#170](https://github.com/Kodria/agentic-workflow/issues/170), [#179](https://github.com/Kodria/agentic-workflow/issues/179)) siguen pausados. Cursor hereda el comportamiento vigente de la custodia opt-in, con sus mismos límites, sin arreglarlos ni empeorarlos.

### 7.2 Excluido: routing de modelo/esfuerzo (R2 pausada)

El routing es la fila Cursor de la línea R2, en pausa (`blocked`) por decisión del dueño desde el 2026-09-26 sin gastar cuota sin autorización explícita ([#126](https://github.com/Kodria/agentic-workflow/issues/126), [#157](https://github.com/Kodria/agentic-workflow/issues/157)). El contrato de R2 ya enumera a Cursor (RNF-T.1 en `2026-09-14-compact-only-unattended-execution-design.md`; `2026-09-17-r2b-routing-contract.md`).

Esta entrega no toca `model-policy`, `capabilities-v2`, `native-routing-observe`, `local-event-scope` ni la admisión `compact-slices/v2`. `modelOverride`, `effortOverride` y `observedModelEvidence` de Cursor quedan `unverified`, así que un plan `awm-routed` sobre Cursor sigue bloqueado con el diagnóstico vigente.

Insumo registrado para cuando se levante la pausa: `--model`, agents `awm-*` con `model:` en frontmatter, `subagent_model` en los inputs de `subagentStart`/`subagentStop`, y que Cursor puede sustituir el modelo declarado (la declaración nunca certifica). La fila Cursor se incorpora al plan de R2, no a un plan paralelo.

### 7.3 Dependencia de evidencia

Nada de §7.1 se declara `supported` sin ejecutar el binario real (misma regla que la tabla R1 y la evidencia de `claude --help` en `adapter.ts`). `agent` 2026.09.26 ya está instalado en la máquina del dueño y `--help`/`--version` están capturados (§2). Falta, como paso de descubrimiento del plan después de las capas 1–2: una sesión `-p --force --trust` acotada que muestre que no se detiene pidiendo aprobación, que lee `~/.agents/skills` y ejecuta `~/.cursor/hooks.json` desde el CLI, y que `--resume` retoma. Si algún hecho no se confirma, la capacidad queda `unverified` y la admisión bloquea con el diagnóstico vigente, nunca con una flag inventada.

## 8. Fuera de alcance, con restricción de diseño

- **Cloud Agents de Cursor.** Se abordan en una sesión específica. Restricción vigente: nada de esta entrega puede impedirlos. Hechos que esa sesión debe resolver: Cloud Agents no ejecutan hooks de usuario, solo sincronizan `~/.cursor/skills` y no leen `~/.agents/skills`; el portador versionado `.cursor/rules/awm.mdc` se conserva por eso.
- **`cli/AGENTS.md` de este repo.** Bloque viejo (~2k tokens, `using-awm` 1.2.2) que Cursor carga como AGENTS.md anidado. Limpieza separada.

## 9. Traspaso de sesión (estado al 2026-09-28)

Diseño aprobado completo por el dueño. Siguiente fase: `writing-plans`, con modo de despacho `proveedor-nativo` (`compact-slices/v1`) y modo de ejecución `interactivo`, porque el dueño no eligió `awm-routed` ni desatendido.

Descomposición en planes (un plan por subsistema/repositorio, en orden de dependencia):

1. **Plan A — registry** (en `awm-baseline-registry`, rama propia desde `origin/main`, que está 14 commits por delante del checkout local; el checkout tiene `skills/ui-ux-pro-max/scripts/__pycache__/` sin trackear que no se toca): `hooks/cursor-session-start`, `hooks/cursor-pre-compact`, `hooks/cursor-post-tool-use`, guarda R15 en `hooks/session-start`, test de paridad con `codex-session-start`. Requisitos: R5 (lado hook), R14–R14.3, R15, R16–R16.1, R17, R20. Se publica con tag antes del Plan B.
2. **Plan B — CLI capas 1–2** (este repo, esta rama): provider Cursor, migración `.mdc`, agents, `PROJECT_GUIDANCE`, adapter `cursor-hooks-json`, doctor, context-budget, gate de subconjuntos, matriz de soporte. Requisitos: R1–R13.1, R16.2 (lado CLI), R17.1–R19, R5 (lado CLI).
3. **Plan C — CLI capa 3** (este repo, después del Plan B y del paso de descubrimiento con `agent -p --force --trust`, que consume cuota): capacidades de ejecución, `cursorAdapter`, tabla de adapters, `versionCommand`. Requisitos: R21–R26.1.

**Estado de los planes (2026-09-29):**

- **Plan A publicado:** `awm-baseline-registry` tag `v4.9.0` (`7112430` on `main`), plan `docs/plans/2026-09-28-cursor-hooks-plan.md`, PR #71 merged 2026-09-29.
- **Contrato que Plan A fija para Plan B:**
  - El CLI copia `hooks/cursor-session-start`, `hooks/cursor-pre-compact` y `hooks/cursor-post-tool-use` a `<AWM_HOME>/hooks/cursor/` con los nombres `session-start`, `pre-compact` y `post-tool-use`.
  - El adapter de Cursor escribe el `using-awm` compuesto en `<AWM_HOME>/hooks/cursor/using-awm.md`. No se reutiliza el de Claude (R1).
  - El heartbeat es `heartbeat.json` junto al script instalado (`{version, hash, ts, event:"sessionStart"}`).
  - El estado de runtime vive en `<AWM_HOME>/hooks/cursor/state/`.
  - `post-tool-use` ejecuta `session-start --reanchor`.
  - El benchmark `npm run bench:cursor-hooks` del registry entrega el p95 para la decisión de R16.2.
- **Plan B:** publicado CLI `v9.15.0` (#206).
- **Camino B / custodia durable:** suspendido para todos los providers en CLI `v9.15.1` (#207, D-023) hasta retomar routing/custody.
- **Plan C (reducido, 2026-09-29):** `docs/plans/2026-09-29-cursor-plan-c-native-admit.md` — admisión nativa interactiva + desatendida v1 sin journal; `versionCommand` de `agent`; evidencia en `docs/testing/cursor-execution-evidence.md`. **Fuera:** R23–R24 (`cursorAdapter` / `WATCH_PROVIDERS`) mientras D-023 esté vigente; `durableResume` y routing siguen `unverified`.
- **Hallazgo de proceso (2026-09-28, ledger `unattended-requires-in-provider-session`):** desatendido = la sesión ya abierta del proveedor, con postura approval-free, despachando sus propios subagentes. **No** lanzar `claude --bg` / CLI headless desde otro agente (p. ej. Cursor). Esa forma se detiene en prompts de autorización (visto en Plan A `e1e5a159`: cleanup `rm -rf` tmp) que el lanzador no ve; el ciclo queda colgado en silencio. En futuras ocasiones ejecutar Plan A/B/C desatendido *dentro* del proveedor admitido.


Hechos no verificados que cada plan debe cerrar con evidencia o degradar (§6, §7.3): deduplicación de skills en modo copia, tolerancia de `mode` en agents, disparo del hook de Claude en Cursor, entrega y latencia de `postToolUse.additional_context`, persistencia de `additional_context` tras compactar, ejecución de hooks y lectura de skills desde `agent`, ejecución de scripts sin shebang en Windows.
