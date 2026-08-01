# R1 — Controlador durable: journal, `awm job`, supervisor `awm watch` — diseño (v2)

> Ejecuta el **Release 1** del brief certificado
> [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md)
> (RF-2.1–RF-2.10, PR-2), re-priorizado por el dueño el 2026-07-31 (issue
> [#20](https://github.com/Kodria/agentic-workflow/issues/20)). Insumos: matriz y
> contradicciones de R0 ([`report.md`](../research/r0/report.md)).
> Decisiones del dueño: **enfoque A** (sin daemons, opt-in, `~/.awm` intocable),
> **100% autónomo en R1**, **higiene de procesos como invariante**, **Claude Code
> intocable**.
>
> **v2 (2026-07-31):** incorpora el review externo del dueño — 4 hallazgos
> bloqueantes y 6 importantes. Cambio central: `awm watch` deja de ser un
> relanzador y pasa a ser **supervisor durable, single-writer del journal y
> dueño de la ejecución de jobs**. Los descendientes de `codex exec` mueren con
> el turno (R0, report §Contradicciones-1) — por eso ningún job puede ejecutarse
> desde el agente en Codex: el agente registra intenciones; el supervisor las
> reclama y ejecuta fuera del ciclo de vida del harness.

## Arquitectura (la corrección del review, conservando el enfoque A)

```
awm watch  (supervisor: foreground, durable, single-writer, dueño de procesos)
├── controller generation N  → codex exec (con fencing token de generación)
├── job runner               → ejecuta jobs reclamados (tests/lint/sensores)
│                               en process groups propios del supervisor
└── journal                  → estado canónico + leases + fencing + resultados
```

- **Single-writer:** solo el supervisor escribe el estado canónico (`cycle.json`,
  `jobs/*.json`, `events.jsonl`). Controlador y subagentes emiten **requests
  inmutables** — un archivo nuevo por operación en `requests/`, nombre =
  idempotency key (`<actionId>-<attempt>-<nonce>`), creado con `wx` (falla si
  existe). El supervisor los consume en orden determinístico, aplica revisión
  monotónica (CAS) y escribe el resultado. Sin supervisor vivo no hay mutación
  de estado canónico — no existen dos escritores por construcción.
- **Fencing por generación:** cada lanzamiento de controlador recibe generación
  `N` + token. Toda request lleva el token; el supervisor **rechaza y audita**
  requests de generaciones viejas. Relanzar no exige probar que el controlador
  anterior murió: al emitir la generación `N+1`, la `N` queda mecánicamente sin
  permiso de escritura ni de disparo de `next_action` — un controlador zombie
  puede seguir imprimiendo texto, pero no puede actuar.
- **Ejecución de jobs:** `awm job request -- <cmd>` (desde el agente) registra la
  intención con **get-or-create atómico por fingerprint** (dos solicitudes
  simultáneas del mismo fingerprint+comando obtienen el mismo `job-id` —
  RNF-T.7). El supervisor reclama la intención, hace spawn del runner en un
  process group propio, captura log/resultado y escribe el estado. El agente
  consulta resultados en su siguiente turno (o el prompt de relanzamiento los
  anuncia). En Claude Code nada de esto se activa (journal no inicializado —
  flujo actual intacto).

## Requirements

IDs propios de este diseño (`R1`–`R8`); donde materializan un RF del brief, se cita.

### R1 — Journal durable (estado canónico + requests)

- **R1.1** — THE journal SHALL vivir en `<repo>/.awm/journal/<branch-slug>/` (local al proyecto, gitignoreado) y SHALL NOT escribir nada bajo `~/.awm`. Estructura: `cycle.json`, `tasks/`, `jobs/`, `requests/`, `events.jsonl`, `supervisor.lock`.
- **R1.2** — THE escrituras de estado canónico SHALL reutilizar `writeFileAtomic` (`cli/src/core/atomic-file.ts`) y SHALL ser exclusivas del supervisor; THE requests SHALL ser archivos inmutables creados con flag `wx` e idempotency key en el nombre. *(RF-2.10; bloqueante-3)*
- **R1.3** — THE estado canónico SHALL llevar revisión monotónica; WHEN el supervisor aplica una request, SHALL verificar generación (fencing) y revisión antes de escribir; IF la request pertenece a una generación reemplazada, THEN SHALL rechazarse y auditarse en `events.jsonl` — nunca aplicarse en silencio. *(bloqueante-3)*
- **R1.4** — THE modelo durable SHALL representar como entidades explícitas: ciclo, tarea, intento, despacho (implementador / spec-review / quality-review / fix / QA), veredicto y job — cada una registrada ANTES de que la acción correspondiente se ejecute. *(RF-2.1, RF-2.3; importante-1)*
- **R1.5** — WHILE el ciclo esté `IN_PROGRESS`, THE `cycle.json` SHALL contener `next_action` estructurado: `{actionId, type, target, preconditions, attempt, state}` — idempotente y ejecutable sin memoria conversacional. *(RF-2.6, N4; importante-1)*
- **R1.6** — IF una lectura encuentra JSON inválido o shape inválido, THEN los comandos de consulta (`list`, `show`, `ps`) SHALL mostrarla como `corrupt` (visible, nunca descartada en silencio) y continuar; THE comandos de certificación (`gate`, `reconcile`) SHALL tratarla como bloqueo (ver R3.2). *(regla CONSTITUTION + bloqueante-2)*
- **R1.7** — THE estados SHALL ser enums de valores separados, nunca sobrecargados: job `registered | claimed | running | done | failed | suspected-stall | orphaned | corrupt`; ciclo `IN_PROGRESS | COMPLETE | BLOCKED`. *(regla CONSTITUTION)*

### R2 — Identidad de procesos e higiene

- **R2.1** — THE identidad de todo proceso registrado SHALL ser `{pid, startTime, spawnNonce, argvDigest, processGroup}` — nunca PID solo; WHEN `ps`, `reap` o el lock evalúan liveness, SHALL validar la tupla completa antes de afirmar identidad o enviar señal alguna. *(bloqueante-4; brief:84)*
- **R2.2** — WHEN se invoca `reap`, THE comando SHALL listar explícitamente qué procesos/artefactos limpiará, validar identidad completa, y solo entonces actuar — nunca limpieza silenciosa ni señal a identidad no confirmada.
- **R2.3** — THE sistema SHALL registrar en el journal todo proceso lanzado por cualquiera de sus componentes; `awm job ps` SHALL ser la fuente única de "qué hay corriendo", cruzando identidad completa contra procesos vivos.
- **R2.4** — THE R1 SHALL NOT instalar nada persistente (sin daemons, launchd, systemd ni cron); el supervisor es un proceso foreground que el dueño ve y corta.

### R3 — CLI `awm job`

- **R3.1** — THE CLI SHALL exponer: `init`, `request -- <cmd>` (intención + get-or-create por fingerprint), `list/show/ps` (consulta), `controller-heartbeat`, `reconcile`, `gate`, `reap`. La ejecución de jobs NO es un verbo del agente: la posee el supervisor. *(bloqueante-1)*
- **R3.2** — WHEN se invoca `gate`, IF existe cualquier entidad no terminal **o cualquier entrada corrupta/no parseable**, THEN THE exit code SHALL ser ≠ 0 con el listado (pendientes y corruptas por separado) — el gate **falla cerrado**: la corrupción jamás certifica. *(RF-2.3, RF-2.9; bloqueante-2)*
- **R3.3** — WHEN se invoca `reconcile`, IF un job no terminal tiene identidad de proceso probada muerta, THEN SHALL marcarse según su dueño: si el supervisor vive y era suyo, lo re-reclama automáticamente (la prueba de terminación es mecánica — RF-2.7 satisfecho sin humano); `orphaned` SHALL reservarse para pérdida del propio supervisor, y su reejecución automática SHALL proceder solo con identidad probada muerta — si la liveness no puede probarse en ningún sentido, SHALL requerir autorización explícita. *(RF-2.6, RF-2.7; importante-2 — la autonomía se preserva porque la prueba de terminación es mecánica en el caso ordinario)*
- **R3.4** — THE fingerprint SHALL computarse de: argv exacto + cwd relativo al repo + `HEAD` + digest del índice + digest de tracked/untracked/deleted de los paths declarados (`--paths <globs>`, expansión persistida en el job; sin declaración, el árbol completo). Reutilización de evidencia SOLO ante identidad exacta de fingerprint + comando; cualquier diferencia ejecuta de nuevo, y un resultado que llega tarde (el estado cambió) queda histórico sin satisfacer el gate actual. *(RF-2.2, RF-2.8; CA-T.1; importante-4)*
- **R3.5** — WHILE un job viva, THE duración SHALL NOT producir transición terminal. THE señales SHALL ser tres, separadas: `controllerHeartbeat` (turno del orquestador, vía `awm job controller-heartbeat` — es lo que consume el supervisor para decidir relanzamiento), liveness real del proceso runner (la valida el supervisor contra la identidad R2.1), y `lastProgressAt` (crecimiento de log/output). `suspected-stall` = runner vivo + sin progreso; observacional, con diagnóstico read-only. *(RF-2.5; importante-3)*
- **R3.6** — IF el proyecto carece de suite o sensores, THEN `gate` SHALL degradar declarando explícitamente qué verificador falta — nunca verde por ausencia de verificadores. *(RF-2.4)*
- **R3.7** — THE logs por job SHALL tener retención acotada (tamaño máximo con default). THE journal SHALL NOT persistir el entorno; argv y stdout/stderr SHALL pasar por redacción de secretos (los patrones del sensor-pack: `password|secret|api_key|apikey|token|passwd`, extensible) antes de persistirse. *(RF-2.10; importante-6)*

### R4 — Supervisor `awm watch`

- **R4.1** — THE instancia SHALL ser única por repo: `supervisor.lock` con identidad completa R2.1; IF el lock apunta a identidad muerta probada, THEN SHALL reclamarse con aviso.
- **R4.2** — WHILE el ciclo esté `IN_PROGRESS`, WHEN `controllerHeartbeat` supere el umbral de silencio (default 5 min), THE supervisor SHALL emitir generación `N+1` (fencing revoca la `N` — no hace falta probar su muerte) y relanzar el comando de reanudación del provider (default `codex exec` con prompt journal-first). *(bloqueantes 1 y 3)*
- **R4.3** — THE relanzamientos SHALL aplicar backoff (1 → 5 → 15 min) y tope por hora; IF el relanzamiento falla, THEN error auditado + backoff — nunca loop caliente.
- **R4.4** — THE supervisor SHALL reclamar y ejecutar toda intención de job pendiente en process groups propios, sobreviviendo a cualquier turno del agente. *(bloqueante-1)*
- **R4.5** — WHEN el ciclo llegue a `COMPLETE` o `BLOCKED`, THE supervisor SHALL drenar sus jobs vivos (esperar o adoptar decisión explícita del dueño), liberar el lock y terminarse — ningún proceso eterno ni hijo abandonado. *(higiene)*
- **R4.6** — THE `events.jsonl` SHALL escribirlo únicamente el supervisor (append serializado por el único writer); la superficie concurrente son las requests inmutables. *(importante-6)*

### R5 — Integración con el skill SDD (registry)

- **R5.1** — IF el proyecto NO tiene journal inicializado, THEN THE skill SDD SHALL comportarse exactamente como hoy — cero cambios (Claude Code intocable).
- **R5.2** — WHERE el journal esté inicializado, THE controlador SHALL emitir la request de registro de cada entidad (tarea/intento/despacho/veredicto) ANTES de actuar, con su token de generación. *(RF-2.1, RF-2.3)*
- **R5.3** — WHERE el journal esté inicializado, WHEN un turno de orquestador comienza, THE skill SHALL abrir con `awm job reconcile` + lectura de `next_action` y SHALL emitir `controller-heartbeat` en cada paso del protocolo.

### R6 — Tests (tmpdir + HOME override; ningún test toca `~/.awm`)

Fixtures obligatorios: los 4 de R0 (job largo / job mudo / orphaned / fingerprint) **más** los del review: review perdido (gate bloquea — CA-2.3), proyecto sin verificadores (R3.6), interrupción en cada fase del ciclo con reanudación por `next_action`, resultado tardío tras cambio de estado (histórico, no certifica), corrupción de journal (gate falla cerrado), redacción de secretos en argv/stdout, requests concurrentes del mismo fingerprint (get-or-create devuelve el mismo job), generación vieja rechazada por fencing, y reutilización de PID (identidad completa evita señal a proceso ajeno).

### R7 — Métricas del ciclo

- **R7.1** — THE journal SHALL registrar timestamps por entidad suficientes para computar duración por fase/tarea/ciclo (RNF-T.4) — el dato del dolor #1 sale gratis del journal, sin telemetría.

### R8 — Validación del dueño

- **R8.1** — THE cierre de R1 SHALL incluir smoke en máquina real (Mac y/o VPS): ciclo con corte provocado → supervisor releva generación → `codex exec` retoma desde `next_action` sin pérdida ni duplicados; y la batería semántica equivalente corrida en Claude Code confirma R5.1 (cero cambio de flujo). Se registra en issue #20.

## Estructura

```
cli/src/core/journal/
  types.ts          entidades: Cycle, Task, Attempt, Dispatch, Verdict, Job,
                    ProcessRef {pid,startTime,spawnNonce,argvDigest,processGroup},
                    NextAction {actionId,type,target,preconditions,attempt,state}
  store.ts          lectura + shape validation; escritura canónica (solo supervisor)
                    sobre writeFileAtomic; revisión monotónica
  requests.ts       emisión/consumo de requests inmutables (wx + idempotency key)
  fingerprint.ts    argv + cwd + HEAD + índice + digests de paths (expansión persistida)
  process.ts        identidad completa de procesos, liveness, spawn con nonce
  redact.ts         redacción de secretos para argv/stdout antes de persistir
cli/src/commands/job/
  index.ts init.ts request.ts list.ts show.ts ps.ts
  controller-heartbeat.ts reconcile.ts gate.ts reap.ts
cli/src/commands/watch/
  index.ts          supervisor: lock, loop, fencing/generaciones, claim+spawn de
                    jobs, relanzamiento con backoff, drenaje y auto-terminación
cli/tests/core/journal/  + cli/tests/commands/job|watch/
```

En `awm-baseline-registry`: sección journal-first del skill
`subagent-driven-development`, condicional a journal inicializado (R5), con los
comandos exactos y el protocolo de `controller-heartbeat`.

## Flujo de continuidad en Codex (v2)

1. Dueño: `awm job init` + `awm watch` en una terminal (Mac o VPS).
2. El supervisor lanza la generación 1: `codex exec` con el prompt journal-first.
3. El orquestador registra entidades vía requests (con token gen-1), emite
   `controller-heartbeat`, y pide verificaciones con `awm job request` — **no las
   ejecuta él**: el supervisor las corre en sus propios process groups, donde
   sobreviven a cualquier turno.
4. Codex se detiene. Los jobs siguen corriendo (son del supervisor, no del turno).
5. Silencio > umbral → el supervisor emite generación 2 (la 1 queda revocada por
   fencing aunque siga viva) y relanza `codex exec`. Backoff + tope si falla.
6. El orquestador gen-2 abre con `reconcile` + `next_action` y continúa. Requests
   tardías de gen-1 se rechazan y auditan. Nada se pierde, nada se duplica.
7. `gate` en verde (sin pendientes, sin corruptos) → ciclo `COMPLETE` → el
   supervisor drena, libera el lock y se apaga solo.

## Non-goals

- Tocar el flujo de Claude Code (R5.1 lo garantiza por diseño).
- Daemons/launchd/cron o instalación persistente (R2.4).
- Timeout terminal por duración, en cualquier forma (fuera de alcance firme).
- Tiering de modelo (desestimado, DA-2) y paralelismo (Release 5, después).
- Telemetría remota; todo es archivo local del repo.
