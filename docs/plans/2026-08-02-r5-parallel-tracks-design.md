# R5 — Paralelismo entre tracks independientes (design)

**Origen:** Release 5 de [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md) (brief re-certificado `ready` 9/9 el 2026-08-02).
**Trazabilidad al brief:** RF-4.1, RF-4.2, RF-4.3 · RNF-T.2 · CA-4.1, CA-4.2, CA-4.3.
**Base:** R1 (controlador durable) ya shipeado y mergeado — CLI v3.5.0.
**Revisión:** v3 — ver §Historial de revisión. v1 y v2 fueron rechazadas en review (8 hallazgos cada una, todos reales).

---

## Cambio de método en v3

Las dos versiones anteriores fallaron por la **misma clase de error**: nueve de los dieciséis hallazgos fueron operaciones multi-paso tratadas como atómicas, o hechos ya establecidos que nadie revalidaba cuando el mundo se movía. v2 arregló el join y no le aplicó la misma lección al bootstrap; vio la invalidación de fingerprint y no siguió su consecuencia hasta el final.

Por eso v3 invierte el orden: **primero las matrices de reconciliación** (§Protocolos durables), y los requisitos se derivan de ellas. Un protocolo no entra al diseño hasta que su tabla "si el proceso muere acá, la recuperación hace esto" está completa.

---

## Contradicciones y decisiones registradas

El brief acota R5 a **"(Registry: `writing-plans` + skill SDD.)"** — solo contenido. Pero RF-4.3 exige verificación **mecánica**: un skill solo puede *instruir* al controlador a comparar, y eso es disciplina del agente, no mecanismo — el mismo modo de falla que motivó R1.

| # | Decisión del dueño | Fecha | Consecuencia |
|---|---|---|---|
| 1 | R5 = CLI + Registry | 2026-08-02 | corrige el alcance declarado del brief |
| 2 | Tracks se declaran con `**Track:**` por tarea | 2026-08-02 | retrocompatible por ausencia |
| 3 | Falla parcial: el track verde se reúne apenas pasa; el ciclo queda no-COMPLETE nombrando el que falta | 2026-08-02 | preserva RF-2.9 |
| 4 | **Sin DAG de dependencias** | 2026-08-02 | RF-4.1 solo paraleliza tracks *mutuamente independientes*: una dependencia entre tracks **es** una intersección → serial. `Depends on:` existe para declarar y **rechazar**, nunca para agendar. El scheduler de materialización diferida que v2 había inventado queda fuera de alcance. |

DA-3 resuelta el 2026-08-02: **fallback a serial con degradación declarada**.

---

## Protocolos durables

Tres protocolos, todos **propiedad del supervisor de la rama del plan**, que es el único escritor de su journal (`cli/src/core/journal/store.ts:59-70`, CAS por revisión). Los comandos `awm track` **emiten requests**; no mutan git ni el journal directamente. Esto es literalmente el modelo de R1, aplicado a las operaciones nuevas.

### P1 — `prepare-track` (bootstrap durable)

```
declared → prepare-intent → worktree-created → journal-created
         → supervisor-starting → ready
                                    ↘ blocked
```

Cada transición se persiste antes de intentar el paso siguiente. El paralelismo **no se activa hasta que el conjunto inicial completo llegó a `ready`**.

| Muere en... | Evidencia observable al recuperar | Acción de reconciliación |
|---|---|---|
| antes de `prepare-intent` | no hay intent | nada que limpiar; reintentar desde cero |
| `prepare-intent`, sin worktree | intent presente, path inexistente | reintentar creación (idempotente) |
| tras `worktree-created` | worktree existe **y** su path figura en el intent | conservar; seguir a journal |
| worktree existe pero **no** figura en ningún intent | ajeno | **no tocar** — solo se borra lo que se puede demostrar propio |
| tras `journal-created`, sin descriptor | journal presente, `.awm/track.json` ausente | escribir descriptor; seguir |
| `supervisor-starting` | intent con `supervisorIntent`; identidad puede o no existir | si el proceso vive con la identidad esperada → `ready`; si no vive → relanzar; si vive con **otra** identidad → `blocked` |
| tras `ready` | descriptor + journal + supervisor vivo + readiness persistida | nada que hacer |

**Regla dura:** el teardown solo elimina recursos cuya propiedad esté demostrada por el intent. Un worktree o una rama que no figuren en ningún intent no se tocan jamás.

### P2 — `join` (integración durable)

El comando emite `track-join-request`. El supervisor del plan la consume y ejecuta:

```
running → join-requested → join-intent → merged → revalidating → joined
                                                              ↘ blocked
```

| Muere en... | Evidencia observable | Acción de reconciliación |
|---|---|---|
| antes de `join-intent` | request presente, sin intent | revalidar precondiciones y reintentar |
| tras `join-intent`, antes del merge | intent con `expectedPlanHeadSha` + `expectedTrackHeadSha` | consultar la matriz de §P2-bis |
| tras el merge, antes de `merged` | HEAD demuestra el track integrado | registrar `merged` (idempotente) y seguir |
| tras `merged`, antes del job | `joinedCommitSha` persistido, sin job | pedir el job de revalidación (P3) |
| durante la revalidación | job existe | consumir su resultado normalmente |

### P2-bis — Matriz `MERGE_HEAD` × `HEAD` (hallazgo crítico de v2)

Un merge conflictivo **no mueve HEAD**. Por eso comparar SHAs no distingue "nunca empezó" de "está en conflicto", y por eso esta matriz **precede** al bloqueo general por `MERGE_HEAD`: la reconciliación es el manejador autorizado de ese estado, no su víctima.

| `MERGE_HEAD` | `HEAD` del plan | Conclusión | Acción |
|---|---|---|---|
| ausente | == `expectedPlanHeadSha` | el merge no se aplicó | reintentable |
| presente, y su SHA == `expectedTrackHeadSha` del intent | == `expectedPlanHeadSha` | merge iniciado y en conflicto | `merge --abort`, verificar índice limpio, reintentar o `blocked` |
| ausente | el track esperado es ancestro de HEAD | el merge sí se aplicó | registrar `merged` con `joinedCommitSha = HEAD` |
| presente, y su SHA **≠** `expectedTrackHeadSha` | cualquiera | merge ajeno o intent corrupto | `blocked` — **no** tocar git |
| cualquier otro | cualquiera | indemostrable | `blocked` — **no** adivinar |

### P3 — Revalidación acumulativa (hallazgo fatal de v2)

`computeGate` recomputa el fingerprint de **cada** item enlazado y lo compara (`cli/src/commands/job/gate.ts:93-95`). Como `head` entra incondicionalmente al fingerprint (`fingerprint.ts:75`), **cada merge invalida la evidencia de todos los tracks ya integrados**. Si cada join solo satisficiera su propio item, el gate nunca volvería a verde con 2+ tracks: el ciclo sería incerrable por construcción.

Protocolo correcto: **después de cada merge se pide UN job global de integración sobre el HEAD vigente, y ese mismo job re-satisface los items de todos los tracks ya integrados**, no solo el del track recién unido.

```
join de B  → merge → HEAD=H1 → job-integración(H1) → satisface {B}
join de A  → merge → HEAD=H2 → job-integración(H2) → satisface {A, B}   ← re-enlaza B
```

Como el job es uno solo y su fingerprint se computa post-merge, todos los items enlazados quedan vigentes **simultáneamente**. Un job puede satisfacer varios items: el gate valida `state.jobs[item.satisfiedBy]`, su verdict y su fingerprint — nada exige unicidad.

**QA e interlock globales corren solo sobre el HEAD final integrado.** Antes del último join no se intentan: cualquier evidencia que produjeran quedaría stale en el merge siguiente. Esto es una decisión de agenda que el diseño declara explícitamente, no un efecto secundario.

---

## Requirements

### R1 — Gramática de declaración

- **R1.1** — WHEN una tarea declara `**Track:** <id>`, THE parser SHALL asignar esa tarea al track `<id>`. *(RF-4.1)*
- **R1.2** — IF ninguna tarea declara `**Track:**`, THEN THE ejecución SHALL ser serial e idéntica a la actual. *(retrocompatibilidad)*
- **R1.3** — THE `<id>` SHALL pasar `git check-ref-format --branch` Y SHALL rechazarse si es vacío, `.`, `..`, contiene `/` o `\`, o empieza con `-`. *(regla de path guards de `CONSTITUTION.md`)*
- **R1.4** — THE ownership SHALL derivarse de la unión de los `**Files:**` de sus tareas, normalizados a POSIX relativo canónico.
- **R1.5** — THE plan SHALL declarar por track, en un bloque `## Tracks`, sus líneas `Depends on:` y `Shared resources:`.
- **R1.6** — IF un valor de `**Track:**` no tiene exactamente una entrada en `## Tracks` (o viceversa), THEN THE parser SHALL rechazar el plan.
- **R1.7** — IF un track no declara explícitamente `Shared resources:` (incluido `[]`), THEN THE ejecución SHALL correr serial. *("sin recursos compartidos" es afirmación del plan, nunca inferencia)*
- **R1.8** — IF cualquier track declara `Depends on:` distinto de `none`, THEN THE ejecución SHALL correr serial. *(RF-4.1 paraleliza solo tracks mutuamente independientes: una dependencia entre tracks es una intersección de dependencias)*

### R2 — Contexto y asignación del track

- **R2.1** — THE journal de un track SHALL contener un `trackContext` con `trackId`, `taskIds`, `planDigest`, `baseSha` y `planJournalId`.
- **R2.2** — THE `next_action` de un track SHALL acotarse a sus propios `taskIds`.
- **R2.3** — IF un track intenta ejecutar una tarea fuera de su asignación, THEN SHALL rechazarla.
- **R2.4** — IF el `planDigest` del `trackContext` difiere del digest del plan vigente, THEN THE track SHALL quedar `blocked`.
- **R2.5** — THE worktree de un track SHALL contener `.awm/track.json` (no versionado) con `planRoot` (realpath), `planBranch`, `trackId`, `planJournalId` y `fencingToken`.
- **R2.6** — THE descriptor SHALL autenticarse contra el `TrackRef` del journal del plan; IF el `fencingToken` no coincide, THEN THE comando SHALL rechazarse.
- **R2.7** — THE track SHALL NOT leer estado dinámico de otros tracks.

### R3 — Modo track del ciclo SDD

- **R3.1** — WHERE un worktree tiene descriptor de track válido, THE ciclo SDD SHALL operar en **modo track**.
- **R3.2** — WHILE opera en modo track, THE ciclo SHALL obtener su lista de tareas exclusivamente del `trackContext` de su journal — SHALL NOT derivarla del archivo de plan.
- **R3.3** — WHILE opera en modo track, THE ciclo SHALL NOT modificar el archivo de plan de ninguna forma (checkboxes, marcadores, reconciliación). *(hoy `post-implementation-qa` escribe `<!-- awm-qa-complete -->` en el plan y `subagent-driven-development` lo invoca como paso obligatorio de cierre; en un worktree de track eso violaría el ownership del track, invalidaría su propio `planDigest` — auto-bloqueándolo por R2.4 — y correría QA global sobre un plan incompleto)*
- **R3.4** — WHILE opera en modo track, THE ciclo SHALL NOT invocar `post-implementation-qa` global.
- **R3.5** — THE gate de un track SHALL componerse de verificaciones locales declaradas — SHALL NOT exigir evidencia de ámbito de plan.
- **R3.6** — THE QA y el interlock globales SHALL ejecutarlos el supervisor del plan **después** de integrar todos los tracks, sobre el HEAD final. *(§P3)*

### R4 — Protocolo `prepare-track`

- **R4.1** — THE creación de un track SHALL recorrer `declared → prepare-intent → worktree-created → journal-created → supervisor-starting → ready`, persistiendo cada transición antes de intentar la siguiente. *(§P1)*
- **R4.2** — THE reconciliación de cada fase SHALL ser idempotente. *(§P1)*
- **R4.3** — THE teardown SHALL eliminar únicamente recursos cuya propiedad esté demostrada por un intent; IF un worktree o rama no figura en ningún intent, THEN SHALL NOT tocarse.
- **R4.4** — THE paralelismo SHALL activarse solo cuando el conjunto inicial completo de tracks alcanzó `ready`.
- **R4.5** — IF la creación del worktree falla, THEN THE ejecución SHALL degradar a serial Y SHALL registrar la degradación. *(RF-4.2, DA-3, RNF-T.2)*
- **R4.6** — IF el path destino contiene un journal o lock ajeno, THEN SHALL rechazarse sin borrar nada.
- **R4.7** — THE rama del plan SHALL tener `.awm` gitignoreado como precondición dura; IF no, THEN serial declarándolo.
- **R4.8** — THE supervisor de track SHALL lanzarse como proceso externo desacoplado del turno del agente, con identidad durable capturada como tupla completa. *(`awm watch` es foreground sin modo detached; en Codex el hijo muere con el turno — hallazgo central de R0)*
- **R4.9** — THE readiness SHALL persistirse con un nonce; THE controlador SHALL NOT despachar trabajo antes de observarla.
- **R4.10** — IF el supervisor de un track muere, THEN SHALL ser recuperable desde su journal e identidad — su ausencia SHALL NOT interpretarse como fallo del track.

### R5 — Independencia y recursos compartidos

- **R5.1** — WHEN se evalúa el paralelismo, THE verificación SHALL comparar los ownership declarados; IF la intersección es no vacía, THEN serial nombrando los paths. *(RF-4.2)*
- **R5.2** — THE verificación post-hoc SHALL comparar el ownership declarado contra `git diff --name-only -z <merge-base(plan, track)> <track>` — SHALL NOT usar el worktree sucio. *(RF-4.3)*
- **R5.3** — THE detección de colisiones SHALL considerar equivalencia case-insensitive además de exacta.
- **R5.4** — WHERE un ownership declara directorio o glob, SHALL cubrir descendientes; WHERE hubo rename, SHALL contar path viejo y nuevo.
- **R5.5** — THE identificadores de recurso SHALL tener forma canónica declarada (`<clase>:<valor>`, p. ej. `port:5432`, `db:dev`, `path:~/.cache/x`).
- **R5.6** — IF la intersección de `Shared resources` entre dos tracks es no vacía, THEN THE ejecución SHALL serializar esos tracks. *(cierra el hueco de v2, donde el campo se declaraba y no participaba de ninguna decisión)*
- **R5.7** — THE conjunto de clasificadores globales (lockfiles, manifests, migraciones, snapshots, generados) SHALL tratarse como recurso compartido implícito; IF dos tracks tocan un archivo de esas clases, THEN el paralelismo SHALL invalidarse aunque los `Files:` declarados fueran disjuntos. *(es el mecanismo que le faltaba a CA-4.3: en v2 el test existía como intención sin nada que lo hiciera cierto)*
- **R5.8** — IF un track modificó archivos fuera de su ownership, THEN SHALL serializar los joins restantes — SHALL NOT descartar el trabajo.
- **R5.9** — WHILE se detecta una violación de ownership, THE ejecución de los tracks en curso SHALL continuar en sus worktrees; se serializa la **integración**, no la ejecución.
- **R5.10** — THE comando de verificación SHALL ser invocable por argv y SHALL salir ≠ 0 ante cualquier violación.

### R6 — Protocolo `join`

- **R6.1** — THE integración SHALL ser propiedad exclusiva del supervisor del plan, de a un join por vez; THE comando `awm track join` SHALL emitir una `track-join-request` — SHALL NOT mutar git ni el journal directamente. *(preserva el modelo single-writer de R1)*
- **R6.2** — THE estado de un track SHALL recorrer `running → join-requested → join-intent → merged → revalidating → joined`, con `blocked` alcanzable desde cualquiera. *(§P2)*
- **R6.3** — THE `join-intent` SHALL persistirse **antes** del merge con `expectedPlanHeadSha` y `expectedTrackHeadSha`.
- **R6.4** — THE join SHALL exigir, todas: worktree e índice limpios, `HEAD` del track igual al esperado, gate del track recalculado bajo su lock, cero jobs vivos, y supervisor del track terminado con lock liberado.
- **R6.5** — IF el worktree del track tiene cambios sin commitear, THEN THE join SHALL rechazarse nombrando los paths. *(el fingerprint de R1 incluye untracked y worktree; `git merge` solo integra commits — sin este guard el join descarta trabajo en silencio con el gate en verde)*
- **R6.6** — THE estrategia de merge SHALL declararse explícitamente Y THE `joinedCommitSha` resultante SHALL persistirse.
- **R6.7** — IF el merge produce conflicto, THEN SHALL abortarse dejando el worktree del plan sin `MERGE_HEAD`.
- **R6.8** — THE reconciliación de un `join-intent` abierto SHALL seguir la matriz `MERGE_HEAD` × `HEAD` de §P2-bis, que **precede** a cualquier bloqueo general por `MERGE_HEAD`. *(sin esta precedencia, el propio guard impediría la recuperación que debe limpiarlo)*
- **R6.9** — IF ningún renglón de esa matriz aplica, THEN THE estado SHALL ser `blocked` sin modificar git — SHALL NOT adivinarse.

### R7 — Evidencia de integración y revalidación acumulativa

- **R7.1** — THE `VerificationKind` SHALL incluir `track-integration`.
- **R7.2** — THE `cycleVerificationPlan` SHALL admitir agregado transaccional de items, idempotente por id, SHALL NOT pisar `satisfiedBy` ya enlazados. *(hoy solo se registra si está vacío — guard puesto en el QA de R1 para que un re-registro tras crash no pierda enlaces)*
- **R7.3** — WHEN se registran los tracks, THE journal del plan SHALL registrar un item `track-integration` por track, dejando el gate rojo desde ese momento.
- **R7.4** — THE job que satisface items de integración SHALL solicitarse **después** de que el merge quedó aplicado, para que su fingerprint se compute post-merge. *(`requestJob` computa el fingerprint al **solicitar** el job — `cli/src/commands/job/request.ts:10` — así que uno pedido pre-merge nace con evidencia que el propio merge invalida)*
- **R7.5** — IF un job de integración se solicita antes de que su merge esté aplicado, THEN SHALL rechazarse.
- **R7.6** — WHEN se completa un merge, THE job global de integración resultante SHALL satisfacer los items de **todos** los tracks ya integrados, no solo el del track recién unido. *(sin esto el gate nunca vuelve a verde con 2+ tracks y el ciclo es incerrable — §P3)*
- **R7.7** — THE QA y el interlock globales SHALL ejecutarse únicamente sobre el HEAD final integrado.

### R8 — Falla parcial y cierre

- **R8.1** — IF cualquier track no completó su join, THEN THE ciclo SHALL permanecer no-`COMPLETE` nombrando el track pendiente, aunque otros ya estén mergeados. *(preserva RF-2.9)*
- **R8.2** — WHEN todos los tracks completaron su join Y el gate de integración pasa Y QA/interlock finales pasan, THE ciclo SHALL poder alcanzar `COMPLETE`.

### R9 — Esquemas e integridad de evidencia

- **R9.1** — THE `JournalState` SHALL tener un `journalId` estable, generado al inicializar. *(hoy no existe; el descriptor de track lo referencia)*
- **R9.2** — THE `TrackRef` SHALL incluir `supervisorIntent`, `supervisorProcessRef`, `readinessNonce`, `readinessAt`, `joinIntent` y `joinedCommitSha`.
- **R9.3** — THE `tracks`, `trackContext` y `journalId` SHALL ser aditivos sobre `schema: 1`; un journal preexistente sin ellos SHALL leerse sin error.
- **R9.4** — IF un comando `awm job` o `awm watch` se invoca desde un cwd cuyo realpath no corresponde ni a la raíz del plan ni al track del descriptor autenticado, THEN SHALL rechazarse.
- **R9.5** — THE journal del plan SHALL NOT espejar estado de journals de track; la consulta SHALL ser read-only al momento de necesitarla.
- **R9.6** — THE estado agregado SHALL ser consultable read-only, componiendo el gate del plan con el de cada track.
- **R9.7** — THE generación y validación de cada token/nonce SHALL declarar qué entidad la realiza.

### R10 — Multi-provider, concurrencia y costo

- **R10.1** — THE comportamiento SHALL declararse por provider (soportado / degradado explícito) verificado contra la matriz de R0. *(RNF-T.2)*
- **R10.2** — THE cantidad de tracks en paralelo SHALL estar acotada por un tope configurable; los excedentes SHALL esperar turno.
- **R10.3** — THE default del tope SHALL derivarse de medición real del costo de fingerprint × N supervisores — SHALL NOT ser inventado.
- **R10.4** — THE bootstrap, la recuperación y el join SHALL verificarse con E2E reales en Claude Code y en Codex. *(CA-T.5: documentación sin ejecución no satisface el criterio)*

---

## Arquitectura

```
PLANO DEL PLAN  (worktree principal, rama del plan)
  awm watch  ──► journal del plan  (ÚNICO ESCRITOR, CAS por revisión)
                   ├─ journalId
                   ├─ tracks: TrackRef[]
                   └─ cycleVerificationPlan
                        ├─ track-integration:A
                        ├─ track-integration:B
                        └─ qa / interlock  ← solo sobre el HEAD final (R7.7)
        ▲                              │
        │ requests                     │ P1 prepare-track · P2 join · P3 revalidación
        │ (nadie muta directo)         ▼
PLANO DEL TRACK  (N worktrees, N ramas)
  wt-A/  .awm/track.json  ← descriptor autenticado por fencingToken
         awm watch ──► journal propio + trackContext{trackId,taskIds,planDigest,baseSha}
         ciclo SDD en MODO TRACK: no toca el plan, no corre QA global
  wt-B/  ídem

PLANO DE SUPERVISIÓN  (procesos externos, desacoplados del turno)
  supervisor-A  ← identidad durable + readinessNonce

PLANO DE COMANDOS
  awm track add | list | status | verify-independence | join | remove
  (todos EMITEN; el supervisor del plan EJECUTA)
```

**Invariantes:**

1. **Un solo escritor por journal.** Los comandos emiten requests; el supervisor las consume. Es el modelo de R1 sin excepciones — v2 lo violaba al exponer `awm track join` como mutador directo.
2. **Ningún dato cruza journals, solo control.** El journal del plan nunca espeja el de un track; corre `computeGate` sobre él en lectura (`gate.ts:21`, función pura de `state` + `fingerprintNow`).
3. **Un track conoce su asignación, no el progreso ajeno.** `trackContext` viene inicializado en su propio journal; el skill SDD en modo track no re-deriva tareas del plan.
4. **Nada se borra sin propiedad demostrada.** Ni worktrees, ni ramas, ni journals.

### Por qué esta forma

Descartadas por evidencia leída en el código: un **journal único con tracks de primera clase** exigiría jobs con `cwd` fuera de `repoRoot` —que `resolveWorkingDirectory` rechaza explícitamente (`fingerprint.ts:27-43`)— o un escritor sobre N dominios CAS sin atomicidad entre sí, y obligaría a borrar `verifyBranchInvariant` (`lock.ts:68-77`). Un **controlador único sin supervisor por track** tiene la misma rotura y deja la fase paralela sin dueño durable — la forma exacta del incidente de los 4 subagentes de QA concurrentes.

N supervisores es lo que R1 ya soporta por construcción: `journalDir(repoRoot, branch)` (`paths.ts:19`) da journals disjuntos y `supervisorLockPath(repoRoot)` (`paths.ts:25`), clavado por realpath, locks disjuntos. Verificado empíricamente: los worktrees aíslan, `.awm/` gitignoreado no se propaga a un worktree fresco, y el realpath difiere por árbol.

---

## Componentes

### Gramática del plan

```markdown
## Tracks

| Track | Depends on | Shared resources |
|-------|------------|------------------|
| cli   | none       | []               |
| docs  | none       | []               |
```

Membresía por tarea (`**Track:**`), propiedades por track (bloque `## Tracks`) — una sola fuente de verdad para cada cosa, validadas por coincidencia exacta (R1.6). Cualquier `Depends on:` distinto de `none` fuerza serial (R1.8).

### Tipos

```ts
interface JournalState {
    journalId: string;              // R9.1 — nuevo, aditivo
    tracks?: TrackRef[];
    trackContext?: TrackContext;    // presente solo en journals de track
    // ... resto sin cambios
}

interface TrackContext {            // R2.1
    trackId: string; taskIds: string[];
    planDigest: string; baseSha: string; planJournalId: string;
}

interface TrackRef {                // R9.2
    trackId: string; worktreePath: string; branch: string;
    ownership: string[]; sharedResources: string[]; dependsOn: string[];
    fencingToken: string;
    state: 'declared' | 'prepare-intent' | 'worktree-created' | 'journal-created'
         | 'supervisor-starting' | 'ready' | 'running' | 'join-requested'
         | 'join-intent' | 'merged' | 'revalidating' | 'joined' | 'blocked';
    supervisorIntent?: { nonce: string; argv: string[] };
    supervisorProcessRef?: ProcessRef;
    readinessNonce?: string; readinessAt?: string;
    joinIntent?: { expectedPlanHeadSha: string; expectedTrackHeadSha: string };
    joinedCommitSha?: string;
}
```

### Comandos y módulos

| Comando | Emite | El supervisor ejecuta |
|---|---|---|
| `add` | `track-prepare-request` | P1 completo hasta `ready` |
| `join` | `track-join-request` | P2 + P3 |
| `verify-independence` | — (read-only, exit ≠ 0) | — |
| `status` / `list` | — (read-only) | — |
| `remove` | `track-teardown-request` | teardown gateado (R4.3) |

| Path | Cambio |
|---|---|
| `cli/src/core/journal/types.ts` | `journalId`, `TrackContext`, `TrackRef`, `track-integration` en `VerificationKind`, guards |
| `cli/src/commands/watch/apply.ts` | nuevos kinds de request (prepare/join/teardown/track-status) + **append transaccional** al cycle plan (R7.2) |
| `cli/src/commands/watch/supervisor.ts` | ejecución de P1/P2/P3 + matriz P2-bis con precedencia sobre el bloqueo por `MERGE_HEAD` |
| `cli/src/commands/job/request.ts` | guard de job de integración pre-merge (R7.5) |
| `cli/src/commands/job/index.ts`, `watch/index.ts` | aserción de realpath contra descriptor autenticado (R9.4) |
| `cli/src/commands/watch/init.ts` | `journalId` al inicializar; precondición `.awm` gitignoreado |

### Registry

- **`writing-plans`** — emite `## Tracks` y `**Track:**`; ausentes ⇒ comportamiento actual.
- **`subagent-driven-development`** — **modo track** (R3.1–R3.5): tareas del journal, sin tocar el plan, sin QA global.
- **`post-implementation-qa`** — no se invoca en modo track; el supervisor del plan la corre sobre el HEAD final (R3.6, R7.7).

---

## Manejo de errores

| Falla | Respuesta | Requisito |
|---|---|---|
| id inválido / bloque discordante / `Depends on` ≠ none | rechaza el plan o corre serial, nombrando la causa | R1.3, R1.6, R1.8 |
| `Shared resources:` ausente | serial — nunca se infiere independencia | R1.7 |
| Recursos declarados intersectan | serializa esos tracks | R5.6 |
| Track toca lockfile/manifest/migración/snapshot/generado | invalida el paralelismo aunque los `Files:` fueran disjuntos | R5.7 |
| `git worktree add` falla | serial + degradación declarada | R4.5 |
| Crash en cualquier fase de `prepare-track` | reconcilia por fase, idempotente; no borra lo ajeno | R4.1–R4.3 |
| Supervisor no alcanza readiness | no se despacha trabajo a ese track | R4.9 |
| Supervisor muere | recuperable por identidad; nunca se infiere fallo | R4.10 |
| Track fuera de su asignación / `planDigest` divergente | rechaza / `blocked` | R2.3, R2.4 |
| Modo track intenta escribir el plan o correr QA global | rechazado | R3.3, R3.4 |
| Worktree sucio al hacer join | rechaza nombrando paths | R6.5 |
| Merge conflictivo | aborta y limpia | R6.7 |
| Crash con `join-intent` abierto | matriz P2-bis; sin renglón aplicable → `blocked` sin tocar git | R6.8, R6.9 |
| Job de integración pre-merge | rechazado | R7.5 |
| `awm job` desde cwd equivocado | rechazado | R9.4 |

### El riesgo que no es una fila

**El paralelismo puede fabricar su propia señal de stall.** `computeGate` llama `fingerprintNow` por item satisfecho (`gate.ts:76,93,115`) y cada llamada corre `ls-files` más un `hash-object` **por archivo** (`fingerprint.ts:65-73`), cada tick de 5s (`supervisor.ts:31`). N supervisores lo multiplican por N en la misma máquina; en un repo grande puede saturarla y manifestarse como `suspected-stall` — el paralelismo generando la señal que R1 usa para decidir custodia. Mitigación: tope acotado (R10.2) con default medido (R10.3), ticks escalonados, memoización por HEAD.

---

## Limitaciones conocidas

**Los recursos compartidos declarados se agendan; el uso real no se detecta.** R5.6 y R5.7 hacen que los recursos **declarados** y las clases de archivo **clasificables** participen del scheduler. Pero un track que abra un puerto o toque una base sin declararlo es indetectable: los worktrees aíslan archivos, no procesos ni servicios. La degradación es fail-closed en lo declarable (falta la declaración ⇒ serial, R1.7) y **queda expuesta** en lo no observable — se documenta como límite, no se disfraza de cobertura.

---

## Testing

- **CA-4.1** — plan fixture de dos tracks, dos corridas sobre el mismo base: serial y paralela. Aserción sobre el **árbol resultante** (hash del tree), no sobre el log — el orden de commits difiere legítimamente.
- **CA-4.2** — se inyecta un `worktreeAdder` que falla (patrón de seam que R1 ya usa con `spawner` en `runner.ts`); el plan completa **y** queda el evento de degradación. El test no depende de que el repo esté limpio de cambios deliberados.
- **CA-4.3** — dos tracks con `Files:` disjuntos, uno toca `package-lock.json`: el paralelismo se invalida por el clasificador de R5.7 — que es el mecanismo que en v2 faltaba.

**Crash/restart real por protocolo** (lo que v2 no tenía): matar el proceso en cada fase de P1 y de P2 y verificar que la reconciliación converge al estado correcto, incluidos los cinco renglones de la matriz P2-bis.

| Test | Qué falla si el guard no está |
|---|---|
| Revalidación acumulativa con 2 tracks (R7.6) | el gate nunca vuelve a verde; el ciclo es incerrable |
| Modo track no escribe el plan (R3.3) | el track se auto-bloquea por su propio `planDigest` |
| Modo track no corre QA global (R3.4) | QA corre sobre un plan incompleto mientras otros tracks siguen |
| `MERGE_HEAD` presente con HEAD esperado (P2-bis) | se concluye "merge no aplicado" estando en conflicto |
| Reconciliación precede al bloqueo por `MERGE_HEAD` (R6.8) | el guard bloquea su propia recuperación |
| Join con worktree sucio (R6.5) | se pierde trabajo en silencio con gate verde |
| Append al cycle plan no pisa `satisfiedBy` (R7.2) | un re-registro tras crash borra enlaces |
| Teardown no borra recursos ajenos (R4.3) | se destruye un worktree con procesos vivos |
| id `..` / `-x` / `a/b` (R1.3) | se viola la regla de path guards de `CONSTITUTION.md` |
| Journal equivocado (R9.4) | la aserción existe pero no discrimina |

**Una medición, no un test (R10.3):** costo de fingerprint × N supervisores sobre este repo antes de fijar el tope por defecto.

Cada fix lleva su test de regresión, validado **revirtiendo el fix para verlo en rojo**.

---

## Trazabilidad al brief

| Brief | Diseño |
|---|---|
| RF-4.1 | R1.1, R1.4, R1.5, R1.8, R4.1–R4.4 |
| RF-4.2 | R1.7, R4.5, R5.1, R5.3, R5.6–R5.9 |
| RF-4.3 | R5.2, R5.4, R5.10, R6.x, R7.x |
| RNF-T.2 | R4.5, R10.1 |
| CA-4.1 / 4.2 / 4.3 | §Testing |
| CA-T.5 | R10.4 |
| RF-2.9 (preservado) | R7.3, R8.1 |

---

## Historial de revisión

**v3 (2026-08-02)** — método invertido: matrices de reconciliación primero, requisitos derivados. Cierra los 8 hallazgos de la review de v2:

| # | Hallazgo v2 | Corrección |
|---|---|---|
| 1 | Tracks dependientes arrancaban de una base anterior a sus dependencias | **Disuelto por alcance**: RF-4.1 solo paraleliza tracks mutuamente independientes; el DAG era alcance inventado en v2. `Depends on` ≠ none ⇒ serial (R1.8) |
| 2 | El ciclo SDD/QA contradecía el modo track (escribía el plan, se auto-bloqueaba, corría QA global) | Modo track explícito, R3.1–R3.6 |
| 3 | Bootstrap no transaccional ni recuperable | Protocolo P1 con matriz de reconciliación, R4.1–R4.4 |
| 4 | `awm track join` mutaba directo, contra el modelo single-writer | Todo es request consumida por el supervisor del plan, R6.1 |
| 5 | Un crash en conflicto era ambiguo; el guard bloqueaba su propia recuperación | Matriz P2-bis con precedencia explícita, R6.8–R6.9 |
| 6 | Cada join invalidaba los items anteriores → gate incerrable (**fatal**) | Revalidación acumulativa: un job global re-satisface todos los integrados, R7.6; QA/interlock sobre el HEAD final, R7.7 |
| 7 | `Shared resources` tenía sintaxis pero no algoritmo | Forma canónica, intersección vacía como condición, clasificadores globales, R5.5–R5.7 |
| 8 | Faltaban esquemas implementables | `journalId`, `TrackContext`, `TrackRef` completo, R9.1–R9.2, R9.7 |

**v2 (2026-08-02)** — cerró 8 hallazgos de v1 (asignación de tareas por track, gramática de declaración, evidencia de integración, join durable, árbol limpio, ciclo de vida del supervisor, descriptor autenticado, normalización de IDs). Rechazada en review.

**v1 (2026-08-02)** — arquitectura de tres planos. Rechazada en review.

La dirección arquitectónica (journal y supervisor por worktree, referencias livianas, fail-closed) se conserva desde v1; lo que cambió en cada iteración fueron los mecanismos que la hacían ejecutable.
