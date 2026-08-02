# R5 — Paralelismo entre tracks independientes (design)

**Origen:** Release 5 de [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md) (brief re-certificado `ready` 9/9 el 2026-08-02).
**Trazabilidad al brief:** RF-4.1, RF-4.2, RF-4.3 · RNF-T.2 · CA-4.1, CA-4.2, CA-4.3.
**Base:** R1 (controlador durable) ya shipeado y mergeado — CLI v3.5.0.

---

## Contradicción del brief resuelta en este diseño

El brief acota el alcance de R5 a **"(Registry: `writing-plans` + skill SDD.)"** — solo contenido. Pero RF-4.3 exige que la independencia se verifique **mecánicamente**, comparando la declaración previa contra lo realmente modificado. Un skill solo puede *instruir* al controlador a correr el `git diff` y comparar: eso es disciplina del agente, no mecanismo — exactamente el modo de falla que motivó R1 (*"El gate existe como instrucción de prosa pero nada lo fuerza mecánicamente"*).

**Resolución del dueño (2026-08-02): R5 va a CLI + Registry.** La verificación de independencia y el gate de integración son comandos, no prosa. Queda registrado acá por el Non-Assumption Mandate del brief: la contradicción se reporta y la resuelve el dueño, jamás se asume.

Decisiones del dueño tomadas en esta sesión de diseño:

| # | Decisión | Consecuencia |
|---|---|---|
| 1 | R5 = CLI + Registry | corrige el alcance declarado del brief |
| 2 | Tracks se declaran con campo `**Track:**` por tarea | retrocompatible por ausencia; parser local y trivial |
| 3 | Falla parcial: el track verde se reúne apenas pasa; el ciclo queda no-COMPLETE nombrando el que falta | preserva RF-2.9 sin dejar el trabajo bueno de rehén |

DA-3 (única decisión abierta que bloqueaba R5) fue resuelta el 2026-08-02 a favor de **fallback a serial con degradación declarada**.

---

## Requirements

### R1 — Declaración de tracks (formato de plan)

- **R1.1** — WHEN una tarea del plan declara `**Track:** <id>`, THE parser SHALL asignar esa tarea al track `<id>`. *(brief RF-4.1)*
- **R1.2** — IF ninguna tarea del plan declara `**Track:**`, THEN THE ejecución SHALL ser serial e idéntica a la actual, sin diferencia observable atribuible a R5. *(brief: Constraint de retrocompatibilidad)*
- **R1.3** — IF una tarea declara un `**Track:**` malformado (vacío, con separadores de path, o que no matchea `[A-Za-z0-9._-]+`), THEN THE parser SHALL rechazar el plan con error explícito — SHALL NOT coercionar ni ignorar el valor.
- **R1.4** — THE ownership de un track SHALL derivarse de la unión de los `**Files:**` de sus tareas.
- **R1.5** — IF un plan declara dos o más tracks sin declarar explícitamente su conjunto `sharedResources` (incluido el conjunto vacío explícito), THEN THE ejecución SHALL rechazar el paralelismo y correr serial. *("sin recursos compartidos" debe ser afirmación del plan, jamás inferencia del CLI — ver Limitaciones conocidas.)*

### R2 — Aislamiento y ciclo de vida del worktree

- **R2.1** — WHEN se activa el paralelismo, THE controlador SHALL crear un worktree y una rama por track, y SHALL registrar un `TrackRef` que incluya el **realpath** del worktree. *(brief RF-4.1)*
- **R2.2** — IF la creación del worktree falla por cualquier causa, THEN THE ejecución SHALL degradar a serial Y SHALL registrar un evento de degradación declarada — SHALL NOT fallar el plan ni degradar en silencio. *(brief RF-4.2 + DA-3 + RNF-T.2)*
- **R2.3** — IF el path destino de un worktree ya contiene un journal o un lock de supervisor ajeno, THEN THE comando SHALL rechazar con error explícito Y SHALL NOT borrar ni modificar ese journal.
- **R2.4** — THE teardown de un worktree de track SHALL requerir que el supervisor de ese track haya salido y liberado su lock.
- **R2.5** — IF un track tiene jobs en estado vivo, THEN THE teardown SHALL ser rechazado.
- **R2.6** — THE rama del plan SHALL tener `.awm` gitignoreado como precondición dura de la activación del paralelismo; IF no lo tiene, THEN THE ejecución SHALL correr serial declarándolo. *(evita que `ensureJournalGitignored` produzca una modificación de archivo trackeado que R3.2 leería como violación de ownership.)*

### R3 — Verificación de independencia

- **R3.1** — WHEN se evalúa activar el paralelismo, THE verificación SHALL comparar los ownership declarados entre tracks; IF la intersección es no vacía, THEN THE ejecución SHALL correr serial nombrando los paths en conflicto. *(brief RF-4.2)*
- **R3.2** — THE verificación post-hoc SHALL comparar el ownership declarado de un track contra los archivos realmente modificados, calculados como `git diff --name-only <merge-base(plan, track)> <track>` — SHALL NOT compararlos contra el worktree sucio. *(brief RF-4.3)*
- **R3.3** — IF un track modificó archivos fuera de su ownership declarado, THEN THE ejecución SHALL serializar los joins restantes (mergear de a uno, re-verificando entre cada uno) — SHALL NOT descartar el trabajo ya realizado por ese track. *(brief RF-4.2)*
- **R3.3b** — WHILE se detecta una violación de ownership, THE ejecución de los tracks aún en curso SHALL continuar en sus worktrees aislados; lo que se serializa es la **integración**, no la ejecución. *(un worktree aislado no es un árbol compartido: lo que RF-4.2 prohíbe es integrar en paralelo sobre la rama del plan, no trabajar en paralelo sobre árboles disjuntos.)*
- **R3.4** — THE comando de verificación SHALL ser invocable por argv y SHALL salir con código ≠ 0 ante cualquier violación, de modo que pueda registrarse como job durable atado a fingerprint.

### R4 — Join y gate de integración

- **R4.1** — WHEN un track alcanza gate verde en su propio journal, THE join SHALL validar ese gate en modo lectura Y SHALL ejecutar la verificación post-hoc de R3.2, ambas **antes** de mergear; IF cualquiera de las dos falla, THEN THE join SHALL abortar sin tocar la rama del plan.
- **R4.2** — IF el merge de la rama del track a la del plan produce conflicto, THEN THE join SHALL abortar el merge, SHALL dejar el worktree del plan sin `MERGE_HEAD`, y SHALL reportar el conflicto — SHALL NOT dejar el árbol a medias.
- **R4.3** — WHEN un join se completa, THE item `track-integration:<id>` SHALL quedar satisfecho Y THE gate de integración SHALL re-ejecutarse sobre el fingerprint nuevo. *(brief RF-4.3)*
- **R4.4** — WHILE exista `MERGE_HEAD` o `REBASE_HEAD` en el worktree del plan, THE supervisor SHALL tratarlo como condición bloqueante, junto al invariante de rama.

### R5 — Falla parcial y cierre

- **R5.1** — WHEN se registran los tracks, THE journal del plan SHALL registrar un item `track-integration` por track, dejando el gate en rojo desde ese momento y no al final.
- **R5.2** — IF cualquier track no completó su join exitosamente, THEN THE ciclo SHALL permanecer no-`COMPLETE` nombrando el track pendiente, aunque otros tracks ya estén mergeados en la rama del plan. *(preserva brief RF-2.9)*
- **R5.3** — WHEN todos los tracks completaron su join Y el gate de integración pasa, THE ciclo SHALL poder alcanzar `COMPLETE`.

### R6 — Integridad de la evidencia

- **R6.1** — IF un comando `awm job` o `awm watch` se invoca desde un cwd cuyo realpath no corresponde ni a la raíz del plan ni a un `TrackRef` registrado, THEN SHALL rechazar la invocación.
- **R6.2** — THE journal del plan SHALL NOT copiar ni espejar estado de los journals de track; la consulta SHALL ser read-only en el momento de necesitarla.
- **R6.3** — THE campo `tracks` SHALL ser aditivo sobre `schema: 1`, y un journal preexistente sin ese campo SHALL leerse sin error.
- **R6.4** — THE estado agregado de un ciclo con tracks SHALL ser consultable en modo read-only, componiendo el gate del plan con el de cada track, sin mutar ningún journal. *(es la respuesta mecánica a "¿dónde estoy?" cuando el controlador se perdió o se compactó.)*

### R7 — Multi-provider y costo

- **R7.1** — THE comportamiento de R5 SHALL declararse por provider (soportado / degradado explícito), verificado contra la matriz de capacidades de R0. *(brief RNF-T.2)*
- **R7.2** — THE cantidad de tracks ejecutándose en paralelo SHALL estar acotada por un tope configurable; IF el plan declara más tracks que el tope, THEN los excedentes SHALL esperar turno en vez de arrancar.
- **R7.3** — THE valor por defecto de ese tope SHALL derivarse de una medición real del costo de fingerprint × N supervisores sobre este repo — SHALL NOT ser un valor inventado.

---

## Arquitectura

Tres planos con una frontera dura entre ellos.

```
PLANO DEL PLAN  (worktree principal, rama del plan)
  awm watch  ──► journal del plan
                   ├─ tracks: TrackRef[]        ← referencias livianas
                   └─ cycleVerificationPlan
                        ├─ track-integration:A
                        └─ track-integration:B
        │
        │  (solo CONTROL cruza: lecturas read-only + merges de git)
        ▼
PLANO DEL TRACK  (N worktrees, N ramas)
  wt-A/  awm watch ──► journal propio + lock propio   ← R1 sin cambios
  wt-B/  awm watch ──► journal propio + lock propio

PLANO DE COMANDOS
  awm track add | list | status | verify-independence | join | remove
```

**Invariante central: ningún dato cruza journals — solo cruza control.** El journal del plan nunca copia ni espeja el estado de un journal de track. Cuando necesita saber si un track está verde, corre `computeGate` sobre el journal del track en modo lectura (ya es función pura de `state` + `fingerprintNow`, `cli/src/commands/job/gate.ts:21`). Esto evita el problema fatal de un escritor único sobre N dominios CAS sin atomicidad entre sí.

**Un track no sabe que es un track.** Dentro de su worktree corre un ciclo SDD ordinario con el `awm watch` de R1 tal cual, sin una línea nueva. Toda la conciencia del paralelismo vive en el plano del plan y en `awm track`.

### Por qué esta forma y no otra

Dos formas alternativas quedaron descartadas **por evidencia leída en el código**, no por preferencia:

- **Journal único con tracks de primera clase** — exigiría o bien jobs con `cwd` fuera de `repoRoot`, o bien un escritor único sobre N dominios CAS independientes. `resolveWorkingDirectory` (`cli/src/core/journal/fingerprint.ts:27-43`) rechaza explícitamente todo `cwd` absoluto, con `..`, con symlink, o cuyo realpath caiga fuera de `repoRoot`. Además obligaría a borrar `verifyBranchInvariant` (`cli/src/commands/watch/lock.ts:68-77`) para el trabajo de track — justo el guard que impide que un journal de la rama P maneje un árbol cuyo HEAD es T.
- **Un controlador, N worktrees, sin supervisor por track** — requiere la misma rotura de `cwd`, y deja la fase paralela **sin dueño durable**: si el controlador muere quedan N agentes en vuelo sin custodia. Es la forma exacta del incidente real de los 4 subagentes de QA concurrentes (7 archivos revertidos en silencio, ya curado en `AGENTS.md`).

En cambio, N supervisores por track es lo que **R1 ya soporta por construcción**: `journalDir(repoRoot, branch)` (`cli/src/core/journal/paths.ts:19`) da journals disjuntos y `supervisorLockPath(repoRoot)` (`paths.ts:25`), clavado por realpath, da locks disjuntos. Verificado empíricamente en este entorno: worktrees aíslan de verdad, `.awm/` gitignoreado **no** se propaga a un worktree fresco (arranca sin journal), y `git-dir ≠ git-common-dir` con realpath distinto por árbol.

---

## Componentes

### `TrackRef` — tipo nuevo (`cli/src/core/journal/types.ts`)

Referencia liviana, nunca espejo:

```ts
interface TrackRef {
    trackId: string;
    worktreePath: string;      // realpath — ancla de ownership (R6.1)
    branch: string;
    ownership: string[];       // Files: declarados, unión de sus tareas
    sharedResources: string[]; // declaración explícita del plan (R1.5)
    status: 'declared' | 'running' | 'joined' | 'blocked';
}
```

Entra como `tracks?: TrackRef[]` en `JournalState`, más su guard en `isWellFormedState`. **Schema sigue en 1**: `normalizeSchemaOne` (`cli/src/core/journal/store.ts:11-34`) ya sienta el precedente de campos aditivos con `??= []`.

### Comandos (`cli/src/commands/track/`)

| Comando | Qué hace | Cómo falla (siempre cerrado) |
|---|---|---|
| `add` | crea worktree + rama, corre `awm watch --init` adentro, registra el `TrackRef` | rechaza un path reusado con journal o lock ajeno; nunca lo "arregla" borrando (R2.3) |
| `verify-independence` | ownership declarado vs. realmente modificado | exit ≠ 0 ante intersección entre tracks o modificación fuera de ownership (R3.1, R3.2, R3.4) |
| `join` | valida verde read-only, mergea a la rama del plan, re-arma el item de integración | aborta y limpia ante conflicto; jamás deja `MERGE_HEAD` (R4.2) |
| `status` | read-only: agrega el `computeGate` de los N journals + el del plan | — |
| `list` | lista los `TrackRef` registrados | — |
| `remove` | teardown del worktree | gateado a lock liberado y cero jobs vivos (R2.4, R2.5) |

### Cambios sobre módulos existentes

| Path | Cambio |
|---|---|
| `cli/src/core/journal/types.ts` | aditivo: `TrackRef` + `tracks?` + guard |
| `cli/src/commands/watch/apply.ts` | aditivo: `register-entity` kinds `track` y `track-status`, sobre el camino transaccional existente |
| `cli/src/commands/job/gate.ts` | idealmente cero cambios: la falla de track sale como `unsatisfied-plan` sobre el `cycleVerificationPlan` ya existente |
| `cli/src/commands/watch/init.ts` | precondición dura de `.awm` gitignoreado (R2.6) |
| `cli/src/commands/job/index.ts`, `cli/src/commands/watch/index.ts` | aserción de realpath contra los `TrackRef` conocidos (R6.1) |
| `cli/src/commands/watch/supervisor.ts` | `MERGE_HEAD`/`REBASE_HEAD` como condición bloqueante (R4.4) |

### Cambios de registry (`awm-baseline-registry`)

- **`writing-plans`** — emite el campo `**Track:**` por tarea; ausente ⇒ track único ⇒ comportamiento actual.
- **`subagent-driven-development`** — sección de despacho por tracks; regla número uno: el primer acto de cada subagente de track es entrar a la raíz de su worktree.

---

## Flujo de datos

```
1. writing-plans emite tareas con **Track:**
        │
2. el controlador agrupa por track ──► ¿2+ tracks? ¿worktree disponible?
        │                                      └─ NO ──► SERIAL + evento
        ▼ SÍ                                              "degradado" (R2.2)
3. verify-independence declarativo: ¿los Files: se intersectan?
        │   intersección vacía = NECESARIA, NO SUFICIENTE
        ▼
4. awm track add A, B ──► worktrees + ramas + watch --init + TrackRef
        └──► items track-integration:A y :B  ⚠ gate del plan ROJO desde acá (R5.1)
        ▼
5. ejecución paralela — cada track corre un ciclo SDD normal, sin saber del otro
        ▼
6. track B termina: SU gate se pone verde en SU journal
        ▼
7. awm track join B
     a. computeGate read-only sobre el journal de B      → ¿verde?     (R4.1)
     b. verify-independence post-hoc desde merge-base    → ¿ownership? (R3.2)
     c. merge a la rama del plan (aborta limpio si conflicta)          (R4.2)
     d. ⚠ el merge cambia HEAD → invalida TODA la evidencia previa del plan
     e. gate de integración sobre el fingerprint nuevo                 (R4.3)
        ▼
8. track A sigue rojo → su item queda unsatisfied → gate del plan rojo
   → COMPLETE inalcanzable, PERO el merge de B ya está en la rama       (R5.2)
        ▼
9. todos los items verdes + cero jobs vivos → COMPLETE                  (R5.3)
```

**El paso 4 arma la trampa antes de que empiece el trabajo.** Registrar los items `track-integration` deja el gate del plan en rojo desde el inicio. Un ciclo con tracks no puede cerrar por descuido aunque el controlador se pierda, se compacte o muera: el bloqueo está escrito en el journal, no depende de que alguien se acuerde.

**El paso 7d tiene un costo estructural conocido.** `head` entra incondicionalmente al fingerprint (`cli/src/core/journal/fingerprint.ts:75`), así que cada merge invalida toda la evidencia previa de la rama del plan (`stale-fingerprint`). Es correcto — es literalmente el gate de integración que pide RF-4.3 — pero se paga **una vez por join**: N tracks ⇒ N corridas del gate de integración. Mitigable agrupando joins cercanos en el tiempo, sin cambiar la semántica de R5.2.

---

## Manejo de errores

| Falla | Respuesta | Protege |
|---|---|---|
| `git worktree add` falla | serial + evento de degradación declarada; **no** es error terminal | R2.2, DA-3, RNF-T.2 |
| Dos tracks declaran el mismo archivo (pre) | serial, nombrando los paths en conflicto | R3.1 |
| Track tocó fuera de su ownership (post) | serializa los joins restantes; **no** descarta el trabajo hecho | R3.3 |
| Merge conflictivo | aborta y limpia; jamás `MERGE_HEAD` en el worktree del plan | R4.2 |
| Path de worktree reusado con journal ajeno | rechaza; nunca borra un journal que puede tener procesos vivos | R2.3 |
| `awm job` desde el cwd equivocado | aserción de realpath contra los `TrackRef` → rechaza | R6.1 |
| Teardown de worktree | solo vía `awm track remove`, gateado a lock liberado | R2.4, R2.5 |

### Dos riesgos que no son una fila de tabla

**El paralelismo puede fabricar su propia señal de stall.** `computeGate` llama a `fingerprintNow` una vez por item satisfecho (`gate.ts:76,93,115`), y cada llamada corre `ls-files` más un `hash-object` **por archivo** (`fingerprint.ts:65-73`), en cada tick de 5s (`supervisor.ts:31`). N supervisores multiplican eso por N en la misma máquina. En un repo grande puede saturar la caja y manifestarse como `suspected-stall` en los controladores — es decir, el paralelismo generando exactamente la señal que R1 usa para decidir custodia. Mitigación: tope de concurrencia acotado (R7.2) cuyo default sale de una medición real (R7.3), escalonar los ticks entre supervisores, y considerar memoizar el fingerprint por HEAD.

**Certificar sobre un merge conflictivo sería un falso verde perfecto.** En pleno merge, `git branch --show-current` sigue devolviendo la rama del plan, así que `verifyBranchInvariant` (`lock.ts:73-77`) pasa limpio y `computeFingerprint` hashearía felizmente archivos con marcadores de conflicto adentro — produciendo un fingerprint fresco y válido sobre un árbol roto. De ahí R4.2 (abortar y limpiar) y R4.4 (`MERGE_HEAD` como condición bloqueante del supervisor).

---

## Limitaciones conocidas

**Los recursos compartidos son invisibles al aislamiento por worktree.** RF-4.2 dice "árbol compartido **o recurso compartido**", pero un worktree aísla *archivos* — no puertos fijos, no la base de datos de desarrollo, no `~/.cache`, no el store del package manager, y no `node_modules` (cada worktree necesita su propio install). **No existe detector mecánico para esta clase de solapamiento.**

Por eso R1.5 exige que `sharedResources` sea una **declaración explícita del plan** y rechace el paralelismo si falta: si el CLI lo dedujera, "sin recursos compartidos" sería vacuamente verdadero y el test de RF-4.2 no probaría nada. Se documenta acá como limitación conocida, no como nota al pie — es la clase de "verde por vacuidad" que el brief prohíbe explícitamente.

---

## Testing

Los tres CA del brief se anclan en corridas reales; ninguno se satisface con mocks.

- **CA-4.1 (equivalencia con serial)** — un plan fixture de dos tracks se ejecuta dos veces sobre el mismo commit base, una serial y otra en paralelo. La aserción es sobre el **árbol resultante** (hash del tree o `git diff --stat`), **no** sobre el log: el orden de commits difiere legítimamente entre ambas corridas y compararlo daría un rojo falso.
- **CA-4.2 (sin aislamiento → serial)** — el brief exige que el test *no dependa de que el repositorio esté limpio de cambios deliberados*. Se fuerza la ausencia de aislamiento inyectando un `worktreeAdder` que falla (mismo patrón de seam que R1 ya usa con `spawner` en `runner.ts`), y se verifica que el plan completa **y** que quedó registrado el evento de degradación (R2.2).
- **CA-4.3 (lockfile/manifest invalida el paralelismo)** — dos tracks con `Files:` disjuntos, uno toca `package-lock.json`: el paralelismo debe invalidarse **a pesar de** que la declaración previa era limpia. Es la diferencia entre "necesaria" y "suficiente".

**Procesos y worktrees reales, no simulados.** R1 ya sentó el precedente con `cli/tests/commands/watch/e2e-crash.test.ts`; un test que mockea el worktree no prueba nada sobre la clase de bug que R5 existe para prevenir.

**Dos tests que nacen de las trampas, no de los requisitos:**

- **Journal equivocado (R6.1):** un `awm job request` emitido desde el worktree principal mientras se edita en el del track debe ser **rechazado**. Sin este test, la aserción de realpath puede existir sin discriminar nada.
- **Merge conflictivo (R4.2/R4.4):** tras un `join` que conflicta, el worktree del plan no debe quedar con `MERGE_HEAD`, y no debe existir ningún fingerprint fresco calculado sobre archivos con marcadores de conflicto.

**Una medición, no un test (R7.3):** el costo de fingerprint × N supervisores se mide sobre este repo real antes de fijar el tope de concurrencia por defecto. Un número inventado ahí sería la clase de constante mágica que el harness ya sabe atrapar.

Cada fix lleva su propio test de regresión, y cada test se valida **revirtiendo el fix para verlo en rojo** — la disciplina que `CONSTITUTION.md` ya exige y que en R1 atrapó una regresión auto-inducida.

---

## Trazabilidad al brief

| Requisito del brief | Requisitos de este diseño |
|---|---|
| RF-4.1 | R1.1, R1.4, R2.1 |
| RF-4.2 | R1.5, R2.2, R3.1, R3.3, R3.3b |
| RF-4.3 | R3.2, R3.4, R4.1, R4.3 |
| RNF-T.2 | R2.2, R7.1 |
| CA-4.1 | testing §CA-4.1 |
| CA-4.2 | testing §CA-4.2 |
| CA-4.3 | testing §CA-4.3 |
| RF-2.9 (preservado) | R5.1, R5.2 |
