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
1. Despachá un subagente pidiéndole modelo distinto al de la sesión (si tu harness expone esa opción) con la instrucción: "Escribí el identificador exacto del modelo bajo el que corrés en `<evidence>/p2-<provider>-<env>-<STAMP>.txt`".
2. Verdad: el archivo con un identificador distinto al de la sesión ⇒ `soportado`. Sin opción de modelo en el despacho ⇒ `no-soportado`. El subagente no conoce su modelo ⇒ `no-certificado` con nota.

## P3 — Turno que termina con proceso vivo
1. Lanzá detached: `node -e 'const fs=require("fs");const f=process.argv[1];const end=Date.now()+180000;(function t(){fs.appendFileSync(f,Date.now()+"\n");if(Date.now()<end)setTimeout(t,1000)})()' <evidence>/p3-<provider>-<env>-<STAMP>.log & disown` (o `spawn` detached equivalente).
1b. Si el lanzamiento detached falla (el harness no lo permite, o el proceso muere igual), registrá `p3TurnEnd: no-soportado` con el error capturado en `detail` — no sigas al paso 2.
2. Registrá el timestamp actual en `p3-<...>-turnend.txt` y TERMINÁ el turno (respondé y cerrá).
3. Esperá al menos 30s de reloj real después del corte antes de revisar — si el turno siguiente llega antes, esperá el resto antes de contar. En el turno siguiente: contá heartbeats posteriores al timestamp del corte. ≥30s de continuidad ⇒ `soportado`; se cortó al terminar el turno ⇒ `no-soportado`; el harness no permite reconsultar ⇒ `no-certificado`.

## P4 — Worktree
1. `git worktree add /tmp/r0-wt-$STAMP HEAD` → escribí un archivo dentro del worktree → verificá con `git -C <repo> status --short` que el árbol principal NO lo ve → `git worktree remove --force /tmp/r0-wt-$STAMP`.
2. Guardá la transcripción de comandos+salidas en `p4-<provider>-<env>-<STAMP>.txt`. Todo ok ⇒ `soportado`; `git worktree` no disponible o el harness lo bloquea ⇒ `no-soportado` con el error capturado.

## P5 — Recuperación post-interrupción
1. Escribí `p5-<provider>-<env>-<STAMP>-marker.json` con `{"next_action":"escribir p5-resumed con este mismo stamp"}`.
2. Cerrá la sesión o el turno. Si tenés forma de cerrar la aplicación/CLI por completo (no solo terminar el turno dentro de la misma sesión abierta), hacelo — es la prueba más fuerte de recuperación real; si solo podés terminar el turno, es válido igual pero anotalo en `detail` como "solo cambio de turno".
3. En sesión/turno NUEVO, sin memoria del anterior: encontrá el marker SOLO leyendo `evidence/`, ejecutá su `next_action` (crear `p5-<...>-resumed.txt` con el stamp). Ambos archivos con el mismo stamp ⇒ `soportado` (sesión real cerrada) o `degradado` (solo cambio de turno — anotalo).

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
    "p2ModelOverride": { "state": "…", "detail": "…", "artifacts": ["p2-….txt"] },
    "p3TurnEnd":       { "state": "…", "detail": "N beats post-corte", "artifacts": ["p3-….log", "p3-…-turnend.txt"] },
    "p4Worktree":      { "state": "…", "detail": "…", "artifacts": ["p4-….txt"] },
    "p5Recovery":      { "state": "…", "detail": "sesión-real | solo-turno", "artifacts": ["p5-…-marker.json", "p5-…-resumed.txt"] },
    "p6WaitPolling":   { "state": "…", "detail": "mecanismo descrito", "artifacts": [] }
  }
}
```

Estados válidos: `soportado | no-soportado | degradado | no-verificable-aquí | no-certificado`.
Para ejercicios de agente (P1–P6), usá `no-verificable-aquí` cuando el ejercicio en sí no se puede intentar en este entorno (p. ej., el entorno no persiste `evidence/` entre turnos, por lo que P5 no puede ni siquiera intentarse) — distinto del caso normal de P5 paso 3, donde el ejercicio SÍ se intenta pero solo se logra cambio de turno y el resultado correcto es `degradado`, y distinto de `no-soportado`, que significa que SÍ se intentó y se confirmó ausente.
Un `state` con `artifacts: []` solo es válido para P6 — en P1–P5, sin artefacto ⇒ `no-certificado`.
