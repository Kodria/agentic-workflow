# Diseño: `awm track remove` y teardown solicitado por el controller

Issue: [#93](https://github.com/Kodria/agentic-workflow/issues/93)

## Contexto y decisión

`awm track remove <trackId>` ya emite una request durable
`track-teardown-request`, pero el consumidor del journal no reconoce ese kind y
la rechaza. El teardown seguro sí existe: el protocolo lo ejecuta al entrar en
`FALLBACK_PENDING`, usando `begin-teardown` y el driver que prueba propiedad
antes de detener supervisores o eliminar worktrees y ramas.

Una cohorte `ACTIVE` o `JOINING` no admite un miembro `REMOVED`: sus invariantes
exigen que todos sus tracks sigan en fases de trabajo. Por ello, eliminar un solo
track y continuar con N-1 no es representable sin rediseñar el protocolo de
cohortes. La decisión aprobada es que una solicitud de eliminación cancela la
cohorte completa, desmonta todos sus recursos demostrablemente propios y solo
entonces retorna a ejecución serial. El trabajo no integrado se preserva cuando
la propiedad o la limpieza no pueden demostrarse: la cohorte queda `BLOCKED`.

## Requisitos

- **TR-REQ-01 — Consumo durable.** WHEN el supervisor consuma una
  `track-teardown-request` con un `trackId` no vacío que pertenezca al journal,
  THE system SHALL persistir una intención declarativa de teardown en ese
  `TrackRef` y registrar la request como aplicada, sin ejecutar efectos Git,
  filesystem o proceso dentro del consumidor transaccional.
- **TR-REQ-02 — Validación fail-closed.** IF el payload no contiene un
  `trackId` string no vacío o el track no existe, THEN THE system SHALL rechazar
  visiblemente la request y no mutar el estado protocolar.
- **TR-REQ-03 — Cancelación de cohorte.** WHEN el reconciliador observe una
  intención pendiente en una cohorte no terminal, THE system SHALL mover la
  cohorte a `FALLBACK_PENDING`, persistir la causa
  `controller-requested:<trackId>` y mover todos los tracks vivos y no bloqueados
  a `TEARDOWN_REQUESTED`.
- **TR-REQ-04 — Teardown único y seguro.** WHILE la cohorte esté en
  `FALLBACK_PENDING`, THE system SHALL reutilizar exclusivamente
  `nextProtocolEffect`, `decideTeardown` y el teardown driver existente para
  desmontar un track por frontera durable, sin introducir una segunda autoridad
  de decisión ni eliminaciones forzadas.
- **TR-REQ-05 — Propiedad indemostrable.** IF el supervisor, worktree o branch
  no puede demostrarse propio durante el teardown, THEN THE system SHALL dejar
  el track y la cohorte bloqueados, conservar el recurso y prohibir la entrada a
  ejecución serial.
- **TR-REQ-06 — Convergencia serial.** WHEN todos los tracks de la cohorte estén
  `REMOVED` o nunca hayan superado `DECLARED`, THE system SHALL persistir
  `SERIAL` con la causa `controller-requested:<trackId>`.
- **TR-REQ-07 — Recuperación tras crash.** IF el proceso termina después de
  aplicar la request, observarla o ejecutar cualquier frontera de teardown,
  THEN THE system SHALL reanudar desde el estado durable y converger sin repetir
  un efecto destructivo ya demostrado.
- **TR-REQ-08 — Idempotencia durante teardown.** WHEN una nueva request válida
  para un track existente llegue mientras la cohorte ya esté en
  `FALLBACK_PENDING`, THE system SHALL tratarla como aplicada, conservar la
  primera causa de fallback y continuar el mismo teardown sin reiniciarlo.
- **TR-REQ-09 — Cohorte terminal.** IF una intención pendiente se observa cuando
  la cohorte ya está `SERIAL` o `COMPLETE`, THEN THE system SHALL consumir la
  intención como moot, registrar evidencia explícita y no reabrir ni degradar la
  cohorte terminal.
- **TR-REQ-10 — Contrato público.** WHEN el comportamiento anterior esté
  implementado, THE CLI and documentation SHALL describir `track remove` como
  solicitud de cancelación segura de la cohorte y SHALL eliminar toda afirmación
  de que el comando no está implementado.

## Arquitectura

### 1. Intención durable en el journal

`TrackRef` incorporará `teardownRequested?: boolean`, análogo a
`joinRequested`. El handler de `track-teardown-request` en `apply.ts` solo
validará, marcará esa intención y producirá el outcome aplicado. Esta separación
evita hacer operaciones externas dentro de la transacción de consumo y cierra la
ventana de crash entre “request eliminada” y “protocolo informado”. El guard de
runtime del journal validará que el campo opcional sea booleano.

### 2. Una sola autoridad de transición

`ProtocolObservation` incorporará `teardown-requested` y
`reconcileProtocol` será la única autoridad que cambie la cohorte a
`FALLBACK_PENDING`, asigne la causa y marque los tracks vivos. El handler de
request no mutará directamente `cohortPhase` ni `TrackPhase`.

La transición se acepta desde cualquier cohorte no terminal. Si ya está en
`FALLBACK_PENDING`, será un no-op protocolar que preserva `fallbackReason`. Si
la cohorte está `SERIAL` o `COMPLETE`, no se altera el protocolo.

### 3. Puente de reconciliación

Antes de procesar joins o elegir el siguiente efecto protocolar,
`reconcileTracks` buscará una intención de teardown. Consumirá una por frontera
durable:

1. convierte la marca durable en `teardown-requested`;
2. aplica el reducer puro;
3. limpia la marca;
4. persiste el nuevo estado y un evento `track-teardown-observed` o
   `track-teardown-moot`;
5. continúa a la siguiente iteración, donde el flujo existente selecciona
   `begin-teardown`.

Procesar teardown antes que join hace que la cancelación gane ante solicitudes
concurrentes: no se inicia un freeze o merge nuevo después de que existe una
cancelación durable.

### 4. Driver existente sin duplicación

No se crea un nuevo ejecutor. `nextProtocolEffect` continuará escogiendo un solo
`begin-teardown`; `runBeginTeardown` reunirá evidencia; `decideTeardown`
resolverá cada paso; y los estados `TEARDOWN_INTENT`, `SUPERVISOR_STOPPED`,
`WORKTREE_REMOVED`, `BRANCH_REMOVED` y `REMOVED` conservarán su semántica
actual. La entrada a `SERIAL` seguirá bloqueada mientras quede un recurso vivo o
un track `BLOCKED`.

## Flujo de estado

```text
track-teardown-request
  -> TrackRef.teardownRequested = true
  -> teardown-requested (observación pura)
  -> FALLBACK_PENDING / controller-requested:<trackId>
  -> todos los tracks vivos: TEARDOWN_REQUESTED
  -> begin-teardown (uno por vez, driver existente)
  -> REMOVED o BLOCKED
  -> SERIAL solo cuando no queda recurso paralelo vivo
```

## Alternativas descartadas

### Eliminar únicamente el track solicitado

Requeriría redefinir membresía de cohorte, barreras de freeze, integración global
y garantías sobre dependencias entre tracks. Es un cambio de protocolo distinto
y mucho mayor que #93. Además, el estado actual prohíbe una cohorte activa con un
track removido.

### Mutar fases directamente desde `apply.ts`

Reduce líneas, pero mezcla consumo transaccional con autoridad protocolar y
duplica reglas que ya pertenecen a `reconcileProtocol`. También difiere del
patrón durable usado por `track-join-request`.

### Retirar el comando

Evita el falso contrato, pero desperdicia la maquinaria de teardown existente y
contradice la superficie request-only ya diseñada. Solo sería razonable si no se
quisiera soportar cancelación administrativa.

## Estrategia de pruebas

- Tests unitarios del apply: payload inválido, track desconocido, intención
  persistida y outcome aplicado.
- Tests puros del protocolo: transición desde preparación/trabajo/integración,
  marcado de toda la cohorte, preservación de `DECLARED`/`REMOVED`/`BLOCKED`,
  idempotencia en `FALLBACK_PENDING` y no-op terminal.
- Tests del reconciliador: prioridad sobre join, consumo de una intención por
  tick, persistencia del evento y selección posterior del driver existente.
- Test de crash/restart: request aplicada antes de reconciliar y reinicio en una
  frontera de teardown convergen a `SERIAL` sin borrar recursos ajenos.
- Tests de CLI/documentación: el verbo continúa siendo request-only y ya no se
  anuncia como no implementado.

## Alcance

Incluye el puente request → intención → protocolo, sus pruebas y la actualización
de la documentación pública. No incluye eliminación parcial de una cohorte,
recuperación automática de tracks `BLOCKED`, comandos para aportar evidencia del
operador ni cambios a la estrategia de integración.
