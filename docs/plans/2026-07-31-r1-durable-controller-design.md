# R1 — Controlador durable: journal, `awm job`, supervisor `awm watch` — diseño (v5)

> Ejecuta el **Release 1** del brief certificado
> [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md)
> (RF-2.1–RF-2.10, PR-2), re-priorizado por el dueño el 2026-07-31 (issue
> [#20](https://github.com/Kodria/agentic-workflow/issues/20)). Insumos: matriz y
> contradicciones de R0 ([`report.md`](../research/r0/report.md)).
> Decisiones del dueño: **enfoque A** (sin daemons, opt-in, `~/.awm` intocable),
> **100% autónomo en R1**, **higiene de procesos como invariante**, **flujo
> default de Claude Code intocable**.
>
> **v2 (2026-07-31):** supervisor durable single-writer dueño de los jobs,
> gate fail-closed, fencing por generación, identidad completa de procesos.
> **v3 (2026-07-31):** exclusión física de controladores, atomicidad por
> transición (snapshot único), secretos/permisos, idempotencia real, bootstrap,
> state machine tripartita, ReviewObligation, neutralidad probada.
> **v4 (2026-07-31):** tercera revisión del dueño — el silencio nunca autoriza
> kill por sí solo (doble señal + escalera de gracia), claim durable por
> `spawnNonce` (la no-ejecución se prueba, no se asume), publicación de
> requests con fsync+rename y acks regenerables desde `state.json`,
> `VerificationPlan` autoritativo (el gate no puede quedar verde por omisión),
> `ControllerAdapter` por provider, ejecución segura estructurada, `COMPLETE`
> ⇒ cero jobs vivos.
> **v5 (2026-07-31, final pre-plan):** cuarta revisión del dueño — el kill
> exige señal positiva `safeToReplace` del adapter (la ausencia nunca es
> prueba; sin señal ⇒ `BLOCKED` sin matar), `BLOCKED` conserva lock y custodia
> mientras exista un vivo sin confirmar, solo `pass` satisface el gate
> (`fail`/`inconclusive` bloquean y crean fix-obligation atómicamente,
> `CycleVerificationPlan` a nivel ciclo), matriz única de recuperación (la de
> R1.8 — claim sin resultado jamás se relanza solo), lock por
> `realpath(worktree)` fuera del directorio de rama, resultado completo de
> request en `state.json`, fsync de directorio tras rename.

## Arquitectura

```
awm watch  (supervisor: foreground, durable, single-writer, dueño de procesos)
├── controller generation N  → codex exec  (hijo del supervisor: su process
│                               group se puede terminar y CONFIRMAR muerto)
├── job runner                → jobs reclamados, en process groups propios
└── journal                   → state.json (snapshot canónico único, atómico)
                                + requests/ inmutables + events.jsonl (auditoría)
```

- **Single-writer + snapshot único:** el estado canónico completo (ciclo,
  tareas, intentos, despachos, obligaciones, veredictos, jobs, generaciones)
  vive en **un solo `state.json`** que solo el supervisor escribe, vía
  `writeFileAtomic` — una transición multi-entidad es una sola escritura
  atómica; no existen estados incompatibles entre archivos por construcción.
  `events.jsonl` es auditoría derivada best-effort, nunca autoridad.
- **Requests inmutables:** el controlador y los subagentes emiten operaciones
  como archivos únicos en `requests/`, publicados atómicamente (tmp + fsync +
  rename — ver R1.3). `requestId` (único, con nonce) ≠ `idempotencyKey`
  (`hash(fingerprint + commandDigest)` para get-or-create; `hash(actionId +
  attempt)` para operaciones de ciclo). El supervisor persiste el resultado
  completo de cada request aplicada en `state.json` — un reintento re-lee el
  ack (o lo regenera desde el estado), no re-aplica.
- **Exclusión física de controladores (no solo lógica):** el controlador es
  hijo del supervisor. Ante heartbeat vencido el supervisor NO relanza a
  ciegas: primero resuelve la generación vigente (ver R4.2) — muerte probada,
  terminación confirmada, o bloqueo. Dos controladores nunca coexisten sobre el
  mismo worktree.

## Requirements

IDs propios de este diseño (`R1`–`R8`); donde materializan un RF del brief, se cita.

### R1 — Journal durable

- **R1.1** — THE journal SHALL vivir en `<repo>/.awm/journal/<branch-slug>/` (local al proyecto, gitignoreado; nada bajo `~/.awm`). Estructura: `state.json` (snapshot canónico único), `requests/`, `acks/`, `logs/`, `events.jsonl`. THE `supervisor.lock` SHALL vivir FUERA del directorio de rama — en `<repo>/.awm/journal/supervisor.lock`, clavado por `realpath(worktree)`: un solo supervisor por worktree físico, sin importar cuántos journals de rama existan; WHILE el supervisor esté activo, THE cambio de rama del worktree SHALL bloquearse (`gate`/`reconcile` verifican que la rama actual coincide con la del journal activo; discrepancia ⇒ `BLOCKED`). *(bloqueante v5-5)*
- **R1.2** — THE estado canónico SHALL ser un único snapshot `state.json` con revisión monotónica, escrito exclusivamente por el supervisor vía `writeFileAtomic` **extendido con `fsync` del directorio tras cada `rename`** (el actual solo sincroniza el archivo temporal); una transición que toca N entidades SHALL materializarse en UNA escritura. THE directorios del journal SHALL crearse `0700` y los archivos escribirse `0600`. *(RF-2.10; mecánica v5)*
- **R1.3** — THE requests SHALL publicarse atómicamente: escribir `*.tmp`, `fsync`, cerrar y `rename` al nombre final (nunca `wx` directo sobre el nombre final — el supervisor jamás puede leer JSON parcial); `requestId` único y `idempotencyKey` separada; el registro de request aplicada dentro de `state.json` SHALL ser `{requestId, idempotencyKey, payloadDigest, outcome}` completo, de modo que IF el estado persistió pero el ack se perdió, THEN el ack SHALL regenerarse determinísticamente desde `state.json` — nunca re-aplicar; IF llega una `idempotencyKey` ya registrada con `payloadDigest` distinto, THEN la request SHALL rechazarse con error explícito. *(RNF-T.7; mecánica v5)*
- **R1.4** — THE modelo durable SHALL registrar como entidades explícitas: ciclo, tarea, intento, despacho, **ReviewObligation** (la obligación de revisión se registra ANTES del despacho; el **Verdict** nace al recibirse — nunca antes de existir), **VerificationPlan**, fix, QA y job. *(RF-2.1, RF-2.3)*
- **R1.4b** — WHEN una tarea se registra, THE controlador SHALL registrar con ella su **VerificationPlan** autoritativo (tests, lint, `awm sensors run` si hay `sensors.json`, y las ReviewObligations de la tarea); THE ciclo SHALL tener además un **CycleVerificationPlan** que cubre QA final e interlock de cierre a nivel de ciclo. THE supervisor SHALL validar al registrar que el plan contiene las clases de verificación esperables de la configuración real del repo (suite presente ⇒ ítem test; `sensors.json` presente ⇒ ítem sensors) — un plan vacío frente a verificadores existentes se rechaza. *(RF-2.4, RF-2.9; bloqueantes v4-4 y v5-3)*
- **R1.4c** — THE satisfacción de un ítem SHALL exigir veredicto **`pass`** (o review aprobada) con fingerprint vigente — terminal ≠ satisfactorio: `fail`/`inconclusive` BLOQUEAN el gate, y WHEN un veredicto adverso se registra, THE supervisor SHALL crear atómicamente (misma escritura de estado) la obligación de fix correspondiente. *(bloqueante v5-3)*
- **R1.5** — WHILE el ciclo esté `IN_PROGRESS`, THE `state.json` SHALL contener `next_action` estructurado `{actionId, type, target, preconditions, attempt, state}`, idempotente y ejecutable sin memoria conversacional. *(RF-2.6, N4)*
- **R1.6** — IF una lectura encuentra JSON/shape inválido, THEN las consultas (`list/show/ps`) SHALL mostrarlo como `corrupt` (visible, jamás descartado en silencio) y THE certificación (`gate`, `reconcile`) SHALL tratarlo como bloqueo. *(bloqueante v2-2, se conserva)*
- **R1.7** — THE job SHALL separar tres dimensiones de estado, nunca un enum sobrecargado: `executionState` (`received | spawn-intent | claimed | running | exited | cancel-requested | cancelled | orphaned`), `observationState` (`progressing | suspected-stall`), y `verdict` (`pass | fail | inconclusive`, presente solo tras `exited`). THE generación de controlador SHALL tener su propio estado: `active | controller-suspected-stall | terminated | superseded`. Re-reclamar trabajo SHALL crear un **Attempt nuevo enlazado**, nunca reutilizar el anterior. *(regla CONSTITUTION; importante v4-1)*
- **R1.8** — THE spawn SHALL ser demostrable, no inferible: el supervisor nunca ejecuta el comando crudo — lo envuelve en un wrapper durable (`awm job exec-wrapper --job <id> --nonce <n>`) que (1) reclama en exclusiva un claim-file por `spawnNonce` (`wx`, con identidad completa), (2) ejecuta el comando, (3) escribe el resultado terminal atómicamente (temp+fsync+rename) junto al claim. WHEN hay replay de un `spawn-intent` sin `running`: sin claim ⇒ nunca ejecutó ⇒ re-spawn seguro; claim + resultado ⇒ adoptar el resultado; claim sin resultado y proceso probado muerto ⇒ ejecución parcial no demostrable ⇒ `orphaned` con autorización requerida — **jamás relanzar lo que no se puede probar que no ejecutó**. *(bloqueante v4-2)*

### R2 — Identidad de procesos, higiene y secretos

- **R2.1** — THE identidad de proceso SHALL ser `{pid, startTime, spawnNonce, argvDigest, processGroup}`; `ps`, `reap`, el lock y toda señal SHALL validar la tupla completa antes de afirmar identidad o señalizar. *(bloqueante v2-4, se conserva)*
- **R2.2** — WHEN se invoca `reap`, SHALL listar explícitamente qué limpiará, validar identidad completa y solo entonces actuar.
- **R2.3** — THE redacción de secretos SHALL ocurrir **en el emisor, antes de cualquier escritura**: el CLI que emite una request redacta argv (patrones del sensor-pack, extensibles) antes de persistirla; IF un flag sensible (`--token`, `--password`, `--api-key`, …) porta un secreto literal, THEN la request SHALL rechazarse con error — no persistirse redactada. THE journal SHALL NOT persistir el entorno; stdout/stderr pasan por redacción antes de escribirse a `logs/`. *(RF-2.10; bloqueante v3-3)*
- **R2.4** — THE R1 SHALL NOT instalar nada persistente (sin daemons/launchd/cron); supervisor foreground, visible, terminable.
- **R2.5** — THE logs por job SHALL tener retención acotada (tamaño máximo con default).

### R3 — CLI `awm job`

- **R3.1** — THE CLI SHALL exponer: `request -- <cmd>` (intención con get-or-create atómico por `idempotencyKey`), `list/show/ps`, `controller-heartbeat`, `reconcile`, `gate`, `reap`. La ejecución de jobs la posee el supervisor. El bootstrap es de `awm watch --init` (ver R4.1) — `awm job` nunca escribe estado canónico. *(bloqueante v2-1, se conserva; importante v3-2)*
- **R3.2** — WHEN se invoca `gate`, IF existe cualquier entidad no terminal, cualquier ReviewObligation sin Verdict, cualquier ítem de VerificationPlan/CycleVerificationPlan sin veredicto `pass` (R1.4c), cualquier veredicto adverso sin fix cerrado, **o cualquier entrada corrupta**, THEN exit ≠ 0 con listado por categoría — falla cerrado. *(RF-2.3, RF-2.9; bloqueante v5-3)*
- **R3.3** — WHEN se invoca `reconcile`, THE recuperación SHALL seguir una única matriz — la de R1.8, sin excepciones: sin claim ⇒ reemitir el MISMO intent con el MISMO `spawnNonce` (el claim `wx` arbitra contra un wrapper original demorado y evita ejecución doble); claim + resultado ⇒ adoptar resultado; claim sin resultado ⇒ `orphaned`, SIN relanzamiento automático — autorización explícita registrada como entidad. Solo una re-reclamación explícita crea un Attempt nuevo enlazado. Esta matriz aplica igual con supervisor vivo o perdido. *(RF-2.6, RF-2.7; bloqueante v5-4 — elimina la contradicción R1.8/R3.3 y el race delayed-wrapper)*
- **R3.4** — THE fingerprint SHALL computarse de: argv exacto + cwd relativo + `HEAD` + digest del índice + digest de tracked/untracked/deleted de los paths declarados (`--paths`, expansión persistida; default árbol completo). Reutilización solo ante identidad exacta; resultado tardío tras cambio de estado queda histórico y no certifica. *(RF-2.2, RF-2.8; CA-T.1)*
- **R3.5** — WHILE un job viva, THE duración SHALL NOT producir transición terminal. Señales separadas: `controllerHeartbeat` (vía `awm job controller-heartbeat`), liveness real del runner (la valida el supervisor contra R2.1) y `lastProgressAt`. `suspected-stall` = vivo + sin progreso, observacional. *(RF-2.5)*
- **R3.6** — IF el proyecto carece de suite o sensores, THEN `gate` SHALL degradar declarando qué verificador falta — nunca verde por ausencia. *(RF-2.4)*
- **R3.7** — THE journal SHALL registrar por entidad los datos de RNF-T.4/T.8/T.9: timestamps por fase, tokens por rol cuando el harness los reporte (input/output/cache), número de despachos, ejecuciones mecánicas (reales vs deduplicadas), y toda evidencia referenciada con hash + comando reproducible. THE comando `awm job export` SHALL producir una exportación sanitizada (redactada) y versionable del ciclo, reproducible desde un checkout limpio — la comparación contra el baseline 2026-07-29 se hace sobre ese artefacto, sin telemetría. *(importante v4-4)*

### R4 — Supervisor `awm watch`

- **R4.1** — THE bootstrap SHALL ser `awm watch --init` (el único writer crea el `state.json` inicial); `supervisor.lock` con identidad completa R2.1; lock con identidad muerta probada ⇒ se reclama con aviso. *(importante v3-2)*
- **R4.2** — THE silencio de heartbeat por sí solo SHALL producir únicamente `controller-suspected-stall` — nunca autoriza kill. THE decisión de relevo SHALL usar doble señal: heartbeat vencido (default 5 min) **y** ausencia de actividad observable del process group del controlador (CPU acumulada congelada, sin crecimiento de output consumido por el supervisor, sin hijos nuevos) durante una ventana de actividad propia (default 10 min adicionales, configurable) — una llamada larga legítima con heartbeat silencioso pero actividad viva NO se toca. *(RF-2.5 aplicado al controlador; bloqueante v4-1)*
- **R4.2b** — THE kill automático SHALL requerir además una **señal positiva del `ControllerAdapter`** (`safeToReplace`/`idle`: el adapter observa que el controlador no está en medio de una operación legítima — p.ej. sin llamada de provider en vuelo, según lo que ese adapter pueda observar). La ausencia de señales nunca es prueba: IF el adapter no puede afirmar `safeToReplace` (capacidad no disponible o estado indeterminado), THEN ciclo `BLOCKED` **sin matar** — con el stall y la limitación del adapter como evidencia. Solo con stall confirmado + `safeToReplace` positivo: (a) process group probado muerto ⇒ relanzar N+1; (b) vivo ⇒ SIGTERM → flush (30 s) → confirmar → SIGKILL → confirmar, con identidad R2.1; (c) terminación inconfirmable ⇒ `BLOCKED`. Dos controladores SHALL NOT coexistir sobre el mismo worktree; el fencing es segunda línea. *(bloqueantes v3-1 y v5-1)*
- **R4.3** — THE relanzamientos SHALL aplicar backoff (1 → 5 → 15 min) y tope por hora; fallo de relanzamiento ⇒ error auditado + backoff.
- **R4.4** — THE supervisor SHALL reclamar y ejecutar toda intención pendiente en process groups propios (sobreviven a cualquier turno), con la transición durable de R1.8. *(bloqueante v2-1)*
- **R4.5** — THE transición a `COMPLETE` SHALL exigir cero jobs vivos: drenaje ANTES de declarar, el gate incluye "todo job terminal" entre sus condiciones. Tras `COMPLETE` el supervisor libera el lock y se termina. **`BLOCKED` NO libera:** WHILE exista cualquier proceso vivo no confirmado muerto (controlador zombie incluido), THE supervisor SHALL conservar lock y ownership, en modo custodia (sin relanzar, auditando), hasta: cero procesos vivos demostrado, transferencia explícita de ownership, o decisión humana registrada — jamás salir dejando un vivo sin dueño ni permitir que otro supervisor arranque sobre él. *(importante v4-5; bloqueante v5-2)*
- **R4.6** — THE `events.jsonl` SHALL escribirlo solo el supervisor (append serializado). Es **auditoría derivada best-effort para observabilidad** — la autoridad es `state.json`; un evento perdido no se reconstruye ni invalida el estado. *(importante v4-6)*
- **R4.7** — THE ejecución de comandos SHALL ser estructurada y segura: executable + argv como array (`shell: false`, sin interpolación — regla `execFileSync` de AGENTS.md extendida a spawn), `cwd` validado dentro del repo, rechazo de symlinks en paths de trabajo del journal (mismo criterio que `writeFileAtomic`), y secretos entregados por referencia (nombre de variable que el proceso resuelve en su propio entorno) — el valor jamás viaja por argv ni se persiste. *(importante v4-2)*
- **R4.8** — THE interacción con cada provider SHALL pasar por una interfaz `ControllerAdapter` (launch/resume, señales de actividad observables, consumo de output, terminación del process group, capacidades declaradas), con implementaciones `codex` y `claude-code` — la lógica del supervisor no conoce providers, conoce el adapter. *(importante v4-3)*

### R5 — Integración con el skill SDD (registry) y neutralidad de provider

- **R5.1** — IF el proyecto NO tiene journal inicializado, THEN THE skill SDD SHALL comportarse exactamente como hoy — el default de Claude Code no cambia.
- **R5.2** — WHERE el journal esté inicializado, THE controlador SHALL emitir la request de registro de cada entidad (tarea/intento/despacho/**ReviewObligation**) ANTES de actuar; el Verdict se registra al recibirse. *(RF-2.1, RF-2.3)*
- **R5.3** — WHERE el journal esté inicializado, WHEN un turno comienza, THE skill SHALL abrir con `reconcile` + `next_action` y emitir `controller-heartbeat` en cada paso.
- **R5.4** — THE capacidad SHALL ser opt-in **en ambos providers**: la batería durable de aceptación SHALL correr también con Claude Code en modo journal (mismo contrato, mismos comandos), y el escenario opt-out SHALL demostrar cero cambio de flujo en ambos. La neutralidad se prueba, no se declara. *(RNF-T.5; importante v3-5)*

### R6 — Tests (tmpdir + HOME override; ningún test toca `~/.awm`)

Fixtures: los 4 de R0 (job largo / mudo / orphaned / fingerprint) + segunda
revisión: reintento con misma `idempotencyKey` (ack, no re-aplicación), secreto
literal en flag sensible (request rechazada), permisos `0700/0600`, review
perdido (gate bloquea), proyecto sin verificadores, interrupción en cada fase
con reanudación, resultado tardío histórico, corrupción (gate cerrado),
requests concurrentes (get-or-create), generación vieja rechazada,
reutilización de PID + tercera revisión: **heartbeat silencioso con actividad
viva ⇒ no se toca** (R4.2), escalera SIGTERM/gracia/SIGKILL confirmada (R4.2b),
claim sin resultado con proceso muerto ⇒ `orphaned`, jamás relanzado (R1.8),
request `*.tmp` truncada ⇒ invisible para el supervisor (R1.3), ack perdido
regenerado desde `state.json` (R1.3), ítem de VerificationPlan nunca solicitado
⇒ gate rojo (R1.4b), `COMPLETE` imposible con job vivo (R4.5), export
sanitizado reproducible (R3.7), y batería semántica completa en modo journal
bajo ambos providers + opt-out sin cambios en ambos (R5.4).

### R7 — Métricas

- **R7.1** — cubierto por R3.7 (RNF-T.4/T.8/T.9 salen del journal).

### R8 — Validación del dueño

- **R8.1** — Smoke en máquina real (Mac y/o VPS): ciclo con corte provocado → supervisor resuelve generación (incluyendo el caso zombie-terminado) → `codex exec` retoma desde `next_action` sin pérdida ni duplicados; y en Claude Code: opt-out sin cambios + opt-in con la misma batería. Se registra en issue #20.

## Estructura

```
cli/src/core/journal/
  types.ts          Cycle, Task, Attempt, Dispatch, ReviewObligation, Verdict,
                    VerificationPlan, Job {executionState, observationState,
                    verdict}, Generation {active|controller-suspected-stall|
                    terminated|superseded}, ProcessRef, NextAction, Ack
  store.ts          snapshot state.json: lectura + shape validation + escritura
                    canónica (solo supervisor) sobre writeFileAtomic, revisión
                    monotónica, permisos 0700/0600
  requests.ts       emisión (redacción previa + rechazo de secretos; publicación
                    tmp+fsync+rename) y consumo; acks durables regenerables
                    desde state.json (idempotencyKey + payload digest)
  fingerprint.ts    argv + cwd + HEAD + índice + digests (expansión persistida)
  process.ts        ProcessRef completo, liveness, señales de actividad del
                    process group (CPU/output/hijos), spawn estructurado
                    shell:false, terminación confirmada con escalera de gracia
  adapter.ts        ControllerAdapter + implementaciones codex / claude-code
  redact.ts         redacción en el emisor; detección de secretos en flags;
                    secretos por referencia, nunca por valor
cli/src/commands/job/
  index.ts request.ts list.ts show.ts ps.ts export.ts
  exec-wrapper.ts   wrapper durable por spawnNonce: claim exclusivo + ejecución
                    + resultado terminal atómico
  controller-heartbeat.ts reconcile.ts gate.ts reap.ts
cli/src/commands/watch/
  index.ts          supervisor: --init (bootstrap), lock, loop, doble señal de
                    stall, resolución de generación (muerte probada /
                    SIGTERM→gracia→SIGKILL confirmados / BLOCKED), claim+spawn
                    vía exec-wrapper, backoff, drenaje pre-COMPLETE, auto-exit
cli/tests/core/journal/  + cli/tests/commands/job|watch/
```

En `awm-baseline-registry`: sección journal-first del skill
`subagent-driven-development`, condicional a journal inicializado (R5), con
comandos exactos, protocolo de `controller-heartbeat` y ReviewObligation.

## Flujo de continuidad (v5 — provider-neutral vía ControllerAdapter)

1. Dueño: `awm watch --init` en una terminal — el supervisor crea el estado
   inicial y lanza la generación 1 con el `ControllerAdapter` del provider
   configurado (Codex: `codex exec`; Claude Code: su adapter — mismo contrato).
2. El orquestador registra entidades vía requests (token gen-1), emite
   `controller-heartbeat`, y pide verificaciones con `awm job request` — el
   supervisor las ejecuta vía exec-wrapper (claim durable) en sus process groups.
3. El controlador se detiene. Los jobs siguen corriendo (son del supervisor).
4. Heartbeat vencido → `controller-suspected-stall` (solo observación). Con
   actividad del process group también congelada durante la ventana propia, el
   supervisor consulta al adapter: `safeToReplace` positivo ⇒ resuelve la
   generación (muerta probada ⇒ relanza; viva ⇒ SIGTERM → gracia → SIGKILL,
   confirmando cada paso); sin señal positiva o terminación inconfirmable ⇒
   `BLOCKED` **en custodia** — conserva lock y ownership, no mata, no relanza,
   audita, hasta muerte demostrada, transferencia u orden humana. Una llamada
   larga con actividad viva nunca se interrumpe.
5. El orquestador gen-2 abre con `reconcile` (matriz única R1.8) + `next_action`.
   Requests tardías de gen-1: rechazadas y auditadas (fencing, segunda línea).
6. `gate` verde (VerificationPlan y CycleVerificationPlan todos en `pass`, sin
   obligaciones abiertas, sin corruptos, **todo job ya terminal — el drenaje
   precede a la declaración**) ⇒ `COMPLETE` ⇒ el supervisor libera el lock y se
   apaga. `awm job export` deja el artefacto sanitizado del ciclo
   (schema versionado, campos `unobservable` por provider donde el harness no
   reporte la métrica) en `.awm/journal/<rama>/export/` — copiable a `docs/`
   para versionarlo.

## Non-goals

- Tocar el flujo default de Claude Code (R5.1; el modo journal en Claude Code es
  opt-in y solo existe para probar neutralidad — R5.4).
- Daemons/launchd/cron o instalación persistente (R2.4).
- Timeout terminal por duración (fuera de alcance firme).
- Aislamiento por worktree por generación: documentado como alternativa al caso
  (b)/(c) de R4.2, se difiere a Release 5 (paralelismo) — en R1 la exclusión es
  por terminación confirmada o bloqueo.
- Tiering de modelo (desestimado, DA-2); telemetría remota.
