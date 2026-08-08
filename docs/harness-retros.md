# Harness Retros

Auditable log of recurring/structural harness gaps converted into rules. See the
`harness-retro` skill for the process. Newest first.

## 2026-08-08 — Post-plan closure: `awm init -a copilot` crash — tercera instancia de `defensive-guard-consistency`

- **Class:** structural (bug real, encontrado en verificación final, no parte de una tarea del plan)
- **Occurrences (ledger count):** tercera instancia confirmada del patrón ya curado `defensive-guard-consistency` en AGENTS.md (instancia 1: `checkManifest`/`computeSensorStatus`/`runSensors`, R3; instancia 2 y 3: `devCore`/`ambient` en `gatherMachine`, este hallazgo).
- **Rule:** `AGENTS.md` → extiende `defensive-guard-consistency` con la instancia de `gatherMachine` (merge-and-prune, no bullet nuevo).
- **Sensor:** ninguno mecánico — el propio `code-quality-reviewer` de la Task 4.x original no lo cazó porque revisaba el diff de esa tarea, no el árbol completo de consumidores de `skillsDir`/`skill.global`; el fix definitivo se verificó con un grep exhaustivo de ambos campos en `cli/src/core/diagnostics/` y `cli/src/core/init/`.
- **Detalle:** durante la verificación global de cierre del plan `2026-08-07-team-rollout-hardening` se encontró que `awm init -a copilot` fallaba de forma determinística en el 100% de las corridas — `gatherMachine` (`cli/src/core/diagnostics/context.ts`) computaba `devCore.present` como permanentemente `false` para cualquier agente sin directorio global de skills (hoy: solo Copilot, cuyo mecanismo de entrega es exclusivamente local vía `managed-agents-md`), así que `stepDevCore` nunca podía tomar su propio guard de skip y siempre intentaba un install de scope GLOBAL condenado a tirar ("skill global scope is not supported by Copilot"), con rollback completo de la transacción — incluso los artefactos locales del proyecto se revertían. Corregido tratando el caso "sin mecanismo global" como N/A-satisfecho, igual que ya hacía el step hermano `stepGlobalSkillsRepair`. Un spec-review posterior sobre ese mismo fix encontró, por grep exhaustivo, que el cómputo `ambient` en la MISMA función tenía el idéntico bug sin corregir — mismo síntoma exacto si `~/.awm/config.json` declaraba un bundle `ambient`. También se encontró y corrigió un test nuevo que no discriminaba el fix (pasaba en verde incluso revirtiendo el fix, por usar un fixture hardcodeado en vez de ejercitar `gatherContext` real) — mismo patrón que la lección ya curada `verify-fix-by-revert-not-just-green`.
- **Descartes:** el hallazgo secundario y no relacionado (`skill-source.ts`'s `parseSkillSource` rechaza `description: >-` en formato YAML block-scalar como vacío, rompiendo `awm add frontend` para cursor/copilot con contenido real del registry) se registra como seguimiento pendiente, NO curado en este retro — es una causa raíz distinta (parsing de contenido, no gating de steps de init) y queda fuera del alcance de este bug puntual.

## 2026-08-08 — R7: fix cableado a la función hermana equivocada, triple-disparo de un side-effect compuesto, checkboxes de plan sin marcar (recurrente)

- **Class:** structural-testing (fix en función hermana equivocada) / logic (side-effect triplicado) / proceso (checkboxes de plan)
- **Occurrences (ledger count):** el patrón de "fix en la función equivocada, verde por testear la función hermana" extiende `verify-fix-by-revert-not-just-green` (≥5ta instancia); el side-effect triplicado es 1 ocurrencia pero sistémica (3 call-sites, 2 archivos de producción, ninguno cazado en aislamiento); "checkboxes de plan sin marcar" es recurrente (`awm ledger recurring` agrupa `r1-plan-checkboxes-unmarked` con la instancia de R7, count≥2 en el cluster).
- **Rule:** `AGENTS.md` → extiende `verify-fix-by-revert-not-just-green` con la variante de función hermana; nuevo bullet `duplicate-side-effect-across-composed-functions`. `CONSTITUTION.md` → nuevo bullet sobre marcar checkboxes de plan como parte del cierre de cada release, no como hallazgo de QA posterior.
- **Sensor:** ninguno mecánico para ninguno de los tres — son de disciplina de verificación/diseño (function-wiring, composición de side-effects) o de proceso de release (checkboxes), no detectables por lint/tsc estático.
- **Detalle:** R7's `post-implementation-qa` (4 lentes: fidelidad + robustness + logic + tests) encontró, de forma INDEPENDIENTE en 3 lentes distintas, el mismo bug raíz: el fix de R7 que corrigió un mensaje de diagnóstico de Windows obsoleto agregó el mensaje nuevo a `renderReport` (`cli/src/commands/doctor.ts`) — pero esa función solo la invoca `awm init`, nunca `awm doctor`, que usa `renderProviderReport`, una función DISTINTA y de forma similar. El test nuevo (`doctor-platform.test.ts`) testeaba `renderReport` directamente y pasaba en verde, dando falsa confianza mientras el comando real (`awm doctor`) — el que el propio comentario del código señalaba como "donde un operador busca este tipo de detalle" — nunca mostraba el mensaje. Ligado a esto: al mover la llamada a un lugar único, se descubrió que `awm init` disparaba el MISMO mensaje 3 veces por corrida (1 llamada directa + 2 embebidas en el resumen antes/después, cada una gateada independientemente por la misma condición) — un side-effect compuesto que ningún test cazó porque cada función se testeaba aislada, nunca el flujo completo del comando. Ambos se corrigieron: el caveat ahora vive solo en `renderProviderReport` (la ruta real de `awm doctor`), y las llamadas de `init`/`update`/`sync` se movieron de los closures `.action()` (no testeables) a las funciones `run*Core` ya cubiertas por el harness de tests existente, disparando una sola vez cada una — verificado con revert-and-rerun (retiro el fix, el test nuevo cae; restauro, vuelve a verde). Por separado, la misma corrida de QA encontró que R6 quedó merged con sus checkboxes de plan (`Task 6.1`-`6.3`) todavía en `- [ ]` pese a estar genuinamente cerrado — mismo patrón que `r1-pr-not-opened`/`r1-plan-checkboxes-unmarked` de R1, ahora confirmado recurrente entre releases distintas del mismo plan.
- **Descartes (modo desatendido):** 2 hallazgos menores de tests.md (caso negativo de `doctor-platform.test.ts` solo cubría linux no macOS; `noteWindowsCaveat` sin test de logger que lanza excepción) se corrigieron en el mismo fix pero NO se curaron como lección — son gaps de cobertura puntuales de una función específica, ya cerrados con su propio test, sin evidencia de recurrencia. El hallazgo de Track A sobre el fix de `paths.ts` no estar itemizado en el checklist de la Task 7.1 (`r7-untracked-windows-msg-scope`) se descartó como lección — ya fue evaluado como scope justificado (corrige una contradicción real entre CONSTITUTION.md y el código, testeado) por el propio spec-review y el lens de fidelidad, no amerita una regla nueva.

## 2026-08-08 — R6: primera corrida real contra `windows-latest` — 3 patrones de testing sistémicos, una reversión arquitectónica, un ledger vacío

- **Class:** structural (win32-ps-pgrep-msys-blind, win32-file-mode-always-0o666) / structural-testing (over-broad-process-kill-mock) / proceso (wmi-refisalive-false-negative-reverted, external-controller-lifecycle-unresolved-gap, empty-ledger-during-direct-ci-debugging)
- **Occurrences (ledger count):** `win32-ps-pgrep-msys-blind` recurring ≥2 with R1's prior entries (`exec-killtree-win32-no-coverage`); over-broad-mock pattern recurring exactly 2 (`adapter.test.ts`, `gate-reconcile.test.ts`); the remaining four are single-occurrence but high-impact (blocker/important severity) — cured per the "blocker or systemic alone cures" rule of modo desatendido, not on recurrence count.
- **Rule:** `AGENTS.md` → new bullets `windows-ci-gotchas` and `external-tool-reliability-needs-multiple-real-confirmations` under "Patrones de testing"; new bullet under new section "Ledger y trazabilidad" (`empty-ledger-during-direct-ci-debugging`), which also absorbed the pre-existing `awm ledger add puede correr dos veces` bullet for locality.
- **Sensor:** none mechanical for any of these — all are either platform-specific runtime behavior (not statically detectable) or agent-process discipline (ledger emission). The `win32-ps-pgrep-msys-blind` and `win32-file-mode-always-0o666` classes are now documented extensively in-code (`cli/src/core/journal/process.ts`) as the durable "sensor" — any future win32 branch touching process liveness or file mode should read those comments first.
- **Detalle:** R6 added the CLI's first-ever PR-triggered CI (`.github/workflows/ci.yml`, ubuntu+windows matrix), which meant this repo's cross-platform test suite ran against real Windows for the first time — previously all Windows coverage was `process.platform` mocked locally. windows-latest surfaced 137 real failures across 6 iterative rounds against real CI, driven down to 0 confirmed-green + 4 tests honestly scoped POSIX-only as a documented, unresolved gap (external controller full lifecycle: spawn → wrapper-persisted identity → `collectControllerGeneration` adoption, never converged despite 4 distinct evidence-based attempts touching `process.ts`'s WMI usage, `activitySnapshot`, and `spawnStructured`'s `detached` flag both ways). One of those attempts (round 2's WMI-based `refIsAlive` identity comparison) was itself reverted in round 3 after a real false negative on its first live CI run — a genuine, documented architectural course-correction, not a symptom patch (see the extensive comment on `refIsAlive` in `process.ts`). Separately: the entire 6-round debugging cycle produced **zero** ledger entries because the work was done by reading CI logs and patching directly, never routing through `systematic-debugging`'s formal invocation — `harness-retro`'s own "empty-ledger consistency check" caught this and the ledger was reconstructed post-hoc from session evidence before this retro ran.
- **Descartes (modo desatendido):** dozens of routine per-file mode-bit/path-separator/PATH-delimiter fixes (R1-style POSIX-isms, already an established, cured pattern from prior releases) were applied but not logged as new lessons — same root class as already-cured `execFileSync-not-execSync`/prior win32 audits, not a new pattern. The unresolved external-controller-lifecycle gap was NOT force-cured into a fake "rule" — there is no mechanical fix to draft without real Windows access to instrument further; it is recorded here and in the scoped tests' comments as an open item for a future session with real Windows access, not silently dropped.

## 2026-08-08 — R5: predicado duplicado a la vista, en el mismo archivo — cuarta ocurrencia de `grep-before-you-write-a-helper`

- **Class:** structural
- **Occurrences (ledger count):** cuarta instancia de un patrón con 3 ocurrencias previas ya curadas (plan Codex: `physicalTarget`, `sanitizeTransactionTimestamp`, `resolveAgentTargets`)
- **Rule:** `AGENTS.md` → "Patrones de diseño de API", extiende el bullet existente `grep-before-you-write-a-helper` con una cuarta instancia — merge-and-prune, no bullet nuevo.
- **Sensor:** ninguno mecánico — candidato a regla ESLint genérica (`no-duplicate-predicate`-style, comparando AST de dos funciones en el mismo archivo) pero fuera de alcance de un sensor-pack genérico.
- **Detalle:** `checkSensorsBaseline` (`cli/src/commands/preflight/checks.ts`, R5 Task 5.1) copió literalmente la fórmula `enabled`/`total` de `checkManifest`, ~100 líneas arriba en el MISMO archivo, en vez de extraerla o reusarla — no hacía falta ni un grep cross-módulo, el sibling estaba a la vista. El lens de robustez de `post-implementation-qa` lo encontró: un manifest con un sensor `null` ya crashea en `checkManifest` hoy (no alcanza a `checkSensorsBaseline`), pero la duplicación deja la misma mina lista para explotar el día que alguien blinde una copia sin acordarse de la otra — exactamente el riesgo que motivó las 3 instancias previas de esta lección. Curado extrayendo `countEnabledSensors()` compartida, reusada por ambas funciones.
- **Descartes (modo desatendido):** el hallazgo `preflight-formatreport-hardcoded-id-padding`/`r5-preflight-format-padend-misaligned` (columna de `awm preflight` desalineada por un `.padEnd(9)` hardcodeado, encontrado independientemente por 2 lentes de QA en la misma ronda) se corrigió (ancho derivado del id más largo presente) pero NO se curó como lección — es una única ocurrencia de severidad minor/cosmética, sin evidencia de recurrencia entre releases; la detección duplicada por 2 lentes en la misma ronda de QA es señal de cobertura, no de patrón sistémico del agente. Se deja como fix puntual con su propio regression test.

## 2026-08-08 — R4: fix con regression test que no cubre la línea que arregla el bug (segunda lección nueva, no extensión)

- **Class:** agent (working-style) / proceso
- **Occurrences (ledger count):** ≥4 en la sesión, 3 releases (`r3-shell-isfile-fix-untested`, `shell-detect-isfile-no-regression-test` en R1; `formatter-dispatch-untested` en R3; el fix de `stepContextInjection` en R4, sin signature propia en el ledger porque lo encontró el code-quality-reviewer del propio batch de QA fixes, no un lens de `post-implementation-qa`)
- **Rule:** `AGENTS.md` → "Patrones de testing", nuevo bullet `verify-fix-by-revert-not-just-green`.
- **Sensor:** ninguno mecánico — "¿este test fallaría si revierto solo esta línea?" no es verificable estáticamente; queda como disciplina de verificación, no como regla de lint.
- **Detalle:** al cerrar R4's post-implementation-qa (2 blockers, 5 important, 3 minor), el fix de blocker 2 (`stepContextInjection` en `cli/src/core/init/steps.ts`, cambiar `projectRoot: d.cwd` por `projectRoot: d.ctx.project?.root ?? d.cwd` para que coincida con el `findProjectRoot(cwd)` que `mutation-targets.ts` usa al enumerar targets de backup) se implementó, verificó con `npx tsc --noEmit && npx jest` en verde (152/152 suites), y se dio por cerrado. Un code-quality-reviewer independiente, revisando el batch completo antes del commit, revirtió ÚNICAMENTE esa línea y volvió a correr `steps.test.ts` + `init.test.ts`: los 65 tests siguieron en verde. El test existente para el escenario Copilot usaba `project: null`, donde el fallback `?? d.cwd` enmascara el fix por completo — nunca ejercita la divergencia `cwd` vs `project.root` que el fix existe para resolver. Se agregó un test nuevo (`awm init` corriendo desde un subdirectorio del project root) que sí falla al revertir la línea, confirmado antes de comitear. Mismo patrón exacto ya visto 3 veces antes en R1/R3 (fix real, test nuevo, pero el test no ejercita la línea específica) — nunca antes curado en el harness pese a la recurrencia, porque cada instancia se trató como un hallazgo aislado de `post-implementation-qa` en vez de reconocerse como la misma clase de gap repitiéndose.
- **Descartes (modo desatendido):** el resto de hallazgos del reviewer (`\x7F` no escapado por `JSON.stringify`) se curó extendiendo `prefer-stdlib-over-hand-rolled-parsing` (cuarta instancia) en vez de como lección nueva — mismo patrón raíz, no uno distinto. La opinión arquitectónica del reviewer sobre `withProjectGuidance`/`injectProject` (invariante implícito mantenido a mano entre dos funciones, no un mecanismo estructural) se descarta como lección curable ahora: es una observación única, no recurrente, y no hay regla mecánica que la prevenga sin un rediseño de `managed-block.ts` (slots nombrados) fuera de alcance de este release — queda documentada en el diff/PR como nota de diseño para un futuro tercer consumidor de la misma AGENTS.md local.

## 2026-08-08 — R4: premisa no verificada sobre cobertura de un mecanismo estándar — cuarta ocurrencia del patrón de parsing/escaping

- **Class:** structural
- **Occurrences (ledger count):** cuarta instancia de un patrón con 3 ocurrencias previas ya curadas (`shellQuote` R1, `extractHost` R2, `parseRuffOutput`/`parseShellcheckOutput` R3)
- **Rule:** `AGENTS.md` → "Patrones de implementación", extiende el bullet existente `prefer-stdlib-over-hand-rolled-parsing` con una cuarta instancia — merge-and-prune, no bullet nuevo.
- **Sensor:** ninguno mecánico — candidato a regla ESLint/semgrep genérica ("comentario que afirma cobertura de un rango de bytes/caracteres sin test que lo pruebe byte por byte") pero demasiado específico para el sensor-pack genérico de AWM; queda como recomendación.
- **Detalle:** `yamlString()` (`cli/src/core/renderers/cursor-mdc.ts`, R4 Task 4.3) traía un comentario afirmando "JSON.stringify itself \u-escapes control bytes" como justificación de por qué era seguro usarlo como único mecanismo de escaping para el frontmatter YAML de Cursor. Un code-quality-reviewer independiente, revisando el batch de fixes de post-implementation-qa, RENDERIZÓ el caso adversarial en vez de confiar en el comentario: `JSON.stringify("a\x7fb")` deja el byte DEL (`0x7F`) sin escapar — JSON solo exige escapar `0x00`-`0x1F`, no `0x7F`. Confirmado contra el propio comportamiento del runtime, no contra una lectura de la spec. Fix: `yamlString` ahora post-procesa la salida de `JSON.stringify` para escapar `\x7F` explícitamente. Mismo patrón exacto que las tres instancias previas (parsing hand-rolled, o un tipo TS sin guard runtime, que "funciona" contra los casos obvios pero falla contra uno que nadie enumeró) — esta vez sobre una premisa de cobertura de stdlib en vez de una regex escrita a mano, extendiendo el alcance de la lección.
- **Descartes (modo desatendido):** ninguno — instancia curada extendiendo el bullet existente, no como lección separada, dado que es la misma raíz.

## 2026-08-07 — R3: guarda defensiva agregada a una función pero no a sus hermanas que leen el mismo campo

- **Class:** structural
- **Occurrences (ledger count):** 2 (cluster convergente en `awm ledger recurring`: `getformatter-unrecognized-value-silent-fallback`, `sensor-status-crash-null-sensors`, `sensors-run-crash-null-sensors`, todas ramificaciones del mismo hallazgo de robustez)
- **Rule:** `AGENTS.md` → "Patrones de implementación", nuevo bullet `defensive-guard-consistency`.
- **Sensor:** ninguno mecánico — este repo no dogfoodea `.awm/sensors.json`. Candidato a regla ESLint genérica ("todo `Object.entries(X.campo)` sin `?? {}` cuando existe ≥1 sibling con la guarda") pero demasiado específico del shape de este proyecto para el sensor-pack genérico de AWM — queda como recomendación, no aplicado.
- **Detalle:** `checkManifest` (`cli/src/commands/preflight/checks.ts`) ya tenía `manifest.sensors ?? {}` desde antes de R3, para tolerar un `.awm/sensors.json` corrupto/editado a mano con `"sensors": null`. Al introducir el manifest honesto-degradado de Task 3.3 (`sensors: {}` cuando el registry no tiene pack), dos funciones HERMANAS que leen el mismo campo — `computeSensorStatus` (`status.ts`) y `runSensors` (`run.ts`) — no recibieron la misma guarda, y `sensors: null` las crasheaba (`TypeError: Cannot convert undefined or null to object`), tumbando `awm sensors status`, `awm sensors run`, y transitivamente `awm preflight`. El code-quality-reviewer de Task 3.3 revisó el diff de esa task en aislamiento y no lo cazó; lo encontró el lens de robustez de `post-implementation-qa`, que sí compara contra el árbol completo de consumidores del campo. La lección: al agregar una guarda defensiva, grep de TODAS las lecturas del mismo campo (`grep -rn "\.sensors\b"`) y confirmar que cada una la tiene — no asumir que arreglar el call site que se está tocando cubre a sus hermanos.
- **Descartes (modo desatendido):** ninguno.

## 2026-08-07 — R3: parsing hand-rolled falla contra JSON válido de forma inesperada — tercera ocurrencia del patrón, ahora sobre tipos TS sin validación runtime

- **Class:** structural + seguridad (crash del proceso completo, no solo de un sensor)
- **Occurrences (ledger count):** 3 (cluster convergente `ruff-formatter-crash-nonarray-json`: `ruff-formatter-crash-nonarray-json`, `ruff-formatter-crash-null-fields`, `shellcheck-formatter-crash-nonarray-json`)
- **Rule:** `AGENTS.md` → "Patrones de implementación", extiende el bullet existente `prefer-stdlib-over-hand-rolled-parsing` (curado en R2) con esta tercera instancia — merge-and-prune, no bullet nuevo.
- **Sensor:** ninguno mecánico — candidato a regla ESLint genérica del sensor-pack `js-ts` ("acceso a propiedad sobre el resultado de `JSON.parse` sin `Array.isArray`/guard de forma previo"), pero queda como recomendación por la misma frontera genérico/específico de `CLAUDE.md` — no aplicado en este repo.
- **Detalle:** `parseRuffOutput`/`parseShellcheckOutput` (`cli/src/commands/sensors/formatters/{ruff,shellcheck}.ts`, ambos nuevos en R3) declaraban un tipo TypeScript (`RuffMessage[]`/`ShellcheckMessage[]`) sobre `JSON.parse(raw)` y leían sus campos directamente. El tipo es una promesa que el compilador no verifica en runtime: `JSON.parse('{}')`, `'null'`, `'42'`, o un elemento `null` dentro de un array son JSON *válido* que no calza esa forma — `for (const msg of parsed)` u otro acceso a propiedad crashea con una excepción no capturada que tumba el `awm sensors run` COMPLETO (todos los sensores, no solo el que falló), confirmado reproduciendo contra el pipeline real (`Promise.all` sin guard, `commander`'s `.action` sin try/catch). Encontrado por el lens de robustez de `post-implementation-qa`, no por spec-review — exactamente la clase de gap para la que ese lens existe. Mismo patrón de fondo que `shellQuote` (R1, 3 rondas) y `extractHost` (R2, 2 rondas): lógica hand-rolled — acá, una anotación de tipo sin guard runtime — que "funciona" contra los casos obvios pero falla contra una forma que nadie enumeró explícitamente. La contramedida sigue siendo la misma: preferir una implementación ya verificada contra la especificación completa cuando existe (URLs → `URL` estándar); cuando no existe (una forma de JSON externa, específica de una herramienta de terceros), validar la forma en runtime explícitamente ANTES de leer cualquier campo — un tipo TS sobre `JSON.parse()` nunca es una garantía.
- **Descartes (modo desatendido):** ninguno — instancia curada extendiendo el bullet existente, no como lección separada, dado que es la misma raíz.

## 2026-08-07 — R2: parsing hand-rolled falla contra casos adversariales no enumerados, dos veces en la misma sesión

- **Class:** agent (working-style)
- **Occurrences (ledger count):** 2 instancias independientes en la misma sesión (`shellQuote` en R1, `extractHost` en R2), cada una necesitando múltiples rondas de fix antes de estar bien
- **Rule:** `AGENTS.md` → "Patrones de implementación", nuevo bullet `prefer-stdlib-over-hand-rolled-parsing` (sibling de `shell-quote-verify-against-primary-source`, curado antes en R1 el mismo día).
- **Sensor:** ninguno mecánico — este repo no dogfoodea `.awm/sensors.json`.
- **Detalle:** `extractHost()` (`cli/src/commands/preflight/checks.ts`) necesitó dos rondas de fix: la regex original hacía match contra la URL completa (bug encontrado en code-quality review), el fix "por hostname" seguía capturando `userinfo@host:puerto` como un bloque en vez de aislar el host real (bug encontrado por el lens de robustez de `post-implementation-qa`, con un repro concreto: `https://user:gitlab@example-host.com/...` — patrón real de inyección de credenciales en CI — se clasificaba mal por la substring "gitlab" en el token, no en el host). El fix final reemplazó la regex por `new URL(remote).hostname`, resolviendo la clase entera de una vez contra la especificación real, en vez de seguir puliendo la regex a mano. Mismo día, mismo patrón: `shellQuote()` de R1 necesitó TRES rondas antes de estar bien (ver retro anterior). Ambos casos comparten la misma forma: un subagente escribe lógica de parsing/quoting a mano que pasa contra los casos obvios del spec, y un review posterior (no el mismo que implementó) encuentra un caso adversarial que nadie había enumerado explícitamente. La lección no es "revisar mejor a mano" — ya se intentó, dos veces, en la misma sesión, y ambas veces la segunda ronda de revisión humana/agente encontró lo que la primera no vio. La lección es preferir, cuando existe, una implementación de librería estándar ya verificada contra la especificación completa (`URL`, `CommandLineToArgvW` documentado) en vez de regex/lógica hand-rolled, incluso cuando el caso parece "simple".
- **Descartes (modo desatendido):** ninguno — ambas ocurrencias curadas en el mismo bullet de `AGENTS.md`, dado que son instancias del mismo patrón de fondo, no dos lecciones separadas.

## 2026-08-07 — R1 (hotfix Windows): quoting para `cmd.exe` mal derivado por intuición, tres veces en un release

- **Class:** agent (working-style) + seguridad
- **Occurrences (ledger count):** 5 (cluster convergente `win-shellquote-cmdexe-metachar`, agrupa 3 signatures distintas del mismo patrón de fondo a lo largo de Task 1.3, post-implementation-qa y su fix)
- **Rule:** `AGENTS.md` → "Patrones de implementación", nuevo bullet `shell-quote-verify-against-primary-source`.
- **Sensor:** ninguno mecánico — este repo no dogfoodea `.awm/sensors.json` (usa `npm run build && node dist/src/index.js` + `tsc`/`jest` para auto-verificación, per "Auto-verificación del CLI (dogfooding)"). El patrón es agnóstico de proyecto y candidato a regla semgrep en el sensor-pack `js-ts` de `awm-baseline-registry` (frontera documentada en `CLAUDE.md`) — queda registrado como recomendación, no aplicado acá.
- **Detalle:** `shellQuote()` (`cli/src/commands/sensors/changed.ts`) tuvo que corregirse TRES veces en un solo release antes de quedar bien: (1) Task 1.3's propia auditoría encontró que la convención de escape de comillas embebidas en Windows era `""` (doblado) en vez del `\"` real de `CommandLineToArgvW` — corregido, pero considerado "moot" porque Windows prohíbe comillas literales en nombres de archivo; (2) `post-implementation-qa`'s lens de lógica encontró, por trazado manual contra la regla documentada de Microsoft, que los backslashes no se duplicaban antes de una comilla — corrompe archivos terminados en `\`; (3) el mismo QA, lens de robustez/seguridad, encontró que el wrapping `"..."` NO neutraliza los operadores de `cmd.exe` (`& | < > ^ %`) — vector de inyección de comandos real, alcanzable recién en este release porque el bug de PATH que R1 arregla mantenía ese código muerto en Windows hasta ahora. El fix de (2)+(3) exigió investigación contra fuentes primarias (`systematic-debugging`, WebSearch/WebFetch reales, no memoria de entrenamiento) antes de escribir una línea: el algoritmo exacto de Microsoft para (2), y la investigación BatBadBut/CVE-2024-27980 — la misma que motivó el propio fix de Node.js para esta clase de vulnerabilidad — para (3), cuyo hallazgo fue que ni el propio autor de esa investigación está seguro de que su algoritmo de escape sea seguro. Por eso el fix de (3) no intenta escapar mejor: rechaza el filename peligroso y degrada a la corrida completa/sin acotar, reusando el mecanismo de fallback que el módulo ya tenía para "el scope no se pudo resolver" — mismo camino que tomó el equipo de seguridad de Node.
- **Descartes (modo desatendido):** el resto de la clusterización por `awm ledger recurring --min 2` son duplicados de praise/hallazgo ya resueltos en su propia ronda de fix+re-review, sin patrón nuevo que curar más allá de lo ya aplicado: `audit-grep-execfilesync-coverage`/`plan-doc-attribution-fix`, `changed-posix-combined-case`, `missing-posix-success-path-test`/`status-windows-missing-negative-case`, `posix-audit-grep-sweep-exhaustive`/`r1-audit-scope-clean`, `win32-argv-quote-exact-algorithm` (verificación duplicada de la misma cosa). `posix-audit-grep-misses-execfilesync`/`r1-plan-checkboxes-unmarked` se agruparon por similitud de embedding, no por recurrencia real — son dos hallazgos no relacionados, ambos ya cerrados individualmente. `r1-pr-not-opened` (important) no es un hallazgo de código — su remedio es la fase siguiente misma (`finishing-a-development-branch`), no algo que se descarta ni se cura.

## 2026-08-07 — `awm ledger add` duplicado infla el conteo de recurrencia sin que haya una segunda ocurrencia real

- **Class:** agent (working-style, proceso de la propia sesión)
- **Occurrences (ledger count):** ≥4 pares exactos en un solo release (`resolveonpath-extraction`, `exec-killtree-win32-no-coverage`, `doc-comment-dual-case-accurate`, más entradas de prueba sueltas `test-entry-check-delete-me`/`test-echo`)
- **Rule:** `AGENTS.md` → "Subagentes concurrentes y git", nuevo bullet.
- **Sensor:** n/a — instrucción de workflow para el controlador, no un check automatizado.
- **Detalle:** varios subagentes de review, en fases y tareas distintas de este mismo release, invocaron `awm ledger add` dos veces para el mismo hallazgo/win (mismo `phase`+`signature`+`desc`, timestamps a milisegundos), y al menos uno dejó una entrada de prueba (`test-echo`) al verificar que `awm` respondía antes de loguear el hallazgo real. Esto no cambió ninguna decisión durante esta sesión porque el controlador reconcilió contra `awm ledger list` completo (contenido real) en cada paso en vez de confiar en el resumen en prosa de cada subagente o en el conteo crudo de `awm ledger recurring` — pero el riesgo es real: ese conteo puede empujar de forma espuria un hallazgo trivial a la categoría "sistémico" del triage de modo desatendido si alguien lo lee sin desduplicar primero.
- **Descartes (modo desatendido):** ninguno relacionado — la única ocurrencia (el patrón de doble-log en sí) queda curada.

## 2026-08-01 — R1 review final: límites durables validados y mutación transaccional

- **Class:** structural/logic/security.
- **Occurrences (ledger count):** 4 hallazgos convergentes en requests (`corrupt-request-prestate-rename`, `request-quarantine-before-state`, `request-rename-before-journal`, `nested-request-shape-wedge`), más blockers relacionados en cycle/job/result/identity shapes.
- **Rule:** `CONSTITUTION.md` → “Validación de entrada”, regla existente fusionada y fortalecida: todo dato deserializado entra como `unknown`, se valida recursivamente, se aplica sobre copia y cualquier cuarentena ocurre después del journal durable.
- **Sensor:** corpus negativo en `cli/tests/core/journal/types.test.ts`, `cli/tests/core/journal/store.test.ts`, `cli/tests/commands/watch/apply.test.ts` y `cli/tests/commands/watch/runner.test.ts`. Cubre nested payloads, enums inválidos, sidecars parciales/sin claim, compatibilidad schema 1 y crash antes de quarantine. El gate final además reprodujo `zombie-group-false-ownership`; `process.test.ts` ahora fija que un grupo compuesto solo por zombies está terminado y el E2E confirma shutdown + liberación del lock.
- **Verification:** prueba roja fabricada al debilitar temporalmente `isWellFormedJob` para aceptar `argv` no-string; `types.test.ts` detectó el shape inválido. Restaurado el guard, el corpus focalizado quedó verde.
- **Descartes (modo desatendido):** `adapter-contract-incomplete`, `missing-explicit-attempt-qa-entities`, `provider-neutrality-battery-missing` — gaps amplios del diseño original que requieren decisión de producto; `detached-descendant-unasserted` — un proceso que crea deliberadamente un PGID nuevo escapa al contrato portable de process-group ownership, por lo que no se disfrazó como fix parcial; `controller-exactly-once-unproven`, `shutdown-lock-retention-uncovered`, `reconcile-generation-output-untested`, `activity-read-failure-semantics-unasserted` — deuda adicional de cobertura, mientras los invariantes concretos sí tienen regresiones directas en este lote. Los demás hallazgos blocker/important del ledger fueron corregidos y cubiertos en código.

## 2026-08-01 — R1 durable-controller plan: EPIPE-relay stdio defaults + redact.ts fail-closed whack-a-mole

- **Class:** security/structural (1 systemic, new `tests/structural` sensor) + process (1 systemic, CONSTITUTION.md)
- **Branch:** `claude/agentic-workflow-awm-issues-dqka6l`
- **Ledger:** 253 entries (83 findings, 170 wins) across 22 SDD tasks (each with spec+quality review and fix loops), one whole-implementation final review, and post-implementation-qa's Track A (fidelity, all in-scope requirement IDs implemented+tested) + Track B 4-lens panel (robustness/security, logic, tests, plus a dedicated adversarial re-review of the QA fix batch itself, which caught one self-introduced regression — verdictId/idempotencyKey scope mismatch, fixed same session).
- **Blockers found this session:** 17. Two systemic classes stood out across independent findings in different files/tasks; both cured below.

### 1. execFileSync/spawn/spawnSync with unspecified `stdio` — EPIPE-relay crash class

- **Occurrences (ledger count):** 5+ distinct call sites across 5 files, found in 3 separate rounds — `recurring-external-process-stdio-defaults` (Task 20, `spawnStructured` + 4 bare `execFileSync` calls in `process.ts` itself), then `epipe-stdio-git-branchof` (blocker) and `epipe-stdio-fingerprint-git` (important) found by post-implementation-qa in `lock.ts`/`job/index.ts`/`watch/index.ts`/`fingerprint.ts` — not covered by the first fix — plus a bonus `spawnSync('zip', ...)` in `pack.ts`.
- **Rule:** `cli/tests/structural/exec-invocation-explicit-stdio.test.ts` (new) — scans every `.ts` file under `cli/src` for `execFileSync`/`spawn`/`spawnSync` call sites and fails if any lacks an explicit `stdio` option or the shared `EXEC_STDIO` constant.
- **Sensor:** `test` (structural) — verified firing: temporarily stripped the `stdio: 'ignore'` line from `spawnStructured` in `process.ts`, confirmed the test failed with the exact call site named, restored the line, confirmed green again.
- **Detalle:** Node's default `stdio` for `execFileSync`/`spawn` relays the subprocess's stderr onto the CALLING process's own stderr fd (`inheritStderr`). When that fd is a destroyed/broken pipe — a detached wrapper whose parent already tore down its own pipes, in this case — the relay itself raises an async, unlistened EPIPE, which Node re-throws, silently crashing the caller mid-work. Root-caused via direct revert/reproduce/reapply after ~4 hours of a subagent stalling on external interruptions unrelated to the bug itself (see AGENTS.md note below). Each of the 3 fix rounds only hardened the call sites a reviewer happened to be looking at; the structural test now covers the whole class so a new call site added without `stdio` fails immediately instead of waiting for the next production EPIPE.
- **Descartes (modo desatendido):** ninguno relacionado a este hallazgo — las 3 rondas de recurrencia fueron curadas en código (durante la sesión) y ahora también como sensor estructural permanente.

### 2. redact.ts secret-detection fixed 4 times in sequence — allow-list of dangerous patterns never closes the class

- **Occurrences (ledger count):** 4 sequential blockers, same function, same file, each found by re-reviewing the PREVIOUS fix: `redact-dashdash-value-bypass` → `redact-stacked-secret-flags-leak` → `redact-hyphen-bounded-literal-bypass` → `redact-single-dash-flag-total-bypass`. Plus 3 more blockers from the same enumeration-vs-default-deny root cause in ReDoS mitigation (`redact-text-redos`, `redact-suffix-bound-secret-leak`, `redact-repeated-keyword-redos`) — bounding one quantifier reopened backtracking via a different trigger, twice.
- **Rule:** `CONSTITUTION.md` → "Validación de entrada", new bullet: security/durable-state gating code must default-deny (reject/redact unless a value is explicitly recognized as safe), never enumerate known-dangerous patterns.
- **Sensor:** none new — `cli/tests/core/journal/redact.test.ts` already carries a dedicated regression test per historical bypass class; a new adversarial-corpus structural test was considered and deferred (existing per-case coverage judged sufficient given session scope).
- **Detalle:** each redact.ts fix closed exactly the bypass a reviewer had just found and no more, because the underlying logic enumerated "what a secret flag looks like" instead of defaulting to redact-when-ambiguous. The eventual fix (`5b8958b`) flipped this: over-redact any flag-shaped ambiguity rather than trying to enumerate every shape that isn't one. The identical "silently accept what wasn't explicitly recognized" shape recurred independently in `computeGate` (accepted a dangling `verdictId` with no matching `Verdict` as a passing obligation), `consumePendingRequests` (crashed instead of rejecting a digest-mismatched request, wedging the supervisor), and `register --entity` (coerced missing fields via `String(undefined)` instead of rejecting the registration) — three more findings in three different files, same root shape, all fixed in the QA loop (#65-70) and now unified under one process rule instead of three separate narrow ones.
- **Descartes (modo desatendido):** no se agregó un sensor estructural adicional para este caso — a diferencia del caso 1 (sin ningún test cruzando archivos), `redact.test.ts` ya tiene un test dedicado por cada clase de bypass histórica; el gap real era la ausencia de la REGLA DE PROCESO que explica el patrón, no de cobertura de test puntual.

### Also observed, not cured this round

- **`awm ledger recurring --min 2`'s clustering is noisier than its output suggests.** The `fingerprint-execfilesync-maxbuffer` cluster reported `count: 36`, but inspecting the entries showed most were unrelated wins from completely different tasks (Task 1's `types.ts`, Task 4's `redact.ts`, Task 22's `runner.ts`) grouped together by the fuzzy-similarity clustering built in the prior (R0) session — a false-positive megacluster, not genuine recurrence. This did not block this retro (severity/systemic-pattern triage was used instead of raw recurrence counts, per the skill's own "recurrence is a signal, not a gate" guidance), but it does mean `recurring --min 2`'s counts should not be trusted at face value in a future retro without spot-checking entries. **Descarte razonado:** fixing the clustering algorithm itself is a code change to a different subsystem (`cli/src/core/ledger/cluster.ts`) outside this plan's scope and would need its own design/test cycle rather than a retro-time patch; noted here so the next retro invocation knows to verify cluster membership before trusting a count.
- **17 blockers total this session**, of which 2 were folded into the systemic cures above; the remaining 15 (redact ReDoS/bypass specifics, fingerprint non-ASCII quoting, dangling-verdictid, digest-mismatch crash, fix-never-closes, next-action-never-populated, unknown-request-kind-silent-discard, adapter-safeToReplace-ps-failure-as-death) were each fixed in-session with their own dedicated regression test (per the existing CONSTITUTION.md "every fix needs its own test" rule) and are not separately structuralized — cure #2 above already generalizes their shared shape into one durable rule.

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

## 2026-08-08 — refIsAlive false-negative en windows-latest: ampliar el reintento no convergía, reintentar el spawn sí

- **Class:** logica (agent working-style extendido en `AGENTS.md`, no sensor-catchable — depende de CI real)
- **Occurrences (ledger count):** 3 corridas reales consecutivas del mismo síntoma exacto (`refIsAlive(ref)` false inmediatamente tras `spawnStructured`), 2 de ellas DESPUÉS de que un fix dedicado (retry acotado de `pidExistsNative`) ya estuviera mergeado — incluyendo una ampliación de 3x50ms a 10x100ms que falló en la corrida INMEDIATA siguiente.
- **Rule:** `AGENTS.md` → `windows-ci-gotchas`, 4to bullet agregado (merge, no duplicado del bullet ya existente sobre `ps`/`pgrep` emulado).
- **Sensor:** ninguno mecánico — inherente a CI real de `windows-latest`, no reproducible localmente ni con mocks. `tests/core/journal/process.test.ts` es el ancla de regresión.
- **Detalle:** systematic-debugging identificó que seguir ampliando el MISMO mecanismo (reintentar `process.kill(pid,0)` sobre el MISMO pid) tenía retornos decrecientes — evidencia de que el sospechoso real no era (solo) latencia de visibilidad de OpenProcess, sino posible terminación temprana genuina del proceso hijo bajo ese runner (sospecha no confirmable sin Windows real). El fix que convergió fue de otra naturaleza: el test ahora reintenta la INSTANCIA COMPLETA del spawn (hasta 3 veces) en vez de re-consultar un pid posiblemente ya muerto — una instancia nueva puede sobrevivir donde la anterior no lo hizo. El presupuesto de `pidExistsNative` se dejó ampliado (10x100ms) como defensa adicional de bajo costo, pero ya no es el mecanismo primario que cierra el caso.
- **Descartes (modo desatendido):** ninguno — hallazgo único, curado.
