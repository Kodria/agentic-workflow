# Diseño — `awm init` (Sub-fase 1d)
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

- **Fecha**: 2026-06-04
- **Estado**: Aprobado (brainstorming)
- **Rama**: `feature/improvements-r3` (continúa sobre 1a/1b/1c en `main`)
- **Design paraguas**: [`2026-06-02-harness-bundles-activation-design.md`](2026-06-02-harness-bundles-activation-design.md) §7.3/§7.4/§10/§12
- **Spec previa reusada**: [`2026-06-04-awm-doctor-design.md`](2026-06-04-awm-doctor-design.md) (motor de diagnóstico de 1c)

## 1. Objetivo

Entregar `awm init`: el orquestador único, context-aware e **idempotente** que deja el harness en estado conocido-bueno. Detecta el contexto (máquina + proyecto), aplica los pasos de setup que faltan reutilizando el **motor de diagnóstico de 1c** (`gatherContext → runChecks → CheckReport`) sin refactorizarlo, ejecuta los remedios accionables (`Remedy.kind==='command'`) y **solo señala** los que requieren un agente (`kind==='skill'`).

Cierra la Fase 1 del release de bundles (1a estructura, 1b activación, 1c doctor, **1d init**).

## 2. Principio rector

El `Remedy` de un `CheckResult` es una **pista para el usuario**, no una tabla de despacho para init. Varios remedios son literalmente `awm init` (cache, hook, dev-core, profile ausentes) — init no puede "ejecutar `awm init`" sobre sí mismo. Por eso init **no ejecuta remedy strings**: posee su propia lista ordenada de pasos (§7.3 del paraguas), y cada paso lee el `status` del report para decidir si actúa o salta. El mapeo es **paso→acción**, no remedy→acción.

Enfoque elegido (descartados B "ejecutor dirigido por remedios" y C "init procedural monolítico"): **pasos ordenados nativos que consultan el report**, con la orquestación **pura respecto de la UI** (interactividad inyectada por callbacks). Espeja la disciplina de 1c: `runChecks` puro, I/O aislada en `context.ts`.

## 3. Arquitectura y componentes

```
commands/init.ts          (RENDER + CLI)  ── registerInitCommand, runInit; prompts @clack; render final reusa doctor.renderReport
   │ orquesta (inyectando callbacks de UI)
core/init/                 (nuevo subdir — orquestación pura, SIN @clack)
   ├── orchestrator.ts     ── runInitSteps(deps) → InitOutcome
   ├── steps.ts            ── los 7 pasos CLI + 2 señalados (constitution, context)
   └── detector.ts         ── detectExtensions(root) → DetectionResult (reglas §7.4)
core/diagnostics/          (1c — contratos SIN CAMBIOS)
   ├── context.ts  gatherContext()   ← reusado tal cual
   ├── checks.ts   runChecks()       ← reusado; único cambio: etiqueta de project.context (ver §8)
   └── types.ts                      ← reusado
```

| Unidad | Propósito | Depende de |
|---|---|---|
| **detector** (`core/init/detector.ts`) | Reglas repo→extensiones propuestas (§7.4). Pura: `(root) → DetectionResult`. No escribe. | filesystem proyecto |
| **steps** (`core/init/steps.ts`) | Un descriptor por paso `{ id, level, run(deps) → StepResult }`. `run` hace check-then-act llamando a funciones puras existentes | diagnostics report, installHook, installBundle, addBundle, syncProfile, initSensors, profile, detector |
| **orchestrator** (`core/init/orchestrator.ts`) | Corre los pasos en orden, recolecta `StepResult[]`, produce `InitOutcome` (before/after, contadores). Pide decisiones vía callbacks inyectados | steps |
| **command** (`commands/init.ts`) | CLI + `@clack` (inyecta callbacks de confirmación) + render final reusando `renderReport` de doctor | orchestrator, doctor.renderReport |

**Aislamiento clave:** orchestrator/steps **no importan `@clack`**. La interactividad se inyecta como callbacks (`confirmExtensions(proposed) → string[]`). Así los pasos se testean sin TTY, y `--yes` es "callbacks que aceptan el default".

## 4. Decisión de cache (unificación)

Hoy existen **dos clones del mismo repo** en `~/.awm`:

| Cache | Lo usa | Para qué |
|---|---|---|
| `~/.awm/registry` | `syncRegistry` (`add/sync/list/update`) + `bundles.ts` (`REGISTRY_CONTENT_DIR = ~/.awm/registry/registry`) | Fuente de skills/bundles |
| `~/.awm/cli-source` | `hooks install` (`DEFAULT_REGISTRY_ROOT`) + `diagnostics/context.ts` (`machine.cli`) | Versión + git status del CLI |

Consecuencia: `awm update` hace `git pull` sobre `registry` pero **no** sobre `cli-source` — el cache que `doctor` inspecciona para `machine.cli` nunca se refresca.

**Decisión: unificar a `~/.awm/cli-source` como cache canónico único.**
- `syncRegistry` clona/pull `~/.awm/cli-source`.
- `REGISTRY_CONTENT_DIR` pasa a `~/.awm/cli-source/registry`.
- `~/.awm/registry` se **deprecia** (ya no se lee ni escribe; init no lo migra activamente, solo deja de usarlo).
- El motor de 1c (`context.ts`) ya apunta a `cli-source`: queda consistente sin tocarlo.

Esto convierte el paso `cache` de init en la fuente única de verdad y hace que `machine.cli` de doctor sea significativo (`awm update`/`init` lo refrescan).

> Nota: la migración de `registry.ts`/`bundles.ts` al path unificado es parte de 1d (paso de plan), no un refactor aparte.

## 5. Los pasos de init (mapeo paso→acción)

`StepResult.action ∈ {applied, skipped, pending, failed}`. Cada paso lee su hecho del `CheckReport` BEFORE.

**Nivel máquina (siempre):**

| # | `id` | Lee del report | Si ✔ | Si ✖/⚠ → acción | Función reusada |
|---|---|---|---|---|---|
| 1 | `cache` | `machine.cli.present` | skipped | clona/pull `~/.awm/cli-source` | `syncRegistry` (path unificado) |
| 2 | `hook` | `machine.hook` | skipped | instala/repara entrada SessionStart | `installHook({agent, registryRoot: cli-source})` |
| 3 | `devCore` | `machine.devCore` | skipped | symlinkea baseline global (incl. links rotos) | `installBundle(baseline, global)` |
| 4 | `ambient` | `machine.ambient.wanted/installed` | skipped | instala los `wanted` faltantes | `addBundle(b, global)` por bundle |

**Nivel proyecto (solo si `ctx.project !== null`):**

| # | `id` | Lee | Si ✔ | Si ✖/⚠ → acción | Reusa |
|---|---|---|---|---|---|
| 5 | `profile` | `project.profile` + detector | profile con exts y sin señales nuevas → skipped | `detectExtensions(root)` → **callback `confirmExtensions`** → `addExtension` por confirmada | detector, `addExtension` |
| 6 | `activation` | `project.activeBundles` (expected/linked/broken) | skipped | materializa symlinks locales faltantes/rotos | `syncProfile(root, local)` |
| 7 | `sensors` | `project.sensors.present` | skipped | `.awm/sensors.json` + config del pack | `initSensors({cwd: root, registryRoot})` |
| 8 | `constitution` | `project.constitution.present` | skipped | **señala** `pending → skill: project-constitution` | — (nunca ejecuta) |
| 9 | `context` | `project.context.present` | skipped | **señala** `pending → skill: project-context-init` | — (nunca ejecuta) |

**Reglas que lo hacen robusto:**

- **Frontera CLI↔agente literal:** pasos 8-9 producen `action: 'pending'` con el nombre exacto de la skill; init nunca redacta esos artefactos (coincide con `Remedy.kind==='skill'`).
- **Orden:** cache(1) antes que hook/devCore (necesitan cache poblado); profile(5) antes que activation(6) (sync lee el profile recién escrito).
- **Paso 5 es el único que pregunta.** Si el detector no propone nada nuevo → no pregunta. Con `--yes` → acepta todas las propuestas.
- **Sensores automático:** init corre `initSensors` cuando falta `sensors.json` (idempotente, mergea, no destructivo) — no lo propone como las extensiones.
- **Ambient fiel a D6:** init solo materializa los `wanted` de `~/.awm/config.json`; **no ofrece** instalar `personal-notion` la primera vez (declarar un ambient es trabajo de `awm add`). Si `config.json` no existe → `wanted=[]` → no hace nada.
- **`failed` no aborta:** un paso que falla (ej. red en cache) se registra `failed` con el error; init continúa con los pasos independientes. El render final lo muestra en rojo.

## 6. El detector (`core/init/detector.ts`)

```typescript
export interface DetectionResult {
    proposed: string[];   // bundles 'project' detectados que existen en el registry
    signals: string[];    // evidencia legible: ['next (package.json)', 'docs/ (mkdocs.yml)']
    deferred: string[];   // señales sin bundle aún: ['infra (Fase futura)']
}
export function detectExtensions(root: string): DetectionResult;
```

**Reglas (§7.4), en orden:**

| Señal en el repo | Resultado |
|---|---|
| `next`/`react`/`vue`/`astro`/`svelte` en `dependencies`/`devDependencies`, o dirs `pages/`,`app/`,`landing/` | `proposed += 'frontend'` |
| `mkdocs.yml`/`docusaurus.config.*`, **o** `docs/` con contenido real (≥2 `.md` más allá de un README suelto) | `proposed += 'docs'` |
| solo `express`/`fastify`/`nest` sin marcador frontend | nada (dev-core baseline basta) |
| `Dockerfile`/`*.k8s.yaml`/`helm/`/`terraform/` | `deferred += 'infra'` (regla extensible; no hay bundle infra aún) |

**Decisiones:**
- **Solo propone bundles que existen** (`scope: 'project'`). Reglas que apuntan a un bundle ausente (infra) van a `deferred`: se **informan** pero nunca se ofrecen activar.
- **No re-propone lo ya activo:** el paso 5 filtra `proposed` contra `profile.extensions` actuales → en un repo ya configurado no genera preguntas (clave para idempotencia interactiva).
- **Umbral de `docs/`:** un `docs/` con solo un README no propone `docs`; requiere config (mkdocs/docusaurus) o ≥2 `.md`.
- **Separado de `sensors/detectStack`:** `detectStack` clasifica `js-ts|python|generic` para el sensor-pack; `detectExtensions` mapea a bundles de skills. Conviven sin acoplarse.
- **Bootstrap, no continuo:** corre en cada `init`, pero por el filtro contra el profile su efecto solo aparece la primera vez o ante una señal nueva.

## 7. Idempotencia (garantía del §12)

**Por construcción**, en dos capas:
1. Cada paso hace **check-then-act** leyendo el report BEFORE: hecho ya ✔ → `skipped` sin tocar disco.
2. Las funciones subyacentes ya son idempotentes: `installHook`→`already-up-to-date`; `installBundle` re-symlinkea al mismo target (unlink+symlink); `addExtension` dedupe; `initSensors` mergea; `ensureSkillsGitignored` no re-agrega líneas.

**Observabilidad** — `InitOutcome`:
```typescript
export interface StepResult {
    id: string;
    level: 'machine' | 'project';
    action: 'applied' | 'skipped' | 'pending' | 'failed';
    detail?: string;
    error?: string;
}
export interface InitOutcome {
    steps: StepResult[];
    applied: number;   // pasos que cambiaron algo (excluye pending)
    pending: number;   // señalados (skill)
    failed: number;
    before: CheckReport;
    after: CheckReport; // re-gather tras actuar
}
```

**Prueba central:** run 1 sobre repo sintético → `applied > 0`; run 2 inmediato → **`applied === 0`** y `after` deep-equal al `after` del run 1.

**Sutilezas honestas (documentadas para que no se lean como violación):**
- Los pasos `pending` (constitution/context) **siempre** reportan `pending` en cada run — son señales, no cambios. `applied` los excluye, así que `applied===0` en run 2 se sostiene.
- El paso `cache` hace `git pull`: traer commits nuevos *es* un cambio legítimo del mundo externo. En el test el remoto es local y fijo → `skipped` en run 2. En producción "behind→updated" es `applied` la primera vez y `skipped` después (correcto).

## 8. Cambio acotado en 1c (etiqueta de contexto)

El check `project.context` ya acepta **CLAUDE.md _o_ AGENTS.md** (CLAUDE.md solo tiene prioridad de etiqueta), y el remedio `project-context-init` escribe **AGENTS.md** (estándar agents.md). Pero la etiqueta del caso ausente en `checks.ts` dice literalmente `"CLAUDE.md ausente"`, lo que se lee como si AGENTS.md no contara.

**Cambio:** la etiqueta ausente pasa a `"contexto del agente (CLAUDE.md/AGENTS.md) ausente"`. Es el único toque a 1c (QA cerrado), justificado porque init reusa ese render y debe ser honesto. Se actualiza el test de `checks.ts` correspondiente.

## 9. CLI, flags y salida

```
awm init [options]
  -y, --yes              Acepta todos los defaults (activa extensiones detectadas, sin prompts). CI-friendly.
  -a, --agent <agent>    Agente objetivo (default: preferencia guardada / claude-code).
      --machine-only     Solo nivel máquina; omite el proyecto aunque esté en un repo. (Escape hatch, no default.)
      --json             Emite InitOutcome como JSON (scripting/tests), sin prompts.
```

**Flujo de salida (BEFORE → Acciones → AFTER):**
```
AWM · init

  Estado inicial ───────────────
  [renderReport(before)]

  Acciones ─────────────────────
  ✔ cache              actualizado (git pull)
  ✔ hook SessionStart  instalado
  ✔ dev-core           3 symlinks creados
  ⤳ frontend           detectado (next) — ¿activar? › sí
  ✔ frontend activo    6 skills locales
  ✔ sensores           .awm/sensors.json (js-ts)
  ◷ CONSTITUTION.md    pendiente → skill: project-constitution
  ◷ contexto del agente pendiente → skill: project-context-init

  Estado final ─────────────────
  [renderReport(after)]

  estado: degradado · 2 pasos requieren un agente (skills arriba)
```

**Decisiones de salida:**
- **BEFORE→Acciones→AFTER** hace visible la idempotencia: en run 2 el bloque Acciones es todo `✔ … (sin cambios)` y BEFORE==AFTER.
- **Reusa `renderReport` de doctor** para los bloques de estado — cero duplicación; init solo agrega el bloque "Acciones".
- **Glifos:** `✔` applied/ok · `⤳` prompt de decisión · `◷` pending (skill) · `✖` failed.
- **Exit codes** (consistente con doctor): `0` sano · `1` degradado · `2` error interno. Un paso `failed` no es exit 2; se refleja en `after.overall`.
- **Cierre del loop con el agente:** los `◷ pending` son la señal para que la sesión ofrezca `project-constitution` / `project-context-init` — el handoff CLI→agente que pide D11.

## 10. Testing

| Archivo | Cubre |
|---|---|
| `tests/core/init/detector.test.ts` | reglas §7.4: next→frontend; `docs/` con 1 README → no propone; mkdocs/≥2 `.md` → docs; express→[]; Dockerfile→deferred; combinado→['frontend','docs'] |
| `tests/core/init/steps.test.ts` | cada paso aislado con report inyectado: skip si ✔ (spy no llamado); applied si ✖; constitution/context → `pending` + aserción negativa (no escriben archivo) |
| `tests/core/init/orchestrator.test.ts` | bare HOME (solo máquina); repo sintético (machine+project, pendings); **idempotencia** (run 2 → `applied===0`, `after` deep-equal); `failed` no aborta |
| `tests/commands/init.test.ts` | `runInit({yes:true})` exit code = `after.overall` (0/1); `--yes` sin prompts; render reusa `renderReport` |

**Cobertura del spec:** §7.3 pasos 1-10 → steps/orchestrator; §7.4 → detector; §12 idempotencia → orchestrator; frontera CLI↔agente → aserciones negativas constitution/context; §4 cache unificado → migración + paso `cache`.

## 11. Fuera de alcance

- Migración activa de datos de `~/.awm/registry` → `cli-source` (se deprecia, no se migra; un `init` reconstruye todo).
- Bundle `infra` y su regla de detección activa (solo `deferred`).
- Resolver de versiones / tags por bundle (Fase 2).
- Desacople multi-agente del bootstrap (Fase 3).

## 12. Componentes y límites (resumen de aislamiento)

| Unidad | Entrada | Salida | Efecto |
|---|---|---|---|
| `detectExtensions` | `root` | `DetectionResult` | ninguno (puro, solo lee) |
| `steps[].run` | `deps` (report, callbacks, paths) | `StepResult` | idempotente sobre disco |
| `runInitSteps` | `deps` | `InitOutcome` | orquesta; sin UI |
| `runInit` (command) | flags + cwd | exit code | render + prompts @clack |
