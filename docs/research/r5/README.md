# R5 · certificación de tracks paralelos

Qué hay acá, qué está probado y qué no. Sin ambigüedad: si una fila dice `pending`, nadie la
verificó por esta vía — no se infiere de las que sí.

## Las dos vías, y por qué son dos

| Vía | Qué certifica | Costo | Estado |
|---|---|---|---|
| `scripted` (`scripted-controller.mjs`) | El contrato **supervisor↔controller**: spawn, token de generación, requests consumidas, worktrees, fencing | **Cero tokens**, repetible | bootstrap ✅ · recovery ✅ · join ⏳ |
| `claude-code` / `codex` | Que un **agente real** sabe ocupar el rol de controller | Tokens, sin techo garantizado | Sin correr (opcional) |

La segunda **no** se deduce de la primera, y la primera **no** se deduce de la segunda. Son
afirmaciones distintas y la matriz las mantiene separadas a propósito.

## Correr la certificación scripteada

```bash
cd cli && npm run build && cd ..
node docs/research/r5/provider-run.mjs --certify-scripted
node docs/research/r5/provider-run.mjs --consolidate
```

Levanta un repo temporal, corre `awm watch` real con `AWM_CONTROLLER_ARGV` apuntando al
controller determinista, mata el supervisor con `SIGKILL` a mitad del bootstrap, lo relanza,
y deriva los veredictos **del journal**, nunca de lo que el controller diga haber hecho.

## Estado real

**Certificado (procesos reales, git real, reproducible):**

- **bootstrap** — los dos tracks llegan a `ARMED` y la cohorte a `ACTIVE`.
- **recovery** — tras `SIGKILL` al grupo del supervisor, el relevo **no duplica recursos**:
  un `supervisorIntent` y un `TrackRef` por track. Esa es la promesa C11; lo demás era
  detalle de implementación.
- **fencing observado en vivo** — las requests de una generación superseded se rechazan
  (`request-rejected-stale`). El mecanismo funciona.

**No certificado por esta vía — `join` (`pending`):**

La cohorte no alcanza `COMPLETE` bajo supervisor vivo con relevo. Tres hipótesis se probaron
y se descartaron como causa completa, cada una arreglando un defecto real del propio
controller scripteado:

1. **Sin heartbeat** el supervisor lo declaraba en stall y lo superseeded en loop. Corregido
   (el heartbeat es parte del contrato del controller, no un adorno).
2. **`git commit` sobre árbol limpio** cuando un controller relevado reencuentra el trabajo
   ya commiteado por su antecesor. Corregido: idempotencia sobre el estado real del worktree,
   no sobre la fase del track.
3. **Contrato canónico de integración sin registrar** — sin `register --entity
   track-integration` el supervisor fail-closea en `request-final-integration` en vez de
   inventar un comando (comportamiento correcto). Corregido.

Después de los tres, el síntoma persiste: **~3,5 minutos después del `SIGKILL`, el token del
controller vivo pasa a ser stale y todas sus requests se rechazan**, antes de que se abra la
generación siguiente. No se identificó la causa raíz.

**No se intentó un cuarto fix a propósito.** Tres intentos fallidos sobre el mismo síntoma es
la señal de que el problema está en un nivel distinto del que se está parcheando, y seguir
parchando produce un verde que no significa nada. Queda como hallazgo abierto con su
evidencia (`evidence/artifacts/scripted-local/events.jsonl`), no como test tolerado en rojo.

**Dónde SÍ está cubierto el join:** `cli/tests/commands/watch/track-join-crash.test.ts`,
`track-finalize.test.ts` y `cli/tests/integration/parallel-tracks.e2e.test.ts` — todos con
git real, incluyendo crash/restart en cada frontera del join. Lo que falta es ejercitarlo
bajo un supervisor vivo con relevo de controller, que es una composición, no el join en sí.

## `AWM_CONTROLLER_ARGV`

Array JSON de strings que reemplaza el argv de lanzamiento del controller, conservando el
resto del adapter (actividad, `safeToReplace`, fencing, custodia). Es lo que vuelve
**falsificable** la afirmación "el supervisor no conoce providers": antes solo se podía
enchufar `codex` o `claude-code`, así que la agnosticidad no se podía romper ni comprobar.

```bash
AWM_CONTROLLER_ARGV='["node","/ruta/a/mi-controller.mjs","--repo","/ruta/al/repo"]' \
  awm watch --provider codex
```

Array y jamás una línea de shell — misma doctrina que el argv de integración de los tracks
(C4). Se valida en el borde: cualquier otra cosa es un error explícito, nunca un fallback
silencioso al provider nativo (un override mal escrito que "funciona igual" lanzaría el
agente real, con su costo en tokens, sin que nadie lo note).
