# Runner: qué garantiza Linux (este sandbox) y qué queda abierto para macOS (R6, Step 4)

**Fuentes:** `docs/research/r0/evidence/mech-claude-code-sandbox-remote-20260731T024434Z-df8007.json`, `docs/research/r0/evidence/detached-heartbeats-20260731T024434Z-df8007.log`, `docs/research/r0/evidence/p3-claude-code-sandbox-remote-20260731T024648Z.log`, `docs/research/r0/evidence/p3-claude-code-sandbox-remote-20260731T024648Z-turnend.txt` (todas rutas reales de este repo, producidas por Tasks 2/8 de este mismo plan). Contexto de vocabulario: `docs/plans/2026-07-30-sdd-cycle-optimization-brief.md` RF-2.5–RF-2.7 (runner que sobrevive a duración/agente/turno) y `docs/plans/2026-07-31-r0-discovery-design.md` R8 (portabilidad macOS+Linux, Windows fuera de alcance).

## Qué garantiza Linux aquí (evidencia real, este sandbox)

### 1. Supervivencia de proceso detached a la muerte del padre

Evidencia: `evidence/mech-claude-code-sandbox-remote-20260731T024434Z-df8007.json`:

```json
"detachedSurvival": {
  "state": "soportado",
  "detail": "11 heartbeats posteriores a la muerte del padre (umbral: 3)",
  "artifacts": ["detached-heartbeats-20260731T024434Z-df8007.log"]
}
```

Umbral de la sonda era 3 heartbeats; se observaron 11 — más de 3x margen sobre el umbral, en una ventana de sonda controlada (script Node puro, `probes/lib/detached.mjs`). Esto confirma en Linux la primitiva mínima que un runner durable (RF-2.6 del brief: *"si desaparece el agente, turno o contexto que solicitó un job, el job SHALL conservar identidad, heartbeat, log y resultado"*) necesita del sistema operativo: un proceso hijo desatendido (`disown`/`detached: true` equivalente) sigue vivo y siguiendo produciendo heartbeats después de que su proceso lanzador termina.

### 2. Atomicidad de rename-replace en el filesystem local

Misma evidencia JSON:

```json
"renameReplace": { "state": "soportado", "detail": "rename-replace entrega el contenido nuevo íntegro en el fs de evidence/", "artifacts": [] }
```

Confirma que `fs.renameSync` (o equivalente) sobre el filesystem que respalda `docs/research/r0/evidence/` en este sandbox entrega el contenido nuevo de forma íntegra — sin lectura parcial/corrupta intermedia. Relevante para RF-2.10 (*"el journal, logs y transiciones SHALL escribirse atómicamente"*): confirma que el patrón "escribir a archivo temporal + rename" es viable como primitiva de escritura atómica de journal en este filesystem Linux.

### 3. Supervivencia real más allá del fin de turno del agente (no solo simulada)

Evidencia: `evidence/p3-claude-code-sandbox-remote-20260731T024648Z.log` (181 líneas de heartbeats, timestamps epoch-ms consecutivos, de `1785466009002` a `1785466189359` — un rango de **180,357 ms ≈ 180.4 segundos** de heartbeats registrados) y `evidence/p3-claude-code-sandbox-remote-20260731T024648Z-turnend.txt` (contiene un único timestamp, `1785466056689`, el marcador del fin de turno real de la sesión de agente).

Restando: `1785466189359 - 1785466056689 = 132,670 ms ≈ 132.7 segundos` de heartbeats del proceso detached **después** del timestamp de fin de turno — muy por encima del umbral declarado de ≥30s en la nota de contexto de esta tarea, y consistente con "133 heartbeats past the recorded cutoff" citado en el brief de la tarea. A diferencia de la sonda mecánica §1 (que mide supervivencia a la muerte de un proceso padre simulado dentro de un mismo script), este es el ejercicio P3 del `AGENT-PROTOCOL.md` real: un proceso detached lanzado por el agente sobrevivió el **fin de turno real** de la conversación (el punto en que el agente que lo lanzó deja de estar activo), no solo un `SIGTERM` simulado al padre.

**Conclusión combinada de evidencia (1) y (3):** en este sandbox Linux, un job/runner detached puede sobrevivir tanto (a) la terminación explícita del proceso que lo lanzó, como (b) el fin de turno del agente en una sesión real — las dos formas de "desaparición del solicitante" que RF-2.6 exige tolerar. Esto es la base empírica mínima para que el diseño de PR-2 (controlador durable + runner) asuma que "lanzar un job detached y reconciliarlo después" es viable en Linux, sin necesitar todavía un daemon/servicio de sistema separado.

## Qué queda abierto para macOS (Fase B — corrida del dueño)

Ninguna de las tres evidencias de arriba fue producida en macOS; son 100% Linux (`"platform": "linux", "release": "6.18.5"` en el JSON de evidencia). El diseño (`docs/plans/2026-07-31-r0-discovery-design.md` R8) exige explícitamente que el estudio de portabilidad del runner cubra macOS y Linux (Windows queda fuera de alcance, R8). Preguntas concretas que solo la corrida del dueño en macOS puede cerrar:

1. **¿El mismo mecanismo de detach (`disown`/spawn detached) sobrevive igual en macOS?** macOS (BSD-derived) tiene semántica de proceso huérfano distinta de Linux en algunos bordes (reparenting a `launchd` en vez de `init`/PID 1) — la sonda mecánica (`probes/lib/detached.mjs`) es Node puro y portable, pero el *resultado* (soporta/no soporta, cuántos heartbeats de margen) es una pregunta empírica, no algo que se pueda inferir del código.
2. **¿Rename-replace es igual de atómico sobre el filesystem por defecto de macOS (APFS) que sobre el filesystem de este sandbox?** APFS y el filesystem Linux del sandbox tienen garantías de atomicidad de `rename(2)` en principio equivalentes por POSIX, pero comportamiento real bajo condiciones de carrera/red (si el dueño corre sobre un volumen de red o iCloud Drive) no está probado aquí.
3. **¿El ejercicio P3 (fin de turno real con proceso vivo) da un margen de supervivencia comparable (~130s) en Claude Code corriendo nativo en macOS,** o hay throttling/cleanup de proceso más agresivo del lado del SO o del cliente de escritorio que reduzca ese margen?
4. **¿Hay diferencias de manejo de señales (SIGHUP en particular)** entre cómo una terminal/sesión de macOS despide a sus hijos vs. cómo lo hace este sandbox Linux — relevante porque `disown` en bash depende de que el shell no reenvíe `SIGHUP` al grupo de procesos.

Estas cuatro preguntas son exactamente el contenido que `RUNBOOK.md` (`docs/research/r0/RUNBOOK.md`) le pide a la Fase B del dueño: correr `probes/run.mjs` y el `AGENT-PROTOCOL.md` en macOS y producir evidencia JSON con la misma forma (`mech-claude-code-mac-*.json`, artefactos P1–P5 equivalentes) para que `consolidate.mjs` las agregue a `capability-matrix.md` junto a esta fila Linux.

## Conclusión

**Lo que Linux garantiza aquí, con evidencia real y no supuesta:** detached-survival soportado con amplio margen (11/3 heartbeats en sonda mecánica, ~132.7s tras fin de turno real en P3), y rename-replace atómico sobre el filesystem del sandbox. **Lo que queda abierto:** si esas mismas dos garantías (y el margen de supervivencia observado) se sostienen igual en macOS — pregunta que este análisis sandbox-only no puede cerrar por diseño (R6 lo declara explícitamente: "macOS se completa con la corrida del kit del dueño") y que corresponde a Fase B, no a esta tarea.
