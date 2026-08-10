# Parallel tracks (`awm track`)

Cómo correr las tasks de un plan **en paralelo**, cada una en su propio worktree, y cómo leer
el sistema cuando decide no hacerlo.

> **Lo primero, porque ahorra tiempo:** el paralelismo es una **optimización opcional**. Un
> plan sin sección `## Tracks` corre serial exactamente como siempre — no hay nada que migrar
> y nada se rompe por no adoptarlo.

## Estado de verificación

Sin ambigüedad sobre qué está probado y qué no:

| Capacidad | Estado | Cómo se verificó |
|---|---|---|
| Bootstrap de la cohorte (tracks a `ARMED`, cohorte `ACTIVE`) | ✅ Verificado | Suite con git real + certificación con supervisor y procesos reales |
| Degradación a serial ante cualquier condición no probada | ✅ Verificado | Suite con git real, incluida paridad de árbol serial-vs-paralelo |
| Recuperación tras crash sin duplicar recursos | ✅ Verificado | `SIGKILL` real al grupo del supervisor + relevo |
| Aislamiento por worktree y ownership declarado/real | ✅ Verificado | Suite con git real, incluidos renames por sus dos puntas |
| `join → COMPLETE` bajo supervisor vivo con relevo de controller | ✅ Verificado | Certificación con supervisor y procesos reales (`provider-run.mjs --certify-scripted`): `COMPLETE`, 2 tracks `JOINED` y **1** job de integración final. Evidencia en [`docs/research/r5/evidence/scripted-local.json`](../research/r5/evidence/scripted-local.json) |
| Un agente LLM real como controller | ⚠ Sin verificar | Opcional; certificado solo con controller determinista |
| `awm track remove` (teardown pedido por el controller) | ❌ **No implementado** | El supervisor no tiene handler para `track-teardown-request`: el comando emite la request y el supervisor la **rechaza** de forma visible. El teardown que sí funciona es el automático de la degradación a serial. |

## El modelo mental

Hay **dos roles**, y confundirlos es el error más común:

- El **supervisor del plan** (`awm watch`) es el único que integra: congela la cohorte,
  mergea, corre QA global y ejecuta el comando canónico de integración. Es un proceso de
  larga vida.
- El **controller** (tu agente) **solo emite requests**. `awm track add` y `awm track join`
  no crean ni mergean nada: dejan una request que el supervisor consume en su próximo tick.

Por eso todo comando que muta lleva `--generation <token>`: el token lo emite el supervisor
al lanzar al controller y viaja en su prompt. Es un **fencing token** — si el supervisor
relevó al controller, las requests del anterior se rechazan (`request-rejected-stale`). Eso
no es un error a reintentar: significa que otro controller tomó el trabajo.

## Declarar un plan paralelo

Tres cosas, todas obligatorias:

1. **Membresía por task** — cada `### Task N:` lleva `**Track:** <id>`.
2. **Tabla `## Tracks`** — una fila por track con `Depends on` y `Shared resources`.
3. **Comando de integración** — argv como **array JSON**, nunca una línea de shell.

```markdown
## Tracks

**Integration argv:** ["npm","test","--","--runInBand"]
**Integration paths:** ["src/**"]

| Track | Depends on | Shared resources |
|---|---|---|
| api | none | [] |
| ui  | none | [] |
```

El ownership de cada track sale de los `**Files:**` de sus tasks — no se declara aparte, para
que no pueda divergir de lo que las tasks dicen que van a tocar.

Antes de arrancar: `awm track verify-independence` sale `!= 0` ante cualquier violación.

## El flujo diario

```bash
awm watch                # supervisor del plan: arranca o retoma. Lanza al controller.
awm track status         # agregado read-only: fase de cada track y de la cohorte
awm track list           # los TrackRef declarados, con su worktreePath
```

El controller, con su token:

```bash
awm track add <id>  --generation "$GEN"    # emite la request de preparación
awm track join <id> --generation "$GEN"    # pide la integración de su track
awm track finalize  --generation "$GEN"    # autoreporta la QA global sobre el HEAD mergeado
```

Cada track trabaja en un worktree hermano del repo (`<repo>.track-<id>`) y commitea **solo
sus archivos asignados**. Ningún merge arranca hasta que **toda** la cohorte esté congelada, y
el comando canónico corre **una vez sobre el HEAD final** — no una vez por track.

### Los joins no cierran la cohorte

Con todos los tracks mergeados la cohorte **no** está completa: queda el tramo que verifica el
resultado combinado, y ese tramo lo maneja el controller del plan.

1. El supervisor pide la **QA global** sobre el HEAD que ya tiene todos los tracks adentro.
2. El controller corre esa QA, **comitea las correcciones** que salgan, y lo autoreporta con
   `awm track finalize`. El HEAD sale del repo, no de un flag: es *tu* HEAD el que reportás.
   Con el árbol sucio el comando falla nombrando lo que falta, en vez de emitir un
   autoreporte que el supervisor va a descartar en silencio.
3. El supervisor **re-verifica por su cuenta** (HEAD real + árbol limpio) antes de aceptarlo:
   el autoreporte declara, nunca prueba.
4. Recién ahí corre la integración canónica y el interlock final, y la cohorte pasa a
   `COMPLETE`.

Si la cohorte se queda quieta con todos los tracks en `MERGED_UNVERIFIED`, está esperando el
paso 2: `awm track status` lo muestra, y el `next_action` del journal dice `run-global-qa`.

## Cuándo degrada a serial (y por qué está bien)

El sistema **prefiere ser lento antes que ser incorrecto**. Cualquiera de estas condiciones
apaga el paralelismo de **toda la cohorte**, no solo del track involucrado:

| Condición | Razón |
|---|---|
| Falta una declaración (membresía, fila, `Shared resources`, argv) | Un contrato incompleto no puede probar independencia |
| Dos tracks se pisan en paths o recursos | Trabajarían sobre lo mismo |
| Un track declara un **lockfile, manifest o migración** | Clase global: dos tracks reescribiéndola en paralelo se pisan aunque el resto no |
| Un glob que el sistema no sabe expandir | Un patrón inexpandible no puede *afirmar* que dos tracks no se cruzan |
| `Depends on` distinto de `none` | Hay orden, entonces no hay paralelo |
| El worktree no se puede crear, o `.awm` no está gitignoreado | Sin aislamiento probado, no hay track |

La degradación queda registrada con su causa (`cohortFallbackReason`, y el evento
`enter-serial` la nombra). **Serial produce el mismo árbol que paralelo** — es un criterio de
aceptación verificado, no una aspiración.

## `BLOCKED` — qué significa y qué NO hacer

`BLOCKED` significa exactamente una cosa: **no se pudo probar la propiedad o la identidad de
un recurso**. No es "falló", es "no me consta".

Un track `BLOCKED` **nunca** habilita el fallback serial. Degradar con worktrees ajenos
posiblemente vivos sería correr encima de algo no probado — justo lo que el diseño evita.

**No borres un worktree, una branch, un lock ni un proceso para que el sistema avance.** Eso
no lo desbloquea: destruye la evidencia de por qué estaba bloqueado, y puede matar trabajo
ajeno. `BLOCKED` es un dead-end deliberado que pide a un operador aportar evidencia:

```bash
awm track status                    # qué track, y su blockedReason
git -C <repo> worktree list         # qué hay realmente registrado
git -C <worktree> status            # ¿hay trabajo sin commitear que se perdería?
```

Recién con eso decidís. El teardown usa siempre `git branch -d` (nunca `-D`) y rehúsa remover
un worktree sucio nombrando los paths, en vez de descartar trabajo real sin dejar rastro.

## Diagnóstico

Todo el estado durable vive en `<repo>/.awm/journal/<rama>/`:

- `state.json` — `cohortPhase`, los `TrackRef` con su fase, `cohortFallbackReason`
- `events.jsonl` — la traza: creación de worktrees, spawns, freezes, merges, rechazos

Cuando algo no avanza, tres preguntas en orden:

1. **¿La cohorte degradó?** `cohortPhase: SERIAL` + `cohortFallbackReason` dice por qué.
2. **¿Hay un track `BLOCKED`?** Su `blockedReason` nombra qué no se pudo probar.
3. **¿Las requests se están rechazando?** `request-rejected-stale` en los eventos significa
   que el controller que las emitió ya fue relevado — el nuevo retoma, no reintentes a mano.

Un controller que trabaja en silencio es declarado en stall y reemplazado: si escribís uno
propio, tiene que emitir `awm job controller-heartbeat --generation <token>` mientras trabaja.

## Referencias

- [CLI reference](../cli-reference.md) — todos los flags
- [Arquitectura](../architecture.md) — componentes y estado en disco
- [`docs/research/r5/README.md`](../research/r5/README.md) — qué está certificado, cómo, y qué queda abierto
