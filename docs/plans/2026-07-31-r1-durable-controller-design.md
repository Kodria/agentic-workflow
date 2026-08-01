# R1 — Controlador durable: journal, `awm job`, supervisor `awm watch` — diseño (v3)

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
> **v3 (2026-07-31):** incorpora la segunda revisión del dueño — 3 bloqueantes
> (exclusión física de controladores, atomicidad por transición, secretos y
> permisos) y 6 importantes (idempotencia real, bootstrap, state machine
> tripartita, ReviewObligation, neutralidad probada en ambos providers,
> RNF-T.8/T.9).

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
  `events.jsonl` es auditoría derivada (reconstruible), nunca autoridad.
- **Requests inmutables:** el controlador y los subagentes emiten operaciones
  como archivos únicos en `requests/` (flag `wx`). `requestId` (único, con
  nonce) ≠ `idempotencyKey` (`hash(fingerprint + commandDigest)` para
  get-or-create; `hash(actionId + attempt)` para operaciones de ciclo). El
  supervisor persiste un **ack durable por requestId** con el resultado de
  aplicarla — un reintento re-lee el ack, no re-aplica.
- **Exclusión física de controladores (no solo lógica):** el controlador es
  hijo del supervisor. Ante heartbeat vencido el supervisor NO relanza a
  ciegas: primero resuelve la generación vigente (ver R4.2) — muerte probada,
  terminación confirmada, o bloqueo. Dos controladores nunca coexisten sobre el
  mismo worktree.

## Requirements

IDs propios de este diseño (`R1`–`R8`); donde materializan un RF del brief, se cita.

### R1 — Journal durable

- **R1.1** — THE journal SHALL vivir en `<repo>/.awm/journal/<branch-slug>/` (local al proyecto, gitignoreado; nada bajo `~/.awm`). Estructura: `state.json` (snapshot canónico único), `requests/`, `acks/`, `logs/`, `events.jsonl`, `supervisor.lock`.
- **R1.2** — THE estado canónico SHALL ser un único snapshot `state.json` con revisión monotónica, escrito exclusivamente por el supervisor vía `writeFileAtomic`; una transición que toca N entidades SHALL materializarse en UNA escritura. THE directorios del journal SHALL crearse `0700` y los archivos escribirse `0600`. *(RF-2.10; bloqueantes v3-2 y v3-3)*
- **R1.3** — THE requests SHALL ser inmutables (`wx`), con `requestId` único y `idempotencyKey` separada; WHEN el supervisor aplica una request, SHALL verificar generación (fencing) + revisión y SHALL persistir un ack durable por `requestId`; IF llega una request con `idempotencyKey` ya aplicada, THEN SHALL responder el ack existente — nunca re-aplicar. *(RNF-T.7; importante v3-1)*
- **R1.4** — THE modelo durable SHALL registrar como entidades explícitas: ciclo, tarea, intento, despacho, **ReviewObligation** (la obligación de revisión se registra ANTES del despacho; el **Verdict** nace al recibirse — nunca antes de existir), fix, QA y job. *(RF-2.1, RF-2.3; importante v3-4)*
- **R1.5** — WHILE el ciclo esté `IN_PROGRESS`, THE `state.json` SHALL contener `next_action` estructurado `{actionId, type, target, preconditions, attempt, state}`, idempotente y ejecutable sin memoria conversacional. *(RF-2.6, N4)*
- **R1.6** — IF una lectura encuentra JSON/shape inválido, THEN las consultas (`list/show/ps`) SHALL mostrarlo como `corrupt` (visible, jamás descartado en silencio) y THE certificación (`gate`, `reconcile`) SHALL tratarlo como bloqueo. *(bloqueante v2-2, se conserva)*
- **R1.7** — THE job SHALL separar tres dimensiones de estado, nunca un enum sobrecargado: `executionState` (`received | spawn-intent | claimed | running | exited | cancel-requested | cancelled`), `observationState` (`progressing | suspected-stall`), y `verdict` (`pass | fail | inconclusive`, presente solo tras `exited`). Re-reclamar trabajo SHALL crear un **Attempt nuevo enlazado**, nunca reutilizar el anterior. *(regla CONSTITUTION; importante v3-3)*
- **R1.8** — WHEN el supervisor va a hacer spawn de un job, THE transición SHALL ser durable: persistir `spawn-intent` (con `spawnNonce`) ANTES del spawn; tras el spawn, persistir `running` con la identidad completa. IF hay replay con un `spawn-intent` sin `running`, THEN SHALL buscarse un proceso vivo portando ese `spawnNonce` (inyectado en el entorno del hijo): si existe se adopta, si no existe el re-spawn es seguro — nunca un segundo proceso por crash entre spawn y persistencia. *(bloqueante v3-2)*

### R2 — Identidad de procesos, higiene y secretos

- **R2.1** — THE identidad de proceso SHALL ser `{pid, startTime, spawnNonce, argvDigest, processGroup}`; `ps`, `reap`, el lock y toda señal SHALL validar la tupla completa antes de afirmar identidad o señalizar. *(bloqueante v2-4, se conserva)*
- **R2.2** — WHEN se invoca `reap`, SHALL listar explícitamente qué limpiará, validar identidad completa y solo entonces actuar.
- **R2.3** — THE redacción de secretos SHALL ocurrir **en el emisor, antes de cualquier escritura**: el CLI que emite una request redacta argv (patrones del sensor-pack, extensibles) antes de persistirla; IF un flag sensible (`--token`, `--password`, `--api-key`, …) porta un secreto literal, THEN la request SHALL rechazarse con error — no persistirse redactada. THE journal SHALL NOT persistir el entorno; stdout/stderr pasan por redacción antes de escribirse a `logs/`. *(RF-2.10; bloqueante v3-3)*
- **R2.4** — THE R1 SHALL NOT instalar nada persistente (sin daemons/launchd/cron); supervisor foreground, visible, terminable.
- **R2.5** — THE logs por job SHALL tener retención acotada (tamaño máximo con default).

### R3 — CLI `awm job`

- **R3.1** — THE CLI SHALL exponer: `request -- <cmd>` (intención con get-or-create atómico por `idempotencyKey`), `list/show/ps`, `controller-heartbeat`, `reconcile`, `gate`, `reap`. La ejecución de jobs la posee el supervisor. El bootstrap es de `awm watch --init` (ver R4.1) — `awm job` nunca escribe estado canónico. *(bloqueante v2-1, se conserva; importante v3-2)*
- **R3.2** — WHEN se invoca `gate`, IF existe cualquier entidad no terminal, cualquier ReviewObligation sin Verdict, **o cualquier entrada corrupta**, THEN exit ≠ 0 con listado (pendientes y corruptas por separado) — falla cerrado. *(RF-2.3, RF-2.9)*
- **R3.3** — WHEN se invoca `reconcile`: job del supervisor vivo con proceso probado muerto ⇒ Attempt nuevo automático (prueba de terminación mecánica — RF-2.7 sin humano); `orphaned` SHALL reservarse para pérdida del supervisor, con reejecución automática solo ante identidad probada muerta; liveness indemostrable en ambos sentidos ⇒ autorización explícita registrada como entidad. *(RF-2.6, RF-2.7)*
- **R3.4** — THE fingerprint SHALL computarse de: argv exacto + cwd relativo + `HEAD` + digest del índice + digest de tracked/untracked/deleted de los paths declarados (`--paths`, expansión persistida; default árbol completo). Reutilización solo ante identidad exacta; resultado tardío tras cambio de estado queda histórico y no certifica. *(RF-2.2, RF-2.8; CA-T.1)*
- **R3.5** — WHILE un job viva, THE duración SHALL NOT producir transición terminal. Señales separadas: `controllerHeartbeat` (vía `awm job controller-heartbeat`), liveness real del runner (la valida el supervisor contra R2.1) y `lastProgressAt`. `suspected-stall` = vivo + sin progreso, observacional. *(RF-2.5)*
- **R3.6** — IF el proyecto carece de suite o sensores, THEN `gate` SHALL degradar declarando qué verificador falta — nunca verde por ausencia. *(RF-2.4)*
- **R3.7** — THE journal SHALL registrar por entidad los datos de RNF-T.4/T.8/T.9: timestamps por fase, tokens por rol cuando el harness los reporte (input/output/cache), número de despachos, ejecuciones mecánicas (reales vs deduplicadas), y toda evidencia referenciada con hash + comando reproducible — la comparación contra el baseline 2026-07-29 sale del journal, sin telemetría. *(importante v3-6)*

### R4 — Supervisor `awm watch`

- **R4.1** — THE bootstrap SHALL ser `awm watch --init` (el único writer crea el `state.json` inicial); `supervisor.lock` con identidad completa R2.1; lock con identidad muerta probada ⇒ se reclama con aviso. *(importante v3-2)*
- **R4.2** — WHEN `controllerHeartbeat` venza (default 5 min), THE supervisor SHALL resolver la generación vigente ANTES de relanzar, en este orden: (a) process group del controlador probado muerto ⇒ relanzar generación N+1; (b) vivo ⇒ marcar `controller-suspected-stall`, terminar el process group (SIGTERM → confirmar → SIGKILL → confirmar, con identidad R2.1) y solo con muerte confirmada relanzar; (c) IF la terminación no puede confirmarse, THEN ciclo `BLOCKED` con evidencia — SHALL NOT coexistir dos controladores sobre el mismo worktree, jamás. El fencing de requests se mantiene como segunda línea, no como única defensa. *(bloqueante v3-1)*
- **R4.3** — THE relanzamientos SHALL aplicar backoff (1 → 5 → 15 min) y tope por hora; fallo de relanzamiento ⇒ error auditado + backoff.
- **R4.4** — THE supervisor SHALL reclamar y ejecutar toda intención pendiente en process groups propios (sobreviven a cualquier turno), con la transición durable de R1.8. *(bloqueante v2-1)*
- **R4.5** — WHEN el ciclo llegue a `COMPLETE`/`BLOCKED`, THE supervisor SHALL drenar jobs vivos, liberar el lock y terminarse — nada eterno, ningún hijo abandonado.
- **R4.6** — THE `events.jsonl` SHALL escribirlo solo el supervisor (append serializado); la superficie concurrente son las requests inmutables.

### R5 — Integración con el skill SDD (registry) y neutralidad de provider

- **R5.1** — IF el proyecto NO tiene journal inicializado, THEN THE skill SDD SHALL comportarse exactamente como hoy — el default de Claude Code no cambia.
- **R5.2** — WHERE el journal esté inicializado, THE controlador SHALL emitir la request de registro de cada entidad (tarea/intento/despacho/**ReviewObligation**) ANTES de actuar; el Verdict se registra al recibirse. *(RF-2.1, RF-2.3)*
- **R5.3** — WHERE el journal esté inicializado, WHEN un turno comienza, THE skill SHALL abrir con `reconcile` + `next_action` y emitir `controller-heartbeat` en cada paso.
- **R5.4** — THE capacidad SHALL ser opt-in **en ambos providers**: la batería durable de aceptación SHALL correr también con Claude Code en modo journal (mismo contrato, mismos comandos), y el escenario opt-out SHALL demostrar cero cambio de flujo en ambos. La neutralidad se prueba, no se declara. *(RNF-T.5; importante v3-5)*

### R6 — Tests (tmpdir + HOME override; ningún test toca `~/.awm`)

Fixtures: los 4 de R0 (job largo / mudo / orphaned / fingerprint) + los de la
segunda revisión: crash entre spawn y persistencia (replay sin duplicar, R1.8),
controlador zombie terminado y confirmado antes del relevo (R4.2, con caso (c)
bloqueando), reintento con misma `idempotencyKey` (ack, no re-aplicación),
secreto literal en flag sensible (request rechazada; nada persiste sin
redactar), permisos `0700/0600` verificados, review perdido (gate bloquea),
proyecto sin verificadores, interrupción en cada fase con reanudación,
resultado tardío histórico, corrupción (gate cerrado), requests concurrentes
(get-or-create), generación vieja rechazada, reutilización de PID (identidad
completa), y batería semántica completa en modo journal bajo ambos providers +
opt-out sin cambios en ambos (R5.4).

### R7 — Métricas

- **R7.1** — cubierto por R3.7 (RNF-T.4/T.8/T.9 salen del journal).

### R8 — Validación del dueño

- **R8.1** — Smoke en máquina real (Mac y/o VPS): ciclo con corte provocado → supervisor resuelve generación (incluyendo el caso zombie-terminado) → `codex exec` retoma desde `next_action` sin pérdida ni duplicados; y en Claude Code: opt-out sin cambios + opt-in con la misma batería. Se registra en issue #20.

## Estructura

```
cli/src/core/journal/
  types.ts          Cycle, Task, Attempt, Dispatch, ReviewObligation, Verdict,
                    Job {executionState, observationState, verdict}, Generation,
                    ProcessRef, NextAction, Ack
  store.ts          snapshot state.json: lectura + shape validation + escritura
                    canónica (solo supervisor) sobre writeFileAtomic, revisión
                    monotónica, permisos 0700/0600
  requests.ts       emisión (con redacción previa + rechazo de secretos) y
                    consumo de requests; acks durables por requestId
  fingerprint.ts    argv + cwd + HEAD + índice + digests (expansión persistida)
  process.ts        ProcessRef completo, liveness, spawn con nonce en entorno,
                    terminación confirmada de process groups
  redact.ts         redacción en el emisor; detección de secretos en flags
cli/src/commands/job/
  index.ts request.ts list.ts show.ts ps.ts
  controller-heartbeat.ts reconcile.ts gate.ts reap.ts
cli/src/commands/watch/
  index.ts          supervisor: --init (bootstrap), lock, loop, resolución de
                    generación (muerte probada / terminar+confirmar / BLOCKED),
                    claim+spawn durable de jobs, backoff, drenaje, auto-exit
cli/tests/core/journal/  + cli/tests/commands/job|watch/
```

En `awm-baseline-registry`: sección journal-first del skill
`subagent-driven-development`, condicional a journal inicializado (R5), con
comandos exactos, protocolo de `controller-heartbeat` y ReviewObligation.

## Flujo de continuidad en Codex (v3)

1. Dueño: `awm watch --init` en una terminal (Mac o VPS) — el supervisor crea el
   estado inicial y lanza la generación 1 (`codex exec`, hijo suyo).
2. El orquestador registra entidades vía requests (token gen-1), emite
   `controller-heartbeat`, y pide verificaciones con `awm job request` — el
   supervisor las ejecuta en sus process groups con transición durable de spawn.
3. Codex se detiene. Los jobs siguen corriendo (son del supervisor).
4. Heartbeat vencido → el supervisor **resuelve** la generación 1: muerta
   probada ⇒ relanza; viva ⇒ la termina y confirma; inconfirmable ⇒ `BLOCKED`
   con evidencia. Solo entonces emite la generación 2.
5. El orquestador gen-2 abre con `reconcile` + `next_action`. Requests tardías
   de gen-1: rechazadas y auditadas (fencing, segunda línea).
6. `gate` verde (sin pendientes, sin obligaciones sin veredicto, sin corruptos)
   ⇒ `COMPLETE` ⇒ el supervisor drena, libera el lock y se apaga.

## Non-goals

- Tocar el flujo default de Claude Code (R5.1; el modo journal en Claude Code es
  opt-in y solo existe para probar neutralidad — R5.4).
- Daemons/launchd/cron o instalación persistente (R2.4).
- Timeout terminal por duración (fuera de alcance firme).
- Aislamiento por worktree por generación: documentado como alternativa al caso
  (b)/(c) de R4.2, se difiere a Release 5 (paralelismo) — en R1 la exclusión es
  por terminación confirmada o bloqueo.
- Tiering de modelo (desestimado, DA-2); telemetría remota.
