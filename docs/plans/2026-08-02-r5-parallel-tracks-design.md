# R5 — Paralelismo entre tracks independientes (design)

**Origen:** Release 5 de [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md) (brief re-certificado `ready` 9/9 el 2026-08-02).
**Trazabilidad al brief:** RF-4.1, RF-4.2, RF-4.3 · RNF-T.2 · CA-4.1, CA-4.2, CA-4.3.
**Base:** R1 (controlador durable) ya shipeado y mergeado — CLI v3.5.0.
**Revisión:** v2 — reescrito tras una revisión que encontró 6 bloqueadores y 2 importantes, todos confirmados contra el código. Ver §Historial de revisión.

---

## Contradicción del brief resuelta en este diseño

El brief acota el alcance de R5 a **"(Registry: `writing-plans` + skill SDD.)"** — solo contenido. Pero RF-4.3 exige que la independencia se verifique **mecánicamente**, comparando la declaración previa contra lo realmente modificado. Un skill solo puede *instruir* al controlador a correr el `git diff` y comparar: eso es disciplina del agente, no mecanismo — exactamente el modo de falla que motivó R1 (*"El gate existe como instrucción de prosa pero nada lo fuerza mecánicamente"*).

**Resolución del dueño (2026-08-02): R5 va a CLI + Registry.**

| # | Decisión del dueño | Consecuencia |
|---|---|---|
| 1 | R5 = CLI + Registry | corrige el alcance declarado del brief |
| 2 | Tracks se declaran con campo `**Track:**` por tarea | retrocompatible por ausencia |
| 3 | Falla parcial: el track verde se reúne apenas pasa; el ciclo queda no-COMPLETE nombrando el que falta | preserva RF-2.9 sin dejar el trabajo bueno de rehén |

DA-3 fue resuelta el 2026-08-02 a favor de **fallback a serial con degradación declarada**.

---

## Requirements

### R1 — Gramática de declaración

- **R1.1** — WHEN una tarea del plan declara `**Track:** <id>`, THE parser SHALL asignar esa tarea al track `<id>`. *(brief RF-4.1)*
- **R1.2** — IF ninguna tarea del plan declara `**Track:**`, THEN THE ejecución SHALL ser serial e idéntica a la actual, sin diferencia observable atribuible a R5. *(Constraint de retrocompatibilidad)*
- **R1.3** — THE `<id>` de un track SHALL pasar `git check-ref-format --branch` Y SHALL rechazarse si es vacío, `.`, `..`, contiene `/` o `\`, o empieza con `-`. *(regla de `CONSTITUTION.md`: rechazar el conjunto completo de entradas peligrosas, nunca enumerar solo las que se le ocurran a quien escribe)*
- **R1.4** — THE ownership de un track SHALL derivarse de la unión de los `**Files:**` de sus tareas, normalizados a paths POSIX relativos canónicos.
- **R1.5** — THE plan SHALL declarar las propiedades por track en un bloque `## Tracks`, con `Depends on:` y `Shared resources:` por track.
- **R1.6** — IF un valor de `**Track:**` no tiene exactamente una entrada correspondiente en el bloque `## Tracks` (o viceversa), THEN THE parser SHALL rechazar el plan.
- **R1.7** — IF un track no declara explícitamente su línea `Shared resources:` (incluido el conjunto vacío `[]` explícito), THEN THE ejecución SHALL rechazar el paralelismo y correr serial. *("sin recursos compartidos" debe ser afirmación del plan, jamás inferencia del CLI — ver §Limitaciones conocidas)*
- **R1.8** — THE grafo de dependencias SHALL construirse desde las líneas `Depends on:`; IF contiene un ciclo, THEN THE parser SHALL rechazar el plan nombrando el ciclo.
- **R1.9** — IF una relación declarada no puede verificarse mecánicamente, THEN THE ejecución SHALL correr serial declarando la degradación — SHALL NOT asumir independencia.
- **R1.10** — WHEN el grafo es válido, THE ejecución SHALL paralelizar únicamente tracks sin dependencias pendientes entre sí; un track con `Depends on:` no vacío SHALL esperar el join de sus predecesores.

### R2 — Bootstrap y asignación del track

- **R2.1** — WHEN se crea un track, THE journal de ese track SHALL inicializarse con `trackId`, el conjunto `taskIds` que le fue asignado, el `planDigest` y el `baseSha`.
- **R2.2** — THE `next_action` de un track SHALL acotarse a sus propios `taskIds`.
- **R2.3** — IF un track intenta ejecutar una tarea fuera de su asignación, THEN SHALL rechazarla. *(cierra el hueco de que cada worktree ejecute el plan completo: el skill SDD extrae todas las tareas del plan activo, así que la asignación tiene que venir del journal, no re-derivarse del plan)*
- **R2.4** — IF el `planDigest` registrado en el journal del track difiere del digest del plan vigente, THEN THE track SHALL quedar BLOCKED — el plan cambió debajo suyo y su asignación ya no es demostrable.
- **R2.5** — THE worktree de un track SHALL contener un descriptor local (`.awm/track.json`, no versionado) con `planRoot` (realpath), `planBranch`, `trackId`, `planJournalId` y un token de fencing.
- **R2.6** — THE descriptor SHALL autenticarse contra el `TrackRef` correspondiente del journal del plan; IF el token no coincide, THEN THE comando SHALL rechazarse. *(sin esto no existe backlink demostrable desde el track hacia su plan)*
- **R2.7** — THE track SHALL NOT leer estado dinámico de otros tracks; conoce su asignación, nunca el progreso ajeno.

### R3 — Ciclo de vida del worktree y del supervisor

- **R3.1** — WHEN se activa el paralelismo, THE controlador SHALL crear un worktree y una rama por track bajo un namespace de ramas propio del ciclo, y SHALL registrar un `TrackRef` con el **realpath** del worktree. *(brief RF-4.1)*
- **R3.2** — IF la creación del worktree falla por cualquier causa, THEN THE ejecución SHALL degradar a serial Y SHALL registrar un evento de degradación declarada — SHALL NOT fallar el plan ni degradar en silencio. *(brief RF-4.2 + DA-3 + RNF-T.2)*
- **R3.3** — IF el path destino ya contiene un journal o un lock de supervisor ajeno, THEN THE comando SHALL rechazar con error explícito Y SHALL NOT borrar ni modificar ese journal.
- **R3.4** — THE rama del plan SHALL tener `.awm` gitignoreado como precondición dura; IF no lo tiene, THEN THE ejecución SHALL correr serial declarándolo. *(evita que `ensureJournalGitignored` produzca una modificación de archivo trackeado que R4.2 leería como violación de ownership)*
- **R3.5** — THE supervisor de un track SHALL lanzarse como **proceso externo desacoplado del turno del agente**, con su identidad durable capturada como tupla completa — SHALL NOT ser un proceso hijo de la invocación del agente. *(`awm watch` es foreground y toma el lock antes de lanzar el controlador; en Codex el proceso muere con el turno — hallazgo central de R0)*
- **R3.6** — THE controlador SHALL NOT despachar trabajo a un track hasta que su supervisor haya señalado readiness de forma durable.
- **R3.7** — IF el supervisor de un track muere, THEN SHALL ser recuperable desde su journal e identidad — su ausencia SHALL NOT interpretarse como fallo del track. *(hereda R2.1 de R1: el silencio no es prueba)*
- **R3.8** — THE shutdown de un track SHALL confirmar terminación del grupo de procesos y liberación de su lock.
- **R3.9** — THE teardown de un worktree SHALL requerir supervisor terminado, lock liberado y cero jobs vivos.

### R4 — Verificación de independencia

- **R4.1** — WHEN se evalúa activar el paralelismo, THE verificación SHALL comparar los ownership declarados entre tracks; IF la intersección es no vacía, THEN THE ejecución SHALL correr serial nombrando los paths en conflicto. *(brief RF-4.2)*
- **R4.2** — THE verificación post-hoc SHALL comparar el ownership declarado contra los archivos realmente modificados, calculados como `git diff --name-only -z <merge-base(plan, track)> <track>` — SHALL NOT compararlos contra el worktree sucio. *(brief RF-4.3)*
- **R4.3** — THE detección de colisiones SHALL considerar además equivalencia case-insensitive, para no declarar independientes dos tracks que colisionan en un filesystem case-folding.
- **R4.4** — WHERE un ownership declara un directorio o un glob, THE comparación SHALL cubrir sus descendientes; WHERE un archivo fue renombrado, SHALL contar como tocado tanto el path viejo como el nuevo.
- **R4.5** — IF un track modificó archivos fuera de su ownership declarado, THEN THE ejecución SHALL serializar los joins restantes — SHALL NOT descartar el trabajo ya realizado. *(brief RF-4.2)*
- **R4.6** — WHILE se detecta una violación de ownership, THE ejecución de los tracks aún en curso SHALL continuar en sus worktrees aislados; lo que se serializa es la **integración**, no la ejecución.
- **R4.7** — THE comando de verificación SHALL ser invocable por argv y SHALL salir con código ≠ 0 ante cualquier violación.

### R5 — Join durable

- **R5.1** — THE integración SHALL tener un dueño único: solo el supervisor de la rama del plan ejecuta joins, y de a uno por vez.
- **R5.2** — THE estado de un track SHALL recorrer la máquina `declared → preparing → running → join-intent → merged → verifying → joined`, con `blocked` alcanzable desde cualquiera.
- **R5.3** — THE intent de join SHALL persistirse **antes** del merge, incluyendo `expectedPlanHeadSha` y `expectedTrackHeadSha`.
- **R5.4** — THE join SHALL exigir, todas: worktree e índice limpios, `HEAD` del track igual al esperado, gate del track recalculado bajo el mismo lock, cero jobs vivos, y supervisor del track terminado con su lock liberado.
- **R5.5** — IF el worktree del track tiene cambios sin commitear, THEN THE join SHALL rechazarse nombrando los paths. *(el fingerprint de R1 incluye untracked y worktree — `ls-files --cached --others`— así que un track puede estar verde con trabajo sin commitear, y `git merge` solo integra commits: sin este guard el join descarta trabajo en silencio dejando el gate verde)*
- **R5.6** — IF el merge produce conflicto, THEN THE join SHALL abortarlo, SHALL dejar el worktree del plan sin `MERGE_HEAD`, y SHALL reportar el conflicto.
- **R5.7** — IF se recupera de un crash con un intent de join abierto, THEN THE reconciliación SHALL comparar los SHAs reales contra los del intent para determinar si el merge llegó a aplicarse — SHALL NOT adivinar ni re-mergear a ciegas.
- **R5.8** — WHILE exista `MERGE_HEAD` o `REBASE_HEAD` en el worktree del plan, THE supervisor SHALL tratarlo como condición bloqueante.

### R6 — Evidencia de integración en el gate

- **R6.1** — THE `VerificationKind` SHALL incluir `track-integration`.
- **R6.2** — THE `cycleVerificationPlan` SHALL admitir el agregado transaccional de items, idempotente por id de item, Y SHALL NOT pisar los `satisfiedBy` ya enlazados. *(hoy `apply.ts` solo registra el plan si está vacío — guard puesto para que un re-registro tras crash no pierda enlaces; el agregado debe ser una operación distinta, no una relajación de ese guard)*
- **R6.3** — THE job que satisface un item `track-integration` SHALL solicitarse **después** de que el merge quedó aplicado, de modo que su fingerprint se compute sobre el estado post-merge.
- **R6.4** — IF un job de integración se solicita antes de que su merge esté aplicado, THEN SHALL rechazarse. *(el fingerprint se computa al pedir el job, no al ejecutarlo — `request.ts:10` — así que un job pedido pre-merge nace con evidencia que el propio merge invalida: no podría satisfacer jamás su item)*
- **R6.5** — THE item `track-integration:<id>` SHALL quedar satisfecho únicamente por el `pass` de ese job post-merge con fingerprint vigente.

### R7 — Falla parcial y cierre

- **R7.1** — WHEN se registran los tracks, THE journal del plan SHALL registrar un item `track-integration` por track, dejando el gate en rojo desde ese momento y no al final.
- **R7.2** — IF cualquier track no completó su join exitosamente, THEN THE ciclo SHALL permanecer no-`COMPLETE` nombrando el track pendiente, aunque otros tracks ya estén mergeados. *(preserva brief RF-2.9)*
- **R7.3** — WHEN todos los tracks completaron su join Y el gate de integración pasa, THE ciclo SHALL poder alcanzar `COMPLETE`.

### R8 — Integridad de la evidencia

- **R8.1** — IF un comando `awm job` o `awm watch` se invoca desde un cwd cuyo realpath no corresponde ni a la raíz del plan ni al track declarado por el descriptor local autenticado, THEN SHALL rechazar la invocación.
- **R8.2** — THE journal del plan SHALL NOT copiar ni espejar estado de los journals de track; la consulta SHALL ser read-only en el momento de necesitarla.
- **R8.3** — THE campo `tracks` SHALL ser aditivo sobre `schema: 1`, y un journal preexistente sin ese campo SHALL leerse sin error.
- **R8.4** — THE estado agregado de un ciclo con tracks SHALL ser consultable en modo read-only, componiendo el gate del plan con el de cada track, sin mutar ningún journal.

### R9 — Multi-provider, concurrencia y costo

- **R9.1** — THE comportamiento de R5 SHALL declararse por provider (soportado / degradado explícito), verificado contra la matriz de R0. *(brief RNF-T.2)*
- **R9.2** — THE cantidad de tracks en paralelo SHALL estar acotada por un tope configurable; IF el plan declara más tracks que el tope, THEN los excedentes SHALL esperar turno.
- **R9.3** — THE valor por defecto del tope SHALL derivarse de una medición real del costo de fingerprint × N supervisores sobre este repo — SHALL NOT ser inventado.
- **R9.4** — THE lanzamiento, recuperación y join SHALL verificarse con E2E reales en Claude Code y en Codex. *(brief CA-T.5: documentación sin ejecución no satisface el criterio)*

---

## Arquitectura

Cuatro planos.

```
PLANO DEL PLAN  (worktree principal, rama del plan)
  awm watch  ──► journal del plan
                   ├─ tracks: TrackRef[]        ← referencias livianas
                   └─ cycleVerificationPlan
                        ├─ track-integration:A
                        └─ track-integration:B
        │
        │  DUEÑO ÚNICO DE INTEGRACIÓN: los joins ocurren acá, de a uno (R5.1)
        ▼
PLANO DEL TRACK  (N worktrees, N ramas, namespace propio del ciclo)
  wt-A/  .awm/track.json  ← descriptor local autenticable (R2.5)
         awm watch ──► journal propio (trackId, taskIds, planDigest, baseSha)
  wt-B/  ídem

PLANO DE SUPERVISIÓN  (procesos externos, desacoplados del turno)
  supervisor-A  ← lanzado detached, identidad durable, readiness (R3.5, R3.6)
  supervisor-B

PLANO DE COMANDOS
  awm track add | list | status | verify-independence | join | remove
```

**Invariante central: ningún dato cruza journals — solo cruza control.** El journal del plan nunca espeja el estado de un journal de track; cuando necesita saber si un track está verde corre `computeGate` sobre el journal del track en modo lectura (ya es función pura de `state` + `fingerprintNow`, `cli/src/commands/job/gate.ts:21`).

**Un track conoce su asignación, no el progreso ajeno.** Esta es la corrección más importante de v2. La versión anterior decía "un track no sabe que es un track", lo cual sonaba elegante pero era un defecto: el skill SDD lee el plan activo y extrae **todas** sus tareas, así que cada worktree habría ejecutado el plan entero. El aislamiento correcto es más fino: el track **sí** conoce su `trackId`, sus `taskIds`, el `planDigest` y su `baseSha` (vienen inicializados en su propio journal, R2.1), y **no** conoce el estado dinámico de ningún otro track (R2.7).

### Por qué esta forma y no otra

Dos formas alternativas quedaron descartadas **por evidencia leída en el código**:

- **Journal único con tracks de primera clase** — exigiría o bien jobs con `cwd` fuera de `repoRoot`, o bien un escritor único sobre N dominios CAS sin atomicidad entre sí. `resolveWorkingDirectory` (`cli/src/core/journal/fingerprint.ts:27-43`) rechaza todo `cwd` absoluto, con `..`, con symlink, o cuyo realpath caiga fuera de `repoRoot`. Además obligaría a borrar `verifyBranchInvariant` (`cli/src/commands/watch/lock.ts:68-77`).
- **Un controlador, N worktrees, sin supervisor por track** — misma rotura de `cwd`, y deja la fase paralela **sin dueño durable**. Es la forma exacta del incidente de los 4 subagentes de QA concurrentes (7 archivos revertidos en silencio, ya curado en `AGENTS.md`).

N supervisores por track es lo que **R1 ya soporta por construcción**: `journalDir(repoRoot, branch)` (`paths.ts:19`) da journals disjuntos y `supervisorLockPath(repoRoot)` (`paths.ts:25`), clavado por realpath, da locks disjuntos. Verificado empíricamente: los worktrees aíslan de verdad, `.awm/` gitignoreado no se propaga a un worktree fresco, y `git-dir ≠ git-common-dir` con realpath distinto por árbol.

**Lo que R1 NO provee y R5 debe construir:** `awm watch` es estrictamente foreground (sus únicas opciones son `--init`, `--provider`, `--heartbeat-timeout`, `--activity-window`) y toma el lock antes de lanzar el controlador. No hay modo detached. En Codex, además, un proceso hijo del turno muere al cerrarse el turno. Por eso el plano de supervisión es una pieza nueva con requisitos propios (R3.5–R3.8), no un detalle de `awm track add`.

---

## Componentes

### Gramática del plan

Membresía por tarea, propiedades por track — sin dos fuentes de verdad sobre lo mismo:

```markdown
## Tracks

| Track | Depends on | Shared resources |
|-------|------------|------------------|
| cli   | none       | []               |
| docs  | none       | []               |

### Task 5: Función pura de limpieza de paths

_Requirements: R2.1_
**Track:** cli

**Files:**
- Create: `cli/src/core/export/transform.ts`
```

El bloque `## Tracks` es la única fuente de `Depends on` y `Shared resources` (R1.5); el campo `**Track:**` es la única fuente de membresía (R1.1). El CLI valida que ambos conjuntos coincidan exactamente (R1.6) — un track declarado sin tareas, o una tarea que apunta a un track inexistente, rechaza el plan.

### `TrackRef` — en el journal del plan (`cli/src/core/journal/types.ts`)

```ts
interface TrackRef {
    trackId: string;
    worktreePath: string;      // realpath — ancla de ownership (R8.1)
    branch: string;
    ownership: string[];       // POSIX relativo canónico (R1.4)
    sharedResources: string[]; // declaración explícita del plan (R1.7)
    dependsOn: string[];       // aristas del DAG (R1.8)
    fencingToken: string;      // autentica el descriptor local (R2.6)
    state: 'declared' | 'preparing' | 'running' | 'join-intent'
         | 'merged' | 'verifying' | 'joined' | 'blocked';
    joinIntent?: { expectedPlanHeadSha: string; expectedTrackHeadSha: string };
}
```

Aditivo sobre `schema: 1`: `normalizeSchemaOne` (`cli/src/core/journal/store.ts:11-34`) ya sienta el precedente con `??= []`.

### `.awm/track.json` — descriptor local del track (no versionado)

```ts
interface TrackDescriptor {
    planRoot: string;     // realpath del worktree del plan
    planBranch: string;
    trackId: string;
    planJournalId: string;
    fencingToken: string; // debe coincidir con el TrackRef (R2.6)
}
```

Es lo que hace implementable a R8.1: desde adentro de un track no existe otra forma de encontrar —y **autenticar**— cuál es su plan. Sin él, la aserción de ownership sería un deseo.

### Comandos (`cli/src/commands/track/`)

| Comando | Qué hace | Cómo falla (siempre cerrado) |
|---|---|---|
| `add` | crea worktree + rama, inicializa el journal del track con su asignación, escribe el descriptor, lanza el supervisor externo y espera readiness | rechaza path reusado con journal ajeno (R3.3); no despacha trabajo sin readiness (R3.6) |
| `verify-independence` | ownership declarado vs. realmente modificado | exit ≠ 0 ante intersección, violación de ownership o colisión case-insensitive |
| `join` | máquina de estados durable: precondiciones → intent → merge → item → job post-merge | rechaza árbol sucio (R5.5); aborta y limpia ante conflicto (R5.6) |
| `status` | read-only: compone el gate del plan con el de cada track | — |
| `list` | lista los `TrackRef` | — |
| `remove` | teardown | gateado a supervisor terminado + lock liberado + cero jobs vivos (R3.9) |

### Cambios sobre módulos existentes

| Path | Cambio |
|---|---|
| `cli/src/core/journal/types.ts` | `TrackRef` + `tracks?` + `track-integration` en `VerificationKind` (R6.1) + guards |
| `cli/src/commands/watch/apply.ts` | nuevos `register-entity`: `track`, `track-status`, `track-join-intent`; y **append transaccional** al `cycleVerificationPlan`, idempotente por id, sin pisar `satisfiedBy` (R6.2) |
| `cli/src/commands/job/request.ts` | guard: rechazar job de integración cuyo merge no esté aplicado (R6.4) |
| `cli/src/commands/watch/init.ts` | precondición dura de `.awm` gitignoreado (R3.4) |
| `cli/src/commands/job/index.ts`, `watch/index.ts` | aserción de realpath contra el descriptor local autenticado (R8.1) |
| `cli/src/commands/watch/supervisor.ts` | `MERGE_HEAD`/`REBASE_HEAD` como condición bloqueante (R5.8) |

### Registry (`awm-baseline-registry`)

- **`writing-plans`** — emite el bloque `## Tracks` y el campo `**Track:**`; ausentes ⇒ track único ⇒ comportamiento actual.
- **`subagent-driven-development`** — sección de despacho por tracks: el primer acto de cada subagente es entrar a la raíz de su worktree, y **su lista de tareas sale del journal del track, no del plan** (R2.3).

---

## Flujo de datos

```
1. writing-plans emite ## Tracks + **Track:** por tarea
        ▼
2. parser: valida ids (R1.3), coincidencia bloque↔tareas (R1.6),
   Shared resources explícito (R1.7), DAG sin ciclos (R1.8)
        │                        └─ cualquier falla ──► SERIAL + evento
        ▼
3. verify-independence declarativo: ¿los ownership se intersectan?
        │   intersección vacía = NECESARIA, NO SUFICIENTE
        ▼
4. awm track add A, B
     ├─ worktree + rama (namespace del ciclo)
     ├─ journal del track init: trackId, taskIds, planDigest, baseSha  (R2.1)
     ├─ descriptor .awm/track.json + fencingToken                      (R2.5)
     ├─ supervisor EXTERNO detached + identidad durable                (R3.5)
     ├─ espera readiness                                               (R3.6)
     └─ items track-integration:A/:B  ⚠ gate del plan ROJO desde acá   (R7.1)
        ▼
5. ejecución paralela — cada track ejecuta SOLO sus taskIds            (R2.3)
        ▼
6. track B termina: SU gate verde en SU journal
        ▼
7. awm track join B   (dueño único, de a uno — R5.1)
     a. precondiciones: árbol limpio, HEAD esperado, gate bajo lock,
        cero jobs vivos, supervisor terminado y lock liberado          (R5.4, R5.5)
     b. verify-independence post-hoc desde merge-base                  (R4.2)
     c. persistir join-intent con SHAs esperados  ← ANTES del merge    (R5.3)
     d. git merge (aborta y limpia si conflicta)                       (R5.6)
     e. estado → merged
     f. AHORA pedir el job de integración (fingerprint post-merge)     (R6.3)
     g. job pass → item satisfecho → estado joined                     (R6.5)
        ▼
8. track A sigue rojo → su item unsatisfied → gate del plan rojo
   → COMPLETE inalcanzable, PERO el merge de B ya está en la rama      (R7.2)
        ▼
9. todos joined + gate de integración verde → COMPLETE                 (R7.3)
```

**El paso 4 arma la trampa antes de que empiece el trabajo.** Los items `track-integration` dejan el gate del plan en rojo desde el inicio. Un ciclo con tracks no puede cerrar por descuido aunque el controlador se pierda, se compacte o muera.

**Los pasos 7c–7f son la corrección más sutil de v2.** El orden importa y no es negociable: el intent se persiste **antes** del merge (para que un crash sea reconciliable comparando SHAs, R5.7), y el job de integración se pide **después** del merge (para que su fingerprint sea post-merge, R6.3). La v1 pedía el job como parte del join, lo que era imposible: `requestJob` computa el fingerprint al **solicitar** el job (`cli/src/commands/job/request.ts:10`), así que un job pedido antes del merge nace con evidencia que el propio merge invalida — no podría satisfacer su item nunca.

**Cada join invalida la evidencia previa del plan.** `head` entra incondicionalmente al fingerprint (`fingerprint.ts:75`), así que todo item ya satisfecho pasa a `stale-fingerprint`. Es correcto — es el gate de integración de RF-4.3 — pero se paga una vez por join: N tracks ⇒ N corridas.

---

## Manejo de errores

| Falla | Respuesta | Protege |
|---|---|---|
| id de track inválido, bloque y tareas discordantes, ciclo en el DAG | rechaza el plan nombrando la causa | R1.3, R1.6, R1.8 |
| `Shared resources:` ausente | serial — nunca se infiere independencia | R1.7 |
| `git worktree add` falla | serial + evento de degradación declarada | R3.2, DA-3 |
| Supervisor de track no alcanza readiness | no se despacha trabajo a ese track | R3.6 |
| Supervisor de track muere | recuperable desde journal + identidad; nunca se infiere fallo | R3.7 |
| Track intenta una tarea fuera de su asignación | rechazada | R2.3 |
| `planDigest` divergente | track BLOCKED | R2.4 |
| Descriptor local con token que no coincide | comando rechazado | R2.6 |
| Dos tracks declaran el mismo archivo (pre) | serial, nombrando los paths | R4.1 |
| Track tocó fuera de su ownership (post) | serializa los joins; **no** descarta el trabajo | R4.5 |
| Worktree del track sucio al hacer join | join rechazado nombrando los paths | R5.5 |
| Merge conflictivo | aborta y limpia; jamás `MERGE_HEAD` | R5.6 |
| Crash con join-intent abierto | reconcilia comparando SHAs reales vs. esperados | R5.7 |
| Job de integración pedido pre-merge | rechazado | R6.4 |
| `awm job` desde cwd equivocado | aserción contra el descriptor autenticado → rechaza | R8.1 |

### Dos riesgos que no son una fila de tabla

**El paralelismo puede fabricar su propia señal de stall.** `computeGate` llama a `fingerprintNow` una vez por item satisfecho (`gate.ts:76,93,115`), y cada llamada corre `ls-files` más un `hash-object` **por archivo** (`fingerprint.ts:65-73`), en cada tick de 5s (`supervisor.ts:31`). N supervisores multiplican eso por N en la misma máquina. En un repo grande puede saturar la caja y manifestarse como `suspected-stall` en los controladores — el paralelismo generando exactamente la señal que R1 usa para decidir custodia. Mitigación: tope de concurrencia acotado (R9.2) con default salido de medición real (R9.3), ticks escalonados, y considerar memoizar el fingerprint por HEAD.

**Certificar sobre un merge conflictivo sería un falso verde perfecto.** En pleno merge, `git branch --show-current` sigue devolviendo la rama del plan, así que `verifyBranchInvariant` (`lock.ts:73-77`) pasa limpio y `computeFingerprint` hashearía archivos con marcadores de conflicto adentro — un fingerprint fresco y válido sobre un árbol roto. De ahí R5.6 y R5.8.

---

## Limitaciones conocidas

**Los recursos compartidos son invisibles al aislamiento por worktree.** RF-4.2 dice "árbol compartido **o recurso compartido**", pero un worktree aísla *archivos* — no puertos fijos, no la base de datos de desarrollo, no `~/.cache`, no el store del package manager, y no `node_modules` (cada worktree necesita su propio install). **No existe detector mecánico para esta clase.** Por eso R1.7 exige que `Shared resources:` sea declaración explícita del plan y rechace el paralelismo si falta: si el CLI lo dedujera, "sin recursos compartidos" sería vacuamente verdadero y el test de RF-4.2 no probaría nada.

---

## Testing

- **CA-4.1 (equivalencia con serial)** — un plan fixture de dos tracks corre dos veces sobre el mismo commit base, serial y en paralelo. La aserción es sobre el **árbol resultante** (hash del tree), **no** sobre el log: el orden de commits difiere legítimamente y compararlo daría un rojo falso.
- **CA-4.2 (sin aislamiento → serial)** — el brief exige que el test *no dependa de que el repositorio esté limpio de cambios deliberados*. Se inyecta un `worktreeAdder` que falla (mismo patrón de seam que R1 usa con `spawner` en `runner.ts`) y se verifica que el plan completa **y** que quedó el evento de degradación (R3.2).
- **CA-4.3 (lockfile/manifest invalida el paralelismo)** — dos tracks con `Files:` disjuntos, uno toca `package-lock.json`: el paralelismo se invalida **a pesar de** una declaración previa limpia.

**Procesos, worktrees y supervisores reales.** R1 ya sentó el precedente con `cli/tests/commands/watch/e2e-crash.test.ts`. R9.4 exige además E2E de lanzamiento, recuperación y join en **ambos** providers — CA-T.5 del brief es explícito en que documentación sin ejecución no satisface el criterio.

**Tests que nacen de los bloqueadores encontrados en revisión, no de los requisitos:**

| Test | Qué debe fallar si el guard no está |
|---|---|
| Track ejecuta solo su asignación (R2.3) | sin él, cada worktree ejecuta el plan completo |
| Job de integración pre-merge rechazado (R6.4) | sin él, el item nunca puede satisfacerse y el ciclo no cierra jamás |
| Join con worktree sucio rechazado (R5.5) | sin él, se pierde trabajo en silencio con el gate verde |
| Append al cycle plan no pisa `satisfiedBy` (R6.2) | sin él, un re-registro tras crash borra enlaces ya establecidos |
| Crash entre intent y merge reconcilia por SHA (R5.7) | sin él, git y journal quedan en desacuerdo sin forma de decidir |
| Journal equivocado rechazado (R8.1) | sin él, la aserción existe pero no discrimina nada |
| Merge conflictivo no deja `MERGE_HEAD` (R5.6/R5.8) | sin él, hay fingerprint fresco sobre árbol roto |
| id de track `..` / `-x` / `a/b` rechazado (R1.3) | sin él, se viola la regla de path guards de `CONSTITUTION.md` |

**Una medición, no un test (R9.3):** el costo de fingerprint × N supervisores se mide sobre este repo real antes de fijar el tope de concurrencia por defecto.

Cada fix lleva su test de regresión, y cada test se valida **revirtiendo el fix para verlo en rojo**.

---

## Trazabilidad al brief

| Requisito del brief | Requisitos de este diseño |
|---|---|
| RF-4.1 | R1.1, R1.4, R1.5, R1.8, R1.10, R2.1, R3.1 |
| RF-4.2 | R1.7, R1.9, R3.2, R4.1, R4.3, R4.5, R4.6 |
| RF-4.3 | R4.2, R4.4, R4.7, R5.x, R6.x |
| RNF-T.2 | R3.2, R9.1 |
| CA-4.1 / CA-4.2 / CA-4.3 | §Testing |
| CA-T.5 | R9.4 |
| RF-2.9 (preservado) | R7.1, R7.2 |

---

## Historial de revisión

**v2 (2026-08-02)** — reescrito tras revisión externa que encontró 6 bloqueadores y 2 importantes. Los ocho se verificaron contra el código antes de aceptarse; los ocho eran reales:

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | Cada track habría ejecutado el plan completo: SDD extrae todas las tareas del plan activo | R2.1–R2.4, R2.7 — la asignación viene del journal del track, no se re-deriva del plan |
| 2 | `sharedResources` exigido sin sintaxis; "dependencias" del brief nunca se modeló | R1.5–R1.10 — bloque `## Tracks`, DAG, detección de ciclos |
| 3 | `track-integration` no existe en `VerificationKind`; el cycle plan no admite agregados; y el job de join invalidaba su propia evidencia | R6.1–R6.5 — el job se pide **después** del merge |
| 4 | El join no era durable ni serializado | R5.1–R5.3, R5.7 — dueño único, máquina de estados, intent con SHAs |
| 5 | Un gate verde podía perder cambios sin commitear | R5.4, R5.5 — precondición de árbol limpio |
| 6 | Nadie lanzaba ni custodiaba los supervisores de track | R3.5–R3.8 — proceso externo, readiness, recuperación, shutdown |
| 7 | R8.1 no era implementable: no hay backlink desde el track al plan | R2.5, R2.6 — descriptor local autenticado por fencing token |
| 8 | La regex de id permitía `.`, `..`, `-x`, violando la regla de path guards de `CONSTITUTION.md` | R1.3, R4.3, R4.4 — `git check-ref-format` + normalización canónica |

La arquitectura de tres planos de v1 (journal y supervisor por worktree, referencias livianas, fail-closed) se conserva; v2 agrega el plano de supervisión y corrige los mecanismos que la hacían inejecutable.
