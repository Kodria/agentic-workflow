# Mejoras al flujo spec-driven de AWM — Design Doc

> **Estado:** Propuesta (NO implementada). Plan de cambios derivado de la auditoría de mercado.
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

**Propuesta — nueva skill cross-cutting `context-compaction-recovery`** (hogar: no hay fase natural; es transversal como `verification-before-completion`).

Contrato de la skill (disparada tras un evento de compaction/auto-compact, o manualmente):

1. **Re-leer las fuentes de verdad:** plan activo en `docs/plans/`, design doc, `awm ledger list` (ítems abiertos).
2. **Reconciliar:** comparar el resumen post-compaction contra esas fuentes; listar cualquier objetivo/ítem abierto/decisión que el resumen haya omitido.
3. **Re-anclar al final del contexto:** re-emitir, como mensaje fresco al *final* del contexto, un bloque compacto con: objetivo actual, sección activa del plan (tarea en curso), ítems abiertos del ledger, e invariantes del CONSTITUTION relevantes.
4. **Continuar** solo después del re-anclaje.

**Integración:**
- `development-process` lista `context-compaction-recovery` en la tabla de Cross-Cutting Skills con trigger "tras cualquier compaction/auto-compact o al retomar una sesión larga".
- `subagent-driven-development`: añadir nota de que **el retorno de cada subagente es un borde de compaction** — el controlador reconcilia el resumen del subagente contra el plan/ledger antes de marcar la tarea completa (ya hay un "ledger gate"; se extiende con "reconciliation gate").

**Tier:** aplica a sesiones largas (umbral: tras el primer compact, o runs con >N tareas). No aplica a sesiones cortas de una tarea.

**Riesgo / caveat:** no sobre-recitar (coste de tokens). Limitar el bloque de re-anclaje a ~objetivo + tarea activa + ítems abiertos, no el plan entero.

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

## Resumen de impacto por skill (en `awm-baseline-registry`)

| Skill | Cambio | Eje |
|-------|--------|-----|
| **`development-process`** | Registrar `context-compaction-recovery` en Cross-Cutting Skills. | 1 |
| **`context-compaction-recovery`** *(nueva)* | Re-anclaje + reconciliación tras compaction, dirigido por ledger/plan. | 1 |
| **`subagent-driven-development`** | Reconciliation gate en retorno de subagente; nota "fresco ≠ neutral"; model/rol separation opcional (2c); usar IDs en spec-reviewer. | 1, 2, 3 |
| **`brainstorming`** | Sección `## Requisitos` en EARS; gate de clarify (cero ambigüedad); spec self-review extendido. | 3 |
| **`writing-plans`** | IDs de requisito por task; self-review → matriz de trazabilidad req→tarea→test. | 3 |
| **`post-implementation-qa`** | Check `analyze` de cobertura pre-QA; IDs como checklist de completitud; evidencia concreta por hallazgo. | 2, 3 |
| **`requesting-code-review`** | Nota "fresco = atenuación, no neutralización; el sensor gana al juicio". | 2 |
| **plantillas de prompt** (`*-reviewer-prompt.md`, `deep-review-prompt.md`) | Exigir evidencia concreta (test/ID de sensor/línea) por hallazgo. | 2 |

---

## Qué NO se propone (alcance excluido, con razón)

- **No** multi-agent debate del mismo modelo como verificador — [13] muestra que no supera a self-consistency a igual cómputo.
- **No** adoptar tooling propietario de spec (Kiro/Spec Kit como dependencia) — se toma la *notación* (EARS) y los *conceptos* (trazabilidad, clarify/analyze), agnósticos y sin tooling.
- **No** separar `design.md` en tres archivos físicos obligatorios — basta una sección de Requisitos durable como cabeza del spec (G6 es baja-media); evitar ceremonia.
- **No** tocar `~/.awm` ni la instalación — todo cambio de contenido va por el flujo registry → tag → `awm update`.

## Próximos pasos sugeridos (no ejecutados)

1. Revisión humana de esta propuesta (priorizar Cambios 3a/3b — mayor palanca, menor coste).
2. Para los cambios aprobados: abrir el ciclo en `awm-baseline-registry` (brainstorming → writing-plans → TDD sobre las skills) en su rama.
3. Validar `context-compaction-recovery` con un escenario real de sesión larga antes de hornearlo en el espinazo.
4. Verificar la metadata de las citas marcadas como "preprint, verificar" antes de cualquier publicación externa del informe.
