# Harness Retros

Auditable log of recurring/structural harness gaps converted into rules. See the
`harness-retro` skill for the process. Newest first.

## 2026-07-23 — awm export --target claude-ai: symlink exfiltration blocker + discovery-reuse lesson

- **Class:** security (CONSTITUTION.md) + agent/API-pattern (AGENTS.md)
- **Branch:** `claude/awm-v1-4-0-frontend-upgrade-bcd3gq`
- **Ledger:** 83 entries (23 findings, 60 wins) across 6 SDD tasks (with fix loops), 1 whole-implementation final review, and post-implementation-qa's 4-lens panel (Track A fidelity: 0 findings; Track B: 2 blockers + 2 minors, all fixed and verified with before/after reproductions in the same session)
- **Occurrences (recurring signal, `awm ledger recurring --min 2`):** 5 clusters flagged, ALL verified via timestamp inspection to be the same finding/win emitted multiple times within seconds by one reviewer (retry after an ambiguous CLI confirmation) — not genuine cross-task recurrence. No pipeline break: `awm ledger list` verification at the controller already tolerates this without masking real signal. Documented as a non-issue rather than cured.
- **Curado en CONSTITUTION.md** ("Validación de entrada"): symlinks in a directory tree sourced from registry content (semi-trusted, possibly third-party) must be rejected explicitly when copying/archiving — `fs.cpSync` copies them as-is, but `zip -r` dereferences them, embedding arbitrary file content from outside the registry into the exported artifact. Confirmed exploitable and fixed in `cli/src/core/export/pack.ts` (commit `2e3144b`) with a before/after reproduction (real secret file leaked into a real zip pre-fix, blocked post-fix).
- **Curado en AGENTS.md** ("Patrones de diseño de API"): multi-root artifact resolution must reuse existing discovery functions (`discoverSkills`, `discoverAllBundles`) instead of hand-rolling a "first root that matches" scan — the discovery functions already encode the `awm-registry.json` override/collision contract; a hand-rolled scan silently ignores it. Confirmed in `cli/src/core/export/resolve.ts`'s `locate()` (fixed in commit `d3d4957`).
- **Sensor:** none (process/agent-class lessons, not sensor-catchable — this repo's `cli/eslint.config.awm.mjs` is a distributable sensor-pack asset for consumer projects, not self-applied CI for this repo; the durable safeguard for the specific bug is the regression test already committed in `cli/tests/core/export/pack.test.ts`).
- **Also fixed this session, not separately cured** (already closed via regression tests per the "logic error → needs a test" heuristic, no additional harness rule needed beyond what's in the diff): apostrophe in `DEFERENCE_LINE` breaking single-quoted YAML output (blocker, `transform.ts`); trailing YAML inline comment silently dropping the deference line (minor, `transform.ts`); untested default `--out` cwd-relative branch (minor, `index.ts`).
- **Descartes (modo desatendido):** the 5 duplicate-emission clusters above — reason: ledger noise from same-event reviewer retries, not a systemic finding; no rule change needed since the controller's ledger-list verification already catches and tolerates it.

## 2026-06-25 — release-script: CLI arg validation + multi-step rollback + call-order test + execFileSync

- **Class:** proceso × 2 (CONSTITUTION) + agent × 2 (AGENTS.md)
- **Branch:** `feature/release-script`
- **Ledger:** 7 findings (2 important, 5 minor), 4 wins; todos los findings corregidos en la sesión
- **Curado en CONSTITUTION.md:**
  - **CLI arg validation:** `argv[++i] ?? 'default'` silencia el error cuando el usuario omite el valor — lanzar error explícito si el token es `undefined` o empieza con `--`
  - **Multi-step rollback:** operaciones no atómicas (git commit + tag + npm publish) deben implementar rollback de los side-effects locales si el paso final falla; patrón: catch → `git tag -d` + `git reset --hard HEAD~1` → re-lanzar
- **Curado en AGENTS.md:**
  - **`assert-call-order-not-just-existence`:** cuando el fake graba commands en `calls[]`, verificar el orden con `indexOf` + `toBeLessThan`, no solo con `toContain`
  - **`execFileSync-not-execSync`:** usar `execFileSync(cmd, args[])` — evita shell intermedio y riesgo de inyección por metacaracteres
- **Sensor:** constitution + agents-md (entregados a cada agente vía contexto)
- **Dismissed:** `missing-idempotence-gate-tests` (corregido, sin patrón estructural nuevo), `release-script-no-prebuild` (fix puntual en package.json), `tag-re-duplicated-across-modules` (deuda técnica menor, no patrón de clase)

---

## 2026-06-22 — CLI Interface Engine: 3 agent patterns curados

- **Class:** agent (testing + diseño)
- **Branch:** `feat/cli-interface-engine`
- **Ledger:** ~16 findings (1 minor structuralizado, 2 dismissed, resto ya corregidos durante SDD/QA), ~22 wins; 4 QA findings cerrados (B1 toggleAll visible, B2 SIGINT handler, B3 --all flag, C1 CJK ranges)
- **Curado en AGENTS.md:**
  - **`ansi-testing-inject-precolored`:** tests con picocolors en Jest son vacuos (non-TTY → strings planos); inyectar ANSI hardcodeado o usar FORCE_COLOR=1
  - **`eventemitter-fake-stdin`:** usar EventEmitter como fake de stdin para tests de I/O shell sin TTY real; contrato mínimo `{ on, removeListener, setRawMode?, pause? }`
  - **`pure-render-io-split`:** separar render puro `(state, width) → string[]` del shell I/O; defaultIO lazy + default-arg-seam para injectable IO testeable
- **Sensor:** agents-md (entregado a cada agente vía contexto de sesión)
- **Dismissed:** `ansi-regex-incomplete` (aceptado como fuera de scope — solo input de picocolors), `cursor-oob-not-clamped-on-filter-change` (benigno, no es un bug real)

---

## 2026-06-22 — WS-C OS Sensitivity: 4 agent patterns curados

- **Class:** agent (working-style + wins)
- **Branch:** `feat/ws-c-os-sensitivity`
- **Ledger:** ~13 findings (todos minor, sin recurrentes), ~39 wins; 2 findings arreglados en QA (C1, C2), 1 descartado (C3)
- **Curado en AGENTS.md:**
  - **W1 / module-level env vars → call-time preference:** merged en bullet existente — exportar funciones call-time evita `jest.resetModules()` en tests
  - **W3 / stub-process-platform:** `Object.defineProperty(process, 'platform', { configurable: true })` — el flag es esencial, sin él la restauración falla silenciosamente
  - **W2 / injected-logger:** recibir el logger como argumento (`fn(log)`) en vez de llamar `console.warn()` — función pura, testeable sin capturar stdout
  - **F4 / best-effort-catch-comment:** bare `catch {}` es indistinguible de un olvido; añadir comentario explicando qué hace el fallback y qué se pierde
- **Sensor:** agents-md (entregado a cada agente vía contexto de sesión)
- **Dismissed:** 9 findings (F1 obsoleto/resuelto por Task 2, F2 doble-llamada idempotente trivial, F3 posible divergencia de strings, F5 reviewer equivocado/código correcto, F6 plan-accepted, + duplicados ya-fijados C1/C2/C3)

---

## 2026-06-12 — WS-5 (team workflow): verify-cmd-source + runbook-as-script

- **Class:** agent (×2 — working-style lessons)
- **Occurrences (ledger count):** F2 `awm-pin-writes-prefs-not-profile` (important) + `cli-reference-pin-base-wrong-keyword` (important) — mismo root cause, 2 entries. W1 `runbook-as-script` — confirmado end-to-end en Fase C.
- **Rule:** `AGENTS.md` — nueva sección "Patrones de documentación":
  - `verify-cmd-source-before-documenting`: al documentar un comando AWM, verificar `cli/src/commands/<cmd>.ts` antes de escribir. Tanto keyword como storage target de `awm pin` pasaron dos rondas de review con valores incorrectos.
  - `runbook-as-script`: escribir el doc como hipótesis y ejecutarlo literalmente; las divergencias se corrigen en el doc. Tres hallazgos de QA (doctor example stale, sync footnote, §4.7 incompleto) derivan del mismo patrón: ejemplos de output escritos sin verificar el binario real.
- **Sensor:** agents-md (entregado a cada agente vía contexto)
- **Dismissed:** F-1 (prompts españoles — F-10 ya es política, sin brecha estructural nueva), F-3 (verificación parcial de onboarding — demasiado específico al tipo de workstream), W-1 atomic-add (ya en AGENTS.md), W-1 awm-update-distinction (ya en tres docs).

---

## 2026-06-11 — WS-7 (policy execution): tdd-first-i18n pattern

- **Class:** agent/win
- **Occurrences (ledger count):** 2 (ws7-tdd-test-first-discipline + tdd-red-green-translation, mismo patrón)
- **Rule:** `AGENTS.md` — "Patrones de testing › tdd-first-i18n"
- **Sensor:** agents-md (lectura contextual)
- **Dismissed findings (8):** todos ya corregidos durante QA; sin regla estructural añadida — el único patrón durable es el de testing

---

## 2026-06-10 — WS-3 (versionado real): gate de contrato después de early-exit + asimetría de cleanup de clone

- **Class:** de proceso (F1) + de lógica (F2) + agent/win (W1)
- **Occurrences (ledger count):** F1 count 1 (important, detectado en post-qa); F2 count 2 (detectado en code-quality-review + confirmado en post-qa como C2); W1 count 3 wins independientes
- **Reglas curadas:**
  - `CONSTITUTION.md § Implementación` — gates de contrato (versión, seguridad, permisos) deben ir ANTES de early-exits de conveniencia en handlers de comando; el early-exit elimina trabajo, el gate verifica un invariante — si el gate queda después, los flujos que toman el early-exit lo saltean en silencio
  - `cli/src/core/registries.ts` — `syncAdditionalRegistries` ahora limpia `reg.contentRoot` si clone falla O si checkout/pull falla post-clone fresco (asimetría con `syncRegistry` corregida); regression test en `registries-sync.test.ts`
  - `AGENTS.md § Patrones de testing` — entrada `dual-tmpdir-isolation` ampliada: patrón completo (`resetModules` + late `require`) + nota obligatoria `-c tag.gpgSign=false` en GIT helper cuando los fixtures crean tags (confirmado necesario en máquinas con `tag.gpgSign=true` global)
- **Sensor:** constitution (CONSTITUTION.md checklist) / agents-md (AGENTS.md) / test (`registries-sync.test.ts` F2 regression)
- **Descartados:** F3 (`empty-pin` string — setPin ya valida en escritura), F4 (DRY inline trivial), F5 (idioma — deferido a WS-7 F-10), F6 (cobertura head-fallback — no invariante roto)

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

## 2026-06-11 — gate-order-annotation: comentar los gates de CONSTITUTION en el código

- **Class:** agent (proceso)
- **Occurrences (ledger count):** 1 (win confirmado en WS-3 B1 retro + WS-4 gate explícito)
- **Rule:** `AGENTS.md` — sección "Patrones de implementación" › `gate-order-annotation`
- **Sensor:** agents-md (entregado a cada agente vía contexto)
- **Detalle:** cuando el orden de un bloque de gates está dictado por CONSTITUTION, un comentario inline `// CONSTITUTION: gates de contrato antes de early-exits` hace visible el invariante, previene reordenamientos accidentales y permite a reviewers verificar sin buscar la regla. Derivado del win W2 de WS-4: el handler `awm sync` ya incluye este comentario y fue el único gate-order correcto en toda la sesión. WS-3 tuvo B1 por exactamente este antipatrón (early-exit antes del gate de pins).
- **Dismissed:** 5 findings (todos cosmetics o ya resueltos durante la sesión: F1 compareSemver NaN — docstring documenta contrato; F2 bySemverAsc duplication — YAGNI; F3 tmpWork muerto — cosmético; F4 non-null en test — no prod; F5 test title — sin impacto comportamental).
