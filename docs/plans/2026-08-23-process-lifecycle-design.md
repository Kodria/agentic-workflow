# Ciclo de vida de procesos AWM (`process-lifecycle`) — Design

Origen: [#113](https://github.com/Kodria/agentic-workflow/issues/113) (tracking), que a su vez arrastra **RF-4.1 / CA-4.1** del [brief de orquestadores declarados](2026-08-21-registry-declared-orchestrators-brief.md) como requisito heredado no satisfecho. Incorpora [#119](https://github.com/Kodria/agentic-workflow/issues/119) (fase de documentación) y [#120](https://github.com/Kodria/agentic-workflow/issues/120) (observabilidad desde el Dashboard) como alcance, no como trabajo paralelo.

Metodología seleccionada en `technology-evaluator` (modo contextual): **HTA** (Annett & Duncan 1967) como espina, con **Workflow Patterns** acotado a **WCP16 Deferred Choice** y **WCP18 Milestone** como complemento obligatorio, y **SIPOC** (Inputs/Outputs/Customers) como calentamiento opcional de tres preguntas. Descartadas: BPMN, IDEF0, VSM, SOP/ISO 9001. **CTA** descartada para R1 pero marcada para R3.

Forma y ubicación del artefacto decididas en `architecture-advisor` (modo contextual): **modelo embebido** — el `SKILL.md` *es* el modelo, bajo contrato de frontmatter. Descartado el sidecar (`process-model.yml` + `SKILL.md` generado) por crear dos fuentes de verdad.

## El problema

R1+R2 de orquestadores declarados entregaron el **mecanismo** para que un registry aporte un orquestador. El **método de autoría** (RF-4.1) se entregó como guía markdown — material de lectura, el estándar más bajo que AWM se aplica a sí mismo en cualquier otra parte.

El antipatrón, nombrado: `development-process` no es una guía sobre cómo desarrollar, es un skill que rutea. `writing-skills` no es una guía sobre cómo escribir skills, es un skill con ciclo verificable. Pero *"cómo crear un proceso"* quedó en markdown estático.

Dos datos lo confirman empíricamente, y ninguno es hipotético:

1. **La guía ya está desincronizada del código** ([#111](https://github.com/Kodria/agentic-workflow/issues/111)): omite el bloque `orchestrator` que R2 lee.
2. **CA-4.1 nunca se ejecutó** — *"una persona ajena al CLI sigue el método y produce un registry instalable"*. El primer autor real se habría estrellado contra (1).

El riesgo que esto cierra no es el obvio ("skills mal escritas") sino el inverso: **skills impecables que no componen.** `writing-skills` enseña a escribir un skill *standalone*; una skill de fase adquiere obligaciones por pertenecer a un proceso — su disparador debe encender dentro del proceso y **no** fuera, debe leer/escribir los markers sobre los que el orquestador gatea, debe terminar nombrando sucesor, hereda gates. Ya nos mordió: `using-awm` lleva un parche `<SUBAGENT-POLICY>` con lista de exclusión explícita, porque skills bien escritas siguiendo `writing-skills` al pie de la letra **disparaban fuera de orden al componerse**.

## Requirements

Trazabilidad: cada `R#` referencia su origen (`#113` decisión N, `#119`, `#120`, o el brief padre).

**R1 — Contrato del modelo durable**

- **R1.1** — EL modelo durable de un proceso SHALL ser el propio `SKILL.md` del orquestador, sin artefacto sidecar separado. *(#113 · consulta de arquitectura)*
- **R1.2** — EL modelo SHALL declararse mediante el discriminador literal `awm: process-model` en frontmatter, y ningún consumidor SHALL inferir que un documento es un modelo de proceso a partir de su cuerpo, sus headings o su nombre de archivo. *(#113 · decisión de discriminador)*
- **R1.3** — EL campo `schema` SHALL ser un entero que solo crece, y todo consumidor SHALL conservar la capacidad de leer y evaluar cualquier valor de `schema` anterior al suyo. *(disciplina heredada de `brief-contract`)*
- **R1.4** — SI un consumidor encuentra un `schema` superior al que conoce, ENTONCES SHALL detenerse e informar que el documento requiere un registry más nuevo, y SHALL NOT interpretarlo como si fuera el contrato anterior. *(disciplina heredada de `brief-contract`)*
- **R1.5** — EL cuerpo del modelo SHALL contener las secciones `## Objetivo`, `## Cuándo aplica`, `## Estructura`, `## Ruteo`, `## Terminación` y `## Sin verificar`, cada una con su esquema de IDs estables. *(#113 · HTA + contrato mínimo)*
- **R1.6** — LA sección `## Estructura` SHALL expresar la descomposición jerárquica como subobjetivos `SG-#` y operaciones `OP-#`. *(HTA)*
- **R1.7** — LA sección `## Ruteo` SHALL expresar cada transición con las columnas *Cuándo* (condición disparadora), *Estado requerido* (hito habilitante, vacío si no hay), *Va a* y *Termina en*. *(HTA plans + WCP18)*
- **R1.8** — LAS filas de `## Ruteo` SHALL evaluarse al momento de llegar a la decisión, leyendo el estado real del proyecto, y SHALL NOT precomputarse. *(WCP16 Deferred Choice)*
- **R1.9** — EL campo `status` SHALL admitir exactamente `draft` y `active`; un modelo recién creado SHALL inicializarse en `draft`, y SHALL promoverse a `active` únicamente como resultado del ciclo de verificación de R3. *(#113 · escritor único, disciplina heredada de `readiness-gate`)*
- **R1.10** — EL contrato SHALL rechazar credenciales y secretos: ningún campo del modelo los admite ni los presupone. *(brief padre · frontera personal/corporativo)*

**R2 — Elicitación y creación**

- **R2.1** — CUANDO el ciclo de vida se invoque para crear un proceso nuevo, EL sistema SHALL preguntar primero en qué registry vive el proceso, antes de elicitar contenido alguno. *(#113 · consulta de arquitectura)*
- **R2.2** — EL sistema SHALL escribir el modelo directamente en el working copy del registry destino, y SHALL NOT escribirlo en el árbol versionado del repositorio de trabajo actual. *(#113 · aislamiento; brief RNF-T.3)*
- **R2.3** — EL sistema SHALL rechazar escribir cualquier ruta bajo `~/.awm`, informando que el contenido se edita en el clon del registry. *(CLAUDE.md — territorio del instalador)*
- **R2.4** — EL sistema SHALL conducir la elicitación como entrevista conversacional jerárquica: objetivo, subobjetivos, operaciones, y las condiciones que disparan cada uno. *(HTA)*
- **R2.5** — EL sistema SHALL dejar de descomponer una operación cuando esa operación pueda ser una skill invocable. *(#113 · mitigación del riesgo nombrado de HTA)*
- **R2.6** — CUANDO exista un modelo con `status: draft` en el registry destino, EL sistema SHALL retomarlo leyéndolo, y SHALL NOT pedir al usuario que vuelva a relatar el proceso. *(#113 · trazabilidad entre sesiones)*
- **R2.7** — EL sistema SHALL delegar todo craft de escritura de skills a `writing-skills` mediante `REQUIRED SUB-SKILL`, y SHALL NOT reexplicarlo. *(#113 · contrato de delegación)*
- **R2.8** — EL sistema SHALL aportar el overlay de obligaciones que una skill adquiere por ser fase de un proceso — disparador acotado al proceso, lectura/escritura de markers, terminación nombrada, herencia de gates, lectura de modo — y ese overlay SHALL vivir dentro del ciclo de vida, no dentro de `writing-skills`. *(#113 · decisión abierta 2, resuelta)*

**R3 — Generación y verificación**

- **R3.1** — CUANDO el modelo esté completo, EL sistema SHALL generar el orquestador, la declaración en `awm-registry.json`, el bundle y las skills de fase, en loop dirigido con aprobación por fase. *(#113 · alcance (c))*
- **R3.2** — EL bloque `orchestrator` de `awm-registry.json` SHALL derivarse del modelo — `name` de `name`, `appliesWhen` de `## Cuándo aplica`, `terminatesTo` de `## Terminación` — y SHALL NOT mantenerse como dato editado por separado. *(#113 · cierra #111 por construcción)*
- **R3.3** — SI `entry_point` es `false`, ENTONCES EL sistema SHALL NOT emitir bloque `orchestrator` alguno. *(derivado de R3.2)*
- **R3.4** — EL sistema SHALL verificar el nombre del proceso contra el contenido ya instalado antes de escribir, para no producir un registry que `awm registry add` rechace por colisión. *(guía §6 · `cli/src/commands/registry/add.ts`)*
- **R3.5** — EL ciclo de verificación SHALL llegar a confirmar que el orquestador aparece efectivamente compuesto en una sesión real, y SHALL NOT cortar en "el registry instaló". *(#113 · decisión abierta 6, resuelta)*
- **R3.6** — CUANDO el ciclo de verificación de R3.5 sea satisfactorio, EL sistema SHALL promover el modelo a `status: active`. *(R1.9)*

**R4 — Modificación y extracción**

- **R4.1** — CUANDO exista un modelo con `status: active`, EL sistema SHALL permitir cargarlo, editarlo y regenerar los artefactos derivados. *(#113 · caso de uso "alterar entero" y "mejora continua")*
- **R4.2** — EL sistema SHALL extraer un modelo desde un proceso ya existente que no fue creado por este ciclo de vida. *(#113 · R2 del tracking; precedente `architecture-extraction`)*
- **R4.3** — CUANDO se extraiga `development-process` al modelo y se regenere, EL resultado SHALL ser equivalente al que está en producción; SI el modelo no puede expresarlo, ENTONCES esa insuficiencia SHALL reportarse como resultado antes de publicar. *(#113 · test de aceptación)*
- **R4.4** — LA fase de documentación entregada en R6 SHALL servir como segundo caso de round-trip, con el mismo criterio de R4.3. *(#113 · decisión 7)*

**R5 — Superficie CLI y observabilidad**

- **R5.1** — EL CLI SHALL exponer `awm process list` y `awm process show --json` como **único** punto de parseo del modelo durable. *(#120)*
- **R5.2** — NINGÚN consumidor — Dashboard incluido — SHALL implementar su propio parser del modelo de proceso. *(#120 · el CLI parsea una vez, el consumidor consume JSON)*
- **R5.3** — EL Dashboard SHALL exponer los procesos declarados mediante un adapter de `DashboardSourceAdapters`, y SHALL NOT derivar sus secciones del proceso activo. *(#120 · opción A)*
- **R5.4** — TODO texto del modelo que provenga de un registry externo SHALL atravesar el límite de sanitización antes de llegar a una superficie de render o de contexto de agente. *(#120; precedente `sanitizeForMarkdown` de R2)*

**R6 — Fase de documentación**

- **R6.1** — EL ciclo de vida de desarrollo SHALL incluir una fase de documentación entre `post-implementation-qa` y `harness-retro`. *(#119)*
- **R6.2** — LA fase SHALL gatearse con el marker `<!-- awm-docs-complete: YYYY-MM-DD -->`, con la misma mecánica que `awm-qa-complete` y `awm-retro-complete`. *(#119)*
- **R6.3** — `classifyPlanState` SHALL reportar `docs_pending` cuando `qaComplete` sea verdadero y `docsComplete` falso, y SHALL conservar `retroComplete → executed` con su significado actual. *(#119 · `cli/src/core/dashboard/plan-state.ts`)*
- **R6.4** — LA fase SHALL verificar la documentación contra el binario real, y SHALL NOT darla por correcta por revisión de prosa. *(`AGENTS.md` — `verify-cmd-source-before-documenting`, `runbook-as-script`)*
- **R6.5** — LA fase SHALL ser resoluble por un agente sin intervención humana, por ser una fase post-plan. *(`CONSTITUTION.md` — Frontera atendido/desatendido)*
- **R6.6** — SI el registry de documentación no está instalado, ENTONCES la fase SHALL correr igual con instrucciones genéricas, y SHALL NOT bloquear el cierre de la rama. *(patrón "sucesor no instalado" del brief padre)*
- **R6.7** — `CONSTITUTION.md` SHALL enunciar la regla apuntando al mecanismo que la hace cumplir, y ese enunciado SHALL NOT ser el único lugar donde la fase existe. *(#119 · lección de #111)*

**R7 — Robustez, frontera y no regresión**

- **R7.1** — SI el ciclo de vida no puede ejecutarse por cualquier causa, ENTONCES SHALL informarlo y continuar sin bloquear al usuario. *(brief RNF-T.1)*
- **R7.2** — EL sistema SHALL producir, en ausencia de modelos de proceso, un comportamiento idéntico al vigente antes de este cambio. *(brief RNF-T.2)*
- **R7.3** — EL sistema SHALL comportarse de forma equivalente en `ubuntu-latest`, `windows-latest` y `macos-latest`. *(brief RNF-T.4)*
- **R7.4** — SI un test de esta funcionalidad se ejecuta, ENTONCES SHALL usar tmpdirs con `HOME` y `AWM_HOME` sobreescritos, y SHALL NOT tocar el `~/.awm` real. *(brief RNF-T.5)*

## Arquitectura

### El artefacto

```yaml
---
awm: process-model
schema: 1
name: <slug>
status: draft | active
entry_point: true | false
terminates_to: <nombre> | none
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

| Sección | Contenido | Origen |
|---|---|---|
| `## Objetivo` | `G` — el goal raíz, un enunciado | HTA |
| `## Cuándo aplica` | el disparador. **Proyecta a `appliesWhen`** | HTA + contrato AWM |
| `## Estructura` | `SG-#` subobjetivos → `OP-#` operaciones | HTA |
| `## Ruteo` | tabla `Cuándo \| Estado requerido \| Va a \| Termina en` | HTA *plans* + WCP16 + WCP18 |
| `## Terminación` | exactamente un sucesor. **Proyecta a `terminatesTo`** | contrato AWM |
| `## Sin verificar` | lo asumido y no confirmado | disciplina de `product-brief` |

*Estado requerido* es WCP18: vacío significa "sin hito". WCP16 no es columna sino regla de evaluación (R1.8).

**Por qué embebido y no sidecar.** Un sidecar garantiza el drift: alguien edita el `SKILL.md` a mano y el modelo se pudre. Es #111 estructuralizado. El modelo embebido tiene cero drift por construcción, y convierte el round-trip de "regenerar" en "parsear" — el archivo que se envía sigue siendo el mismo, así que la equivalencia de R4.3 es verificable en vez de aspiracional.

**Por qué discriminador propio y no `mode:` del `brief-contract`.** Ese contrato enumera consumidores de forma normativa y obliga a `readiness-gate` a parsear todo `schema` anterior para siempre. Un `mode:` con cero secciones de cuerpo compartidas y cero consumidores compartidos infla un contrato que otra skill carga eternamente. Se reusa la **disciplina** (discriminador y no heurística, `schema` que solo crece, escritor único del campo que promociona, trazabilidad por ID), no el **namespace**.

### El punto de intersección con `writing-skills`

```
process-lifecycle ──delega──► writing-skills
   (composición)                (craft unitario)
        │
        └── overlay: las obligaciones que una skill
            adquiere al ser fase de un proceso
```

Ejes ortogonales, verificado contra el archivo: `grep -niE 'orchestrat|handoff|marker|gate|termination|phase'` sobre `writing-skills/SKILL.md` (660 líneas) devuelve **4 líneas, y ninguna es sobre composición**:

| Línea | Qué es |
|---|---|
| 287 | `requirement markers` — la sintaxis de `REQUIRED SUB-SKILL`, o sea cómo referenciar textualmente otro skill |
| 605 · 610 · 622 | `RED / GREEN / REFACTOR Phase` — el ciclo TDD para escribir *un* skill |

Cero cobertura de composición: ni orquestación, ni handoff, ni markers de estado, ni gates, ni terminación. *(Corrige el conteo "una sola coincidencia" que arrastraba #113 desde la exploración inicial; el número era otro, la conclusión es la misma y más fuerte.)* Fusionarlos produciría un artefacto de +1000 líneas que viola la regla de eficiencia de tokens que `writing-skills` predica.

El overlay vive **dentro del ciclo de vida** (R2.8): meterlo en `writing-skills` hace pagar su peso a todos los que solo escriben una skill suelta.

### Empaque

Bundle nuevo `process`, con `dependsOn: ["authoring"]`, **ambos a `baseline`**.

Si el ciclo de vida fuera a `baseline` y `writing-skills` quedara en `project`, baseline entregaría un skill cuyo `REQUIRED SUB-SKILL` no está instalado — exactamente la degradación "sucesor no instalado", para todos los usuarios. La nota *"enable only in the agentic-workflow repo"* del bundle `authoring` queda **stale**: R1+R2 convirtieron la autoría en actividad de usuario final.

### Estado verificado del sistema

Todo lo de esta sección se leyó del código, no se supuso.

**Contrato mecánico que el CLI ya verifica:**

| # | Requisito | Evidencia |
|---|---|---|
| 1 | Bloque `orchestrator` de exactamente 3 campos, strings no vacíos, ≤500 chars, sin campos extra | `cli/src/core/orchestrators.ts` |
| 2 | `skills/<name>/SKILL.md` existe. **El nombre del directorio gana** — el `name` del frontmatter no participa del descubrimiento | `cli/src/core/discovery.ts` |
| 3 | Bundle en `catalog.json` + `bundle.json`; `--install-all` en modo no interactivo | guía §6 |
| 4 | Sin colisión de nombres contra contenido instalado (revierte el clon) | `cli/src/commands/registry/add.ts` |

**La cadena de markers está codificada, no es prosa** — `cli/src/core/dashboard/plan-state.ts`:

```ts
if (markers.retroComplete) return 'executed';
if (markers.qaComplete)    return 'retro_pending';
if (tasks.total > 0 && tasks.completed === tasks.total) return 'qa_pending';
```

con `assertKeys(input.markers, 'markers', ['qaComplete', 'retroComplete'])`, que **tira excepción ante una clave desconocida**.

**El contrato de secciones del Dashboard está enumerado en siete lugares**, uno de ellos una aserción de igualdad exacta:

| Lugar | Qué enumera |
|---|---|
| `cli/src/core/dashboard/types.ts:12` | el union `DashboardSectionV1['id']` |
| `cli/src/core/dashboard/types.ts:26` | `PROJECT_SECTION_IDS` |
| `cli/src/core/dashboard/validate.ts:3` | `SECTION_ORDER` (allowlist del validador) |
| `cli/src/core/dashboard/render-html.ts:67` | `stageSections` |
| `cli/src/core/dashboard/sanitize.ts:4` | `ALLOWED_KEYS` — **incluye `qaComplete`/`retroComplete`**, así que un marker nuevo que no se agregue acá se descarta en silencio |
| `cli/tests/core/dashboard/collect.test.ts:49` | `expect(...).toEqual([...])` — igualdad exacta sobre la lista ordenada |
| `cli/tests/core/dashboard/contracts.test.ts:18` | fixture de contrato |

**Consecuencia de diseño:** agregar una sección no es una línea. La lista es un contrato ordenado con aserción exacta, así que cambiarla **bumpea `DashboardSnapshotV1.schema` a 2**, y ese bump se hace **una sola vez**: R6 agrega `docs` y `processes` juntos, con `processes` en `availability: 'not_applicable'` hasta que R1 lo pueble. `not_applicable` ya es un valor de primera clase del contrato, diseñado exactamente para "esta sección no aplica acá" — no es código muerto, es una declaración honesta.

### Por qué la fase de documentación va entre QA y retro

| Razón | Detalle |
|---|---|
| Preserva la semántica | `retroComplete → executed` sigue significando terminal. Después de retro, `executed` cambia de significado y rompe a todo consumidor de `classifyPlanState` |
| Coherente con el skill | `harness-retro` se auto-describe como *"the terminal learning phase of development-process"* |
| Convierte el drift en aprendizaje | Un hueco de documentación entra al ledger y `harness-retro` lo cura, en vez de perderse |
| Desatendido-seguro | Es resoluble por un agente solo, que es lo que `CONSTITUTION.md` → "Frontera atendido/desatendido" exige de toda fase post-plan |

## Releases

Ordenados por valor entregado, no por dependencia técnica.

### R0 — Fase de documentación

**Valor productivo independiente:** desde el merge, toda tarea de AWM termina documentada y la documentación de usuario final deja de derivar en silencio. No requiere nada de R1–R3.

Cubre R6.1–R6.7 y el bump de `schema` del snapshot. Se implementa a mano — el ciclo de vida todavía no existe — y por eso mismo **se convierte en el segundo caso de round-trip de R2** (R4.4): el constructor tendrá que poder reproducir un resultado que ya está en producción.

Criterios de aceptación:
- **CA-0.1** — un plan con QA completa y documentación pendiente reporta `docs_pending` en `awm doctor --full`.
- **CA-0.2** — la fase corre en modo desatendido de punta a punta, sin pausas, en un ciclo real.
- **CA-0.3** — con el registry de documentación ausente, la fase corre igual y la rama cierra.

### R1 — Modelo durable, creación, generación y verificación

Cubre R1.\*, R2.\*, R3.\*, R5.\*, R7.\*.

Criterios de aceptación:
- **CA-1.1** *(heredado, nunca ejecutado)* — con un registry de prueba instalado, iniciar una sesión **real** y comprobar que el orquestador aparece entre los considerados.
- **CA-4.1** *(heredado, nunca ejecutado)* — una persona ajena al CLI sigue el método y produce un registry instalable. **Verificable con persona real, no simulación.**
- **CA-1.2** — `awm process list` reporta el proceso; `awm process show --json` emite el modelo parseado.
- **CA-1.3** — el Dashboard muestra la sección `processes` poblada por el adapter, sin parser propio.
- **CA-1.4 — demo de aceptación** — declarar el orquestador del proceso personal en [`Kodria/awm-personal-registry`](https://github.com/Kodria/awm-personal-registry), hoy 3 skills sueltas sin `awm-registry.json` ni declaración. Es el consumidor que motivó el proyecto entero.

### R2 — Extracción

Cubre R4.2–R4.4. Desbloquea `development-process` y `product-process` como sujetos.

- **CA-2.1** — round-trip sobre `development-process`: extraer → modelo → regenerar → equivalencia con producción.
- **CA-2.2** — round-trip sobre la fase de documentación de R0.

### R3 — Captura retrospectiva

Conversación → modelo (*"guardá lo que hicimos como proceso"*). Otro adaptador de entrada, mismo destino. Acá entra **CTA / Critical Decision Method**, descartada para R1 por capturar conocimiento tácito de expertos en vez de estructura de proceso — que es justamente lo que una captura retrospectiva necesita.

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El round-trip prueba que el modelo es insuficiente | El contrato de R1 habría que revisarlo con documentos ya en circulación | R2 es release aparte: fallar el round-trip es un **resultado que se reporta** (R4.3), no un bloqueo de R0/R1. Y R1.3/R1.4 dejan la puerta del `schema` abierta desde el día uno |
| La descomposición HTA no tiene criterio natural de parada | Modelos infinitamente anidados, inusables | R2.5 — una operación deja de descomponerse cuando puede ser una skill invocable. Criterio de AWM, no de HTA, y verificable |
| Inyección vía contenido de un registry externo | El modelo llega al contexto del agente y a superficies de render | R5.4 + el límite de sanitización que R2 de orquestadores ya estableció (`sanitizeForMarkdown`, incluidos `<>` tras el hallazgo de QA) |
| Baseline entrega un skill cuyo `REQUIRED SUB-SKILL` no está instalado | Degradación para todos los usuarios | Bundle `process` con `dependsOn: ["authoring"]`, ambos `baseline` |
| Tocar el contrato de secciones del Dashboard dos veces | Dos bumps de `schema`, dos rondas de actualización de siete puntos de enumeración | Un solo bump en R0, con `processes` en `not_applicable` hasta R1 |
| El constructor escribe bajo `~/.awm` al modificar `development-process` | Violación directa de `CLAUDE.md` | R2.3 — rechazo duro de rutas bajo `~/.awm`, no convención |

## Fuera de alcance

- **DA-4 del brief padre** (capa O1: predicado determinista evaluado por el framework en vez de juicio del agente sobre prosa). Abierta y **diferida a propósito**; aditiva por diseño. Vive en el brief, no acá.
- **Runtime de sesión con estado y eventos, concurrencia entre sesiones, bandeja de captura.** Fuera de alcance del brief original por decisión explícita. Brief propio.
- **Secciones del Dashboard derivadas del proceso activo** (opción B de #120). El snapshot dejaría de tener forma estable, rompiendo render, fixtures y comparabilidad entre proyectos.
- **Migrar `docs/guides/authoring-a-registry-with-an-orchestrator.md` a `docs/`.** Se subordina como `references/` del skill y #111 se arregla ahí (decisión 4), pero el movimiento del archivo se ejecuta en R1, no se diseña acá.
