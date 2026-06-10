# Harness Retros

Auditable log of recurring/structural harness gaps converted into rules. See the
`harness-retro` skill for the process. Newest first.

---

## 2026-06-10 — WS-2 (multi-registry de equipo): call-site perdido al wiring + patrón hoist-per-root-io

- **Class:** de proceso (F1) + agent (W3)
- **Occurrences (ledger count):** F1 count 1 (important, detectado en spec-review loop); W3 count 2 (confirmado en 2 code-quality reviews independientes)
- **Reglas curadas:**
  - `CONSTITUTION.md § Implementación` — al conectar una función nueva que reemplaza un bare call, grep todos los call-sites antes de marcar el task; el plan puede no listar módulos secundarios (caso: `init/steps.ts` quedó sin wiring en Task 5)
  - `AGENTS.md § Patrones de diseño de API` — hoist-per-root-io: I/O de por-root fuera del loop interno de artefactos (patrón `readRegistryManifest` en discovery/bundles)
- **Sensor:** constitution (CONSTITUTION.md checklist) / agents-md (AGENTS.md)
- **Descartados:** 7 ítems (F2 deuda WS-4, F3 cosmético, F4 divergencia intencional, F5 dead-code inofensivo, F6 plumbing intencional, W1 ya en CONSTITUTION, W2 ya en AGENTS)

---

## 2026-06-09 — WS-1 (registries adicionales): guard de path-component incompleto + patrones de diseño

- **Class:** de proceso (F1) + agent (F2, W1–W4)
- **Occurrences (ledger count):** 3 hallazgos de validación incompleta (mismo root cause), 4 wins confirmados
- **Reglas curadas:**
  - `CONSTITUTION.md` — guard de nombre/path debe rechazar conjunto completo: vacío, `.`, `..`, `/`, `\\`
  - `AGENTS.md` — dual-tmpdir-isolation, module-level-env comment, default-arg-seam, contentRoot-stamp-at-discovery, atomic-add-rollback
- **Sensor:** constitution (revisión manual al inicio de sesión)

---

## 2026-06-09 — WS-0 (deudas rápidas): ledger vacío al cierre — pipeline de aprendizaje roto

> **Corregido 2026-06-09 (mismo día):** la versión original de esta entrada clasificó el problema
> como "disciplina del orquestador" sin regla técnica, y afirmó erróneamente que la instrucción
> de ledger vive en `implementer-prompt.md` (vive en `spec-reviewer-prompt.md` y
> `code-quality-reviewer-prompt.md` — emiten los reviewers, no el implementer). El usuario
> detectó que el retro se cerró sin rastrear la causa estructural. Esta entrada reemplaza a la original.

- **Clase:** estructural (del harness) — 3 gaps en skills, no disciplina individual
- **Occurrences (ledger count):** 0 entradas tras un ciclo que produjo 5 hallazgos QA — la
  contradicción ES el hallazgo
- **Traza de la falla en cadena:**
  - **G1 — `subagent-driven-development/SKILL.md` no mencionaba el ledger.** La instrucción
    `awm ledger add` vivía solo en los templates (`spec-reviewer-prompt.md:69`,
    `code-quality-reviewer-prompt.md:35`), y la sección *Prompt Templates* era un listado
    pasivo sin obligación de construir los prompts desde ellos. Un orquestador que arma
    prompts inline pierde la instrucción por completo — exactamente lo que pasó. El Sensor
    Gate tenía verificación del lado del controller; el ledger no tenía equivalente.
  - **G2 — `post-implementation-qa/SKILL.md` mencionaba el ledger como nota, no como gate.**
    El deep-review reportó 5 hallazgos con ledger en 0 y ningún paso lo detectó.
  - **G3 — `harness-retro/SKILL.md` trataba "ledger vacío" como exit incondicional.**
    No distinguía "vacío porque no hubo hallazgos" de "vacío porque la tubería se rompió",
    así que el retro cerró declarando que no había nada que aprender.
- **Reglas agregadas:**
  - `registry/skills/subagent-driven-development/SKILL.md` — sección *Ledger Gate (AWM)*
    espejo del Sensor Gate: prompts construidos desde templates (obligatorio) +
    trust-but-verify del controller (`awm ledger list` debe crecer si el reviewer reportó
    hallazgos/wins) + 2 red flags nuevos.
  - `registry/skills/post-implementation-qa/SKILL.md` — Paso 3 exige construir el prompt
    desde el template; Paso 4 gana gate de ledger (verificar entradas `post-qa` antes de
    presentar hallazgos) + 2 red flags nuevos.
  - `registry/skills/harness-retro/SKILL.md` — *empty-ledger consistency check* obligatorio
    antes del fast-exit: si hubo hallazgos reportados en el ciclo y el ledger está vacío,
    eso es el hallazgo del retro (rastrear y curar) + anti-pattern nuevo.
- **Sensor que lo atrapa:** proceso — los gates viven en el texto de los 3 skills (controller
  verifica con `awm ledger list`, barato y autoritativo). Sin sensor automático de código.

---

## 2026-06-05 — `post-implementation-qa` omitido tras `subagent-driven-development`

- **Clase:** de proceso
- **Dónde se vio:** ≥2 ciclos de desarrollo donde `subagent-driven-development`
  terminó su final code review, el TERMINATION_PHASE decía `STOP COMPLETELY`, y el
  agente pasó directamente a preguntar sobre `finishing-a-development-branch` sin
  haber invocado `post-implementation-qa`. El QA (plan-vs-implementación, Type B/C)
  se omitió en cada caso hasta que el usuario lo detectó manualmente.

- **Causa raíz:** El TERMINATION_PHASE mezclaba dos invariantes distintos:
  1. "No auto-mergees" (válido)
  2. "Para antes del QA" (incorrecto — QA es obligatorio, no opcional)
  El texto `STOP COMPLETELY. Do NOT invoke... any other skill` impedía que el agente
  invocara `post-implementation-qa`, que es parte del flujo mandatorio definido en
  `development-process`. El final code reviewer interno del skill solo cubre calidad
  de código, no fidelidad al plan.

- **Regla agregada:**
  - `registry/skills/subagent-driven-development/SKILL.md` — TERMINATION_PHASE
    reemplaza `STOP COMPLETELY` por una secuencia explícita que exige invocar
    `post-implementation-qa` como primer paso antes de reportar y preguntar al
    usuario. Incluye el `Why not skip it` explicando la diferencia de clases de
    revisión.

- **Sensor que lo atrapa:** proceso (no hay sensor automático para esto — la regla
  vive en el texto del skill y el agente la sigue al entrar en TERMINATION_PHASE).

---

## 2026-05-27 — Los sensores nunca se corrieron durante subagent-driven-development

- **Clase:** de proceso + estructural
- **Dónde se vio:** primer ciclo real de desarrollo (rediseño UX `/diagrams` en
  notion-tracker) tras instalar los sensores el 2026-05-25. Las 7 tareas se
  ejecutaron verificando solo `typecheck + test + build`; `awm sensors run` nunca
  corrió. El sensor `lint` tenía 7 hallazgos nuevos reales en archivos nuevos
  (`no-unused-vars` en params de tipos de interfaces, `set-state-in-effect`,
  `no-undef`) que pasaron las 3 etapas de review por subagente + el review final.

- **Causa raíz (3 hallazgos):**
  - **A — regla huérfana.** El gate de sensores vivía solo en
    `verification-before-completion`. Las skills que manejan la ejecución
    (`subagent-driven-development` + sus 3 prompt templates, `executing-plans`)
    no la referenciaban ni mencionaban sensores. Los subagentes corren en
    contexto aislado: solo hacen lo que el prompt dice, y los prompts pedían
    `typecheck + test + build`.
  - **B — comando incorrecto.** `verification-before-completion` indicaba
    `awm sensors run --slow`, pero `--slow` corre solo `semgrep`/`mutation` y
    **omite `lint` y `typecheck`** (que son `--fast`). Aun siguiendo la skill al
    pie de la letra, el sensor que atrapó los errores no se habría corrido.
  - **C — fragilidad del ratchet.** Al arreglar los hallazgos se cambió la config
    de lint (`argsIgnorePattern: '^_'`), lo que reescribió el texto del mensaje
    de todos los `no-unused-vars`. El fingerprint del baseline incluía el mensaje
    (`sensor|file|rule|maskNumbers(message)`), así que 557 hallazgos
    preexistentes pasaron a contarse como "nuevos" → `overall: fail` falso.

- **Reglas agregadas:**
  - `registry/skills/verification-before-completion/SKILL.md` — `awm sensors run`
    (sin flag = todos) como gate; advertencia explícita contra `--slow`.
  - `registry/skills/subagent-driven-development/SKILL.md` — sección *Sensor Gate
    (AWM)* + `verification-before-completion` en *Integration*.
  - `registry/skills/subagent-driven-development/implementer-prompt.md` — paso de
    sensores en *Your Job*, *Self-Review* y *Report Format*.
  - `registry/skills/subagent-driven-development/code-quality-reviewer-prompt.md`
    — evidencia de sensores como check bloqueante.
  - `registry/skills/executing-plans/SKILL.md` — gate de sensores por tarea +
    *Integration*.
  - `registry/sensor-packs/js-ts/eslint.config.awm.mjs` —
    `argsIgnorePattern/varsIgnorePattern: '^_'` (convención estándar TS).
  - `cli/src/commands/sensors/baseline.ts` — fingerprint endurecido a
    `sensor|file|rule` (fallback al mensaje enmascarado solo sin `rule`) +
    `partition` por conteo de ocurrencias. Cambios de wording ya no invalidan el
    baseline; ocurrencias extra por `(file,rule)` se siguen detectando.

- **Sensor que lo atrapa:** `lint` (y `typecheck`/`security`) vía `awm sensors run`
  ahora referenciado por el loop de ejecución. Tests: `cli/tests/commands/sensors/baseline.test.ts`
  (regresión de wording-stable + conteo de ocurrencias).
