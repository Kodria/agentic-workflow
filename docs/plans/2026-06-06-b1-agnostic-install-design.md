# Body B-1 — Instalación/reparación agnóstica — Diseño
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

**Fecha:** 2026-06-06
**Origen:** Harness shakedown lab (`docs/harness-shakedown/`). Body B-1 agrupa los Hallazgos #1, #4, #5, #6.
**Rama:** `harness-b1-agnostic-install`

**Principio rector:** `awm init --agent <X>` debe dejar a `<X>` tan funcional como a Claude. Toda lectura de "salud de skills" y toda reparación deben apuntar al **agente target**, no a `claude-code` hardcodeado. El norte de producto es el desacople multi-agente.

**Alcance:** el plumbing de **install/repair/diagnóstico de skills** y la **entrega per-proyecto de `CONSTITUTION.md`** a agentes ≠ Claude. NO incluye el trinquete de aprendizaje (→ Body B-3, ya shippeado B-2).

---

## Hallazgo central revisado contra el código actual

El lab (corrido sobre un binario `1.0.0`) describió "tres mecanismos descoordinados" + un problema de prosa. La inspección del código **actual** (mismo `1.0.0` en repo y en `~/.awm/cli-source`) corrige el cuadro:

- El **install** ya es agnóstico (`stepDevCore`/`installBundle({ agents:[d.agent] })` instala al agente target).
- Lo que **no** es agnóstico son **dos diagnósticos + una reparación**, los tres con `PROVIDERS['claude-code'].skill.global` hardcodeado. Esa es la causa raíz única.
- **#5 se desinfla:** la "fuga" a `~/.claude` que vio el lab fue consecuencia directa de #4 (symlinks de OpenCode rotos + reparación Claude-only). Con #4 arreglado, los symlinks de OpenCode se reparan, todas las skills resuelven desde `~/.agents/skills`, y el modelo deja de salir a buscar. Queda solo la mitad independiente: des-Claude-izar la prosa.
- La inyección de contexto **no** menciona `.claude` (verificado: `using-awm/SKILL.md` limpio). El awm-context es agnóstico.

**Evidencia (código actual):**

| Lugar | Hardcode |
|---|---|
| `cli/src/core/diagnostics/context.ts` (`gatherMachine`) | `const skillsDir = PROVIDERS['claude-code'].skill.global` — calcula `devCore`/`globalSkills` siempre contra `~/.claude/skills`. |
| `cli/src/core/init/steps.ts:141` (`stepGlobalSkillsRepair`) | `PROVIDERS['claude-code'].skill.global` — repara solo `~/.claude/skills`. |
| `cli/src/index.ts` (`awm update`) | mismo hardcode en el endurecimiento. |
| `registry/skills/writing-skills/SKILL.md` | prosa "`~/.claude/skills` for Claude Code, `~/.agents/skills/` for Codex". |
| `registry/skills/project-constitution/SKILL.md` | menciona `~/.claude/settings.json` (legítimamente Claude-specific: ahí vive el hook). |

---

## Unidad 1 — Diagnóstico de skills agnóstico (#4a) · *el linchpin*

**Dónde:** `cli/src/core/diagnostics/context.ts` (`gatherMachine`).

`gatherMachine` calcula `devCore` (presencia del bundle baseline) y `globalSkills` (symlinks rotos/muertos) siempre contra `~/.claude/skills`. Si Claude está sano, reporta "todo sano" aunque el agente target sea OpenCode → la reparación (Unidad 2) nunca dispara y el install se skipea por el guard de `stepDevCore`.

**Fix:** threadear el agente target a `gatherMachine` y calcular contra `PROVIDERS[agent].skill.global`.

**Puntos de diseño:**
- `gatherMachine` hoy no recibe el agente; hay que pasárselo desde el flujo de init (`d.agent`) hasta la construcción del snapshot machine.
- `computeHookStatus('claude-code')` se queda Claude-específico: OpenCode no usa hooks (usa inyección), su estado de hook es N/A por naturaleza. Solo la **salud de skills** se vuelve agnóstica.

---

## Unidad 2 — Reparación de skills agnóstica (#4b)

**Dónde:** `cli/src/core/init/steps.ts:141` (`stepGlobalSkillsRepair`) + `cli/src/index.ts` (`awm update`).

- `stepGlobalSkillsRepair`: usar `PROVIDERS[d.agent].skill.global` en vez del hardcode.
- `awm update`: no tiene `--agent` (es mantenimiento machine-global) → **itera sobre todos los providers con soporte de skills** (`Object.keys(PROVIDERS)` con `skill` no nulo) y repara cada `skill.global` que exista en disco. Así `update` deja a Claude *y* OpenCode sanos en una corrida.

**Punto de diseño:** la reparación scoped a un path inexistente (p.ej. agente sin skills instaladas) degrada a "nada que reparar" (0 re-linked, 0 pruned), no crashea.

---

## Unidad 3 — Des-Claude-izar la prosa (#5)

**Dónde:** `registry/skills/writing-skills/SKILL.md`, `registry/skills/project-constitution/SKILL.md`.

Endurecimiento "belt-and-suspenders": que ni el cuerpo de las skills empuje al modelo hacia `~/.claude`.

- `writing-skills/SKILL.md`: la línea de paths por-agente → referencia agnóstica (las skills se resuelven vía el Skill tool, el modelo no necesita conocer el path). Corregir además la referencia obsoleta a "Codex" (es OpenCode → `~/.agents/skills`).
- `project-constitution/SKILL.md`: reformular la mención a `~/.claude/settings.json` a "corré `awm hooks install`" sin clavar el path (o condicionarla al agente, dado que el hook es Claude-specific).

**Límite:** las menciones en material no-funcional (`CREATION-LOG.md`, ejemplos de `writing-skills/examples/`, scripts de `impeccable`) quedan fuera de alcance — no las consume el flujo.

---

## Unidad 4 — CONSTITUTION.md → OpenCode (#6)

**Dónde:** capa de inyección de contexto (`cli/src/core/context/`), invocada por `stepContextInjection` (`steps.ts`).

`CONSTITUTION.md` (fuente de la verdad de los lineamientos **del proyecto**) le llega a Claude vía el hook SessionStart (`$PWD/CONSTITUTION.md`) pero **no a OpenCode**. La estrategia `config-instructions` solo escribe el **config global** (`~/.config/opencode/opencode.json`), donde hoy inyecta el `awm-context.md` machine-global (path absoluto, correcto). Un `CONSTITUTION.md` per-proyecto NO puede ir al config global (clavaría un proyecto para toda la máquina).

**Fix (decisión del usuario — `opencode.json` local del proyecto):** `awm init` (que ya corre per-proyecto) escribe/actualiza un **`$PWD/opencode.json`** con `instructions: ['CONSTITUTION.md']` (referencia **relativa**, viaja con el repo, commiteable) cuando el agente es OpenCode y existe `CONSTITUTION.md`. Es el análogo agnóstico exacto del hook de Claude.

**Puntos de diseño:**
- La capa de inyección hoy conoce solo el target **global** (`provider.injection.configPath`). Hay que enseñarle un **target local** per-proyecto, sin romper el flujo global del `awm-context.md`.
- Son dos refs con scope distinto: `awm-context.md` machine-global → config global; `CONSTITUTION.md` per-proyecto → `$PWD/opencode.json`.
- `CONSTITUTION.md` ausente → no se escribe `instructions` (no se inventa el archivo).
- `$PWD/opencode.json` existente con `instructions` no-array → error claro "arreglalo a mano, re-corré" (mismo patrón que la estrategia global). Idempotente: no duplica la entrada.

---

## Unidad 5 — Crash de `stepProfile` con multiselect vacío (#1, CONFIRMADO VIVO)

**Dónde:** `cli/src/commands/init.ts:92` (`confirmExtensions`) + `cli/src/core/init/steps.ts:180` (`stepProfile`).

**Root cause (confirmado):** el crash `✖ project.profile [Cannot read properties of undefined (reading 'disabled')]` **no** sale de código de AWM (el string `'disabled'` no existe en `cli/src` ni en el binario instalado). Sale de `@clack/core`: su navegación de opciones hace `s[n].disabled`. Con un array de opciones **vacío**, `s[0]` es `undefined` → crash.

La cadena: en un dir **greenfield**, `detectExtensions` no encuentra señales → `proposed`/`newProposed` vacío → `stepProfile` llama `confirmExtensions([])` (sin guardar el caso vacío) → el path interactivo (sin `--yes`) invoca clack `multiselect({ options: [] })` → crash. Con `--yes` no pasa (devuelve `proposed` directo, sin clack). Es agnóstico: misma llamada clack sin importar el agente. Efecto: `.awm/profile.json` no se crea (el step crashea a mitad).

**Fix:**
- Guarda primaria (agnóstica, unit-testeable) en `stepProfile`: `if (newProposed.length === 0) return ok('project.profile', 'project', 'skipped')` **antes** de llamar `confirmExtensions`.
- Guarda belt-and-suspenders en `confirmExtensions`: si `proposed.length === 0`, retornar `[]` sin invocar `multiselect` (protege a cualquier otro caller).

---

## Error handling (resumen)

- Reparación scoped por agente: path inexistente del agente target → "nada que reparar", no crashea (Unidad 2).
- `awm init` con `CONSTITUTION.md` ausente → no escribe `instructions` (Unidad 4).
- `$PWD/opencode.json` con `instructions` no-array → error claro y accionable (Unidad 4).
- `stepProfile` con cero extensiones propuestas → `skipped`, no crash; `profile.json` se crea por el flujo normal (Unidad 5).

## Testing

- **Unidad 1:** `gatherMachine` con agente `opencode` y `~/.agents/skills` con symlinks rotos → `globalSkills`/`brokenLinks` no vacío (hoy daría vacío mirando a Claude). Con agente `claude-code` → comportamiento actual (regresión).
- **Unidad 2:** `stepGlobalSkillsRepair` con `d.agent = opencode` repara `~/.agents/skills`; `awm update` repara los paths de todos los providers con skills. Path inexistente → no-op sin throw.
- **Unidad 3:** test de regresión — grep: la prosa funcional de skills no contiene `~/.claude/skills` salvo donde es legítimamente Claude-specific y reformulado.
- **Unidad 4:** `awm init --agent opencode` con `CONSTITUTION.md` presente → `$PWD/opencode.json` tiene `instructions:['CONSTITUTION.md']`; ausente → no lo agrega; corrida dos veces → idempotente; `instructions` no-array → error.
- **Unidad 5:** `stepProfile` con `detectExtensions → []` retorna `skipped` y **no** invoca `confirmExtensions`/clack; `confirmExtensions([])` retorna `[]` sin invocar `multiselect`.

## Componentes y límites (para aislamiento)

| Unidad | Propósito | Depende de |
|---|---|---|
| 1. Diagnóstico agnóstico | `gatherMachine(agent)` calcula salud de skills contra el path del agente target | `PROVIDERS[agent].skill.global`, threading de `agent` |
| 2. Reparación agnóstica | `stepGlobalSkillsRepair`/`update` reparan el path del agente target (o todos) | `PROVIDERS`, `repairGlobalSkills` |
| 3. Prosa agnóstica | Skills no empujan al modelo hacia `~/.claude` | — (edición de prosa en registry) |
| 4. CONSTITUTION → OpenCode | `awm init` wirea `$PWD/CONSTITUTION.md` al `opencode.json` local | capa de inyección con target local, `stepContextInjection` |
| 5. Guarda multiselect vacío | `stepProfile` no invoca clack con opciones vacías | `detectExtensions`, `confirmExtensions` |

## Orden de implementación sugerido

1. **Unidad 5** (independiente, desbloquea `awm init` greenfield — prerequisito de probar el resto).
2. **Unidad 1 → Unidad 2** (#4: diagnóstico antes que reparación; juntas cierran el linchpin y la cobertura de #5).
3. **Unidad 3** (prosa, independiente).
4. **Unidad 4** (#6, independiente de las demás).

## Límite de alcance (lo que NO entra en B-1)

- Trinquete de aprendizaje (ledger + harness-retro como fase) → **Body B-3**.
- Cualquier rework del split "agents nativos vs symlinks" de OpenCode: es por diseño (tipo de artefacto), no un defecto — el problema era cobertura (cae con #4), no el mecanismo.
- Soporte de Antigravity: fuera de alcance por decisión del usuario hasta estabilizar Claude + OpenCode. (Las unidades 1–2 quedan agnósticas por construcción; si un día se activa Antigravity, heredan el fix sin cambios.)
