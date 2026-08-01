# R1 — Controlador durable: journal, `awm job`, `awm watch` — diseño

> Ejecuta el **Release 1** del brief certificado
> [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md)
> (RF-2.1–RF-2.10, PR-2), re-priorizado por el dueño el 2026-07-31 (issue
> [#20](https://github.com/Kodria/agentic-workflow/issues/20)): prioridades =
> tiempo de ciclo + continuidad del orquestador en Codex. Insumos: matriz y
> contradicciones de R0 ([`report.md`](../research/r0/report.md)) — en Codex el
> harness mata procesos al fin del turno y no hay espera certificable, así que
> la continuidad viene de estado durable + relanzamiento externo.
> Decisiones del dueño en la sesión de diseño: **enfoque A** (journal + `awm job`
> + watchdog `awm watch` como proceso en primer plano, sin daemons),
> **100% autónomo en R1** (el watchdog relanza `codex exec` solo),
> **higiene de procesos como invariante** (nada invisible en Mac/VPS),
> **Claude Code intocable** (su flujo actual no cambia).

## Requirements

IDs propios de este diseño (`R1`–`R7`); donde materializan un RF del brief, se cita.

- **R1 — Journal durable.** THE journal SHALL vivir en `<repo>/.awm/journal/<branch-slug>/` (local al proyecto, gitignoreado) y SHALL NOT escribir nada bajo `~/.awm`. Componentes: `cycle.json` (estado del ciclo + `next_action`), `jobs/<job-id>.json`, `events.jsonl` (append-only).
  - **R1.1** — THE escrituras del journal SHALL ser atómicas vía write-temp + `rename` (primitiva certificada por R0 en Linux y macOS). *(RF-2.10)*
  - **R1.2** — IF una lectura del journal encuentra JSON inválido o shape inválido (incluido valor no-objeto), THEN THE lector SHALL descartar esa entrada con warning explícito y continuar — nunca crashear el comando. *(regla CONSTITUTION, recurrencia curada 2026-07-31)*
  - **R1.3** — THE estados SHALL ser enums de valores separados, nunca sobrecargados: job `registered | running | done | failed | suspected-stall | orphaned`; ciclo `IN_PROGRESS | COMPLETE | BLOCKED`. *(regla CONSTITUTION)*
  - **R1.4** — WHILE el ciclo esté `IN_PROGRESS`, THE `cycle.json` SHALL contener un `next_action` ejecutable (qué task/fase sigue y con qué contexto mínimo) — el puntero de reanudación nunca es memoria conversacional. *(RF-2.6, N4)*
- **R2 — CLI `awm job`.** THE CLI SHALL exponer: `init` (habilita el journal en el proyecto), `add/start/heartbeat/finish` (ciclo de vida), `list/show/ps` (visibilidad), `reconcile`, `gate`, `run -- <cmd>`, `reap`.
  - **R2.1** — WHEN se invoca `ps`, THE comando SHALL cruzar los PIDs registrados en el journal contra los procesos realmente vivos y mostrar el veredicto por job (vivo / muerto / sin PID). *(higiene)*
  - **R2.2** — WHEN se invoca `reconcile` (inicio de cualquier turno), IF un job `running` tiene PID muerto y sin resultado, THEN SHALL marcarse `orphaned` — SHALL NOT inferirse fallo ni iniciarse un duplicado; la reejecución exige prueba de terminación o autorización explícita. *(RF-2.6, RF-2.7)*
  - **R2.3** — WHEN se invoca `gate`, IF existe cualquier job/tarea/veredicto no terminal, THEN THE exit code SHALL ser ≠ 0 con el listado de pendientes — el interlock de cierre es mecánico, no prosa. *(RF-2.3, RF-2.9)*
  - **R2.4** — WHEN se invoca `run -- <cmd>`, THE comando SHALL computar fingerprint (comando normalizado + `HEAD` + digest del working tree de los paths declarados vía `--paths <globs>`; sin declaración, el working tree completo) y SHALL reutilizar evidencia previa **solo** ante identidad exacta de fingerprint + comando; cualquier diferencia SHALL ejecutar de nuevo. *(RF-2.2, RF-2.8; CA mecánico que resuelve DA-1)*
  - **R2.5** — WHILE un job viva, THE duración SHALL NOT producir jamás una transición terminal; IF no hay progreso observable (heartbeat), THEN el estado SHALL ser `suspected-stall` observacional con el proceso intacto y diagnóstico read-only. *(RF-2.5)*
  - **R2.6** — THE logs por job SHALL tener retención acotada (tamaño máximo configurable con default) y THE journal SHALL NOT persistir valores de variables de entorno ni secretos. *(RF-2.10)*
- **R3 — Watchdog `awm watch`.** THE watchdog SHALL ser un proceso en primer plano (terminal del dueño), sin daemon, launchd, systemd ni cron.
  - **R3.1** — THE instancia SHALL ser única por repo (lockfile con PID; IF el lock apunta a un PID muerto, THEN SHALL reclamarse con aviso — nunca segundo watchdog silencioso).
  - **R3.2** — WHILE el ciclo esté `IN_PROGRESS`, WHEN el heartbeat del orquestador supere el umbral de silencio (configurable, default 5 min), THE watchdog SHALL relanzar el comando de reanudación configurado del provider (default Codex: `codex exec` con el prompt de reanudación journal-first).
  - **R3.3** — THE relanzamientos SHALL aplicar backoff (1 → 5 → 15 min) y un tope por hora (configurable); IF el relanzamiento falla, THEN SHALL registrarse el error y continuar el backoff — nunca un loop caliente. *(higiene)*
  - **R3.4** — WHEN el ciclo llegue a `COMPLETE` o `BLOCKED`, THE watchdog SHALL terminarse solo y liberar su lock — ningún proceso eterno. *(higiene)*
  - **R3.5** — THE watchdog SHALL registrar todo proceso que lance (PID, comando, timestamp) en el journal y reportarlo en stdout — nada invisible. *(higiene)*
- **R4 — Higiene de procesos (invariante del dueño).**
  - **R4.1** — THE sistema SHALL registrar en el journal todo proceso que lance cualquiera de sus componentes; `awm job ps` SHALL ser la fuente única de "qué hay corriendo".
  - **R4.2** — WHEN se invoca `reap`, THE comando SHALL listar explícitamente qué procesos/artefactos limpia antes de actuar — nunca limpieza silenciosa.
  - **R4.3** — THE R1 SHALL NOT instalar nada persistente en la máquina (sin servicios, sin crontabs, sin archivos fuera del repo salvo los propios binarios npm ya existentes).
- **R5 — Integración con el skill SDD (registry `awm-baseline-registry`).**
  - **R5.1** — IF el proyecto NO tiene journal inicializado, THEN THE skill SDD SHALL comportarse exactamente como hoy — cero cambios de flujo (Claude Code intocable).
  - **R5.2** — WHERE el journal esté inicializado, THE controlador SHALL registrar cada despacho y veredicto en el journal ANTES de actuar (registro primero, acción después). *(RF-2.1, RF-2.3)*
  - **R5.3** — WHERE el journal esté inicializado, WHEN un turno de orquestador comienza, THE skill SHALL abrir con `awm job reconcile` y continuar desde `next_action` — reanudar-y-reconciliar como protocolo, no como excepción. *(RF-2.6; contradicción 1 de R0 aceptada)*
- **R6 — Tests.** THE suite SHALL usar tmpdirs con override de `HOME`/`AWM_HOME` (patrón obligatorio del repo; ningún test toca `~/.awm` ni el journal real) y SHALL cubrir los 4 fixtures especificados en el report de R0: job largo (nunca timeout), job mudo (`suspected-stall`, nunca kill), `orphaned` (reconciliación sin duplicar), fingerprint (dedup solo identidad exacta — CA-T.1).
- **R7 — Validación del dueño.** THE cierre de R1 SHALL incluir un smoke en la máquina real del dueño (Mac y/o VPS): ciclo con corte provocado → `awm watch` relanza `codex exec` → el orquestador retoma desde `next_action` sin pérdida. Runbook mínimo estilo Fase B; se registra en el issue #20.

## Estructura

```
cli/src/core/journal/
  types.ts          contratos: CycleState, Job, JobState, eventos
  store.ts          lectura/escritura atómica + shape validation
  fingerprint.ts    comando normalizado + HEAD + digest de paths
  process.ts        liveness de PIDs, registro de procesos lanzados
cli/src/commands/job/
  index.ts          registra subcomandos
  init.ts add.ts start.ts heartbeat.ts finish.ts
  list.ts show.ts ps.ts
  reconcile.ts gate.ts run.ts reap.ts
cli/src/commands/watch/
  index.ts          loop del watchdog (lock, umbral, backoff, relanzamiento)
cli/tests/core/journal/  + cli/tests/commands/job|watch/   (tmpdir + HOME override)
```

En `awm-baseline-registry` (repo hermano, mismo patrón editar→commit→tag→`awm update`):
sección nueva del skill `subagent-driven-development` — protocolo journal-first
condicional a journal inicializado (R5), con los comandos exactos.

## Flujo de continuidad en Codex (el dolor #2, curado)

1. El dueño corre `awm job init` en el proyecto y deja `awm watch` corriendo en una terminal.
2. El orquestador Codex trabaja journal-first: registra despacho/veredicto antes de actuar, hace heartbeat, mantiene `next_action` al día.
3. Codex se detiene (el hoy: "lanza uno tras otro y de un momento a otro simplemente se detiene").
4. `awm watch` detecta silencio > umbral → relanza `codex exec "sos el orquestador: corré awm job reconcile y ejecutá next_action"` con backoff.
5. El orquestador nuevo re-ancla desde el journal (`reconcile` adopta huérfanos, `next_action` da el punto exacto) y sigue. Nada se pierde, nada se duplica.
6. Al llegar a `COMPLETE` (gate en verde), el watchdog se apaga solo.

## Non-goals

- Tocar el flujo de Claude Code (funciona perfecto — R5.1 lo garantiza por diseño).
- Daemons/launchd/cron o cualquier instalación persistente (R4.3).
- Timeout terminal por duración, en cualquier forma (fuera de alcance firme del brief).
- Tiering de modelo (Release 4 desestimado, DA-2) y paralelismo (Release 5, sigue después).
- Telemetría remota; todo es archivo local en el repo.
