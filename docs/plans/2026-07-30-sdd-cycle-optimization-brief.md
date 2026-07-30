---
awm: product-brief
schema: 1
title: Optimización del ciclo SDD sin pérdida de calidad
mode: brief
readiness: ready
created: 2026-07-30
updated: 2026-07-30
open_decisions: [DA-1, DA-2, DA-3, DA-4, DA-5, DA-6]
project: awm-sdd-optimization
---

# Optimización del ciclo SDD sin pérdida de calidad — Product Brief

Audiencia: agente de análisis/pair (provider-neutral) · Metodología: brief-spec (AWM product-brief) · Este documento es autocontenido: no asume acceso a la sesión que produjo el diagnóstico.

## Business Need

- **N1** — El dueño del framework AWM ejecuta desarrollos vía el ciclo `subagent-driven-development` (SDD: un subagente implementador + dos subagentes revisores por tarea, más un panel de QA multi-lente al cierre) y cada desarrollo está tardando **horas**. En la única sesión instrumentada de punta a punta (2026-07-29, rama `claude/agentic-workflow-awm-issues-dqka6l`, PR agentic-workflow#19), un diff de +1878/−35 líneas en 15 archivos costó ~115 minutos post-plan (77 de ejecución SDD, 18 de QA, 7 de retro, más 13 de plan), 23 despachos de subagente, ~1.57M tokens reportados por subagentes y una relación revisión:implementación de 4.2:1. El costo de no resolverlo: cada ciclo de desarrollo paga ese sobreprecio, y el dueño lo paga en tiempo de calendario.
- **N2** — El rigor del proceso de calidad **es la fuente de su valor y no puede perderse**: el dueño reporta que cada vez se encuentran menos bugs al terminar un desarrollo, y en la sesión medida el aparato de revisión atrapó 3 defectos reales que ningún sensor mecánico habría detectado (un bug sutil de regex que venía especificado *en el plan mismo*, un crash con datos históricos mal formados, un gap de cobertura en la propiedad transitiva de un algoritmo). Cualquier optimización que degrade esa capacidad es una no-solución.
- **N3** — El dueño opera AWM con **tres providers**: Claude Code, Codex y OpenCode. Una optimización que solo funcione en uno no sirve: toda capacidad nueva debe funcionar en los tres o degradar de forma explícita y segura donde falte soporte.
- **N4** — El ciclo no es delegable de forma desatendida si su continuidad depende de que un agente, turno o invocación permanezca vivo: una revisión puede quedar sin veredicto, una verificación legítimamente larga puede superar los límites de una invocación, o el controlador puede perder su punto exacto de continuación. AWM debe conservar estado y resultados fuera de la memoria del agente, reanudar idempotentemente y prohibir un cierre silencioso mientras exista trabajo pendiente, sin introducir semántica exclusiva de ningún provider.

## Business Cases

Catálogo medido (sesión 2026-07-29, fuentes: timestamps de commits, reportes de uso por subagente, comandos cronometrados):

- **Cómputo de verificación redundante**: la suite completa de tests (42s) y los sensores (46s, que incluyen la suite adentro) se corrieron ~22 veces —una por subagente— sobre estados del diff mayormente idénticos. Un test dirigido al área tocada tarda 3s. Ahorro estimado: 15–17 min/ciclo sin quitar ninguna verificación, calculándola una vez por estado del diff en lugar de una vez por agente.
- **Defectos de estilo escalando a revisión por agente**: 4 de ~9 hallazgos de revisión fueron indentación/convención (`test()` vs `it()`, 4 espacios vs 2). Cada uno costó un round-trip completo de fix + re-review; el patrón necesitó **tres intentos** para quedar totalmente atrapado, porque cada fix parcial solo re-barría las líneas que su propia tarea había tocado. Causa raíz verificada: el proyecto no tiene formatter y su sensor de lint corre solo 3 reglas — la clase entera de defecto no tenía detector mecánico, así que la atrapaba (o no) un revisor por suerte. Mecanizarla *sube* la calidad además de ahorrar ~15 min/ciclo.
- **Tracks independientes ejecutados en serie**: el plan de la sesión declaraba dos releases sin ningún archivo, tipo ni import compartido (verificado por revisión final), y aun así se ejecutaron secuencialmente. Serializarlos no agregó verificación alguna.
- **Veredicto de revisión perdido sin bloqueo**: un review de calidad despachado en background nunca reportó su veredicto al controlador, y el ciclo avanzó a la siguiente tarea igual. El gate existe como instrucción de prosa ("no marcar completo sin evidencia") pero nada lo fuerza mecánicamente.
- **Verificaciones cada vez más largas (señal transversal reportada por el dueño)**: a medida que un proyecto crece, tests, linters, typecheck, builds, sensores, análisis de seguridad o mutación pueden tardar mucho más que al inicio. Un timeout terminal confunde "lento" con "falló", puede cortar una ejecución válida y dejar su salida inaccesible si el agente que la inició desaparece. Esta clase de fallo es agnóstica al stack y al provider: la duración nunca debe decidir por sí sola el veredicto ni la conservación del resultado.
- **Continuidad atada al agente**: el estado fino del ciclo (tarea, intento, fase, despacho, commit, veredictos, verificaciones y siguiente acción) vive parcialmente en contexto conversacional. Si el turno termina o el agente se pierde, el plan y el ledger permiten reconstrucción parcial, pero no prueban qué proceso sigue vivo, qué resultado pertenece a qué diff ni qué acción exacta debe ejecutarse una sola vez.
- **Uso plano de modelo**: los 23 despachos corrieron en el modelo de la sesión, aunque la skill SDD ya documenta una regla de selección ("spec completo + 1-2 archivos → modelo barato") que aplicaba a la mayoría de las tareas. La regla existe como consejo; no hay mecanismo que la transporte ni la aplique.
- **Incidente de concurrencia (regla ya curada)**: 4 subagentes de QA en paralelo sobre el mismo working tree; uno corrió `git checkout <ref> -- .` para inspeccionar una versión anterior y el restore quedó incompleto, revirtiendo 7 archivos en silencio. Detectado solo por un `git status` de rutina del controlador. Cualquier paralelismo futuro debe tratar el aislamiento como condición, no como optimización.

Casos borde que el diseño debe cubrir:

- Provider sin selección de modelo por despacho → el tier declarado se ignora con aviso, el ciclo completa normal.
- Plan con un solo track, o con tracks que comparten archivos → el paralelismo no aplica; ejecución serial sin fricción añadida.
- Proyecto sin suite de tests o sin sensores configurados → el gate del controlador degrada a lo que exista y lo declara (estado honesto, nunca "verde vacuo").
- Pack del stack sin set de referencia de sensores → la detección estática reporta "sin referencia para este stack" (inconcluso), nunca "sin gaps".
- Ledger vacío o sin clusters → la detección empírica reporta "sin evidencia", nunca silencio ni error.
- Runtime sin soporte de worktrees → los tracks independientes caen a serial; jamás paralelo sobre árbol compartido.
- Entrada de ledger histórica mal formada → la detección empírica la tolera (el CLI ya valida shape al leer, desde v3.4.0).
- Verificación que corre durante horas y sigue viva → permanece `running`; la duración no la mata ni la convierte en fallo.
- Verificación viva sin nueva salida → pasa a `suspected-stall`, abre diagnóstico read-only y continúa ejecutándose.
- Agente que inició una verificación desaparece → el job y su log sobreviven; el controlador recuperado consulta el mismo `job-id`, nunca inicia un duplicado por reflejo.
- Resultado tardío sobre un estado anterior del diff → se conserva como evidencia histórica, pero no certifica el estado actual.
- Journal que declara un job en curso sin poder demostrar que runner o proceso siguen vivos → estado `orphaned`, nunca verde; reejecución solo tras demostrar que el original terminó o por autorización humana.

## Users & Context

- **El dueño del framework** (operador único hoy) — lanza ciclos SDD desde Claude Code, Codex u OpenCode según el contexto; sufre N1 en tiempo de calendario y depende de N2 para confiar en merges sin re-revisión manual.
- **El agente controlador** — el agente que orquesta el ciclo SDD dentro de una sesión: despacha subagentes, aplica gates, marca tareas completas. Es el usuario directo de PR-2 y PR-4.
- **Los subagentes** (implementadores y revisores) — reciben prompts construidos desde templates del registry; son los destinatarios de PR-3 (tier) y del cambio de alcance de verificación en PR-2.
- **El runner durable de verificaciones** — componente provider-neutral que registra, ejecuta y conserva el estado/salida de verificaciones mecánicas por `job-id`; su vida no depende de la del agente que solicitó el trabajo.
- **Consumidores del registry** — cualquier máquina/equipo que instale `awm-baseline-registry`: los cambios de proceso les llegan vía `awm update`, por lo que todo cambio debe ser retrocompatible con planes y proyectos existentes.

## Constraints

- **El aparato de revisión no se toca**: ninguna etapa se elimina ni se fusiona (la fusión spec+quality fue evaluada durante el diagnóstico y retirada — el quality review atrapó un bug en código que el plan especificaba verbatim, demostrando que revisar "transcripción" atrapa defectos de planificación). El tiering de modelo, si procede, aplica **solo al implementador**, nunca a revisores.
- **AWM permanece agnóstico a clases de problema** (doctrina existente del repo): la detección de sensores faltantes es una capacidad genérica de detección de ausencia de cobertura; los sets de referencia contienen clases genéricas de defecto, jamás reglas nacidas de un bug puntual de un proyecto.
- **Contrato provider-neutral**: journal, estados, jobs, fingerprints, gates y reglas de recuperación tienen una sola semántica. Un runtime puede requerir un adaptador para expresar una primitiva, pero el adaptador no puede cambiar los estados ni relajar los criterios de cierre; ninguna solución exclusiva de un provider satisface el brief.
- **Sin timeout terminal por duración**: ninguna verificación se mata, falla o descarta porque superó un tiempo fijo. Los umbrales temporales son observacionales (`suspected-stall`) y disparan diagnóstico, nunca cancelación.
- **El comando conserva su semántica**: AWM no agrega un timeout externo ni reinterpreta el resultado. Si el propio framework de tests/lint/sensor define y reporta un timeout interno, ese exit/veredicto real se captura como resultado del job; cambiar esa política pertenece al proyecto, no al runner.
- **Detener o duplicar requiere evidencia**: diagnóstico y recuperación son read-only mientras el proceso original pueda seguir vivo. Cancelar requiere autorización humana; reejecutar requiere demostrar que el original terminó o autorización explícita para reemplazarlo.
- **Detección ≠ mutación**: `~/.awm` es territorio del instalador (`awm init`/`awm update`); cualquier detección reporta y sugiere, nunca modifica configuración por su cuenta.
- **Split contenido/CLI**: los cambios de proceso (skills, prompts, packs) viven en `awm-baseline-registry` y llegan vía tag + `awm update`; los mecanismos ejecutables de detección, journal, runner e interlocks viven en el CLI (`agentic-workflow`), cuyo publish a npm es automático en CI.
- **Multi-provider como criterio de aceptación, no como aspiración**: toda capacidad declara su comportamiento en los tres providers (soportado / degradado explícito), verificado contra la matriz de capacidades de R0.
- **Retrocompatibilidad de contenido**: planes existentes sin los campos nuevos deben ejecutar exactamente igual que hoy.
- **Costo**: sin infraestructura paga nueva ni suscripciones adicionales. El presupuesto de tokens por ciclo debe bajar o mantenerse — es parte de N1; una optimización que compre velocidad subiendo el gasto de tokens no cumple la necesidad.
- **Privacidad**: journal, logs y evidencia viven localmente junto al estado AWM del proyecto y no salen de él. Deben aplicar redacción y límites de retención para no persistir secretos ni salida ilimitada; la detección de cobertura no exporta contenido a ningún servicio externo.

## Non-Assumption Mandate

Este brief tiene una particularidad que se declara de frente: **el diagnóstico sí está verificado** — proviene de mediciones sobre una sesión real (timestamps de commits, reportes de uso por subagente, comandos cronometrados, ledger de la rama, código mergeado en `main` v3.4.0). Los números de Business Need/Cases no son estimaciones: son datos con procedencia citada, aunque de **n=1 sesión** (ver Risks).

Lo que **NO** está verificado — y debe confirmarse en R0 (descubrimiento read-only) antes de cualquier compromiso técnico:

- **Capacidades de los runtimes destino**: selección de modelo por despacho, despacho paralelo, aislamiento por worktree, espera/polling, continuidad del controlador, comportamiento al terminar un turno con trabajo vivo y recuperación después de una interrupción — con versión, fecha, fuente y mecanismo reproducible para cada provider.
- **Estructura real de los sensor-packs por stack** en `awm-baseline-registry` (`sensor-packs/generic/`, `sensor-packs/js-ts/`, otros): qué forma tendría un "set de referencia" por pack y si la estructura actual lo admite sin rediseño.
- **Mecánica de enforcement del controlador**: el gate de PR-2 es prosa de skill hoy; qué estado ejecutable vuelve mecánicas las transiciones y el interlock de terminación, qué parte vive en CLI/registry y cómo consume el mismo contrato cada provider.
- **Runner durable y portabilidad de procesos**: cómo iniciar una verificación sin atarla a un turno, identificar runner/proceso sin confundir PIDs reutilizados, conservar log/heartbeat/resultado atómicamente, recuperar jobs activos u `orphaned` y diagnosticar sin matar ni duplicar en los sistemas operativos soportados.
- **Fingerprint del estado verificable**: combinación suficiente de HEAD, índice, working tree y archivos no rastreados para que una evidencia nunca certifique un diff distinto; forma de deduplicar comandos equivalentes cuando sensores ya contienen suite, lint u otro verificador.
- **Duraciones y salida reales fuera de la sesión n=1**: distribución de duración, comportamiento sin output y volumen de logs de verificaciones en proyectos de distintos tamaños/stacks. La señal transversal reportada por el dueño guía el problema, pero R0 debe convertirla en fixtures y límites observables reproducibles, no en un timeout supuesto.
- **Suficiencia del esquema actual del ledger** para la mitad empírica de PR-1: si `class`/`signature`/`ref` bastan para mapear un cluster convergente a una "clase de defecto sin sensor", o si hace falta vocabulario adicional.
- **Convenciones de código y tests del CLI** para la pata de comando de PR-1 (más allá de lo tocado en la sesión medida).

Cualquier contradicción entre este brief y el sistema real encontrada durante R0 se reporta al dueño y jamás se resuelve asumiendo — el dueño decide y la resolución queda registrada (actualización de este brief o nuevo `DA-#`). Toda definición técnica (esquemas, rutas, firmas, formato del set de referencia, mecanismo del gate/runner/journal) queda delegada al implementador, a producir solo después del descubrimiento de R0.

## Glossary

| Term | Definition |
|------|------------|
| SDD | `subagent-driven-development`: ciclo donde cada tarea del plan la ejecuta un subagente implementador fresco, revisado por un subagente de spec-compliance y otro de code-quality antes de marcarse completa. |
| Controlador | El agente de la sesión que orquesta el SDD: despacha subagentes, aplica gates, marca tareas. |
| Sensor | Verificación mecánica configurada en `.awm/sensors.json` (typecheck, lint, tests, security, etc.) que `awm sensors run` ejecuta y agrega en un veredicto. |
| Sensor-pack | Conjunto de configuraciones de sensores por stack, distribuido vía registry (`sensor-packs/js-ts/`, etc.). |
| Ledger | Registro por-rama (`awm ledger`) donde revisores y QA emiten hallazgos y aciertos; insumo de `harness-retro`. |
| Cluster convergente | Grupo de hallazgos del ledger con firmas distintas que `awm ledger recurring` (v3.4.0+) une por archivo compartido o afinidad léxica: la señal de que revisores independientes encontraron el mismo defecto. |
| Provider / runtime | El agente-host donde corre AWM: Claude Code, Codex u OpenCode. |
| Worktree | Checkout adicional de git (`git worktree add`) que aísla un árbol de trabajo del principal. |
| Tier | Declaración de complejidad por tarea del plan que expresa qué capacidad de modelo necesita su implementador. |
| Gate | Condición verificable que debe cumplirse antes de avanzar de fase; "mecánico" = su incumplimiento bloquea por construcción, no por memoria del agente. |
| Journal de ejecución | Estado durable del ciclo: plan/run, tarea, intento, fase, despacho, base/head, commit, worktree, gates y `next_action`. Es fuente de reanudación, no un resumen conversacional. |
| Job de verificación | Ejecución registrada de un comando mecánico (test, lint, typecheck, build, sensor, seguridad, mutación u otro) identificada antes de comenzar y vinculada a un fingerprint. |
| Runner durable | Ejecutor provider-neutral que mantiene job, heartbeat, log y resultado fuera de la vida del agente solicitante. |
| Fingerprint | Identidad del estado exacto verificado, incluyendo cambios comprometidos y no comprometidos relevantes. Toda evidencia y deduplicación se liga a él. |
| `suspected-stall` | Estado observacional: job vivo sin progreso visible dentro del umbral configurado. Abre diagnóstico; no implica fallo, cancelación ni permiso para duplicar. |
| `orphaned` | El journal registra un job no terminal, pero no puede demostrarse que runner o proceso sigan vivos. Nunca certifica éxito y requiere recuperación segura o decisión humana. |

## Processes

- **PR-1 — Detección de cobertura de sensores.** Responde, para un proyecto dado: *"¿qué clases de defecto no tienen detector mecánico acá?"*. Dos mitades complementarias, ambas read-only:
  - **Estática**: compara los sensores configurados del proyecto contra el set de referencia de su pack/stack y reporta cada clase ausente o presente-pero-sin-configuración-efectiva (ej.: lint presente pero corriendo un set mínimo de reglas sin config de proyecto). Si el pack no define set de referencia para el stack, el resultado es "inconcluso por falta de referencia" — nunca "sin gaps" (un estado nunca significa dos cosas: doctrina existente).
  - **Empírica**: cruza los clusters convergentes del ledger contra los sensores activos: una clase de hallazgo que aparece recurrentemente *a mano* (emitida por revisores) mientras ningún sensor la reporta es exactamente un gap de cobertura pagándose en revisión por agente. Si R0 confirma que el esquema actual del ledger basta, el cruce usa `class` + análisis del cluster; si no, la resolución del vocabulario faltante se registra como decisión.
  - La salida es un reporte; si DA-6 se resuelve a favor, incluye la remediación sugerida como comando/config propuesto que el dueño aplica — la detección jamás muta nada.

```mermaid
flowchart TD
    A[Invocación de detección] --> B{¿Pack define set de referencia?}
    B -->|no| C[Reporte: inconcluso por falta de referencia]
    B -->|sí| D[Comparar sensores configurados vs referencia]
    D --> E[Gaps estáticos]
    A --> F{¿Ledger con clusters convergentes?}
    F -->|no| G[Reporte: sin evidencia empírica]
    F -->|sí| H[Cruzar clase de cluster vs sensores activos]
    H --> I[Gaps empíricos con cluster citado]
    E --> J[Reporte unificado read-only]
    G --> J
    I --> J
    C --> J
```

- **PR-2 — Controlador durable + runner + gate de verificación.** El ciclo y sus verificaciones sobreviven a agentes/turnos, y la evidencia cara se calcula **una vez por fingerprint/comando**, no una vez por subagente:
  - Antes de ejecutar, el controlador crea o recupera un journal con tarea, intento, fase, despacho, base/head, commit, worktree, gates y `next_action`; cada transición se persiste atómicamente.
  - Toda verificación mecánica potencialmente larga (tests dirigidos o completos, lint, typecheck, build, sensores, seguridad, mutación u otras definidas por el proyecto) se registra primero como job. El runner devuelve `job-id` y conserva heartbeat, log y resultado fuera de la vida del agente.
  - Los implementadores solicitan verificación dirigida al área tocada. Revisores consumen evidencia válida del fingerprint y solo solicitan un job adicional cuando necesitan una comprobación distinta; no reejecutan por rutina la suite/sensores completos.
  - El controlador construye un plan de verificación autoritativo para el fingerprint, deduplicando comandos equivalentes (por ejemplo, no corre la suite por separado cuando el sensor ya ejecuta esa misma suite), y consume evidencia propia del runner antes de marcar la tarea completa.
  - No existe timeout terminal por duración. `suspected-stall` conserva el proceso y abre diagnóstico read-only; cancelar requiere autorización humana, y reejecutar requiere prueba de que el original terminó o autorización explícita.
  - El gate es mecánico contra veredictos/jobs perdidos: una tarea no puede completarse con revisor ausente, job pendiente/no certificado o evidencia de otro fingerprint. El interlock final aplica la misma regla a tareas, revisiones, fixes, QA y cierre.
  - Al iniciar, reanudar o recuperar contexto, el controlador reconcilia journal, plan, Git, ledger y jobs. Un agente perdido no cambia el estado del job; un job `orphaned` nunca se interpreta como éxito.
  - Si el proyecto no tiene suite, sensores u otra clase esperada, el gate degrada a lo que exista y lo **declara** — estado honesto, nunca verde por vacuidad.

```mermaid
flowchart TD
    A[Crear/recuperar journal] --> B[Persistir fase + next_action]
    B --> C[Registrar jobs por fingerprint/comando]
    C --> D[Runner ejecuta; agente puede desaparecer]
    D --> E{Estado del job}
    E -->|running| F[Polling corto]
    E -->|suspected-stall| G[Diagnóstico read-only + monitoreo]
    E -->|orphaned| H[Recuperación segura o decisión humana]
    E -->|fail| I[Fix loop → fingerprint nuevo]
    E -->|pass| J{¿Revisiones y gates del fingerprint completos?}
    J -->|no| B
    J -->|sí| K[Tarea completa + evidencia auditable]
    K --> L{¿Trabajo pendiente?}
    L -->|sí| B
    L -->|no| M[Interlock final → COMPLETE]
```

- **PR-3 — Tier declarativo de complejidad por tarea** *(condicionado a R0 + DA-2)*. El plan transporta la intención; el runtime la honra con lo que tenga:
  - `writing-plans` admite un campo opcional por tarea (p. ej. `**Complejidad:** mecánica | integración | diseño`), análogo a los campos `**Skills:**`/`**Modo de ejecución:**` ya existentes.
  - Donde el runtime soporta selección de modelo por despacho, el controlador la aplica **solo al implementador** — los revisores corren siempre a plena capacidad (el aparato de revisión riguroso es justamente lo que hace seguro abaratar la implementación).
  - Donde no hay soporte, degradación a no-op **reportado**: el ciclo completa normal y la evidencia registra que el campo se ignoró. Si R0 confirma soporte en los tres providers, la degradación será excepcional; si no, DA-2 decide si el no-op satisface el criterio del dueño ("funcional en todo o no sirve").
  - Campo ausente → comportamiento idéntico al actual.

- **PR-4 — Paralelismo entre tracks independientes con aislamiento** *(condicionado a R0 + DA-3)*:
  - La independencia se verifica mecánicamente sobre `Files:` declarados, dependencias/recursos compartidos conocidos y archivos realmente modificados; una intersección vacía declarada es necesaria, no suficiente.
  - Cada track paralelo corre en su propio worktree/branch con ownership explícito; el merge de vuelta y el gate de integración son del controlador. Si el runtime no ofrece aislamiento, fallback a serial — jamás paralelo sobre árbol compartido (incidente real documentado en `AGENTS.md` del repo del CLI: corrupción silenciosa de 7 archivos por `git checkout` concurrente).

## Requirements

- **RF-1.1** — WHEN se invoca la detección de cobertura sobre un proyecto con sensores configurados y pack con set de referencia, THE detección SHALL reportar cada clase de defecto del set ausente en el proyecto, y cada sensor presente cuya configuración efectiva no cubra su clase (con el criterio de "configuración efectiva" definido en R0).
  - **CA-1.1** — Corrida contra el repo real `agentic-workflow` (estado actual conocido: sin formatter; lint con 3 reglas y sin config de proyecto), el reporte nombra ambos gaps. Dato real, no mock.
- **RF-1.2** — WHEN el ledger de una rama (activo o archivado) contiene clusters convergentes cuya clase no está cubierta por ningún sensor activo, THE detección SHALL reportar el gap empírico citando el cluster que lo evidencia.
  - **CA-1.2** — Corrida contra fixture sanitizado/versionado, derivado con trazabilidad del ledger real 2026-07-29 y su cluster convergente de 3 hallazgos de indentación con firmas distintas, señala la clase estilo/formato como sin cobertura.
- **RF-1.3** — IF el proyecto no tiene ledger, o el ledger no produce clusters, THEN THE detección SHALL reportar "sin evidencia empírica" de forma explícita — nunca silencio, nunca error.
  - **CA-1.3** — Corrida en un proyecto recién inicializado, la mitad empírica reporta el estado explícito y sale con éxito.
- **RF-1.4** — THE detección SHALL ser íntegramente read-only: cero escrituras a `.awm/`, `~/.awm/` o archivos de configuración del proyecto.
  - **CA-1.4** — Hash del árbol del proyecto y de `~/.awm` antes/después de la corrida: idénticos.
- **RF-1.5** — IF el pack del stack no define set de referencia, THEN THE mitad estática SHALL reportar "inconcluso por falta de referencia" como estado distinto de "sin gaps".
  - **CA-1.5** — Corrida sobre un stack sin referencia definida, el reporte distingue explícitamente ese estado.
- **RF-2.1** — WHEN cualquier fase solicita una verificación mecánica, THE controlador SHALL registrarla antes de iniciar como job durable con `job-id`, comando/digest, fingerprint, estado y rutas de evidencia, independientemente del stack, duración o provider.
  - **CA-2.1** — Fixture de verificación configurable supera ampliamente el umbral observacional, pierde al agente solicitante y termina `pass`; un controlador recuperado consume el mismo `job-id`/resultado sin duplicar el proceso.
- **RF-2.2** — WHEN un implementador verifica su tarea, THE controlador SHALL solicitar verificación dirigida al área tocada; WHEN el gate autoritativo verifica la tarea, SHALL ejecutar una sola vez por fingerprint cada comando necesario, deduplicando suite/sensores/linters equivalentes.
  - **CA-2.2** — En un ciclo SDD instrumentado, el journal demuestra que un comando mecánico dado se ejecutó como máximo una vez por fingerprint aunque implementador, revisores y controlador solicitaran evidencia; tras un fix aparece un fingerprint nuevo.
- **RF-2.3** — IF cualquier revisor despachado no tiene veredicto registrado (perdido, pendiente, o nunca reportado), THEN THE controlador SHALL NOT marcar la tarea completa, por mecanismo verificable y no por prosa.
  - **CA-2.3** — Escenario controlado: se omite deliberadamente un veredicto; el journal conserva `next_action`, el interlock impide cierre y la recuperación obtiene o re-despacha el veredicto exactamente una vez.
- **RF-2.4** — IF el proyecto carece de suite de tests o de sensores, THEN THE gate SHALL degradar a la evidencia disponible declarando qué falta — nunca reportar verde por ausencia de verificadores.
  - **CA-2.4** — Corrida en proyecto sin sensores: la evidencia registra "sensores: no configurados" como estado explícito.
- **RF-2.5** — WHILE un job permanezca vivo, THE runner SHALL conservarlo en `running` sin timeout terminal por duración; IF deja de producir progreso observable, THEN SHALL marcar `suspected-stall`, mantener el proceso y habilitar diagnóstico read-only.
  - **CA-2.5** — Job controlado sin output durante un periodo superior al umbral entra en `suspected-stall`, continúa con la misma identidad, luego produce salida y termina sin cancelación ni segundo proceso.
- **RF-2.6** — IF desaparece el agente, turno o contexto que solicitó un job, THEN THE job SHALL conservar identidad, heartbeat, log y resultado; el siguiente controlador SHALL reconciliarlo desde estado durable sin inferir fallo ni iniciar un duplicado.
  - **CA-2.6** — El ciclo se interrumpe de forma controlada durante implementación, spec review, quality review, fix y QA; cada reanudación ejecuta `next_action` una sola vez y conserva commits/veredictos/jobs previos.
- **RF-2.7** — IF el journal registra un job no terminal pero no puede demostrarse que runner o proceso sigan vivos, THEN THE estado SHALL ser `orphaned` y SHALL NOT certificar el gate; reejecución SHALL requerir prueba de terminación o autorización humana explícita.
  - **CA-2.7** — Fixture `orphaned` bloquea certificación; el diagnóstico no mata ni duplica, y solo tras la condición autorizada nace un nuevo job relacionado con el anterior.
- **RF-2.8** — WHEN un job termina, THE resultado SHALL certificar exclusivamente el fingerprint registrado; IF el estado del proyecto cambió, THEN la evidencia SHALL conservarse como histórica y SHALL NOT satisfacer el gate actual.
  - **CA-2.8** — Un job iniciado sobre fingerprint A termina después de crear fingerprint B: A queda registrado, B permanece sin certificar hasta su propia verificación.
- **RF-2.9** — WHILE exista cualquier tarea, revisión, fix, QA, job o gate no terminal, THE estado del ciclo SHALL ser `IN_PROGRESS` y el interlock SHALL impedir cierre; el ciclo solo SHALL terminar como `COMPLETE` o como bloqueo real que requiere decisión/autoridad externa, con evidencia.
  - **CA-2.9** — Escenarios controlados dejan pendiente cada clase de trabajo por turno; ninguno emite cierre y todos continúan desde el journal al recuperar control.
- **RF-2.10** — THE journal, logs y transiciones SHALL escribirse atómicamente, limitar retención/salida y redactar secretos conforme a reglas provider-neutral.
  - **CA-2.10** — Interrupción durante escritura no produce un registro parcialmente válido; fixture con secretos conocidos demuestra redacción y política de retención sin truncar el veredicto.
- **RF-3.1** — WHEN un plan declara el campo de complejidad en una tarea, THE controlador SHALL aplicar la selección de modelo correspondiente al implementador de esa tarea únicamente, y SHALL NOT aplicarla a ningún revisor.
  - **CA-3.1** — En runtime con soporte: evidencia durable/versionada del ciclo muestra implementador en el modelo del tier y revisores en el modelo pleno.
- **RF-3.2** — IF el runtime no soporta selección de modelo por despacho, THEN THE controlador SHALL completar el ciclo ignorando el campo y registrando el no-op en la evidencia.
  - **CA-3.2** — En el provider sin soporte identificado por R0: el mismo plan ejecuta de punta a punta; la evidencia registra el no-op.
- **RF-3.3** — IF una tarea no declara el campo, THEN THE comportamiento SHALL ser idéntico al actual (retrocompatibilidad).
  - **CA-3.3** — Un plan pre-existente (sin el campo) ejecuta sin diferencia observable atribuible al tiering.
- **RF-4.1** — WHEN un plan declara dos o más tracks sin intersección de archivos, dependencias o recursos compartidos conocidos AND el runtime ofrece aislamiento por worktree, THE controlador SHALL poder ejecutarlos en paralelo, cada uno en su worktree/branch con ownership explícito.
  - **CA-4.1** — Un plan real de dos tracks independientes ejecuta en paralelo; el diff final es equivalente al de la ejecución serial del mismo plan.
- **RF-4.2** — IF el aislamiento no está disponible, existe solapamiento conocido o un track modifica fuera de su ownership, THEN THE ejecución SHALL detener paralelismo y reconciliar/serializar — nunca continuar en paralelo sobre árbol o recurso compartido.
  - **CA-4.2** — Mismo plan sin aislamiento ejecuta serial según eventos del scheduler; el test no depende de que el repositorio esté limpio de cambios deliberados.
- **RF-4.3** — THE verificación de independencia SHALL comparar declaración previa y archivos/recursos reales modificados, y SHALL ejecutar un gate de integración después de reunir los tracks.
  - **CA-4.3** — Un track que toca lockfile, manifest, migración, snapshot, generado o archivo no declarado compartido invalida el paralelismo aunque `Files:` iniciales fueran disjuntos.
- **RNF-T.1** — (transversal) THE optimización SHALL preservar la capacidad de detección de defectos del proceso: ninguna etapa de revisión eliminada ni fusionada, y la métrica de no-regresión de calidad (DA-1) no empeora en la ventana de medición acordada.
  - **CA-T.1** — Comparación de la métrica DA-1 entre ciclos pre- y post-cambio, sobre desarrollos reales.
- **RNF-T.2** — (transversal) THE framework SHALL declarar, para cada capacidad nueva, su comportamiento en cada uno de los tres providers (soportado / degradado explícito), verificado contra la matriz de capacidades de R0 — nunca "no probado".
  - **CA-T.2** — Cada estado declarado enlaza evidencia E2E reproducible por provider; nombrar el provider en documentación sin ejecución no satisface el criterio.
- **RNF-T.3** — (transversal) THE sets de referencia de sensores SHALL contener exclusivamente clases genéricas de defecto, reutilizables entre proyectos — jamás reglas nacidas de un bug puntual (doctrina existente del framework).
  - **CA-T.3** — Revisión del set de referencia entregado: cada entrada nombra una clase, ninguna referencia a un proyecto específico.
- **RNF-T.4** — (transversal) THE ciclo SDD SHALL dejar rastro suficiente (timestamps, evidencia de gates) para derivar la duración por fase de un ciclo sin instrumentación manual, de modo que N1 sea medible contra el baseline.
  - **CA-T.4** — De un ciclo real post-cambio se deriva la tabla de duración por fase usando solo artefactos persistidos.
- **RNF-T.5** — (transversal) THE ciclo SHALL conservar liveness y reanudación con una semántica única en todos los providers; adaptadores específicos MAY expresar primitivas distintas pero SHALL NOT cambiar estados, veredictos ni gates.
  - **CA-T.5** — La misma batería E2E de interrupción, job largo, resultado tardío e interlock corre en cada provider soportado y enlaza evidencia reproducible; documentación sin ejecución no satisface el CA.
- **RNF-T.6** — (transversal) THE duración SHALL ser una señal de observabilidad, nunca un veredicto terminal; ningún timeout fijo SHALL matar, fallar o descartar una verificación viva.
  - **CA-T.6** — Fixtures con duraciones variables y periodos sin output completan sin corte; solo exit/veredicto real produce `pass` o `fail`.
- **RNF-T.7** — (transversal) THE runner SHALL ser idempotente por fingerprint + digest de comando y SHALL impedir ejecuciones activas duplicadas.
  - **CA-T.7** — Solicitudes concurrentes idénticas reciben el mismo job/evidencia; una reejecución autorizada queda enlazada y justificada.
- **RNF-T.8** — (transversal) THE fixtures y evidencia de aceptación SHALL estar versionados, sanitizados y acompañados de hash/comando de reproducción; ningún CA SHALL depender exclusivamente de transcripts, ledgers o estado local invisible.
  - **CA-T.8** — Un checkout limpio reproduce las aceptaciones sin acceso a la sesión que diseñó o implementó el cambio.
- **RNF-T.9** — (transversal) THE optimización SHALL medir por ciclo wall time, tokens por rol, despachos y cantidad de ejecuciones mecánicas, separando input/output/cache cuando el provider lo exponga.
  - **CA-T.9** — Tras la ventana acordada en DA-1, el reporte compara baseline y ciclos posteriores con la misma metodología y declara cualquier dimensión no observable, sin inventar equivalencias entre providers.

## Open Decisions

| ID | Decision | Blocks | Known Positions |
|----|----------|--------|------------------|
| DA-1 | Métrica de no-regresión de calidad y ventana de medición: ¿capacidad de detectar defectos conocidos/controlados? ¿bugs escapados post-merge? ¿ambos? ¿cuántos ciclos/días? | Release 1 | (a) batería de defectos controlados por ciclo; (b) bugs escapados post-merge, ventana de 30 días; (c) combinación (propuesta; el conteo bruto de hallazgos QA no prueba calidad por sí solo) |
| DA-2 | ¿La degradación a no-op reportado satisface el criterio del dueño "funcional en todo o no sirve" para el tiering de modelo, o el tiering se retiene hasta que los tres providers soporten selección nativa? | Release 4 | (a) no-op reportado es aceptable (la intención viaja en el plan, agnóstica); (b) retener hasta soporte pleno confirmado por R0 |
| DA-3 | Aislamiento por worktree para paralelismo: ¿requisito duro (sin worktree no hay feature) o fallback a serial aceptable como degradación? | Release 5 | (a) fallback a serial (propuesto: el plan sigue siendo válido en los tres providers); (b) requisito duro |
| DA-4 | ¿Dónde viven los sets de referencia de sensores y quién los mantiene? | Release 2 | (a) dentro de cada sensor-pack del registry baseline, mantenidos con el pack (propuesto); (b) archivo separado por stack en el registry; (c) en el CLI |
| DA-5 | Umbral de la detección empírica: ¿cuántos hallazgos convergentes manuales de una clase disparan el reporte de "sensor faltante"? | Release 3 | Configurable con default (propuesto: cluster convergente de ≥2, alineado con `--min 2` de `awm ledger recurring`) |
| DA-6 | ¿La detección solo reporta el gap, o además sugiere la remediación (comando/config propuesto, sin ejecutarlo)? | Release 2 | (a) reporte + sugerencia no ejecutada (propuesto); (b) solo reporte |

## Out of Scope

- **Fusionar o eliminar etapas de revisión** (spec-compliance + code-quality en un solo despacho, o menos lentes de QA): evaluado durante el diagnóstico y retirado con evidencia — el review de calidad atrapó un bug real en código que el plan especificaba verbatim; revisar transcripción atrapa defectos de planificación.
- **Auto-instalar o auto-configurar sensores**: la detección reporta (y a lo sumo sugiere, según DA-6); aplicar cambios de configuración es siempre acción del dueño. `~/.awm` no se toca.
- **Cambiar la composición del panel de QA** (lentes, tracks A/B) o el ciclo TDD: fuera de esta optimización.
- **Instrumentación remota o pesada de telemetría**: journal, job state, heartbeat y log local son parte funcional de PR-2; no se incorpora un servicio remoto, collector externo ni plataforma de métricas.
- **Matar automáticamente verificaciones lentas**: la duración no es prueba de fallo. Diagnóstico, cancelación y reemplazo siguen el contrato de PR-2; no se introduce timeout terminal oculto por stack, comando o provider.
- **Semántica exclusiva de un provider**: adaptadores pueden traducir primitivas, pero ninguna capacidad, estado o gate puede existir solo para un runtime ni alterar el resultado según cuál lo ejecute.
- **Optimizar el costo del plan mismo** (`writing-plans` tardó 13 min en el baseline): fuera de alcance; este brief cubre ejecución, QA y sus gates.

## Releases

El orden es por valor de negocio: primero lo que reduce el dolor de N1 en *todos* los ciclos futuros (incluidos los que implementan el resto de este brief) y cierra el hueco de calidad observado; después la capacidad nueva; al final lo condicionado a decisiones abiertas y a la matriz de R0.

### Release 0 — Descubrimiento (read-only)

- **Value:** independiente por sí mismo: la matriz de capacidades por provider (selección de modelo, despacho paralelo, worktrees, espera/polling, terminación, recuperación y mecánica de gates), el mapeo conceptual→real de sensor-packs/ledger y el estudio portable de runner/fingerprint definen la forma segura de R1–R5.
- **Scope:** verificación de todo lo listado en el Non-Assumption Mandate. Sin escritura de código ni datos.
- **Blocked by:** none.
- **Acceptance:** matriz reproducible por provider con versión/fecha/fuente/comando + límites de concurrencia/contexto/filesystem + comportamiento ante interrupción/final con trabajo vivo + mapeo conceptual→real + especificación reproducible de fixtures para job largo/sin output/orphaned/fingerprint + contradicciones encontradas + plan técnico provider-neutral validado por el dueño.

### Release 1 — Controlador durable + runner + gate de verificación (core)

- **Value:** hace delegable el ciclo: preserva estado/resultados aunque un agente o turno desaparezca, tolera verificaciones de duración arbitraria sin cortarlas, evita cierres/veredictos perdidos y elimina ejecuciones mecánicas duplicadas por fingerprint — continuidad y *subida* de calidad sin quitar ninguna verificación.
- **Scope:** RF-2.1–RF-2.10 · RNF-T.1, RNF-T.4–RNF-T.9. (CLI: journal, runner, estados e interlocks · Registry: skill SDD + prompts + contrato de consumo.)
- **Blocked by:** DA-1 (la aceptación necesita la métrica de no-regresión definida).
- **Acceptance:** CA-2.1–CA-2.10, CA-T.1, CA-T.4–CA-T.9 — fixtures deterministas + ciclo SDD real por provider; la duración nunca es timeout terminal y el cierre nunca depende de memoria conversacional.

### Release 2 — Detección estática de cobertura de sensores (core, mitad 1)

- **Value:** el dueño puede preguntarle al framework "¿qué clases de defecto no tienen detector acá?" y recibir una respuesta accionable — elimina en origen la clase de desperdicio "estilo escalando a revisores" en cualquier proyecto, no solo el diagnosticado.
- **Scope:** RF-1.1, RF-1.4, RF-1.5 · RNF-T.2, RNF-T.3. (CLI: comando de reporte · Registry: sets de referencia por pack.)
- **Blocked by:** DA-4, DA-6.
- **Acceptance:** CA-1.1, CA-1.4, CA-1.5, CA-T.2, CA-T.3.

### Release 3 — Detección empírica de cobertura (core, mitad 2)

- **Value:** convierte el ledger en detector de gaps: la recurrencia manual convergente —visible desde v3.4.0— se vuelve señal automática de sensor faltante, cerrando el loop de aprendizaje del harness.
- **Scope:** RF-1.2, RF-1.3 · RNF-T.2. (CLI, sobre la base de Release 2.)
- **Blocked by:** Release 0 + Release 2 + DA-5.
- **Acceptance:** CA-1.2, CA-1.3 — contra fixture sanitizado/versionado derivado del ledger real citado, con hash y comando de reproducción.

### Release 4 — Tier declarativo de modelo (condicionado)

- **Value:** la porción del costo correspondiente a implementadores corre en la capacidad que cada tarea necesita, no en el máximo por defecto; revisores permanecen fuera del tiering y a plena capacidad como red. El ahorro se mide sobre tokens reales por rol, sin atribuirle consumo de revisores que esta release no modifica.
- **Scope:** RF-3.1, RF-3.2, RF-3.3 · RNF-T.2. (Registry: `writing-plans` + skill SDD.)
- **Blocked by:** DA-2 + matriz de capacidades de R0.
- **Acceptance:** CA-3.1, CA-3.2, CA-3.3 — CA-3.1/3.2 ejecutados en los providers que la matriz de R0 marque como soportado/no-soportado respectivamente.

### Release 5 — Paralelismo entre tracks independientes (condicionado)

- **Value:** planes con tracks genuinamente independientes (caso real medido) dejan de pagar la suma de sus duraciones y pagan aproximadamente el camino crítico, con independencia previa/posterior verificada, ownership explícito, aislamiento y gate de integración como condiciones.
- **Scope:** RF-4.1, RF-4.2, RF-4.3 · RNF-T.2. (Registry: `writing-plans` + skill SDD.)
- **Blocked by:** DA-3 + matriz de capacidades de R0.
- **Acceptance:** CA-4.1, CA-4.2, CA-4.3.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Contradicciones entre este brief y el sistema real (capacidades de providers, estructura de packs, esquema del ledger) | Retrabajo; diseño inaplicable en algún runtime | Mandato de no-asunción + R0 read-only antes de todo compromiso; releases 4–5 explícitamente condicionados a la matriz |
| Baseline de n=1 sesión: los ahorros estimados pueden no generalizar | Expectativas infladas; optimizar el caso equivocado | RNF-T.4 hace medibles los ciclos siguientes; DA-1 fija la métrica antes de Release 1; revisar estimaciones tras 2–3 ciclos medidos |
| Presión de optimización erosionando gates con el tiempo ("ya que ahorramos acá, saltemos esto") | Pérdida gradual de N2 — el valor central del proceso | RNF-T.1 como requisito transversal con CA propio; Out of Scope explícito sobre etapas de revisión; tier jamás aplica a revisores |
| Corrupción de estado por concurrencia (incidente real: 7 archivos revertidos por `git checkout` concurrente de subagentes) | Trabajo perdido, evidencia contaminada, difícil de detectar | RF-4.2 (aislamiento o serial, sin tercera opción); RF-4.3 (independencia mecánica); regla ya curada en `AGENTS.md` del CLI |
| Sets de referencia degenerando en reglas específicas de proyecto | Viola la doctrina del framework; convierte hallazgos locales en obligaciones globales | RNF-T.3 con CA de revisión por entrada; doctrina existente citada en Constraints |
| Drift de capacidades entre providers (un runtime agrega/quita soporte tras R0) | La matriz queda obsoleta; degradaciones inesperadas | RNF-T.2 exige comportamiento declarado y verificado por release; re-verificación de matriz al activar releases 4–5 |
| Veredicto de revisor perdido que el gate nuevo no logre atrapar en algún runtime | El hueco que motivó PR-2 persiste parcialmente | CA-2.3 se ejecuta como escenario controlado en cada provider durante la aceptación de Release 1 |
| Verificación legítima muy lenta o silenciosa | Un timeout la corta; se pierde un resultado válido; el agente parece desaparecido | Sin timeout terminal; runner durable; `suspected-stall` observacional; CA-2.1/2.5 y CA-T.6 con duraciones/silencios variables |
| Job realmente colgado permanece vivo indefinidamente | Consumo de recursos y ciclo sin terminar | Diagnóstico read-only, estado visible, política de retención/operación; cancelación o reemplazo solo con autorización humana, nunca falsa finalización |
| Runner/host cae mientras el hijo puede seguir vivo | Doble ejecución o resultado ambiguo | Identidad durable + heartbeat + `orphaned`; no reejecutar hasta demostrar terminación o recibir autorización |
| Resultado tardío aplicado al diff equivocado | Falso verde sobre código no verificado | Fingerprint obligatorio e invalidación tras cualquier mutación; CA-2.8 |
| Journal/log corrupto o con secretos | Reanudación incorrecta o exposición local | Escrituras atómicas, validación de shape, redacción y retención acotada; CA-2.10 |
| Adaptadores divergen entre providers | AWM deja de ser agnóstico y un runtime relaja gates | Contrato único + misma batería E2E por provider; documentación sola no satisface CA-T.5 |
