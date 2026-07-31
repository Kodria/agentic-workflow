# Harness Retros

Auditable log of recurring/structural harness gaps converted into rules. See the
`harness-retro` skill for the process. Newest first.

## 2026-07-29 — ledger-clustering-and-export-path-cleanup plan: shape validation, file-convention drift, and a concurrent-git corruption incident

- **Class:** security (1 blocker) + process (1 systemic, CONSTITUTION.md) + agent (1 incident, AGENTS.md)
- **Branch:** `claude/agentic-workflow-awm-issues-dqka6l`
- **Ledger:** 36 entries (13 findings, 23 wins) across 7 plan tasks (each with per-task spec+quality review), one whole-diff final code review, and post-implementation-qa's Track A (fidelity, 0 findings) + Track B 3-lens panel (robustness/security: 1 blocker + 1 minor; logic: 0; tests: 2 minor).

### 1. Malformed-but-JSON-valid ledger entries crash `awm ledger recurring`

- **Occurrences (ledger count):** 1, but `blocker` severity — cures regardless of recurrence per modo desatendido triage.
- **Rule:** `CONSTITUTION.md` → "Validación de entrada", new bullet on shape-validating deserialized data before use.
- **Sensor:** `test` (regression tests added directly in the fix: `cli/tests/core/ledger/store.test.ts`).
- **Detalle:** `listEntries()`'s existing `try/catch` around `JSON.parse` only ever caught syntax errors; a syntactically-valid-but-shape-invalid entry (missing `desc`, `desc: null`, numeric `signature`) passed through untouched. The new clustering code (`normalizeTokens`, added by this same plan) calls `.toLowerCase()` on `signature`/`desc` unconditionally, so such an entry crashed `awm ledger recurring` with an uncaught `TypeError`, exit 1 — a genuine regression, since the pre-diff `Map`-keyed grouping never touched `desc` and tolerated the same input. Fixed with `isWellFormedEntry()`, extending the existing "skip malformed line" policy from JSON-syntax-only to shape validation of the 4 fields downstream code actually reads unconditionally.
- **Descartes (modo desatendido):** ninguno relacionado a este hallazgo.

### 2. 4-space-vs-2-space indentation drift recurred 3 times before being fully caught

- **Occurrences (ledger count):** 3 (`transform-ts-mixed-indentation-introduced` in Task 5's production code; `transform-test-indentation-mismatch-recurs` in two tests appended to an existing block in Task 6; `transform-test-strip-block-still-4space-test-style` in an entire 11-test `describe` block added by Task 5 that survived two rounds of partial fixes untouched, caught only by the whole-diff final review).
- **Rule:** `CONSTITUTION.md` → "Implementación", new bullet: match the target file's own established convention, not a sibling module's, when appending new code — and re-sweep the whole file (not just the lines a fix touched) when reviewing a partial fix to a shared file.
- **Sensor:** ninguno mecánico — this repo's `eslint.config.awm.mjs` has no `indent` rule (only `no-unused-vars`/`no-undef`/`no-unreachable`); adding a blanket AST indent rule retroactively across the whole codebase without prior audit was considered and rejected as disproportionate scope for this cure (risk of flooding `lint` with unrelated baseline noise).
- **Detalle:** Release A (`cluster.ts`/`cluster.test.ts`, new files) and Release B (`transform.ts`, an existing file) were implemented in the same session with different conventions — 4-space/`test()` for A, 2-space/`it()` already established in B. Code added to B copied A's convention instead of B's own. Each per-task fix (`b1d684b`, `5c582a6`) only re-indented the specific lines its own task had touched, never re-swept the file it was editing — so a whole block added two tasks earlier survived two separate "fixed" commits before the third, whole-diff-level review caught it.
- **Descartes (modo desatendido):** ninguno relacionado a este patrón — las 3 ocurrencias fueron curadas (2 en código durante la sesión, 1 como regla de proceso acá).

### 3. Concurrent QA subagents racing `git` commands corrupted the working tree, undetected by any subagent report

- **Occurrences:** 1, not from the ledger (this was a controller-level observation, not emitted by any reviewer) — cured anyway given severity: it silently produced 7 reverted files mid-QA, and every affected subagent's own report gave no indication anything was wrong.
- **Rule:** `AGENTS.md` → new section "Subagentes concurrentes y git".
- **Sensor:** n/a — workflow/process instruction for the controller, not a code pattern.
- **Detalle:** 4 QA lens subagents ran in parallel with Bash access to the same repo checkout. One ran `git checkout <base-commit> -- .` to inspect pre-existing-baseline sensor behavior and never fully restored — plausibly racing with its 3 siblings' own concurrent `git diff`/`git show` calls on the same tree. Commit history (HEAD, reflog) was never touched; only the working tree + index reverted to an older state across 7 files, silent until a routine `git status --short` surfaced it. Cured as: prefer `git show <ref>:<path>` (read-only) over `git checkout <ref> -- <path>` (mutates) when a subagent needs historical file content; isolate genuinely mutating comparisons in a `git worktree`; and the controller must `git status --short` after every round of parallel Bash-capable subagents, before trusting their reports.
- **Descartes (modo desatendido):** ninguno.

## 2026-07-25 — Codex CLI provider plan: shared-state overwrite, R14 singleton-agent refusal, and the fix-needs-a-test gap

- **Class:** logic (2 blockers) + structural (systemic duplication, escaping) + process (CONSTITUTION.md) + agent/API-pattern (AGENTS.md)
- **Branch:** `claude/agentic-workflow-dev-ejg4u2`
- **Ledger:** 127 entries (48 findings, 79 wins) — 80 code-quality-review, 27 spec-review, 20 post-qa — across Tasks 4-9 of `docs/plans/2026-07-24-codex-cli-provider-plan.md` (each with its own fix-and-reverify loop), one whole-implementation holistic review, and post-implementation-qa's Track A (fidelity, 0 findings — all in-scope requirement IDs implemented+tested) + Track B 3-lens panel (robustness/security, logic, tests), which found and closed 2 blockers, 7 important findings, and 1 minor.
- **Occurrences (`awm ledger recurring --min 2`):** 7 clusters, mostly the same event double-logged within seconds by a reviewer and its re-verification pass — not genuine cross-task recurrence, except `doctor-unsupported-state-conflated-with-degraded` (blocker) and `shared-skills-check-masks-broken-links`, both cured below.
- **Ledger-fragmentation self-finding:** this retro's own first `awm ledger list` pass read only 3 entries instead of 127 — `cli/.awm/ledger/` and the repo-root `.awm/ledger/` are two different files for the same branch, and prior-session `awm ledger add` calls run with `cwd=cli/` wrote to the wrong one. Cured in CONSTITUTION.md.
- **Curado en CONSTITUTION.md** ("Implementación", 3 new rules):
  1. Every fix needs its own regression test pinning the exact case it fixes — found ≥6 independent times this session (TOML escaping, malformed heartbeat, baseline hash, `planReconciliation`, mutation-targets enumeration, broken-`.toml` check) where a real bug was fixed in code but not initially anchored by a test.
  2. A status/enum value must never mean both "not applicable" and "broken" — `provider-checks.ts` reused `'unsupported'` for both a real version-incompatibility failure and a structurally-N/A check, making `awm doctor`'s `overall` unable to ever report `healthy` for a real single-provider install; `skillsGlobalCheck` had the same shape, overloading `'shared'` to also mean "shared but broken."
  3. `awm ledger`/`awm sensors` must run from the repo root, never a subdirectory with its own `.awm/` — see the self-finding above.
- **Curado en AGENTS.md** ("Patrones de diseño de API"): strengthened `reuse-discovery-not-hand-rolled-scan`'s sibling lesson (new bullet `grep-before-you-write-a-helper`) with 3 independent occurrences this session — `physicalTarget` duplicated byte-for-byte across `install-planner.ts` and `mutation-targets.ts`; `sanitizeTransactionTimestamp` duplicated with DIVERGING rules between two call sites; `resolveAgentTargets` + try/catch boilerplate repeated at 6 call sites before extraction.
- **Curado en `cli/tests/structural/codex-agent-escaping-completeness.test.ts`** (new): the TOML renderer's control-character escaping was fixed piecemeal across 5 separate review-round findings (quote runs → DEL → rest of C0 range) because each fix only tested the character it addressed. New structural test exercises the full required-escape character class plus quote-run lengths in one pass — verified it actually fires by temporarily narrowing the escape range back to the pre-fix state and confirming the test fails, then restoring the fix.
- **2 blockers found by post-implementation-qa's Track B logic lens, both fixed and verified same-session** (not separately cured beyond the process rule above, since each is a one-off logic bug rather than a durable pattern in isolation — though the R14 one is also the ledger-recurring signal noted above, occurring 3x: Task 9 discovery, `stepDevCore`/`stepAmbient`, `stepActivation`):
  - `applyInstallPlan` called `writeArtifactState(plan.records)` — a wholesale overwrite, not a merge — so every `awm init` run (which issues 3+ separate `applyInstallPlan` calls) silently discarded every earlier bundle's ownership records in `state/artifacts.json`. Fixed with `mergeArtifactRecords` (upsert by `targetPath`).
  - `stepDevCore`/`stepAmbient`/`stepActivation` each passed `agents: [d.agent]` (a singleton) to the planner, which `assertCompleteSharedGroup` (R14) refuses whenever a co-owner sharing a physical skill directory is independently enabled — making `awm init --agent codex` structurally fail once OpenCode was already enabled, the exact "multiple providers coexist" scenario this plan exists to deliver. Fixed with `agentsSharingSkillTarget`/`sharedInstallAgents`/`sharedActivationAgents`, without weakening the R14 assertion itself.
- **Sensor:** `tests/structural/codex-agent-escaping-completeness.test.ts` (structural, verified firing); the process/state-conflation/ledger-cwd rules are not independently sensor-catchable (process/agent-class lessons), same category as prior retros' CONSTITUTION.md/AGENTS.md-only cures.
- **Also fixed this session, not separately cured** (closed via the specific fix + its own regression test, no additional durable rule needed beyond the 3 CONSTITUTION.md rules above): uncaught-exception inconsistency in `init.ts`/`sync.ts` vs. sibling command files; `mutation-targets.ts` under-enumerating orphaned skill symlinks (rollback-safety gap); `reconciliation.ts`'s catch-branch comment describing a trigger condition that doesn't match reality (a plain dangling `dependsOn` is silently dropped earlier, never reaches the catch).

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

## 2026-07-27 — un test que "cree" discriminar un fix no es evidencia sin revertir y ver rojo

- **Class:** process (proceso)
- **Occurrences (ledger count):** 6 (`domain-test-redundant-scenario`, `r9-r11-identical-scenario`, `r11-redundant-domain-assertions`, `r11-precedence-mutation-not-caught` — todas sobre el mismo test R11 a lo largo de 4 rondas de fix — más `task9-test-cannot-distinguish-explicit-guard` y `r14-baseline-early-return-vacuous-test`, mismo patrón sobre el test de R14, detectado independientemente por el spec-reviewer de Task 9 y por la lente de tests de post-implementation-qa)
- **Rule:** `CONSTITUTION.md` → "Implementación", bullet fortalecido de "todo fix debe incluir un test que reproduzca el caso" — ahora exige el ciclo empírico revertir→rojo→restaurar→verde, y nombra las dos causas raíz confirmadas (fixture compartido con un test hermano más fuerte; interacción incidental que neutraliza la rama nueva).
- **Sensor:** ninguno mecánico — es un juicio sobre si un test discrimina, no un patrón estático que ESLint/semgrep pueda atrapar. Verificación es el propio ciclo revertir/rojo/restaurar/verde, aplicado manualmente por cada implementador.
- **Detalle:** en el plan `inconclusive`, el test de R11 pasó por 4 rondas de fix antes de que alguien realmente revirtiera el código y confirmara que el test fallaba — cada ronda anterior "parecía" correcta pero no lo era, porque reusaba el fixture de un test hermano (R8 o R9) cuya aserción ya dominaba cualquier mutante que R11 pudiera atrapar. El mismo patrón exacto resurgió en el test de R14 (`applyBaseline`), donde los 4 productores de `inconclusive` siempre emiten `errors: []`, así que un guard incidental preexistente (`suppressed === 0`) ya devolvía el resultado sin tocar, independientemente de si el guard explícito nuevo existía o no. El fix real requirió exportar `applyBaseline` (siguiendo el patrón ya existente de `reconcilePack`/`findManifestDir` en el mismo archivo) y escribir un test unitario que construye a mano un `SensorResult` con `errors` no vacíos — un estado que ningún productor real genera hoy, pero necesario para que el test pueda distinguir la rama explícita de la incidental.
- **Descartes (modo desatendido):** ninguno relacionado a este patrón — las 6 ocurrencias fueron curadas.

## 2026-07-27 — auditar TODAS las assertions contra el valor viejo al extender un enum, no solo los archivos del plan

- **Class:** process (proceso)
- **Occurrences (ledger count):** 2 (`enum-value-stale-assertion-audit`: Tasks 1 y 3 del plan `inconclusive` cada una encontró un test preexistente, en un archivo que el plan NO había listado, con una aserción fijada al valor viejo del enum)
- **Rule:** `CONSTITUTION.md` → "Implementación", nuevo bullet sibling a la regla existente sobre enums que significan dos cosas.
- **Sensor:** ninguno mecánico — requiere reconocer semánticamente "esto es una extensión de enum" antes de saber qué grepear; no es un patrón AST estático.
- **Detalle:** al mover una rama de `'skipped'` a `'inconclusive'` en Task 1, un test preexistente en `run.test.ts` (no listado en el plan) tenía `expect(status).toBe('skipped')` sobre el mismo caso de timeout y rompió recién al correr la suite completa. El mismo patrón exacto — un test no listado por el plan, en un archivo distinto, con la misma aserción fijada al valor viejo — volvió a aparecer en Task 3 sobre `run-tool-missing.test.ts`. Ambas veces el implementador lo manejó bien (actualizó la aserción y lo reportó como consecuencia necesaria, no como scope creep), pero ninguna de las dos veces el plan lo había anticipado.
- **Descartes (modo desatendido):** ninguno relacionado a este patrón.

## 2026-07-27 — `awm` en PATH puede ser una instalación global obsoleta, desconectada del working tree

- **Class:** agent (proceso, win estructuralizado en AGENTS.md)
- **Occurrences (ledger count):** 1, pero de alto impacto — afectó el sensor-gate de las 10 tareas del plan
- **Rule:** `AGENTS.md` → nueva sección "Auto-verificación del CLI (dogfooding)"
- **Sensor:** n/a — es una instrucción de workflow para el agente, no un check automatizado
- **Detalle:** en este sandbox, `which awm` resolvía a una instalación global npm en v3.2.0, completamente desconectada del working tree local (v3.2.2, sin publicar). Correr `awm sensors run` bare para auto-verificar el propio trabajo durante el desarrollo del CLI habría probado código viejo, no el diff real — confirmado comparando la salida del binario global (`security: skipped`, el bug que este mismo plan arregla) contra el build local (`security: fail`, correcto). Todas las tareas de este plan usaron `node dist/src/index.js sensors run` desde `cli/` en su lugar.
- **Descartes (modo desatendido):** ninguno.

## 2026-07-31 — validación de shape recurrió pese a regla ya curada; posible gap de sensor

- **Class:** structural (sensor-catchable en principio, pero fuera del alcance de sensores de este repo hoy)
- **Occurrences (ledger count):** 2 independientes en código distinto, misma rama — `listEntries()` del ledger (2026-07-29, ya curado en `CONSTITUTION.md`) y `consolidate.mjs` del kit R0 (2026-07-31, `r0-consolidate-nonobject-json-crash` blocker + `r0-consolidate-undefined-leaks-into-report` important), esta última **después** de que la regla ya existía en prosa.
- **Rule:** `CONSTITUTION.md` → "Validación de entrada", regla existente fortalecida (merge, no duplicado) con la segunda ocurrencia y una recomendación explícita de escalar a semgrep si recurre una tercera vez.
- **Sensor:** ninguno mecánico hoy. El patrón ("acceder a una propiedad de un `JSON.parse()` sin verificar antes que el resultado es un objeto con esa forma") es genérico y agnóstico a proyecto — candidato real a regla semgrep en el sensor-pack `js-ts` de `awm-baseline-registry`, pero ese cambio pertenece a ese repo, no a este (frontera documentada en `CLAUDE.md`). Se deja registrado como recomendación para una futura sesión de contenido, no aplicado acá.
- **Detalle:** durante `post-implementation-qa` de la Fase A de R0, el lens de robustness encontró que `consolidate.mjs` crasheaba con un archivo de evidencia JSON válido pero no-objeto (`null`/número/string pasa `JSON.parse` sin lanzar), y que archivos sin `provider`/`environment` renderizaban `undefined@undefined` en el reporte generado — el mismo defecto de fondo que motivó la regla curada dos días antes sobre `listEntries()`. La regla en prosa no impidió la recurrencia: nadie la consultó activamente al escribir `consolidate.mjs`, y solo un lens de QA dedicado la encontró. Esto es evidencia de que una regla de `CONSTITUTION.md` (proceso, dependiente de que un agente la recuerde) no sustituye a un detector mecánico para un patrón que ya se demostró recurrente — exactamente el tipo de brecha que el brief de optimización de ciclo (`docs/plans/2026-07-30-sdd-cycle-optimization-brief.md`) pide identificar como "sensor faltante", no como regla de proceso adicional.
- **Descartes (modo desatendido):** los otros 4 findings de robustness de esta misma QA (`r0-empty-string-flag-silent-fallback`, `r0-consolidate-missing-dir-crash`, `r0-run-single-probe-failure-loses-all-evidence`, `r0-detached-spawn-no-error-handler`) y los 2 de logic (`detached-timing-margin`, `cli-inspect-error-field-mismatch`) — cada uno ya cerrado en código con fix + verificación RED/GREEN durante el mismo fix loop, aislado a `docs/research/r0/probes/` (kit de descubrimiento descartable post-R0, fuera del alcance de gobierno de sensores de `cli/`, sin defecto de clase repetible más allá del propio fix). Estructuralizar cada uno individualmente violaría "merge-and-prune, mantener acotado" para un kit que el propio design doc declara retirable.

## 2026-07-31 — `git commit --amend --reset-author` (remedio del stop-hook de firma) destruye forense de timing

- **Class:** agent (working-style, provider-agnóstico)
- **Occurrences (ledger count):** 1, pero de alto impacto — invalidó parcialmente el razonamiento de un lens de QA completo
- **Rule:** `AGENTS.md` → "Subagentes concurrentes y git", nuevo bullet sibling sobre reescritura de historia y evidencia forense.
- **Sensor:** n/a — instrucción de workflow para el agente, no un check automatizado.
- **Detalle:** para resolver la advertencia del stop-hook sobre 8 commits sin firmar, se corrió `git rebase --exec "git commit --amend --no-edit --reset-author"` (el comando que el propio hook sugiere). `--reset-author` resetea `AuthorDate` y `CommitDate` al momento del amend, no solo la identidad — colapsando los timestamps reales de 3 tareas de trabajo de subagentes (minutos de diferencia real) a segundos entre sí. Una revisión de QA posterior (`post-implementation-qa`, lens de tests), razonando sobre esos timestamps ya corrompidos, concluyó que pasos de verificación que requieren tiempo real (un sleep de sonda de 2.5s, un ciclo RED/GREEN) no pudieron haber ocurrido — 2 hallazgos `blocker`/`important` que resultaron ser falsos positivos con causa raíz identificable (el propio rebase), no evidencia de trabajo no hecho. Se confirmó comparando `AuthorDate`/`CommitDate` de los 8 commits reescritos: todos caen en la misma ventana de 1-2 segundos, coincidiendo con el momento del rebase, no con el de cada implementación original.
- **Descartes (modo desatendido):** ninguno relacionado a este patrón — la única ocurrencia fue curada.

## Resueltos durante la sesión, sin curación adicional

- `task6-r1-test-unneeded-third-sensor` (minor): test de R1 incluía un tercer sensor sin uso — simplificado durante la sesión, no requiere regla — cosmético y ya cerrado.
- `skipped-plus-inconclusive-overall-untested` (minor): test sin assert de `overall` — agregado durante el fix loop de QA, no requiere regla — gap puntual ya cerrado.
- **Plan `ledger-clustering-and-export-path-cleanup` (2026-07-29), 10 findings resueltos en código sin regla adicional:** `ledger-cluster-unused-ledgerentry-import` (falso positivo — deliberado, resuelto dando contexto al reviewer), `cluster-representative-cast-instead-of-non-null-assertion` (nit de estilo, fix de una línea), `url-guard-false-negative-after-parenthetical-strip` (bug real, fix estructural: regex de una sola pasada + test de regresión — ancla suficiente sin regla adicional), `path-shape-duplicated-across-path-src-and-pathlessform` (residuo de Task 5, cerrado en el fix loop de QA derivando `pathlessForm` de `PATH_SRC`), `export-pathlessform-unreachable-throw-aborts-bundle` (mismo fix que el anterior — el desync que lo hacía posible quedó estructuralmente cerrado), `cluster-no-min-boundary-test` y `url-guard-pathstart-zero-untested` (gaps de test coverage puntuales, cerrados con un test cada uno). Ninguno generaliza a una clase de bug repetible más allá del fix aplicado — cada uno queda anclado por su propio test de regresión, consistente con la regla ya vigente en `CONSTITUTION.md` ("todo fix debe incluir un test que reproduzca el caso").
- Wins de diseño reforzados en el ledger pero no curados a AGENTS.md (`ledger-cluster-overlap-coefficient-choice`, `ledger-cluster-union-find-deterministic`, `whole-diff-two-releases-genuinely-independent`, y las 5 wins de `strip-intra-registry-paths-core-logic-sound`): decisiones correctas específicas del código de este plan, no patrones reusables por sesiones futuras — mantener AGENTS.md como índice curado, no diario de sesión.
