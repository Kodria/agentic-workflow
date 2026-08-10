# R5 · protocolo de certificación por provider

Tres ejercicios sobre un repo temporal, idénticos para todos los providers. El objetivo no
es "que el agente diga que funcionó": es **dejar en el journal la evidencia durable de que
funcionó**. `provider-run.mjs --finalize` no lee este documento ni el reporte del agente —
lee el journal del repo y deriva los veredictos de ahí. Inventar el resultado no sirve, y
saltarse un paso tampoco: un ejercicio no ejecutado sale `fail` con el detalle de qué faltó.

## Quién ejecuta esto

**Vos sos el controller que `awm watch` lanzó**, no un operador que invoca `awm watch` como
si fuera un comando acotado. Esa distinción es la arquitectura, no un detalle:

- `awm watch` es un **supervisor durable de larga vida**. No "corre y sale": se queda
  reconciliando, y es él quien te lanzó a vos como controller de la generación vigente.
- Toda mutación del ciclo pasa por un **token de generación** que el supervisor te entregó
  en tu propio prompt de lanzamiento (`Generacion activa: <token>`). Cada comando que
  registra trabajo lo lleva: `--generation <token>`.
- Vos **nunca** lanzás ni matás `awm watch`. El único caso en que un proceso de supervisor
  se toca es el Ejercicio 2, y ahí lo hace el operador, no vos.

Si no tenés un token de generación en tu prompt, no estás en el rol que este protocolo
asume: pará y reportalo en vez de improvisar uno.

## Variables

El runner (`provider-run.mjs --provider … --environment …`) ya preparó todo e imprimió:

```
WORKDIR=...   # raíz temporal de la corrida
REPO=...      # el repo del plan — TODO se ejecuta acá adentro
CLI=...       # ruta absoluta a dist/src/index.js del build local
TRACKS=alpha,beta
```

Reglas invariantes:

- **No edites nada fuera de `WORKDIR`.** El repo del CLI no se toca durante la corrida.
- **Siempre `node "$CLI" …`**, nunca `awm` del PATH: `awm` puede ser cualquier versión
  publicada, y la corrida certifica *este* build.
- **Nunca borres ni edites `.awm/` a mano.** Es la evidencia; tocarla invalida la corrida.
- `cd "$REPO"` antes del primer comando y quedate ahí.

## Ejercicio 1 — Bootstrap

Que los dos tracks lleguen a `ARMED` y la cohorte pase a `ACTIVE`.

```bash
cd "$REPO"
node "$CLI" track add alpha --generation "$GENERATION"
node "$CLI" track add beta  --generation "$GENERATION"
node "$CLI" track status   # agregado read-only: fase de cada track + de la cohorte
```

`track add` **solo emite la request**. Quien crea el worktree, el journal del track y su
supervisor es el supervisor del plan, que la consume en su próximo tick. Es normal que
`track status` muestre los tracks avanzando de a una frontera por tick: ese avance acotado
es justamente lo que permite que un crash en cualquier punto converja al reintentar. Poleá
`track status` hasta ver ambos tracks `ARMED` y la cohorte `ACTIVE`.

**Se certifica leyendo:** un evento `track-armed-or-blocked` por cada track, más la cohorte
en `ACTIVE` o posterior.

## Ejercicio 2 — Recovery

Probar que, si el supervisor del plan muere sin cleanup, el relevo **no duplica**
supervisores de track.

> **Este ejercicio lo ejecuta el operador humano**, no el controller: implica matar el
> proceso que lanzó al controller — es decir, matarte a vos mismo si lo intentás desde acá.

```bash
# En otra terminal, con el supervisor del plan corriendo sobre $REPO:
pkill -9 -f "index.js watch"    # SIGKILL: sin handlers, sin cleanup — el peor caso real
cd "$REPO" && node "$CLI" watch --provider <claude-code|codex>   # relevo
```

`SIGKILL` y no `SIGTERM`: un `SIGTERM` deja correr el cleanup ordenado, que es justamente el
camino que este ejercicio **no** quiere medir. El relevo abre una generación nueva y lanza un
controller nuevo, que retoma desde el journal.

**Se certifica leyendo:** ≥2 generaciones de controller en el journal (prueba durable de que
un segundo proceso tomó el relevo — no una marca que escriba el agente) y **exactamente un**
`track-supervisor-intent` por track. Dos intents para el mismo track significan que el
restart duplicó un supervisor, que es precisamente lo que C11 prohíbe.

## Ejercicio 3 — Join

Completar los dos tracks, pedir los joins y llegar a `COMPLETE` con **una sola** corrida del
comando canónico de integración.

```bash
cd "$REPO"
node "$CLI" track list   # imprime el worktreePath de cada track (siblings: <repo>.track-<id>)
```

En el worktree de `alpha`: escribir `src/alpha.txt` con `alpha-final`, `git add -A` y commit.
En el de `beta`: `src/beta.txt` con `beta-final`, `git add -A` y commit.

```bash
node "$CLI" track join alpha --generation "$GENERATION"
node "$CLI" track join beta  --generation "$GENERATION"
node "$CLI" track status
```

`track join` **solo emite la request**: la integración es propiedad exclusiva del supervisor
del plan. Ningún merge arranca hasta que **toda** la cohorte esté congelada (C3), y el
comando canónico corre **una vez sobre el HEAD final**, no una vez por track (C4). Si ves más
de un job de integración final, es un hallazgo — reportalo, no lo "arregles" reintentando.

**Se certifica leyendo:** `cohortPhase: COMPLETE`, los dos tracks en `JOINED`, y exactamente
un job de integración final.

## Cierre

Lo ejecuta el operador, con el supervisor ya detenido:

```bash
node docs/research/r5/provider-run.mjs --finalize --workdir "$WORKDIR"
```

Imprime `PASS`/`FAIL` por ejercicio, copia el journal sanitizado a
`docs/research/r5/evidence/artifacts/<provider>-<environment>/` y escribe el JSON canónico.
Sale `!= 0` si algún ejercicio no pasó.

## Si algo falla

Reportá el `fail` **con su detalle tal cual**. No reintentes hasta que dé verde ocultando los
intentos previos, y no edites el journal para que un check pase: un ejercicio que necesitó
que le acomoden el estado no está certificando nada. Un `FAIL` honesto con su detalle es un
resultado útil; un `PASS` fabricado envenena la matriz para todos los que la lean después.

## Estado de validación de este documento

Los comandos de los Ejercicios 1 y 3 están verificados contra la superficie real del CLI
(`track add|join|list|status`, todos con `--generation`). **La secuencia completa
supervisor → controller → joins todavía no se corrió end-to-end en ningún provider**: eso es
exactamente lo que los Steps 3 y 4 de la Task 16 producen, y requiere un provider real
(`claude` o `codex` instalado y autenticado) en una máquina que no es una sesión agéntica
remota. Hasta que exista la evidencia, `provider-run.mjs --consolidate` escribe
`not-certified` y el test `r5-provider-evidence` falla — que es el comportamiento correcto,
no un test roto.
