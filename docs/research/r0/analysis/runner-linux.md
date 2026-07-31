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

### 2. Integridad final de rename-replace; atomicidad concurrente no certificada

Misma evidencia JSON:

```json
"renameReplace": { "state": "no-certificado", "detail": "la sonda original no tuvo lector concurrente", "artifacts": [] }
```

La corrida original solo confirma que el contenido final leído después de
`fs.renameSync` es íntegro. Como no existía un lector concurrente, no podía
observar una ausencia o contenido parcial durante el reemplazo y no certifica
RF-2.10. La sonda fue endurecida después de la auditoría; las corridas nuevas
informan cantidad de lecturas concurrentes y observaciones viejo/nuevo.

### 3. Continuidad posterior al timestamp; cambio de turno no certificado por archivo

Evidencia: `evidence/p3-claude-code-sandbox-remote-20260731T024648Z.log` (181 líneas de heartbeats, timestamps epoch-ms consecutivos, de `1785466009002` a `1785466189359` — un rango de **180,357 ms ≈ 180.4 segundos** de heartbeats registrados) y `evidence/p3-claude-code-sandbox-remote-20260731T024648Z-turnend.txt` (contiene un único timestamp, `1785466056689`, el marcador del fin de turno real de la sesión de agente).

Restando: `1785466189359 - 1785466056689 = 132,670 ms ≈ 132.7 segundos` de heartbeats posteriores al timestamp. Esto prueba continuidad temporal, pero los artefactos originales no incluyen identidad de turno/sesión ni un archivo de reanudación; la misma evidencia podría existir sin que el turno hubiese terminado. Por R4, el cambio real de turno queda `no-certificado` hasta repetir P3 con el protocolo endurecido.

**Conclusión combinada de evidencia (1) y (3):** en este sandbox Linux sí está certificada la supervivencia a la terminación del proceso padre. También se observaron heartbeats durante más de dos minutos tras un timestamp declarado como corte, pero la desaparición del turno/agente no quedó certificada por artefactos durables.

## Qué queda abierto para macOS (Fase B — corrida del dueño)

Ninguna de las tres evidencias de arriba fue producida en macOS; son 100% Linux (`"platform": "linux", "release": "6.18.5"` en el JSON de evidencia). El diseño (`docs/plans/2026-07-31-r0-discovery-design.md` R8) exige explícitamente que el estudio de portabilidad del runner cubra macOS y Linux (Windows queda fuera de alcance, R8). Preguntas concretas que solo la corrida del dueño en macOS puede cerrar:

1. **¿El mismo mecanismo de detach (`disown`/spawn detached) sobrevive igual en macOS?** macOS (BSD-derived) tiene semántica de proceso huérfano distinta de Linux en algunos bordes (reparenting a `launchd` en vez de `init`/PID 1) — la sonda mecánica (`probes/lib/detached.mjs`) es Node puro y portable, pero el *resultado* (soporta/no soporta, cuántos heartbeats de margen) es una pregunta empírica, no algo que se pueda inferir del código.
2. **¿Rename-replace es atómico bajo lectores concurrentes en el filesystem de la máquina del dueño?** La nueva sonda lo mide de forma empírica; debe correrse sobre el volumen real donde vive el checkout, especialmente si es un volumen de red o sincronizado.
3. **¿El ejercicio P3 (fin de turno real con proceso vivo) da un margen de supervivencia comparable (~130s) en Claude Code corriendo nativo en macOS,** o hay throttling/cleanup de proceso más agresivo del lado del SO o del cliente de escritorio que reduzca ese margen?
4. **¿Hay diferencias de manejo de señales (SIGHUP en particular)** entre cómo una terminal/sesión de macOS despide a sus hijos vs. cómo lo hace este sandbox Linux — relevante porque `disown` en bash depende de que el shell no reenvíe `SIGHUP` al grupo de procesos.

Estas cuatro preguntas son exactamente el contenido que `RUNBOOK.md` (`docs/research/r0/RUNBOOK.md`) le pide a la Fase B del dueño: correr `probes/run.mjs` y el `AGENT-PROTOCOL.md` en macOS y producir evidencia JSON con la misma forma (`mech-claude-code-mac-*.json`, artefactos P1–P5 equivalentes) para que `consolidate.mjs` las agregue a `capability-matrix.md` junto a esta fila Linux.

## Conclusión

**Lo certificado aquí:** detached-survival frente a muerte del padre, con amplio margen (11/3 heartbeats). **No certificado por las corridas históricas:** atomicidad concurrente de rename y supervivencia al fin real de turno. Ambos deben repetirse en la máquina del dueño con la sonda y el protocolo endurecidos antes de cerrar Fase B.
