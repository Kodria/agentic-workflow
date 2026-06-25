# Auditoría de mercado del arnés AWM — contexto, sesgo de auto-auditoría y spec-driven

> **Tipo:** Informe de investigación (evidencia verificable, no opinión).
> **Fecha:** 2026-06-25
> **Alcance:** Sustento empírico, agnóstico al proveedor, para tres preguntas sobre el arnés AWM:
> (1) degradación de contexto y pérdida por compaction; (2) sesgo cuando un agente audita su propio trabajo;
> (3) madurez del flujo spec-driven (`brainstorming` → `writing-plans` → …) frente al estado del arte.
> **Método:** fan-out de búsquedas web + fetch de fuentes primarias + verificación adversarial de cada afirmación.
> Se priorizaron fuentes primarias (papers en arXiv/IEEE, docs y blogs de ingeniería oficiales) sobre agregadores.
> **Design-doc de cambios derivado:** [`docs/plans/2026-06-25-spec-audit-improvements-design.md`](../plans/2026-06-25-spec-audit-improvements-design.md)

---

## Resumen ejecutivo

El espinazo de AWM (`development-process` → `brainstorming` → `writing-plans` → `subagent-driven-development`/`executing-plans` → `post-implementation-qa` → `harness-retro` → `finishing-a-development-branch`) está **bien alineado con el estado del arte**. Tres de sus decisiones de diseño están validadas de forma independiente por la literatura:

1. **Externalizar estado a archivos** (plan docs, ledger por rama) — es la mitigación primaria de degradación de contexto, no una optimización (Manus, LangChain, Anthropic).
2. **Subagentes con contexto aislado** — patrón recomendado para tareas de lectura/investigación (Anthropic, Cognition).
3. **Review con contexto fresco gateado por sensores deterministas** — es exactamente lo que la evidencia dice que funciona contra el sesgo de auto-evaluación (OpenAI CriticGPT, Stechly et al., Anthropic).

Los focos de mejora reales, todos respaldados por evidencia, son:

- **Eje 1 — falta un primitivo de re-anclaje + reconciliación tras compaction.** El estado durable vive en archivos, pero ningún paso re-inyecta el objetivo al final del contexto ni reconcilia el resumen post-compaction contra el ledger/plan. Es el único punto donde el *context rot* y la pérdida irreversible se concentran.
- **Eje 2 — el review con contexto fresco es atenuación, no neutralización.** El sesgo de auto-preferencia vive en los pesos del modelo y sobrevive al "blinding". La cura no es más contexto fresco: es (a) gating por verdad determinista (que ya tenés) y, donde el riesgo lo amerite, (b) separación de modelo/rol del revisor.
- **Eje 3 — la capa de *requisitos* es la más débil.** El flujo funde *qué* (requisitos) dentro del *cómo* (design en prosa). Faltan: artefacto de requisitos separado, criterios de aceptación tipo **EARS**, e **IDs de requisito con trazabilidad** spec→tarea→test. Las tres son baratas y cada una refuerza una fase que ya existe.

---

## Eje 1 — Degradación de contexto y pérdida por compaction

### A. La degradación con la longitud del contexto está medida y es real

- **"Lost in the Middle" (Liu et al., TACL 2024).** En QA multi-documento y recuperación clave-valor, el rendimiento es máximo cuando la información relevante está al **principio o al final** del contexto y **se degrada significativamente cuando está en el medio** (curva en U). Ocurre incluso en modelos de contexto largo. Es el resultado canónico revisado por pares que da nombre al modo de falla. *[1]*

- **"Context Rot" (Chroma Research, 2025).** Sobre **18 modelos** (GPT-4.1, Claude 4, Gemini 2.5, Qwen3), el rendimiento "varía significativamente al cambiar la longitud de entrada, incluso en tareas simples". La degradación empieza **mucho antes** del límite de ventana (es distinta del overflow). Sub-hallazgos: pares semánticos (que requieren inferencia) se degradan más que coincidencias léxicas; **un solo distractor** baja la precisión; incluso una tarea mecánica de replicación de texto cae con la longitud; en LongMemEval, prompts enfocados de ~300 tokens superan a prompts completos de ~113k tokens en la misma pregunta. *[2]*

- **Anthropic formaliza "context rot" como presupuesto de atención (2025).** "A medida que aumenta el número de tokens, la capacidad del modelo de recordar información con precisión disminuye." Causa raíz arquitectónica: cada token atiende a cada otro token (relaciones n²), así que un "presupuesto de atención" finito se reparte cada vez más fino. Conclusión: el contexto "debe tratarse como un recurso finito con rendimientos marginales decrecientes". *[3]*

### B. La compaction/summarization pierde información de forma irreversible

- **La compaction de la API de Claude descarta los mensajes previos (docs oficiales).** El mecanismo, citado: genera un resumen, crea un bloque `compaction` y "**la API descarta automáticamente todos los bloques de mensaje previos al bloque `compaction`**". El resumen es una proyección con pérdida: lo que el resumidor omitió desaparece de la vista del modelo. *[4]*

- **Taxonomía de agentes de código: la compaction es destructiva en todo el ecosistema (arXiv, 2026).** Estrategias de compaction en Aider, OpenHands, Cline, SWE-agent, Gemini CLI, Codex CLI. **Aider** usa "reemplazo destructivo de `done_messages`" (purga irreversible). Crítico: **Gemini CLI es el único agente que valida su propia compaction** — tras resumir, corre un "turno de verificación" que comprueba si se perdió información crítica antes de continuar. Que esto se señale como *único* es evidencia directa de que (a) la pérdida post-compaction es un modo de falla reconocido y (b) un paso explícito de verificación/re-anclaje es una mitigación ya implementada, no teórica. *[5]*

- **Disparo tardío del auto-compact.** El auto-compact tiende a dispararse cerca del ~95% de la ventana — es decir, en la región más "rotada" — y luego resume: doble golpe. La práctica recomendada es compactar proactivamente antes (los analistas sugieren ~60% de llenado). *(El umbral exacto es ingeniería-inversa de la comunidad; el mecanismo "resumir y descartar lo previo" sí está en las docs oficiales [4].)*

### C. Mitigaciones agnósticas que usan otros arneses

- **Recitación / re-anclaje de objetivos (Manus, 2025).** Citado: "Al reescribir constantemente la lista de tareas, Manus está **recitando sus objetivos hacia el final del contexto**… Esto empuja el plan global al rango de atención reciente del modelo, **evitando el problema de 'lost-in-the-middle' y reduciendo la desalineación de objetivos**." Es el hallazgo más cargado para AWM: un agente en producción reescribe deliberadamente sus objetivos al *final* del contexto para contrarrestar exactamente [1]. *[6]*

- **El sistema de archivos como memoria externa persistente (Manus).** Trata el filesystem como "el contexto definitivo": ilimitado, persistente, restaurable. Externalizar estado evita el bloat de contexto. Esto valida que la externalización a archivos de AWM (plan docs + ledger) es una mitigación primaria. *[6]*

- **Contexto single-threaded; no fragmentar entre agentes (Cognition, 2025).** Dos principios: "comparte contexto y trazas completas, no mensajes sueltos" y "las acciones cargan decisiones implícitas, y decisiones conflictivas dan malos resultados". Subagentes en paralelo sobre contexto incompleto toman decisiones conflictivas. Prescripción: agentes lineales single-threaded; subagentes solo para sub-preguntas acotadas de lectura, **nunca escrituras en paralelo**. Caveat para AWM: un subagente que devuelve un resumen hereda el mismo riesgo de pérdida por compaction en el borde del hand-off. *[7]*

- **Tres técnicas de horizonte largo (Anthropic).** (a) **Compaction**: resumir cerca del límite y reinicializar; "maximiza recall primero, luego itera por precisión". (b) **Note-taking estructurado**: memoria externa persistente (p.ej. NOTES.md) recuperada después. (c) **Arquitecturas de subagentes**: agentes de contexto limpio que devuelven resúmenes condensados de 1.000–2.000 tokens. *Nota: la guía de Anthropic NO nombra un paso explícito de "re-anclar el objetivo tras compactar" — ese movimiento es la recitación de Manus [6] y la sonda de Gemini CLI [5]. Es justo el hueco que el arnés puede llenar.* *[3]*

- **Taxonomía Write / Select / Compress / Isolate (LangChain, 2025).** **Write** = guardar fuera de la ventana (scratchpads, memorias). **Select** = traer a la ventana (RAG/retrieval). **Compress** = retener solo lo necesario (summarization/trimming — marcado explícitamente como riesgo de perder detalles críticos). **Isolate** = dividir (multi-agente, sandboxes). Analogía: la ventana de contexto = RAM. Ubica los mecanismos de AWM: plan docs + ledger = **Write**; subagentes = **Isolate**; compaction = **Compress** (el lossy a vigilar). *[8]*

### Implicación accionable (Eje 1)

AWM ya hace lo que la literatura más respalda: **Write** (plan docs + ledger) e **Isolate** (subagentes). El hueco está en el **borde de Compress** — el momento de la compaction — que es donde [1]–[5] muestran que se concentran el context rot *y* la pérdida irreversible.

**Respuesta directa a "¿debería añadir un paso explícito de re-anclaje del objetivo tras compaction?": sí.**

1. **Re-anclar objetivos al final del contexto tras cada compaction** (y periódicamente en runs largos). El resumen de la compaction aterriza al *inicio* de la nueva ventana — la región de menor atención según [1] — así que confiar solo en él para cargar el objetivo es el peor caso. Re-inyectar objetivo + sección activa del plan + ítems abiertos del ledger al *final* lo contrarresta (recitación de Manus [6]).
2. **Añadir un paso de verificación/reconciliación post-compaction.** Como AWM tiene un ledger estructurado de verdad-base, puede hacer mejor que la sonda genérica de Gemini CLI [5]: reconciliar el resumen contra el ledger/plan y re-emerger cualquier ítem abierto que el resumen haya dejado caer. Esto convierte un paso lossy irreversible [4] en uno recuperable, porque la fuente de verdad vive en archivos.
3. **Compactar proactivamente**, no en el acantilado del 95%; o resumir *desde el ledger* en lugar de desde el transcript rotado.
4. **Tratar cada retorno de subagente como un borde de compaction** [5,7] y aplicarle la misma disciplina de re-anclaje + reconciliación.

---

## Eje 2 — Sesgo de auto-auditoría y verificación independiente

### A. El sesgo de auto-preferencia es real (y mecanístico, no contextual)

- **Self-enhancement bias medido (Zheng et al., NeurIPS 2023).** GPT-4 favoreció sus propias respuestas con **~10% más de win rate**; Claude-v1 **~25%**; GPT-3.5 **no** se favoreció. Adoptan el término "self-enhancement bias". Coexiste con utilidad: el acuerdo juez-humano supera el **80%** (comparable al acuerdo humano-humano). El sesgo no es uniforme: escala con la capacidad del modelo. *[9]*

- **El auto-reconocimiento causa la auto-preferencia (Panickssery et al., NeurIPS 2024).** Los evaluadores LLM "puntúan sus propias salidas más alto que las de otros, mientras los humanos las consideran de igual calidad". Correlación **lineal y causal** entre capacidad de auto-reconocimiento y fuerza de auto-preferencia (vía fine-tuning, descartando confusores). El mecanismo es el modelo reconociendo "esto es mío". *[10]*

- **El "blinding" reduce pero NO elimina el sesgo (arXiv 2025).** Ofuscar autoría/estilo reduce la auto-preferencia (p<.01), pero al extrapolar a una neutralización estilística más completa, **la auto-preferencia se recupera**: "el auto-reconocimiento y la auto-preferencia pueden ocurrir en muchos niveles semánticos"; "la eliminación completa no es plausible". **Es el hallazgo más cargado para tu pregunta clave.** *[11]*

- **Quitar etiquetas de autoría preserva el *signo* del sesgo en todos los modelos.** La magnitud baja 9.1–48.4% pero **ningún modelo cambia el signo** de su sesgo de auto-evaluación: "surge de heurísticas de puntuación intrínsecas, no del reconocimiento explícito de identidad". *[12]*

### B. La auto-corrección sin señal externa es neutra-a-dañina

- **Los LLM no se auto-corrigen razonamiento sin feedback externo (Huang et al., ICLR 2024).** La auto-corrección intrínseca *baja* la precisión: GSM8K GPT-4 95.5%→89.0%; CommonSenseQA GPT-3.5 75.8%→41.8% (catastrófico). Las mejoras de trabajos previos dependían de **etiquetas oráculo**. Además: el debate multi-agente **no supera** a self-consistency a igual cómputo (88.2% vs 83.0% con 9 respuestas). *[13]*

- **Los LLM no verifican mejor de lo que resuelven (Stechly et al., 2023).** En coloreo de grafos, las ganancias de prompting iterativo vinieron de que la solución correcta estaba fortuitamente en el top-k y fue reconocida por un **verificador externo**. Los lazos LLM-critica-LLM son inefectivos. *[14]*

- **Reflexion y Self-Refine dependen de señal externa o de tareas subjetivas.** Self-Refine (Madaan et al., NeurIPS 2023) reporta ~20% de mejora pero **sobre métricas de preferencia** (tareas abiertas), requiere un modelo base fuerte y casi no ayuda en matemática. *[16]* Reflexion (Shinn et al., NeurIPS 2023) "convierte feedback **del entorno** en feedback verbal" — el motor es la señal externa (tests, éxito de tarea), no la introspección. *[17]*

### C. Lo que sí funciona: separación generador/crítico + verdad externa

- **CriticGPT — un modelo crítico *separado* atrapa más bugs que humanos (OpenAI, 2024).** Un crítico RLHF distinto del generador produce críticas **preferidas sobre las humanas en el 63% de los casos** en código con bugs naturales. Razón: "evaluar la salida de IA suele ser más rápido y fácil que demostrar la salida ideal". **Caveat:** los críticos LLM alucinan bugs/nitpicks más que los humanos; hay un trade-off precisión-cobertura, y los equipos humano+modelo alucinan menos. *[15]*

- **Constitutional AI — paso de crítica→revisión separado y anclado a principios (Anthropic, 2022).** El lazo "Crítica → Revisión" es procedimental y anclado a una constitución en lenguaje natural (criterio externo), no un simple "mirá de nuevo". *[18]*

### Implicación accionable (Eje 2) — respuesta a la pregunta clave

**El contexto fresco solo es necesario pero NO suficiente.** Cadena de razonamiento desde la evidencia:

1. **La auto-preferencia es mecanística, no contextual** [10,12]: vive en los pesos. Un subagente de contexto fresco sobre el **mismo modelo** carga los mismos pesos y la misma capacidad de auto-reconocimiento.
2. **El blinding no la cierra** [11]: incluso neutralizando estilo agresivamente, se recupera. El contexto fresco es una intervención más débil que la ofuscación de autoría, y esa ya falla.
3. **La auto-revisión sobre razonamiento es neutra-a-dañina** [13,14]: el lift aparente viene de un verificador externo o de feedback del entorno.
4. **Lo que funciona en producción es separación + señal externa** [15,18].

**Para AWM (subagente de contexto fresco, mismo modelo, mismo orquestador):**

- **Conservá el contexto fresco** (quita el anclaje barato "lo acabo de escribir, está bien"), pero **documentalo como atenuación, no eliminación.** Asumí sesgo residual presente.
- **Anclá el review a verdad-base determinista** — la jugada de mayor palanca, y ya alineada con tu arquitectura de sensores. [13,14,17,15] convergen: la señal de corrección fiable viene de tests/lint/semgrep/compilador, **no** del juicio del modelo sobre su propia salida. El veredicto del subagente debe estar **gateado por** los sensores, no poder anularlos.
- **Preferí separación real de modelo/rol donde el riesgo sea alto** [10,15]: un *modelo distinto* (o al menos un crítico con prompt/rol distinto y sin acceso al chain-of-thought del generador) reduce el favoritismo por auto-reconocimiento. Si podés despachar QA en otra familia de modelo para reviews críticos de corrección, hacelo. Si estás limitado a un modelo, apoyate más fuerte en los sensores deterministas y en checklists/constitución explícitos [18].
- **Restringí al crítico contra hallazgos alucinados** [15]: exigí evidencia concreta por hallazgo (test que falla, ID de regla de sensor, línea) — espeja el principio de AWM de que las reglas específicas viven en config files, no en la opinión del modelo.
- **No confíes en el "debate" del mismo modelo como verificador** [13]: a igual cómputo ≈ self-consistency. Si gastás presupuesto extra, preferí checks externos a más deliberación del mismo modelo.

**Bottom line:** el contexto fresco reduce el anclaje conversacional, pero el mecanismo de auto-preferencia vive en los pesos compartidos y sobrevive al blinding; la auditoría confiable requiere (a) gating por verdad-base determinista (sensores/tests) e, idealmente, (b) separación de modelo y/o de rol del crítico — no contexto fresco solo.

---

## Eje 3 — Spec-driven development y mejores prácticas de ingeniería

### A. Estructura de artefactos: el SOTA separa requisitos / diseño / tareas

- **AWS Kiro: tres archivos — `requirements.md` / `design.md` / `tasks.md` (docs oficiales).** El flujo genera tres documentos secuenciales: requisitos (comportamiento del sistema), diseño (arquitectura técnica), tareas (actividades discretas). Los requisitos usan EARS y se "traducen directamente a casos de prueba". La línea base del estado del arte separa **tres** artefactos, no dos. *[19]*

- **`requirements.md` de Kiro = user stories + criterios de aceptación EARS.** Ejemplo exacto: "WHEN a user submits a form with invalid data THE SYSTEM SHALL display validation errors next to the relevant fields", organizados por áreas funcionales. Criterios machine-checkable que mapean 1:1 a tests. *[20]*

- **Trazabilidad: cada tarea de Kiro referencia su requisito/criterio.** "Checklist numerado donde cada tarea traza de vuelta a un criterio de aceptación específico"; Kiro propaga cambios entre los tres archivos cuando cambia el alcance. *[19][24]*

- **GitHub Spec Kit: `/constitution` → `/specify` → `/clarify` → `/plan` → `/tasks` → `/analyze` → `/implement`.** `/specify` define requisitos funcionales y user stories (el "qué/por qué", agnóstico a tecnología); `/plan` la estrategia técnica con stack; `/tasks` el desglose ordenado y testeable; **`/clarify` saca la sub-especificación a la luz *antes* de planificar**; **`/analyze` corre consistencia cross-artifact y cobertura *después* de tareas y *antes* de implementar**. *[21]*

- **`constitution.md` de Spec Kit** codifica principios no-negociables consultados en cada fase (calidad de código, testing, UX, performance) — análogo directo de tu `CONSTITUTION.md`. *[21]*

- **Filosofía de Spec Kit:** "Las especificaciones no sirven al código — el código sirve a las especificaciones… El PRD es la fuente que genera la implementación", separando el "qué" estable del "cómo" flexible. Un `design.md` que mezcla qué+cómo viola esta separación. *[22]*

### B. EARS: la gramática de requisitos

- **EARS = cinco plantillas + forma compleja (Mavin et al., IEEE RE'09).** Sintaxis verificada:
  - **Ubicua:** "The \<system\> shall \<response\>"
  - **Estado (WHILE):** "While \<precondition\>, the \<system\> shall \<response\>"
  - **Evento (WHEN):** "When \<trigger\>, the \<system\> shall \<response\>"
  - **Opcional (WHERE):** "Where \<feature\>, the \<system\> shall \<response\>"
  - **No deseado (IF/THEN):** "If \<trigger\>, then the \<system\> shall \<response\>"
  - **Compleja:** "While \<precondition\>, When \<trigger\>, the \<system\> shall \<response\>"
  Es una gramática diminuta y sin tooling. *[23]*

- **EARS existe para eliminar defectos de requisitos en lenguaje natural.** "Reduce o incluso elimina problemas comunes de los requisitos en lenguaje natural" — ambigüedad, vaguedad, incompletitud, complejidad. Adoptado por Airbus, Bosch, Dyson, Honeywell, Intel, NASA, Rolls-Royce, Siemens. La plantilla **IF/THEN de comportamiento no deseado** fuerza la especificación de casos borde/error — justo la clase de bug que `harness-retro` persigue. *[23]*

### C. Workflows ligeros (los análogos más cercanos a AWM)

- **Harper Reed: idea honing → planning → execution.** Prompts verificados: honing "Ask me one question at a time… only one question at a time" → `spec.md`; planning "break it down into small, iterative chunks that build on each other" → `prompt_plan.md` + `todo.md`; restricción: "no debe haber código colgante o huérfano que no esté integrado en un paso previo"; ejecución TDD. **Valida el espinazo de AWM** y aporta dos préstamos: la interrogación de a una pregunta (que ya hacés) y la restricción de "nada de código huérfano". *[25]*

- **Jesse Vincent / "superpowers" (linaje directo de tus skills, ver `skills-lock.json`).** Agente que "habla el plan con vos antes de implementar"; planes escritos asumiendo que el ejecutor "tiene cero contexto y gusto cuestionable"; "despacha tareas una por una a subagentes… y revisa el código de cada tarea antes de continuar"; "TDD RED/GREEN". Espeja brainstorm/plan/TDD/review-de-contexto-fresco de AWM. *[26]*

- **Tessl (Guy Podjarny): el spec como fuente de verdad durable.** "Hoy el código es la fuente de verdad… y acopla *qué* hace la app con *cómo* lo hace, mezclados en las mismas líneas." La articulación más fuerte de *por qué* importa un artefacto de requisitos separado: la intención decae dentro del código con el tiempo. *[27]*

### D. Best practices de agentes (ejecución y review)

- **Anthropic "Building Effective Agents": workflows con "gates" programáticos entre pasos.** El prompt chaining descompone en pasos secuenciales con "checks programáticos (gates) en pasos intermedios para asegurar que el proceso sigue en curso"; añadir complejidad "solo cuando mejora demostrablemente los resultados". El gating determinista de AWM (sensores, tests estructurales) es exactamente este patrón. *[28]*

- **Claude Code: Explore → Plan → Code → Commit**, con el plan escrito a un archivo editable; el planning es "más útil cuando hay incertidumbre sobre el enfoque… modifica múltiples archivos". Recomienda *saltear* el plan para diffs de una línea → el flujo debe ser **tier-able**, no obligatorio para cambios triviales. *[29]*

- **Claude Code: review adversarial de contexto fresco contra el plan.** "Un revisor en contexto fresco ve solo el diff y los criterios que le des, no el razonamiento que produjo el cambio." Plantilla: "revisá el diff contra PLAN.md. Verificá que cada requisito esté implementado, que los casos borde listados tengan tests, y que nada fuera del alcance haya cambiado. Reportá huecos, no preferencias de estilo." **Presupone requisitos enumerables**: sin IDs de requisito, el revisor no tiene checklist de completitud — debilitando justo esta fase. *[29]*

- **Anthropic, práctica #1: dale al agente una verificación ejecutable** (tests/build/lint). "Dale a Claude un check que pueda correr… itera hasta que pase." Los criterios de aceptación EARS son la fuente natural de estos checks ejecutables. *[29]*

### E. Trazabilidad como práctica base de ingeniería

- **Trazabilidad bidireccional (ISO/IEC/IEEE 29148).** *Forward*: "verificar que todo requisito esté asociado a elementos de diseño/componentes". *Backward*: "atrapar casos de prueba o elementos de diseño que no trazan a ningún requisito, lo que suele señalar scope creep". Mapea directo sobre la distinción alcance-vs-seguridad de AWM: forward = "¿se construyó y testeó cada requisito?"; backward = "¿existe código/test sin requisito?" (= scope creep / código huérfano). *[30]*

### Gaps del flujo AWM (prosa en design.md, sin EARS, sin IDs, dos artefactos)

| # | Gap | Qué hace el SOTA | Severidad | Fix concreto |
|---|-----|------------------|-----------|--------------|
| **G1** | Requisitos fundidos en `design.md` en prosa; sin artefacto de requisitos. | Kiro (3 archivos), Spec Kit (spec/plan/tasks), Tessl (spec=verdad) separan qué de cómo [19,21,22,27]. | **Alta** | Sección de **Requisitos** como cabeza durable de la spec (o `requirements.md`), solo QUÉ + criterios de aceptación, upstream del diseño. |
| **G2** | Sin EARS / criterios estructurados — prosa ambigua y no 1:1 testeable. | EARS cura ambigüedad/incompletitud [23]; Kiro lo hornea [20]. | **Alta** | Criterios de aceptación en EARS. Priorizar IF/THEN para forzar casos borde/error — la clase exacta que `harness-retro` re-descubre. |
| **G3** | Sin IDs de requisito → sin trazabilidad → el review de contexto fresco y el QA no tienen checklist de completitud. | Kiro traza tareas a nº de requisito [19]; Spec Kit `/analyze` [21]; el revisor de Anthropic chequea "cada requisito implementado" [29]; ISO 29148 [30]. | **Alta** | Numerar requisitos (R1, R1.1…) y taggear cada tarea/test con los IDs que satisface. Da checklist enumerable al revisor/QA y atrapa código huérfano (backward). |
| **G4** | Sin gate explícito de "clarify / completitud" antes del diseño. | Spec Kit `/clarify` [21]; Harper de-a-una-pregunta [25]. | Media | Gate de salida del brainstorming: los requisitos pasan una ronda de structured-questioning (sin ambigüedades abiertas) antes de diseñar. *(Tu `brainstorming` ya hace de-a-una-pregunta — falta el gate explícito de no-ambigüedad.)* |
| **G5** | Sin check de consistencia/cobertura cross-artifact antes de implementar/QA. | Spec Kit `/analyze` [21]; ISO 29148 backward [30]. | Media | Paso `analyze` automatizable pre-QA: todo ID de requisito tiene ≥1 tarea y ≥1 test, y ninguna tarea/test carece de ID. Gate determinista en el sentido de Anthropic [28]. |
| **G6** | `design.md` + `plan.md` pueden mezclar QUÉ y CÓMO. | Spec Kit tiers spec→plan→tasks [21]; Anthropic separa plan de código [29]. | Baja-Media | Que design/plan referencien (no repitan) IDs de requisito; el QUÉ vive en un solo lugar. |
| **G7** | Riesgo de que añadir estructura se vuelva pesado (waterfall reinventado). | Anthropic: complejidad solo si mejora [28]; saltear plan para diffs triviales [29]; Fowler advierte que checklists verbosos dan "falsa sensación de control". | Guardrail | **Tier-able** (modelo spine-vs-specialized de AWM): EARS + IDs + trazabilidad obligatorios para features multi-archivo/riesgosas; salteable para diffs triviales. Requisitos tersos (bullets EARS), no prosa. |

**Bottom line (Eje 3):** el espinazo de AWM está bien alineado con el SOTA práctico [25,26,29]. Los tres gaps de carga están todos en la **capa de requisitos**: (1) sin artefacto separado, (2) sin criterios EARS, (3) sin IDs/trazabilidad. Las tres son baratas (EARS no necesita tooling; los IDs son una convención de nombres; el `analyze` es un script) y cada una refuerza una fase que ya existe — el TDD obtiene criterios testeables, el review de contexto fresco obtiene checklist de completitud, y QA/retro pueden detectar código huérfano y scope creep vía trazabilidad backward.

---

## Citas

**Eje 1 — Contexto/compaction**
1. Liu, N. F., et al. (2024). *Lost in the Middle: How Language Models Use Long Contexts.* arXiv:2307.03172; TACL 2024. https://arxiv.org/abs/2307.03172 · https://aclanthology.org/2024.tacl-1.9/
2. Hong, K., Troynikov, A., & Huber, J. (2025). *Context Rot: How Increasing Input Tokens Impacts LLM Performance.* Chroma Technical Report. https://research.trychroma.com/context-rot · https://www.trychroma.com/research/context-rot
3. Anthropic Applied AI (2025). *Effective context engineering for AI agents.* https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
4. Anthropic. *Compaction.* Claude API docs. https://platform.claude.com/docs/en/build-with-claude/compaction
5. Rombaut, B. (2026). *Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures.* arXiv:2604.03515. https://arxiv.org/abs/2604.03515
6. Ji, Y. "Peak" / Manus (2025). *Context Engineering for AI Agents: Lessons from Building Manus.* https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
7. Yan, W. / Cognition (2025). *Don't Build Multi-Agents.* https://cognition.com/blog/dont-build-multi-agents
8. LangChain Team (2025). *Context Engineering for Agents.* https://blog.langchain.com/context-engineering-for-agents/

**Eje 2 — Sesgo de auto-auditoría**
9. Zheng, L., et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* NeurIPS 2023. https://arxiv.org/abs/2306.05685
10. Panickssery, A., Bowman, S. R., & Feng, S. (2024). *LLM Evaluators Recognize and Favor Their Own Generations.* NeurIPS 2024. https://arxiv.org/abs/2404.13076
11. *Mitigating Self-Preference in LLM Evaluators via Authorship Obfuscation* (2025). https://arxiv.org/abs/2512.05379 *(verificar metadata de autores en versión publicada)*
12. *Self-evaluation bias as an intrinsic scoring heuristic* (2025). https://arxiv.org/abs/2606.20093 *(corroborante; verificar metadata)*
13. Huang, J., et al. (2024). *Large Language Models Cannot Self-Correct Reasoning Yet.* ICLR 2024. https://arxiv.org/abs/2310.01798
14. Stechly, K., Marquez, M., & Kambhampati, S. (2023). *GPT-4 Doesn't Know It's Wrong: Iterative Prompting for Reasoning Problems.* https://arxiv.org/abs/2310.12397
15. McAleese, N., et al. / OpenAI (2024). *LLM Critics Help Catch LLM Bugs (CriticGPT).* https://arxiv.org/abs/2407.00215
16. Madaan, A., et al. (2023). *Self-Refine: Iterative Refinement with Self-Feedback.* NeurIPS 2023. https://arxiv.org/abs/2303.17651
17. Shinn, N., et al. (2023). *Reflexion: Language Agents with Verbal Reinforcement Learning.* NeurIPS 2023. https://arxiv.org/abs/2303.11366
18. Bai, Y., et al. / Anthropic (2022). *Constitutional AI: Harmlessness from AI Feedback.* https://arxiv.org/abs/2212.08073

**Eje 3 — Spec-driven**
19. AWS Kiro. *Feature Specs.* https://kiro.dev/docs/specs/feature-specs/
20. AWS Kiro. *Requirements-First Workflow.* https://kiro.dev/docs/specs/feature-specs/requirements-first/
21. GitHub. *github/spec-kit* + GitHub Blog, *Spec-driven development with AI* (2025). https://github.com/github/spec-kit · https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/
22. GitHub Blog (2025). *Spec-driven development with AI.* (filosofía "code serves specs") — misma URL que [21].
23. Mavin, A., Wilkinson, P., Harwood, A., & Novak, M. (2009). *Easy Approach to Requirements Syntax (EARS).* IEEE RE'09. https://ieeexplore.ieee.org/document/5328509/ · https://alistairmavin.com/ears/
24. Fowler, M. (Böckeler, B.) (2025). *Understanding Spec-Driven Development: Kiro, spec-kit, and Tessl.* https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
25. Reed, H. (2025). *My LLM codegen workflow atm.* https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/
26. Vincent, J. (obra) (2025). *Superpowers: How I'm using coding agents in October 2025.* https://blog.fsck.com/2025/10/09/superpowers/ · https://github.com/obra/superpowers
27. Podjarny, G. / Tessl (2024–2025). *AI Native Software Development.* https://tessl.io/blog/
28. Anthropic (2024). *Building Effective Agents.* https://www.anthropic.com/research/building-effective-agents
29. Anthropic. *Best practices for Claude Code.* https://code.claude.com/docs/en/best-practices
30. Jama Software / Perforce / ReqView — *Requirements Traceability Matrix* (citando ISO/IEC/IEEE 29148). https://www.jamasoftware.com/requirements-management-guide/requirements-traceability/traceability-matrix/

### Notas de verificación / caveats
- **[5]** (arXiv:2604.03515) figura con un solo autor en la versión recuperada; confirmar lista de autores contra la versión publicada. Las afirmaciones sobre Gemini CLI (sonda de verificación) y Aider (reemplazo destructivo) están explícitas en ese paper.
- **El umbral exacto del auto-compact (~95%/167K)** es ingeniería-inversa de la comunidad; el *mecanismo* (resumir y descartar bloques previos) está confirmado por las docs oficiales **[4]**.
- **[11]** y **[12]** son preprints recientes; verificar metadata de autores/venue antes de cita formal. El resultado direccional (blinding atenúa pero no elimina; el signo sobrevive) es consistente entre ambos.
- **La convención literal `_Requirements: x.y_` de Kiro** está corroborada por Kiro docs + Fowler, pero no fue citable verbatim de las páginas recuperadas; tratar como corroborada, no verbatim.
- **[30]** se apoya en fuentes secundarias que citan ISO/IEC/IEEE 29148; el estándar no fue recuperado directamente.
