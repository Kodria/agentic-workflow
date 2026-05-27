# Harness Retros

Auditable log of recurring/structural harness gaps converted into rules. See the
`harness-retro` skill for the process. Newest first.

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
