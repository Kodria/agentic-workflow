# Mejoras al flujo spec-driven de AWM — Design Doc

> **Estado:** Implementado (Cambios 1–4 en `awm-baseline-registry`, distribuidos vía tag + `awm update`). Derivado de la auditoría de mercado.
> **Fecha:** 2026-06-25
> **Sustento:** [`docs/research/2026-06-25-agentic-harness-market-audit.md`](../research/2026-06-25-agentic-harness-market-audit.md)
> **Naturaleza:** Estos cambios tocan **contenido de skills**, que vive en `awm-baseline-registry`
> (ver `CLAUDE.md`). Este doc define el QUÉ y el PORQUÉ; la implementación se hace en el repo de registry,
> con su propio ciclo spec→plan→TDD, y se distribuye vía tag + `awm update`.

## Objetivo

Cerrar tres focos de mejora del arnés, cada uno respaldado por evidencia de mercado verificable, **sin romper el principio de AWM de ser agnóstico al proveedor** y sin convertir el flujo en waterfall pesado. Cada cambio refuerza una fase que **ya existe**; ninguno introduce un subsistema nuevo desde cero.

## Principios de diseño (no-negociables de esta propuesta)

1. **Agnóstico al proveedor.** Nada depende de features propietarias (p.ej. el "dynamic workflow" de Claude). Las primitivas son: archivos, IDs de texto, prompts de subagente, gramática EARS (sin tooling) y los sensores deterministas que AWM ya tiene.
2. **Tier-able, no obligatorio.** Sigue el modelo spine-vs-specialized: la estructura pesada (EARS + IDs + trazabilidad) aplica a features multi-archivo/riesgosas; los diffs triviales la saltean. *(Building Effective Agents: añadir complejidad solo si mejora demostrablemente; Claude Code: saltear plan en diffs de una línea.)*
3. **Curar la fase existente, no apilar skills.** Preferimos editar `brainstorming`/`writing-plans`/`post-implementation-qa` antes que crear skills nuevas, salvo donde no haya hogar natural (Eje 1).
4. **El gate determinista manda.** Donde haya conflicto entre el juicio de un modelo y un sensor/test, gana el sensor. La evidencia del Eje 2 lo exige.

---

## Lo que AWM ya hace bien (no tocar — está validado)

Para evitar regresiones, se documenta explícitamente qué **no** cambiar, porque la investigación lo respalda:

- **Externalización de estado a archivos** (plan docs + ledger por rama) — mitigación primaria de degradación de contexto (Manus, LangChain, Anthropic).
- **Subagentes de contexto aislado** — patrón recomendado (Anthropic, Cognition).
- **Review de contexto fresco** (`subagent-driven-development`, `post-implementation-qa`) — recomendado explícitamente por Claude Code best-practices.
- **Gating por sensores deterministas** (`awm sensors run` como gate de completitud) — es la "verdad externa" que el Eje 2 identifica como lo único que neutraliza el sesgo de forma fiable.
- **Loop de aprendizaje vía ledger → `harness-retro`** — convierte hallazgos en reglas durables.
- **De-a-una-pregunta en `brainstorming`** — espeja el "one question at a time" de Harper Reed.

---

## Cambio 1 — Re-anclaje y reconciliación tras compaction (Eje 1)

**Problema:** El estado durable vive en archivos, pero ningún paso (a) re-inyecta el objetivo al final del contexto tras un compact, ni (b) reconcilia el resumen post-compaction contra el ledger/plan. La compaction descarta los bloques previos de forma irreversible y su resumen aterriza en la región de **menor** atención (inicio de la nueva ventana, "lost-in-the-middle").

**Evidencia:** Lost in the Middle [1]; Context Rot [2]; compaction descarta bloques previos [4]; Gemini CLI es el único que verifica su compaction [5]; recitación de objetivos de Manus [6].

**Propuesta — NO una skill, sino una extensión del hook de SessionStart (corrección de diseño).**

> *Revisión de diseño:* la versión original proponía una **skill** `context-compaction-recovery` que el agente invocaría tras un compact. Eso es frágil: la instrucción de invocarla puede haberse ido *en* la misma compactación, y la recuperación no puede depender de que el agente (recién compactado) recuerde correrla. La recuperación debe ser **determinista, a nivel de hook** — el mismo lugar (y, de hecho, el mismo hook) que ya re-inyecta `use-awm`/CONSTITUTION en cada arranque de sesión. `harness-retro` **no** sirve como mecanismo de recuperación: salta al final del proceso; es la capa de *aprendizaje*, no de recuperación en tiempo real.

**Hecho que lo habilita:** el hook de SessionStart de AWM ya está cableado al matcher `startup|clear|compact` (`cli/src/providers/index.ts`). O sea, **ya dispara en cada compactación**; hoy solo re-inyecta el feedforward estático (use-awm + CONSTITUTION). El hueco de Cambio 1 es el estado **dinámico** de la tarea.

**Arquitectura en tres capas (separadas):**

| Capa | Cuándo | Quién | Qué hace |
|------|--------|-------|----------|
| **Recuperación** | en cada compact, determinista | **hook SessionStart (`source=compact`)** | re-ancla el bloque dinámico de estado canónico |
| **Auditoría** | durante la sesión | **ledger** (`--phase compaction-recovery`) | registra el evento → auditable leyendo el log, sin interrumpir al agente |
| **Aprendizaje** | fin de proceso | **`harness-retro`** | si la pérdida se repite (≥2), cura una regla durable |

**Contrato del re-anclaje** (en `hooks/session-start`, failure-safe / silencioso-en-ausencia, mismo contrato que la inyección de CONSTITUTION):
1. Detectar el **plan activo** de forma file-derived: el plan más reciente en `docs/plans/` (excluyendo design docs) con checkboxes `- [ ]` abiertos y sin marcador de completitud.
2. Si existe, anexar a `additionalContext` un bloque **Re-anchor**: objetivo (`**Goal:**`/título), ítems abiertos del plan, e ítems abiertos de `awm ledger list`.
3. En un borde `compact` genuino, además emitir un `awm ledger add --phase compaction-recovery` best-effort (silencioso si `awm`/ledger ausente) — ese log ES el blanco predecible de auditoría.

**Contra qué se valida (clave):** no contra la memoria del agente, sino contra el **estado canónico derivado de archivos** (checkboxes del plan + `awm ledger list` + marcador de tarea activa). El snapshot que el hook inyecta es el blanco predecible; el ledger es el rastro auditable. La detección de *qué dropeó el resumen* es una operación de **tiempo de auditoría** (comparar el snapshot del ledger contra lo retenido), no algo que el hook calcule en vivo.

**Integración:**
- `subagent-driven-development`: **reconciliation gate** — el retorno de cada subagente es un borde de compaction para el controlador (solo ve el resumen, no el contexto). Antes de marcar la tarea completa, reconciliar el reporte contra IDs de requisito / ítems abiertos / `awm ledger list`; ante desacuerdo, **ganan los archivos**. Es el contrapunto por-subagente del re-anclaje del agente principal.

**Caveat de agnosticismo:** esta es la vía determinista de **Claude Code** (que ofrece el evento de hook en `compact`). Harnesses sin hook de compactación (p. ej. OpenCode, inyección por `config-instructions`) no tienen el mecanismo determinista; para ellos el fallback portable es model-invoked/manual. El **contrato** (re-anclar estado canónico tras compact) es universal; el **mecanismo** es best-effort según la capacidad del harness.

**Riesgo / caveat:** no sobre-recitar (coste de tokens). El bloque se limita a objetivo + ítems abiertos (plan + ledger), no el plan entero; y solo se inyecta cuando hay un plan activo en vuelo.

---

## Cambio 2 — Endurecer el review contra el sesgo de auto-preferencia (Eje 2)

**Problema:** El review de contexto fresco (spec-reviewer, code-quality-reviewer, deep-review de QA) corre en el **mismo modelo** y bajo el **mismo orquestador** que construyó la solución. La evidencia muestra que el contexto fresco **atenúa pero no elimina** el sesgo de auto-preferencia: éste vive en los pesos y sobrevive al blinding.

**Evidencia:** self-enhancement bias [9]; auto-reconocimiento causa auto-preferencia [10]; blinding no elimina [11,12]; auto-corrección sin señal externa es neutra-a-dañina [13,14]; CriticGPT — crítico separado [15]; CAI — crítica anclada a criterio externo [18].

**Propuestas (tres, de menor a mayor coste):**

**2a. Documentar honestamente la limitación + reforzar el gate determinista (barato, alto valor).**
- En `requesting-code-review`, `post-implementation-qa` y `subagent-driven-development`: añadir una nota explícita "**El contexto fresco es atenuación, no neutralización del sesgo. El veredicto del revisor NO puede anular un sensor/test. Ante conflicto entre el juicio del revisor y un sensor determinista, gana el sensor.**"
- Esto formaliza lo que el Eje 2 identifica como la única defensa fiable: la verdad-base determinista (`awm sensors run`, tests).

**2b. Exigir evidencia concreta por hallazgo (barato, ataca alucinaciones del crítico).**
- Los críticos LLM alucinan más bugs/nitpicks que los humanos [15]. En las plantillas de prompt de los revisores (`spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`, `deep-review-prompt.md`): exigir que **cada hallazgo cite evidencia concreta** — test que falla, ID de regla de sensor, o `archivo:línea`. Hallazgos sin evidencia se descartan. *(Ya es parcialmente la cultura de AWM: las reglas viven en config, no en opiniones.)*

**2c. Separación de modelo/rol para reviews críticos de corrección (mayor coste, opcional/tier).**
- `subagent-driven-development` ya tiene "Model Selection". Extenderlo: **el revisor de un task de corrección crítica debería correr en un modelo distinto (otra familia) del implementador cuando esté disponible**, o al menos con rol/prompt distinto y sin acceso al chain-of-thought del implementador.
- Política agnóstica: "si el harness puede despachar el review en otra familia de modelo, hacelo para reviews de corrección críticos; si está limitado a un modelo, apoyarse más fuerte en sensores + checklist EARS (Cambio 3)".
- **No** convertir esto en multi-agent debate del mismo modelo — la evidencia [13] muestra que a igual cómputo no supera a self-consistency.

**Tier:** 2a y 2b son universales (baratos). 2c aplica solo a tasks marcados de corrección crítica.

---

## Cambio 3 — Capa de requisitos: EARS + IDs + trazabilidad (Eje 3)

**Problema (el de mayor palanca):** `brainstorming` produce un `design.md` en prosa que **funde el QUÉ (requisitos) con el CÓMO (diseño)**. No hay criterios de aceptación estructurados, ni IDs de requisito, ni trazabilidad spec→tarea→test. Consecuencia: el TDD no tiene criterios atómicos testeables, y el review de contexto fresco / QA no tienen checklist de completitud que verificar.

**Evidencia:** Kiro 3-artefactos + EARS + trazabilidad [19,20]; Spec Kit spec/plan/tasks + `/clarify` + `/analyze` [21]; EARS cura ambigüedad [23]; el revisor de Claude Code chequea "cada requisito implementado" [29]; ISO 29148 trazabilidad bidireccional [30].

**3a. Sección de Requisitos con EARS en `brainstorming`.**
- El design doc gana una sección **`## Requisitos`** como cabeza durable, *antes* del diseño, con criterios de aceptación en notación EARS. Plantillas:
  - Evento: `WHEN <trigger>, THE <system> SHALL <response>`
  - Estado: `WHILE <precondition>, THE <system> SHALL <response>`
  - No deseado (priorizar): `IF <trigger>, THEN THE <system> SHALL <response>`
- **Sinergia con la doctrina de robustez de AWM:** la plantilla IF/THEN fuerza la especificación de casos borde/error — exactamente la clase de bug (validación de entradas, `Infinity`/`NaN`) que el CONSTITUTION y `harness-retro` ya persiguen. EARS lo mueve *upstream*, al spec, en vez de descubrirlo en QA.
- El "Spec Self-Review" de `brainstorming` (que ya chequea ambigüedad) se extiende: "cada requisito está en EARS y es 1:1 testeable".

**3b. IDs de requisito + trazabilidad en `writing-plans`.**
- Numerar requisitos (`R1`, `R1.1`…) en la sección de Requisitos.
- En `writing-plans`, cada **Task** taggea los IDs que satisface (convención tipo Kiro `_Requisitos: R1.1, R2.3_`). Cada test referencia el ID que verifica.
- El "Self-Review" de `writing-plans` (que ya chequea cobertura de spec) se convierte en una **matriz de trazabilidad explícita**: tabla requisito→tarea→test.

**3c. Gate de clarify en `brainstorming` (G4).**
- Gate de salida del brainstorming: los requisitos pasan una ronda de structured-questioning hasta **cero ambigüedades abiertas** antes de pasar a diseño. `brainstorming` ya hace de-a-una-pregunta; esto añade el gate explícito de no-ambigüedad (análogo a `/clarify` de Spec Kit).

**3d. Check `analyze` de cobertura pre-QA (G5).**
- Paso automatizable (script o checklist) antes de `post-implementation-qa`: **todo ID de requisito tiene ≥1 tarea y ≥1 test; ninguna tarea/test carece de ID**.
- Forward traceability = "¿se construyó/testeó cada requisito?". Backward = "¿hay código/test huérfano?" (= scope creep) — la restricción de "nada de código huérfano" de Harper Reed, hecha verificable.
- `post-implementation-qa` usa los IDs como **checklist de completitud** para su deep-review (cierra el hueco que [29] señala: sin IDs, el revisor de contexto fresco no tiene contra qué medir completitud).

**Tier (G7 — guardrail anti-waterfall):** EARS + IDs + trazabilidad son **obligatorios para features multi-archivo/riesgosas**, **salteables para diffs triviales**. Requisitos tersos (bullets EARS), nunca prosa larga. Mantener la convención de AWM de que "simple no exime de proceso, pero el proceso escala con el riesgo".

---

## Cambio 4 — QA multi-lente, dos pistas (Ejes 2 + 3 — refunde el Type C)

**Problema:** El `post-implementation-qa` actual clasifica hallazgos en **Type B (fidelidad: el plan dice X, el código hace Y)** y **Type C (calidad: bug lógico, caso borde)**. El Type C es un **cubo monolítico**: un solo subagente de deep-review busca "todos los bugs de calidad" en una pasada, y la calidad se mide **anclada al plan**. Dos debilidades:

1. **Una sola lente = un solo modo de falla cubierto.** Un revisor único, con un prompt único, en el mismo modelo que implementó, tiene un punto ciego único. El Eje 2 muestra que redundar el *mismo* crítico no ayuda (blinding no neutraliza el sesgo); lo que ayuda es **diversidad de criterio anclada a algo externo**.
2. **La calidad se evalúa contra el plan.** Pero un bug de robustez (división por cero → `Infinity`) es defecto **independientemente del plan** — que puede ni mencionarlo. El "scope ≠ exemption" ya está parcheado como nota al pie, pero sigue viviendo *dentro* del cubo Type C anclado al plan, en vez de ser un criterio de primera clase.

**Decisión (aprobada):** **disolver el Type C monolítico en un panel de lentes plan-agnósticas.** El Type C se reemplaza — no coexiste. El QA pasa a tener **dos pistas explícitas**:

- **Pista A — Fidelidad (anclada al plan).** Es el actual **Type B**, ahora **dirigido por los IDs de requisito** del Cambio 3: cada `R#` del spec es un ítem de checklist de completitud (¿implementado? ¿testeado?). Forward gap = requisito sin código/test; backward gap = código sin requisito (scope creep). Sin IDs no hay contra qué medir (cierra el hueco que la best-practice de Claude Code [29] señala).

- **Pista B — Calidad (plan-agnóstica, multi-lente).** **Reemplaza al Type C.** En lugar de un cubo "encontrá bugs", un panel de **lentes distintas**, cada una con criterio propio e independiente del plan, despachadas como **subagentes separados** (contexto aislado por lente — la diversidad necesita independencia real, no un solo agente recorriendo una lista):
  - **Lente de robustez/seguridad** — el piso que el scope no exime: `Infinity`/`NaN`/`undefined` silenciosos, crash en borde/entrada inválida, validación en fronteras (la doctrina de robustez de AWM + scope≠exemption, ahora lente de primera clase y no nota al pie).
  - **Lente de corrección lógica** — resultado incorrecto para entrada válida, invariantes rotos, estado inconsistente.
  - **Lente de tests** — ¿cada requisito tiene test? ¿los tests ejercen los casos borde de los criterios `IF/THEN`? ¿hay asserts vacíos o tests que no fallarían nunca?
  - *(extensible/tier: lentes de perf, concurrencia, etc., solo cuando el dominio lo amerita)*

**Por qué multi-lente y no un cubo más grande (evidencia):**
- **Perspective-diverse verify:** cuando un artefacto puede fallar de varias maneras, dar a cada verificador una **lente distinta** (corrección / robustez / tests) atrapa modos de falla que la redundancia del mismo crítico no puede. Es diversidad de *criterio*, no de cantidad.
- **Eje 2 directo:** el sesgo de auto-preferencia sobrevive al contexto fresco [11,12]; lo que lo ataca es anclar la crítica a un **criterio externo** (CAI [18]) y separar el crítico (CriticGPT [15]). Cada lente plan-agnóstica *es* un criterio externo distinto; el cubo monolítico compartía un solo criterio difuso.
- **Eje 3 sinergia:** la Pista A consume los IDs del Cambio 3 como checklist; sin la capa de requisitos, la fidelidad no tiene métrica. Las pistas se refuerzan: A mide "¿está todo lo prometido?", B mide "¿lo que hay es sólido?" — al margen de lo prometido.

**Absorbe el Cambio 2 en la misma superficie (cierra tres ejes en una pasada):** las plantillas de prompt de cada lente heredan las notas anti-sesgo del Cambio 2 —
- **2a** — nota "**el contexto fresco es atenuación, no neutralización; ante conflicto lente-vs-sensor, gana el sensor determinista**" en cada lente.
- **2b** — **evidencia concreta por hallazgo** (test que falla / ID de regla de sensor / `archivo:línea`); hallazgo sin evidencia se descarta — combate la alucinación del crítico LLM [15].

Así, una sola reescritura de `post-implementation-qa` realiza el Eje 3 (Pista A por IDs), el Eje 2 (anti-sesgo en plantillas) y este Cambio 4 (Pista B multi-lente) — **sin tocar la skill tres veces**. Es la razón de plegar estos tres cambios en una edición batch de la skill de QA.

**Tier (anti-waterfall):** el panel completo de lentes aplica a features multi-archivo/riesgosas. Un diff trivial corre **solo la lente de robustez** (el piso nunca se saltea) + la Pista A si hay IDs. No se despachan N subagentes para un cambio de una línea.

**Gate determinista manda (principio 4):** ninguna lente puede declarar "limpio" por encima de un `awm sensors run` rojo; el panel **se suma** al gate de sensores, no lo reemplaza.

**Riesgo / caveat:** N lentes = N subagentes = más tokens. Mitigación doble: el tier (panel pleno solo en cambios riesgosos) y la **deduplicación** de hallazgos solapados entre lentes antes de presentar al usuario (robustez y corrección pueden flaggear el mismo `archivo:línea`).

---

## Resumen de impacto por skill (en `awm-baseline-registry`)

| Artefacto | Cambio | Eje |
|-------|--------|-----|
| **`hooks/session-start`** *(extensión, no skill nueva)* | Re-anclaje determinista del estado canónico (objetivo + ítems abiertos de plan/ledger) en cada `compact`; log `--phase compaction-recovery` al ledger. | 1 |
| **`subagent-driven-development`** | Reconciliation gate en retorno de subagente (el retorno = borde de compaction; ganan los archivos); nota "fresco ≠ neutral"; model/rol separation opcional (2c). | 1, 2 |
| **`brainstorming`** | Sección `## Requisitos` en EARS; gate de clarify (cero ambigüedad); spec self-review extendido. | 3 |
| **`writing-plans`** | IDs de requisito por task; self-review → matriz de trazabilidad req→tarea→test. | 3 |
| **`post-implementation-qa`** | **Reescritura holística (una sola edición):** dos pistas — Pista A (fidelidad por IDs, ex-Type B) + Pista B (panel multi-lente plan-agnóstico que **reemplaza al Type C**); check `analyze` de cobertura pre-QA; evidencia concreta por hallazgo. | 2, 3, 4 |
| **`requesting-code-review`** | Nota "fresco = atenuación, no neutralización; el sensor gana al juicio". | 2 |
| **plantillas de prompt** (`*-reviewer-prompt.md`, `deep-review-prompt.md`) | Exigir evidencia concreta (test/ID de sensor/línea) por hallazgo; `deep-review-prompt.md` se reestructura en plantilla de dos pistas con una lente por subagente. | 2, 4 |

---

## Qué NO se propone (alcance excluido, con razón)

- **No** multi-agent debate del mismo modelo como verificador — [13] muestra que no supera a self-consistency a igual cómputo. *(El panel multi-lente del Cambio 4 NO es debate: cada lente tiene un criterio distinto y plan-agnóstico — diversidad de criterio, no N copias discutiendo.)*
- **No** adoptar tooling propietario de spec (Kiro/Spec Kit como dependencia) — se toma la *notación* (EARS) y los *conceptos* (trazabilidad, clarify/analyze), agnósticos y sin tooling.
- **No** separar `design.md` en tres archivos físicos obligatorios — basta una sección de Requisitos durable como cabeza del spec (G6 es baja-media); evitar ceremonia.
- **No** tocar `~/.awm` ni la instalación — todo cambio de contenido va por el flujo registry → tag → `awm update`.

## Próximos pasos sugeridos (no ejecutados)

**Estado de implementación (en `awm-baseline-registry`):**
1. **Cambio 3** — ✅ capa de requisitos (EARS + IDs + trazabilidad) en `brainstorming`/`writing-plans`/`post-implementation-qa`.
2. **Cambio 4** — ✅ QA dos pistas; el panel multi-lente reemplaza al Type C.
3. **Cambio 2** — ✅ guardas anti-sesgo en toda la superficie de review (QA + `requesting-code-review` + reviewers de `subagent-driven-development`), con separación modelo/rol (2c).
4. **Cambio 1** — ✅ re-anclaje determinista en `hooks/session-start` (`source=compact`) + reconciliation gate en `subagent-driven-development`; auditoría vía ledger.

**Pendiente:**
- **Validación del Cambio 1 en escenario real:** el mecanismo es determinista y testeado (syntax + tests funcionales del hook), pero la *calidad de recuperación* se audita leyendo el ledger (`--phase compaction-recovery`) a lo largo de sesiones reales; no requiere hornear nada más, solo observar el log.
- **Fallback portable del Cambio 1** para harnesses sin hook de compactación (OpenCode): camino model-invoked/manual — aún no escrito.
- Verificar la metadata de las citas marcadas como "preprint, verificar" antes de cualquier publicación externa del informe.
