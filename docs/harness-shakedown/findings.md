# Harness Shakedown — Findings (bug log)

Bugs encontrados corriendo el arnés de verdad. Se arreglan DESPUÉS de que el lab mapee el cuadro completo (ambas herramientas), salvo que un bug bloquee el avance. Cada hallazgo tiene lo necesario para retomarlo sin perder contexto.

---

## ⭐ INSIGHT CENTRAL — La distinción alcance-vs-seguridad falta en el modelo de calidad

> No es un bug puntual: es un principio de arquitectura de calidad que el arnés no tiene cableado. Es el hallazgo más valioso del shakedown. Material para un ciclo de diseño dedicado.

**Qué pasó:** brainstorming preguntó por edge cases, el usuario dijo "caso feliz", y el sistema documentó `personas=0` como "fuera de alcance". QA respetó ese alcance → 0 hallazgos. El `splitBill(100,0,10) → Infinity` silencioso se quedó en el código. Ni QA ni brainstorming fallaron por separado: **comparten un punto ciego.**

**El principio que falta:**
> **El alcance puede excluir *features*. Nunca puede excluir *seguridad*.** La validación de entradas no es una feature: es un piso. Una función pública jamás debería devolver `Infinity`/`NaN` en silencio — debe fallar ruidosamente. "El usuario dijo que no" justifica omitir una feature, NO omitir un invariante de robustez.

**Por qué importa para el objetivo de producto (garantía agnóstica):**
- "Brainstorming con más criterio" **NO es la solución primaria**: el criterio del LLM es exactamente lo que varía entre herramientas (ver [Hallazgo #3]). Confiar en él reintroduce la dependencia de la disciplina del agente. Sirve como red de respaldo, no como garantía.
- La capa que **garantiza** debe ser **determinística y agnóstica** — dispara sin importar quién escribió el código.

**Portafolio propuesto (de más agnóstico a menos), a diseñar con datos de ambas herramientas:**
1. **Regla de proceso (CONSTITUTION, agnóstica):** toda función pública valida entradas y falla ruidosamente. Heredada por todos los agentes vía contexto inyectado.
2. **Convención de test estructural (semi-determinística):** todo módulo exige test de entradas límite/inválidas, no solo caso feliz → convierte "¿probaste el cero?" en gate, no en juicio.
3. **Sensor estructural/semgrep (determinística donde se pueda):** clases encodables (división sin guarda, `eval`, etc.). Verdad incómoda: "ningún `Infinity` silencioso para toda entrada" es difícil de volver puramente estático (TS no tiene tipos refinados); por eso es portafolio y no una sola capa.
4. **QA con lente de seguridad (juicio, respaldo):** instruir a QA que "documentado-fuera-de-alcance NO exime invariantes de seguridad" → `Infinity` silencioso es Type-C aunque el diseño lo waiveó.
5. **harness-retro (el trinquete):** cada bug que escapa ≥2 veces se vuelve regla. La garantía crece con el tiempo; nunca es total el día uno.

**Prerrequisito:** nada de esto corre mientras el gate esté hueco ([Hallazgo #2]). Arreglar la detección de pack es el primer escalón.

**Próximo paso:** completar la corrida de OpenCode para obtener evidencia decisiva (¿el juicio de brainstorming/QA sobrevive un cambio de herramienta?), luego abrir ciclo de diseño de la capa de calidad agnóstica.

---

## Hallazgo #1 — `awm init` crashea en el step `project.profile`

- **Encontrado:** 2026-06-05, Fase 1 (Claude), corriendo `awm init --agent claude-code` en `~/awm-lab/tip-splitter-claude`
- **Síntoma:** `✖ project.profile [Cannot read properties of undefined (reading 'disabled')]`
- **Efecto:** `.awm/profile.json` NO se crea (el step crasheó a mitad). El profile del proyecto queda ausente; `awm doctor`/`init` reportan `degradado`.
- **Severidad:** media. NO bloquea el flujo de desarrollo (las skills de la espina están a nivel máquina-global, `✔ skills globales`), pero la activación project-scoped basada en profile está rota.
- **Clase (sospechada):** lógica / runtime — un `.disabled` leído sobre un objeto `undefined`.
- **Pista de investigación:** `grep "disabled" cli/src/` **NO** muestra ninguna lectura literal de `.disabled` en `profile.ts` ni en `init/`. Las únicas coincidencias son `config.enabled === false` (sensors/status.ts:72) y un `skipReason: 'disabled'` (sensors/run.ts:140) — ninguna es la culpable. Conclusión: el `.disabled` se lee en la cadena que `stepProfile` dispara al **activar bundles/skills** (acción `syncProfile`), probablemente sobre una entrada de bundle/skill `undefined` (mismatch de forma entre el registry y lo que el profile espera). Puede ser acceso dinámico (`obj['disabled']`) o en el path de instalación de bundles.
- **Repro:** `awm init --agent claude-code` en un dir git fresco sin `.awm/profile.json` previo.
- **CONFIRMADO AGNÓSTICO (2026-06-05):** reproduce idéntico con `awm init --agent opencode` en `project-opencode`. No es Claude-specific → bug del CLI, independiente del agente. Efecto colateral observado: el contexto materializado de OpenCode quedó con "Extensiones activas: ninguna" (el crash impide cargar extensiones del proyecto).
- **Archivos a inspeccionar al debuggear:** `cli/src/core/init/steps.ts` (`stepProfile`), la acción `syncProfile` y su cadena de activación de bundles, `cli/src/core/profile.ts`, `cli/src/core/bundles.ts`.
- **Estado:** ABIERTO — debuggear con `systematic-debugging` después del lab.

---

## Hallazgo #2 — `awm sensors init` en dir vacío detecta pack `generic` → sin gate rápido (tsc/lint/test) = FALSO VERDE

- **Encontrado:** 2026-06-05, Fase 3 (Claude), inspeccionando `project-claude/.awm/sensors.json` tras `awm init`.
- **Síntoma:** `sensors.json` quedó con `"pack": "generic"` y un único sensor `security` (semgrep, `fast: false`). No hay sensores tsc / eslint / test.
- **Causa raíz:** `awm init` corre `awm sensors init` cuando el directorio todavía está **vacío** (sin `package.json`/`tsconfig.json`). La detección de stack no encuentra indicadores → fallback a `generic`. El proyecto TS se scaffoldea *después* (Task 1 del plan), pero **nada re-dispara la detección de sensores**, así que el pack `js-ts` (tsc/eslint/test) nunca se configura.
- **Efecto:** el hook `PostToolUse` corre `awm sensors run --fast` tras cada edit; como el único sensor es `fast:false`, corren **0 sensores** → `overall` verde vacío. **FALSO VERDE**: el gate rápido no valida nada en un proyecto TS. Misma clase que Body A atacó, distinta causa (pack equivocado, no manifest ausente).
- **Severidad:** ALTA — anula el gate de sensores para *cualquier* proyecto inicializado antes de que exista su stack (es decir, todo proyecto greenfield, que es el caso típico de `awm init`).
- **Direcciones de fix (decidir en fase de arreglo):** (a) `awm sensors init` re-detecta tras el scaffolding; (b) `awm init` difiere la detección de sensores hasta que haya stack; (c) `awm sensors run` advierte cuando el pack es `generic` pero ya existen indicadores (`package.json`/`tsconfig.json`) en el árbol; (d) un step de init que re-evalúe el pack. Conecta con la honestidad de Body A (no dar verde sin haber corrido nada real).
- **Nota relacionada:** el diseño de la app eligió **Vitest**, no Jest. Aun re-detectando `js-ts`, si su sensor de test invoca `jest` (no instalado) → DEGRADED = fail (Body A). A vigilar en la fase de fix.
- **EVIDENCIA EMPÍRICA (2026-06-05, corrido a mano tras la ejecución):**
  - `awm sensors run` → `{ sensors:[{name:"security",status:"pass"}], overall:"pass" }` — solo semgrep.
  - `awm sensors run --fast` (lo que corre el hook tras cada edit) → `{ sensors:[], overall:"skipped" }`, exit 0 — **cero sensores**.
  - Los 4 tests Vitest pasan, pero corridos por el agente (`npx vitest`), no por el gate.
- **Estado:** ABIERTO.

---

## Hallazgo #4 — La reparación de symlinks de skills es Claude-only; OpenCode tiene 10 symlinks rotos (Body A a medias)

- **Encontrado:** 2026-06-05, preparando la Fase 3 de OpenCode.
- **Síntoma:** `~/.agents/skills` (path de skills de OpenCode, per `PROVIDERS['opencode'].skill.global`) tiene **10 symlinks rotos** que apuntan a `~/.awm/registry/registry/skills/` — el root viejo que **no existe** (el real es `~/.awm/cli-source/registry/skills/`). Evidencia: `find ~/.agents/skills -type l ! -exec test -e {} \; | wc -l` → 10. En contraste, `~/.claude/skills` → 0 rotos (Body A lo reparó).
- **Causa raíz (DOS referencias hardcodeadas a claude-code — `awm init` ni instala ni repara skills de agentes ≠ Claude):**
  1. **`cli/src/core/diagnostics/context.ts:106`** — `gatherMachine` computa `devCore`/`brokenLinks` SIEMPRE contra `PROVIDERS['claude-code'].skill.global` (`~/.claude/skills`). Como Body A dejó Claude sano → `devCore.present=true, brokenLinks=[]`. Entonces `stepDevCore` (`steps.ts`) entra por su guard `if (devCore.present && brokenLinks.length===0) return skipped` y **NUNCA instala** a `~/.agents/skills`, aunque `stepDevCore` pasa `agents:[d.agent]`. El install queda neutralizado por un health-check Claude-scoped.
  2. **`cli/src/core/init/steps.ts:141`** (`stepGlobalSkillsRepair`) — hardcodea `PROVIDERS['claude-code'].skill.global`; nunca repara el path del agente target.
  - El endurecimiento en `awm update` (`cli/src/index.ts`) también usa `PROVIDERS['claude-code'].skill.global`.
  - Conclusión: `awm init --agent opencode` asume "Claude = la máquina". La reparación manual del usuario es un workaround de este bug, no el flujo previsto.
- **Fix:** ambas referencias deben usar `PROVIDERS[agent].skill.global` (o iterar sobre todos los agentes con skills). El health-check de `devCore` debe scoped-ear al agente target; la reparación también.
- **Efecto:** `awm init --agent opencode` NO instala ni repara las skills de OpenCode. No existe hoy un comando que deje las skills de OpenCode sanas. Los cuerpos de las skills no son accesibles desde el path de OpenCode.
- **Severidad:** ALTA para el objetivo de agnosticismo — es Body A "terminado" solo para Claude.
- **Pregunta abierta más profunda (a probar empíricamente):** aun con los symlinks reparados, **¿OpenCode consume `~/.agents/skills`?** OpenCode no tiene un "Skill tool" estilo Claude. Puede que el path sea inerte. Hay que reparar → probar Fase 3 → observar si OpenCode realmente invoca/lee alguna skill.
- **Dirección de fix:** hacer `stepGlobalSkillsRepair` (y la reconciliación de `awm update`) iterar sobre el path del agente target (o de todos los agentes con skills), no hardcodear `claude-code`. Conecta con la misma raíz de Body A.
- **Workaround para desbloquear el lab:** re-linkear manualmente los 10 symlinks de `~/.agents/skills` → `~/.awm/cli-source/registry/skills/` (equivalente a lo que Body A hace para Claude).
- **Actualización (reparación manual del usuario):** el usuario reparó a mano las skills de la **espina** (brainstorming, development-process, writing-plans, etc.) → OpenCode pudo seguir el flujo. Quedaron **10 docs/especializadas aún rotas** (docs-brainstorming, c4-architecture, template-wizard, discovery-assistant, init-docs-repo, documenting-modules, docs-system-orchestrator, business-documenting-modules, template-manager, docs-assistant). Refuerza la severidad: la reparación manual es parcial y propensa a error — el fix debe ser un step agnóstico del CLI.
- **Estado:** ABIERTO.

---

## Hallazgo #3 — El verde del arnés viene de la disciplina del agente, no del gate (implicación de agnosticismo)

- **Encontrado:** 2026-06-05, Fase 5-6 (Claude), como consecuencia del Hallazgo #2.
- **Observación:** El flujo completo reportó "READY / QA completo / sensores limpios", pero el gate agnóstico (`awm sensors run`) solo validó semgrep. La calidad real (tipos OK, tests verdes) la garantizó **la disciplina de Claude** (sus subagentes corrieron Vitest y revisaron spec/calidad), NO el enforcement del arnés.
- **Por qué importa (va al corazón del objetivo de producto):** el arnés debe **garantizar** calidad *independiente de la herramienta*. Hoy no lo hace: si el agente fuera menos disciplinado (o si OpenCode no corre los tests por su cuenta), el gate diría "pass" igual sobre código con type-errors o tests rotos. El enforcement agnóstico está hueco mientras el pack sea `generic` (Hallazgo #2).
- **Hipótesis a probar en la corrida de OpenCode:** si OpenCode no replica la auto-disciplina de Claude (correr tests, dos etapas de review), el mismo flujo producirá código con menos garantías y el gate no lo atrapará. Esta es la prueba directa de (no-)agnosticismo.
- **CORRECCIÓN (2 conclusiones previas erradas, revisadas con evidencia 2026-06-05):**
  - **ERROR previo 1:** se afirmó que "OpenCode no tiene Skill tool / `~/.agents/skills` es inerte". **FALSO** — el transcript muestra `Skill "subagent-driven-development"` + `Read ~/.agents/skills/.../implementer-prompt.md`. OpenCode invoca skills y lee sus cuerpos. El path se consume.
  - **ERROR previo 2:** se afirmó "fidelidad de ejecución menor en OpenCode". **PREMATURO** — ese juicio fue sobre un snapshot de un intento SIN skills (pre-reparación de symlinks). Con las skills cargadas, OpenCode ejecutó subagent-driven con alta fidelidad: commits por tarea (`6d81a48`→`dfa0738`→`8609832`), implementer + spec review + code-quality review **con fix loop** (`.gitkeep`), y QA. La fidelidad dependió 100% de si las skills estaban instaladas → **el linchpin es el Hallazgo #4**.
- **VEREDICTO REVISADO por capas:** (1) entrega de contexto = agnóstica ✅; (2) seguir el flujo = agnóstica ✅; (3) fidelidad de ejecución CON skills instaladas = **largamente agnóstica** ✅ (OpenCode replicó subagent dispatch + dos reviews + QA); (4) **juicio de QA/seguridad = NO-DETERMINÍSTICO entre agentes** ⚠️⚠️ — ver abajo.
- **EVIDENCIA DECISIVA — QA no-determinístico:** misma skill `post-implementation-qa`, código idéntico (`splitBill` con división sin guarda), resultados OPUESTOS:
  - **Claude QA:** "0 hallazgos" — waiveó el bug por "fuera de alcance".
  - **OpenCode QA:** **C1 🔴 BLOCKER** (`splitBill(100,0,10)→Infinity`) + **C2 🟡 IMPORTANT** (`splitBill(100,-2,10)→-55`), flagueados pese a estar fuera de alcance, y preguntó al usuario.
  - El gate de sensores (Finding #2) NO lo cazó en ninguna — fue el deep-review (juicio LLM). Y el juicio dio distinto por agente.
- **Implicación:** la capa de juicio **es capaz** de cazar el bug de seguridad, pero **no garantiza** cazarlo (varía por agente y probablemente por corrida). La única garantía agnóstica es un **gate determinístico** (ver ⭐ INSIGHT CENTRAL). OpenCode aquí aplicó "seguridad ≠ alcance" mejor que Claude — el principio es alcanzable por juicio, no garantizado.
- **Relación:** consecuencia de [Hallazgo #2]. Fix de #2 (gate real con tsc/lint/test/estructural) da el piso determinístico que esto necesita.
- **Estado:** CONFIRMADO — el juicio de QA es no-determinístico entre agentes; la ejecución (con skills) sí es agnóstica.
