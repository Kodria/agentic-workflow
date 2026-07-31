# R0 — Informe final de descubrimiento (Fase C)

> Cierra el **Release 0** del brief certificado
> [`2026-07-30-sdd-cycle-optimization-brief.md`](../../plans/2026-07-30-sdd-cycle-optimization-brief.md)
> según el design doc [`2026-07-31-r0-discovery-design.md`](../../plans/2026-07-31-r0-discovery-design.md)
> (R7/R7.1/R8/R10). Tracking: [issue #20](https://github.com/Kodria/agentic-workflow/issues/20).
> Toda afirmación de este informe está respaldada por artefactos bajo
> [`evidence/`](evidence/) y por la matriz generada
> [`capability-matrix.md`](capability-matrix.md) — nada se afirma por relato.

## Corridas existentes y alcance (R10, R8)

| Corrida | Estatus R10 | Contenido |
|---|---|---|
| `claude-code@sandbox-remote` | obligatoria — **existió** | 3 corridas mecánicas (la última con sonda de rename endurecida) + formulario P1–P6 original + re-certificación completa bajo protocolo endurecido (`agent-...-recert-20260731T230122Z.json`) |
| `codex@owner-mac` | obligatoria — **existió** | corrida mecánica (sonda endurecida) + formulario P1–P6 completo, con P5 de sesión real cerrada |
| `codex@agentmobile-linux` | suplementaria | evidencia adicional de sandbox Linux; P2–P6 `no-certificado` bajo la vara endurecida (ver [`analysis/codex-evidence-audit.md`](analysis/codex-evidence-audit.md)) |
| `opencode@owner-mac` | **desestimada** | decisión del dueño 2026-07-31 (issue #20): OpenCode queda fuera del alcance de la iniciativa — el set de providers es Claude Code + Codex (brief N3 actualizado) |
| `claude-code@owner-mac` | opcional | no existió |

**Sistemas operativos (R8):** el estudio cubre Linux (sandbox, kernel 6.18) y macOS
(máquina del dueño, corridas Codex). **Windows queda fuera de alcance** por decisión
de diseño. Hallazgo de portabilidad real: el `date` BSD de macOS no soporta `%N`
(el P1 original lo asumía — corregido en el protocolo para usar Node, ver
`AGENT-PROTOCOL.md`).

## Estado real verificado

Resumen de [`capability-matrix.md`](capability-matrix.md) (generada solo desde
`evidence/*.json`; cada celda enlaza su evidencia):

| Capability | claude-code | codex |
|---|---|---|
| detached-survival (OS) | soportado | soportado (macOS: 23 heartbeats post-muerte del padre) |
| rename-replace atómico | soportado (lector concurrente: 28 lecturas, 0 corruptas) | soportado (184 lecturas, 0 corruptas) |
| despacho de subagentes | soportado | soportado |
| paralelismo real de subagentes | soportado (solape 18.2 s) | soportado (solape 7 s en mac, 15.2 s en linux) |
| override de modelo por despacho | **soportado** (controlador `claude-fable-5` vs worker `claude-haiku-4-5-20251001`, ambos observados) | **no-certificado** (el despacho acepta el parámetro, pero ni controlador ni worker exponen el identificador observado) |
| proceso vivo tras fin de turno | **soportado** (179 heartbeats / 178 s post-corte real) | **no-soportado** (1 heartbeat, 0 post-corte: el harness mata el proceso al cerrar el turno) |
| aislamiento por worktree | soportado | soportado |
| recuperación post-interrupción | degradado (proxy contexto-fresco; la prueba fuerte quedó cubierta por codex) | **soportado** (sesión real cerrada y recuperada solo desde `evidence/`) |
| espera/polling | soportado (notificaciones de background + trigger programado, respaldado por artefactos P3) | no-certificado |

**Las dos asimetrías estructurales entre providers** (las celdas en negrita) son los
hechos más importantes que produjo R0 — ambas alimentan directamente el diseño de
Release 1 y las decisiones DA-2/DA-3 (ver Contradicciones).

## Mapeo conceptual→real (R6)

Detalle completo en [`analysis/`](analysis/); síntesis:

- **Sensor-packs** ([`analysis/sensor-packs.md`](analysis/sensor-packs.md)): la
  estructura real (`pack.json` + config files) **admite un set de referencia de
  clases de defecto sin rediseño** — como campo nuevo en `pack.json` (o catálogo
  hermano), derivable 1:1 de los `id` de reglas semgrep ya existentes. Insumo
  directo de R2 y DA-4.
- **Esquema del ledger** ([`analysis/ledger-schema.md`](analysis/ledger-schema.md)):
  `class`/`signature`/`ref`/`desc` **no bastan** para mapear un cluster convergente
  a una clase de defecto con/sin sensor: falta un `defectClass` estable entre
  entradas y un campo de cobertura de sensor. Evidencia: el cluster real de
  indentación (3 firmas distintas, misma clase de defecto, conectadas por prosa).
  Además el enum `class` ya tiene drift en disco (`estructural`, `arquitectura`
  fuera del tipo declarado). Insumo directo de R3 y DA-5.
- **Convenciones del CLI** ([`analysis/cli-conventions.md`](analysis/cli-conventions.md)):
  un futuro `commands/job/` hereda el patrón `sensors/` (subdirectorio +
  `index.ts` + `types.ts`), el aislamiento de tests con tmpdir + override de
  `HOME`/`AWM_HOME`, y tres reglas de CONSTITUTION con impacto directo en el
  journal: validación de args, shape validation de todo estado leído de disco, y
  estados de enum nunca sobrecargados.
- **Runner** ([`analysis/runner-linux.md`](analysis/runner-linux.md) + evidencia
  owner-mac): las dos primitivas que el runner necesita del OS — supervivencia
  detached y rename atómico — están certificadas **en ambos OS**. Lo que varía
  entre providers no es el OS: es el ciclo de vida que impone el harness (ver
  contradicción 1).

## Contradicciones con el brief (R7.1)

Ninguna se resuelve asumiendo — se reportan aquí para decisión del dueño; las dos
primeras piden actualizar posiciones de DAs existentes, no crear nuevas.

1. **La supervivencia de jobs no puede depender de procesos hijos del agente en
   Codex.** RF-2.6 exige que un job sobreviva a la desaparición del agente/turno.
   La evidencia muestra que el *OS* lo permite en ambas plataformas
   (detached-survival mecánico `soportado`), pero el *harness* de Codex mata el
   proceso al cerrar el turno (P3 `no-soportado`: 0 heartbeats post-corte), mientras
   Claude Code lo respeta (178 s post-corte). **Consecuencia:** el runner durable de
   R1 no puede implementarse como "proceso lanzado por el agente" de forma
   provider-neutral. El journal + reconciliación del brief siguen siendo válidos;
   lo que cambia es el mecanismo de ejecución en Codex: lanzador externo al ciclo
   de vida del harness, o modo pull (el job corre cuando hay quien lo corra y la
   reconciliación al reanudar es el camino primario, no el fallback). RF-2.7
   (`orphaned`) pasa de estado excepcional a estado *esperado* en Codex.
2. **El override de modelo solo es certificable en Claude Code hoy.** RF-3.2 ya
   contemplaba el no-op reportado; la evidencia lo vuelve el caso *real* de Codex:
   el despacho acepta un modelo solicitado pero no expone identificador observado
   (ni el worker conoce el suyo). DA-2 deja de ser hipotética — el tiering de R4
   en Codex es no-op reportado o best-effort no verificable, y la aceptación de
   R4 debe redactarse sobre esa realidad.
3. **La espera activa del controlador no es simétrica.** Claude Code ofrece
   notificaciones de background + triggers programados (ambos con artefacto);
   en Codex no quedó mecanismo certificable — la continuidad depende de la
   reanudación de sesión (P5 `soportado`, la celda más fuerte de Codex). Refuerza
   la contradicción 1: en Codex el ciclo debe diseñarse alrededor de
   *reanudar-y-reconciliar*, no de *esperar-y-reaccionar*.

Sin contradicciones en sensor-packs ni ledger: los análisis confirmaron los
supuestos del brief y precisaron el vocabulario faltante que PR-1 ya anticipaba.

## Especificación reproducible de fixtures (R7)

Especificación, no implementación — para la aceptación de R1 (batería de casos
controlados, alimenta también DA-1):

- **Job largo:** writer Node de N segundos con heartbeat cada 1 s a un log
  (patrón exacto del P3 del protocolo, parametrizado por duración; N muy por
  encima de cualquier ventana de invocación). Criterio: el journal lo mantiene
  `running` mientras haya heartbeats — la duración jamás dispara terminación
  (RF-2.5, "fuera de alcance: matar verificaciones lentas").
- **Job sin output:** proceso vivo que no escribe nada (Node `setTimeout` largo
  sin writes). Criterio: transiciona a `suspected-stall` observacional, proceso
  intacto, diagnóstico read-only habilitado — nunca kill (RF-2.5).
- **Job `orphaned`:** lanzar job durable, terminar el turno/sesión solicitante de
  verdad (reproducible con el patrón P3: `turnend` + reanudación por trigger o
  sesión nueva), verificar que identidad/heartbeat/log/resultado persisten y que
  el siguiente controlador lo **reconcilia sin duplicarlo** (RF-2.6); si el
  proceso ya no puede probarse vivo, el estado es `orphaned` y el gate no
  certifica (RF-2.7). En Codex este fixture es el camino normal, no el borde.
- **Fingerprint:** mismo comando + mismo árbol ⇒ mismo fingerprint (dedup RF-2.2);
  cualquier cambio en los paths relevantes ⇒ fingerprint distinto y la evidencia
  anterior queda histórica (RF-2.8). Especificación: hash de comando normalizado +
  `HEAD` + digest del diff del working tree sobre los paths que el comando
  declara observar. Las transiciones del journal usan write-temp + `rename`
  (RF-2.10) — primitiva certificada en ambos OS por esta matriz.

## Plan técnico provider-neutral para R1–R5

- **R1 (journal + runner + gate):** vive en `cli/` como `commands/job/`
  (patrón `sensors/`: `index.ts` + `types.ts`), estados `running` /
  `suspected-stall` / `orphaned` como valores separados (regla CONSTITUTION),
  shape validation en toda lectura del journal, escritura atómica por rename.
  Ejecución dual certificada por la matriz: en Claude Code el runner puede ser
  detached del agente; en Codex el contrato es reanudar-y-reconciliar (el journal
  es el mismo; cambia quién mantiene vivo el proceso). El interlock de cierre
  (RF-2.9) es consulta al journal, no prosa de skill. Bloqueado por DA-1
  (métrica de no-regresión — la batería de fixtures de arriba es la posición
  propuesta).
- **R2 (cobertura estática):** campo de clases de defecto en `pack.json` del
  registry (evidencia: encaja sin rediseño) + comando CLI que compara instalado
  vs referencia. Bloqueado por DA-4/DA-6.
- **R3 (detección empírica):** requiere el vocabulario nuevo del ledger
  (`defectClass`, cobertura de sensor) — cambio de schema con migración tolerante
  al drift ya observado. Consume `awm ledger recurring` (ya en v3.4.0). Bloqueado
  por DA-5 (umbral ≥2 propuesto).
- **R4 (tier de modelo):** viable hoy solo verificable en Claude Code; en Codex,
  no-op reportado (RF-3.2). DA-2 debe resolverse aceptando esa asimetría o
  esperando a que Codex exponga el modelo observado.
- **R5 (paralelismo por worktree):** worktree-isolation `soportado` en ambos
  providers — la capacidad base existe; DA-3 (requisito duro vs fallback serial)
  queda como única decisión previa. La regla anti-corrupción de árbol compartido
  ya está curada en `AGENTS.md`.

## Validación (R9)

R0 se considera completo cuando el dueño valida este informe; la validación se
registra en el [issue #20](https://github.com/Kodria/agentic-workflow/issues/20).
Pendientes que este informe deja explícitamente al dueño:

1. Validar las tres contradicciones y sus consecuencias sobre DA-2 y el diseño
   del runner de R1.
2. Resolver DA-1 (métrica de calidad) para desbloquear R1 — la batería de
   fixtures de este informe es la posición propuesta.
