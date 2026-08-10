# R5 · certificación de tracks paralelos

Qué hay acá, qué está probado y qué no. Sin ambigüedad: si una fila dice `pending`, nadie la
verificó por esta vía — no se infiere de las que sí.

## Las dos vías, y por qué son dos

| Vía | Qué certifica | Costo | Estado |
|---|---|---|---|
| `scripted` (`scripted-controller.mjs`) | El contrato **supervisor↔controller**: spawn, token de generación, requests consumidas, worktrees, fencing | **Cero tokens**, repetible | bootstrap ✅ · recovery ✅ · join ✅ |
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

**Certificado — `join` (`pass`):** la cohorte alcanza `COMPLETE` bajo supervisor vivo con
relevo, con los 2 tracks en `JOINED` y **exactamente 1** job de integración final.

Llegar ahí exigió reparar **siete defectos**, la mayoría de producto. El síntoma que este
README describía antes — "el token del controller vivo pasa a ser stale y todas sus requests
se rechazan" — resultó ser un efecto secundario, no la causa: era el controller lanzado por
un supervisor de TRACK emitiendo contra el journal del PLAN con el token del track. Las
requests rechazadas por generación stale en la corrida certificada son **0**.

La decisión de entonces de **no intentar un cuarto parche** fue correcta: el problema estaba
en un nivel distinto del que se estaba parcheando. Los defectos reales, en el orden en que se
destaparon uno a otro:

1. **`awm track join` no hacía nada** (producto). `applyRequestToState` no tenía rama para
   `track-join-request`: se caía por el final sin lanzar, el caller contaba `applied++` y
   borraba el archivo. `join-requested` era la única observación del protocolo con cero
   productores en todo `src/`.
2. **El fallthrough silencioso** (producto) que permitió (1). Un `RequestKind` sin handler
   ahora falla cerrado: `request-rejected-invalid`, evento durable, archivo `.rejected`.
3. **`awm track finalize` no existía** (producto). Los joins no cierran la cohorte: el
   supervisor pide QA global y espera un `track-finalize-request` que ningún comando emitía —
   el único productor era el harness de tests. `COMPLETE` solo era alcanzable desde adentro
   de los tests.
4. **Un join pedido antes de la activación se perdía** (producto, introducido al reparar (1)
   y detectado por esta misma certificación).
5. **El supervisor de un track no arrancaba** si el plan cruzaba `ACTIVE` entre dos polls
   (producto). Solo funcionaba *porque* el join estaba roto y los tracks se quedaban parados
   en `ACTIVE`: un bug sostenía al otro.
6. **Un track no podía congelarse nunca** (producto): R3.6 se evaluaba fuera del guard
   `requireGlobalKinds`, así que el gate local exigía verificadores que un journal de track
   jamás detecta.
7. **El plan de ciclo del controller scripteado** no incluía `qa` ni `interlock` (harness),
   que el gate global exige siempre.

**Dónde más está cubierto el join:** `cli/tests/commands/watch/track-join-crash.test.ts`,
`track-finalize.test.ts`, `track-join-request.test.ts` y
`cli/tests/integration/parallel-tracks.e2e.test.ts` — todos con git real, incluyendo
crash/restart en cada frontera.

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
