# Protocolo de agente — R0 (clase 2: hechos del harness)

Para el agente de CADA sesión de provider (Claude Code / Codex / OpenCode).
Regla central (design doc R4): **la verdad queda en archivos**. Toda respuesta
sin artefacto que la respalde se registra `no-certificado` — nunca `soportado`.

**Antes de escribir `soportado` en cualquier ejercicio, releé/listá el artefacto que estás por citar en `artifacts[]` — si no podés abrirlo o no existe, el estado real es `no-certificado`, no `soportado`.** Nadie más valida esto automáticamente; la honestidad del agente en este paso es la única garantía.

Preparación: `STAMP=$(date -u +%Y%m%dT%H%M%SZ)`; los artefactos van en
`docs/research/r0/evidence/` con prefijo `p<N>-<provider>-<env>-$STAMP`.
Alcance de sistema operativo: macOS y Linux. Windows queda fuera de alcance de este protocolo (ver `RUNBOOK.md`).

## P1 — Despacho y paralelismo de subagentes
1. Despachá DOS subagentes a la vez (si tu harness lo permite), cada uno con esta instrucción exacta: "Durante 20 segundos, cada ~1s, agregá una línea `$(date +%s%3N)` al archivo `<evidence>/p1-<provider>-<env>-<STAMP>-<a|b>.log`, luego terminá".
2. Verdad: si existen ambos logs y sus rangos de timestamps se SOLAPAN, hay paralelismo real. Si ambos logs existen pero sus rangos NO se solapan (corrieron uno tras otro), `p1Dispatch: soportado` pero `p1Parallel: no-soportado` — el despacho existe, el paralelismo no. Si solo se pudo despachar de a uno, `p1Parallel: no-soportado` y `p1Dispatch: soportado`. Si no hay despacho de subagentes, ambos `no-soportado`.

## P2 — Override de modelo por despacho
1. Registrá en `p2-<provider>-<env>-<STAMP>-controller.txt` el identificador exacto del modelo de la sesión y **cómo se obtuvo** (metadato del harness, salida del CLI o `no disponible`). No uses una inferencia ni el nombre solicitado como si fuera el observado.
2. Despachá un subagente pidiendo un modelo distinto, sin revelarle en el prompt el identificador solicitado. Pedile: "Escribí el identificador exacto del modelo que el runtime reporta para esta ejecución en `<evidence>/p2-<provider>-<env>-<STAMP>-worker.txt`; si el runtime no lo expone, escribí `no disponible`".
3. Guardá además en `p2-<provider>-<env>-<STAMP>-dispatch.txt` el modelo solicitado y cualquier metadato/resultado del despacho que el harness exponga.
4. Verdad: controlador y worker tienen identificadores observados, distintos, y el dispatch confirma el override ⇒ `soportado`. Hay opción de override pero falta cualquiera de esas tres piezas ⇒ `no-certificado`. El harness no ofrece override ⇒ `no-soportado`.

## P3 — Turno que termina con proceso vivo
1. Lanzá detached: `node -e 'const fs=require("fs");const f=process.argv[1];const end=Date.now()+180000;(function t(){fs.appendFileSync(f,Date.now()+"\n");if(Date.now()<end)setTimeout(t,1000)})()' <evidence>/p3-<provider>-<env>-<STAMP>.log & disown` (o `spawn` detached equivalente).
1b. Si el lanzamiento detached falla (el harness no lo permite, o el proceso muere igual), registrá `p3TurnEnd: no-soportado` con el error capturado en `detail` — no sigas al paso 2.
2. Registrá el timestamp actual en `p3-<...>-turnend.txt` y TERMINÁ el turno (respondé y cerrá).
3. Esperá al menos 30s de reloj real después del corte antes de revisar — si el turno siguiente llega antes, esperá el resto antes de contar. En el turno siguiente, escribí `p3-<...>-resumed.json` con timestamp de revisión y los identificadores de turno/sesión que exponga el harness, y contá heartbeats posteriores al corte.
4. Verdad: ≥30s de continuidad **y** un artefacto de reanudación que distinga el turno de revisión ⇒ `soportado`; si hay heartbeats pero el harness no expone ninguna evidencia durable del cambio de turno ⇒ `no-certificado`; si se cortó al terminar el turno ⇒ `no-soportado`.

## P4 — Worktree
1. `git worktree add /tmp/r0-wt-$STAMP HEAD` → escribí un archivo dentro del worktree → verificá con `git -C <repo> status --short` que el árbol principal NO lo ve → `git worktree remove --force /tmp/r0-wt-$STAMP`.
2. Guardá la transcripción **literal** de comandos, stdout y stderr en `p4-<provider>-<env>-<STAMP>.txt`; no reemplaces una salida vacía o extensa por comentarios narrativos. Todo ok y salida literal presente ⇒ `soportado`; relato sin salida ⇒ `no-certificado`; `git worktree` no disponible o el harness lo bloquea ⇒ `no-soportado` con el error capturado.

## P5 — Recuperación post-interrupción
1. Escribí `p5-<provider>-<env>-<STAMP>-marker.json` con `{"next_action":"escribir p5-resumed con este mismo stamp"}`.
2. Para Fase B, cerrá la aplicación/CLI por completo. Un nuevo turno dentro de la misma conversación con memoria previa no certifica recuperación.
3. En una sesión NUEVA sin memoria del anterior: encontrá el marker SOLO leyendo `evidence/`, ejecutá su `next_action` (crear `p5-<...>-resumed.txt` con el stamp) y registrá cualquier identificador de sesión que el harness exponga.
4. Ambos archivos con el mismo stamp y sesión nueva ⇒ `soportado`. Solo cambio de turno ejecutado por un contexto fresco sin briefing ⇒ `degradado` (proxy válido fuera de Fase B). Mismo contexto con memoria o sin evidencia del corte ⇒ `no-certificado`.

## P6 — Espera/polling
Describí el mecanismo de espera de tu harness (¿notificaciones de background? ¿polling? ¿sleep bloqueado?) y respaldalo con el artefacto de P3 (quién te despertó y cómo). Sin artefacto posible ⇒ `no-certificado` con nota — es informativo.

## Formulario final
Escribí `evidence/agent-<provider>-<env>-<STAMP>.json`:

```json
{
  "schema": 1,
  "kind": "agent",
  "provider": "<claude-code|codex|opencode>",
  "environment": "<sandbox-remote|owner-mac|...>",
  "date": "<ISO>",
  "harnessVersion": "<lo que tu CLI/harness reporte>",
  "exercises": {
    "p1Dispatch":      { "state": "…", "detail": "…", "artifacts": ["p1-…-a.log", "p1-…-b.log"] },
    "p1Parallel":      { "state": "…", "detail": "rango A ∩ rango B", "artifacts": ["…"] },
    "p2ModelOverride": { "state": "…", "detail": "modelo controlador vs worker + procedencia", "artifacts": ["p2-…-controller.txt", "p2-…-worker.txt", "p2-…-dispatch.txt"] },
    "p3TurnEnd":       { "state": "…", "detail": "N beats post-corte + identidad de turno", "artifacts": ["p3-….log", "p3-…-turnend.txt", "p3-…-resumed.json"] },
    "p4Worktree":      { "state": "…", "detail": "…", "artifacts": ["p4-….txt"] },
    "p5Recovery":      { "state": "…", "detail": "sesión-real | contexto-fresco | mismo-contexto", "artifacts": ["p5-…-marker.json", "p5-…-resumed.txt"] },
    "p6WaitPolling":   { "state": "…", "detail": "mecanismo descrito", "artifacts": [] }
  }
}
```

Estados válidos: `soportado | no-soportado | degradado | no-verificable-aquí | no-certificado`.
Para ejercicios de agente (P1–P6), usá `no-verificable-aquí` cuando el ejercicio en sí no se puede intentar en este entorno (p. ej., el entorno no persiste `evidence/` entre turnos, por lo que P5 no puede ni siquiera intentarse) — distinto del caso normal de P5 paso 3, donde el ejercicio SÍ se intenta pero solo se logra cambio de turno y el resultado correcto es `degradado`, y distinto de `no-soportado`, que significa que SÍ se intentó y se confirmó ausente.
Un `state` con `artifacts: []` solo es válido para P6 — en P1–P5, sin artefacto ⇒ `no-certificado`.
