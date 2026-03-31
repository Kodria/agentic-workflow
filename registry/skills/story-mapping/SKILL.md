---
name: story-mapping
description: "Facilita sesiones de User Story Mapping (metodología Jeff Patton). Usa esta skill cuando el usuario quiera crear un Story Map desde documentación existente, ser acompañado en tiempo real durante una sesión de planning, o actualizar un Story Map existente. Activa ante frases como: 'quiero hacer un story mapping del proyecto X', 'vamos a hacer el story map', 'acompáñame en la sesión de planning', 'actualiza el story map con estas historias', 'repriorizar el story map', 'continuar el story mapping del proyecto X'."
---

# Story Mapping Assistant

Facilita el ciclo completo de User Story Mapping para planificación de producto. Opera en 3 modos según el contexto del usuario, documentando progresivamente en el repositorio del proyecto siguiendo la metodología de Jeff Patton.

**Principio core:** El Story Map es un artefacto vivo que organiza las necesidades del usuario en dos dimensiones — horizontal (flujo narrativo del usuario) y vertical (prioridad de entrega). Markdown es la fuente de verdad; herramientas visuales (Miro, etc.) son capas de presentación opcionales.

---

## Fundamento metodológico — Los 4 niveles de Jeff Patton

El mapa tiene 4 niveles jerárquicos. Cada nivel responde a una pregunta distinta. Si no sabes dónde poner algo, identifica qué pregunta responde.

### Nivel 1 — Goal (Objetivo)

> 🧠 **Pregunta clave:** "¿Por qué existe este producto?"

- Es **uno solo** para todo el mapa (o muy pocos). No tiene emoji de color — no es una tarjeta del backbone, es el encabezado del mapa.
- No es una tarjeta del backbone — es el título/encabezado del mapa (sección `## Goal`)
- Es la razón de ser del sistema

**Test de validación:** ¿Tu sistema entero existe para resolver esto? → Es un Goal. Si es solo una parte del sistema → Baja de nivel.

### Nivel 2 — Activity (🟡 Actividad) → Backbone

> 🧠 **Pregunta clave:** "¿Qué está HACIENDO el usuario en este momento?"

Las Activities forman el **backbone** (fila superior del mapa), de izquierda a derecha en **flujo narrativo** (no secuencia estricta).

**Tests de validación — aplica TODOS antes de confirmar una Activity:**

| Test | Si falla |
|------|----------|
| ¿Es un verbo/acción? | Bájalo al contexto — probablemente es un concepto de negocio. Ponlo como agrupador, no como Activity |
| ¿Contiene múltiples pasos internos? | Si no tiene pasos internos, es una Task, no una Activity |
| ¿Un usuario puede "hacer" esto directamente? | Si es abstracto, es un concepto de negocio — ponlo como agrupador visual encima del backbone |
| ¿Se explica en una frase? | Es demasiado grande → divídela en dos Activities |

**Bien:** "Gestionar órdenes de compra", "Agendar entrega al CD", "Consultar estado de pagos"
**Mal:** "Logística" (dominio, no acción), "Ingresar credenciales" (demasiado pequeño → es Task), "Como proveedor, quiero ver mis OCs" (es Story)

### Nivel 3 — Task (🔵 Tarea)

> 🧠 **Pregunta clave:** "¿Cuáles son los pasos que el usuario sigue dentro de esta actividad?"

Las Tasks van **debajo de su Activity padre**, de izquierda a derecha. Pueden tener un mini-flujo secuencial dentro de la actividad.

**Tests de validación — aplica TODOS antes de confirmar una Task:**

| Test | Si falla |
|------|----------|
| ¿Pertenece claramente a una Activity? | Si es huérfana, quizás es una Activity por sí misma |
| ¿Es una acción unitaria? | Si tiene sub-pasos, puede ser una Activity |
| ¿Describe lo que hace el usuario, no lo que construye el equipo? | Lo que construye el equipo son Stories |

**Bien** (dentro de "Gestionar OCs"): "Ver listado de OCs", "Filtrar por estado", "Aceptar una OC", "Descargar detalle en PDF"
**Mal:** "Gestionar órdenes de compra" (demasiado grande → es Activity), "Endpoint REST para listar OCs" (detalle técnico → fuera del mapa), "Como operador, quiero filtrar OCs" (es Story)

### Nivel 4 — Story (⬜ Historia de usuario)

> 🧠 **Pregunta clave:** "¿Qué exactamente va a construir el equipo de desarrollo?"

Las Stories se **apilan verticalmente debajo de su Task padre**, priorizadas de arriba (más importante) a abajo (menos importante).

**Tests de validación — aplica TODOS antes de confirmar una Story:**

| Test | Si falla |
|------|----------|
| ¿El equipo puede construir esto en 1-2 sprints? | Demasiado grande → divídela |
| ¿Tiene un Definition of Done claro? | Demasiado vaga → refínala |
| ¿Se puede reformular como "Como [rol], quiero [acción] para [beneficio]"? | Reformúlala. Si no puedes identificar un rol y un beneficio claro, puede ser un requisito técnico |

**Bien** (debajo de Task "Aceptar una OC"): "Como proveedor, quiero aceptar una OC con doble clic para confirmar compromiso de entrega", "Como admin, quiero que se registre fecha/hora de aceptación para auditoría"
**Mal:** "Módulo de órdenes de compra" (demasiado grande → es Activity), "Mejorar performance" (no describe valor de usuario → nota técnica)

---

## El eje horizontal: flujo narrativo, NO secuencia estricta

> 🧠 **Pregunta clave para ordenar:** "¿En qué orden le explicarías el sistema a alguien que no lo conoce?"

Eso es el **flujo narrativo**. Algunas actividades pueden ser paralelas o cíclicas en la realidad, pero en el mapa van en el orden en que contarías la historia del producto.

**Lo que SÍ es:** El orden en que contarías la historia del producto. Una organización lógica que da contexto.
**Lo que NO es:** Una secuencia estricta paso-a-paso. Un diagrama de flujo o BPMN. Un timeline de implementación.

Si no sabes dónde poner una Activity: *"Cuando le explico el sistema a un nuevo miembro del equipo, ¿en qué momento de la explicación mencionaría esto?"*

---

## Árbol de decisión para elementos ambiguos

Cuando tengas un elemento y no sepas dónde va:

```
¿Es algo que un usuario HACE en el sistema?
├── No → ¿Es un concepto de negocio/dominio?
│   ├── Sí → Agrupador visual encima del backbone (no entra en el mapa)
│   └── No → Fuera del mapa (requisito técnico, spike, constraint) → Sección "Notas técnicas"
└── Sí → ¿Tiene múltiples pasos internos?
    ├── No → ¿Describe lo que construye el equipo (no lo que hace el usuario)?
    │   ├── Sí → Es una STORY ⬜
    │   └── No → Es una TASK 🔵
    └── Sí → ¿Es demasiado grande para una sola sesión de trabajo?
        ├── Sí → Es una ACTIVITY 🟡
        └── No → ¿Se puede implementar en 1-2 sprints?
            ├── Sí → Es una STORY ⬜
            └── No → Divídela en varias Stories
```

---

## Conceptos que NO son acciones del usuario

No todo lo que aparece en el discovery entra en el Story Map. Clasifica así:

| Concepto | Ejemplo | Dónde va |
|----------|---------|----------|
| Capacidad de negocio | "Logística", "Due Diligence" | **Fuera del mapa** — agrupador visual. Se documenta como contexto, no como Activity |
| Requisito técnico / NFR | "Soportar 1000 usuarios concurrentes" | **Fuera del mapa** — sección `## Notas técnicas` del documento |
| Integración con sistema externo | "Recibir datos vía API desde ERP" | **Como Story** debajo de la Task que necesita esos datos |
| Proceso batch / automatizado | "Carga nocturna de datos" | **Como Story** técnica debajo de la Activity que consume esos datos |
| Feature transversal | "Multilenguaje", "Auditoría" | **Columna separada** al final del backbone, o Stories repetidas bajo varias Tasks |
| Spike / investigación | "Evaluar WebSockets vs polling" | **Fuera del mapa** — sección `## Notas técnicas` |

**Comportamiento:** Cuando el usuario proponga un elemento no-acción, identifícalo, explica por qué no entra directamente en el mapa, y sugiere dónde documentarlo. No lo descartes silenciosamente.

---

## Detección proactiva de errores comunes

Aplica esta tabla durante TODOS los modos de operación:

| Error | Cómo detectarlo | Respuesta |
|-------|-----------------|-----------|
| Capacidad de negocio como Activity | Elemento no es verbo/acción | *"'{X}' parece un dominio, no una acción. ¿Qué hace el usuario dentro de {X}?"* |
| Story escrita como Task | Formato "Como... quiero..." en nivel de Task | *"Esto parece una Story. La bajo al nivel correcto debajo de la Task."* |
| Backbone como secuencia estricta | Usuario insiste en orden temporal estricto | *"El orden es narrativo, no secuencial. ¿En qué orden le explicarías el sistema a alguien nuevo?"* |
| Detalle técnico como tarjeta | "Endpoint REST", "API de...", "Tabla de..." | *"Esto es un detalle técnico. Lo documento en Notas técnicas y lo vinculo a la Story que lo necesita."* |
| Story demasiado grande | No estimable en 1-2 sprints | *"Esta Story parece demasiado grande para 1-2 sprints. ¿La dividimos?"* |
| Task sin Activity padre | Task huérfana sin Activity clara | *"¿A qué actividad del usuario pertenece esta tarea?"* |

## Paso 0: Autodescubrimiento de Contexto

Antes de hacer cualquier pregunta al usuario:

1. **Lee `AGENTS.md`** en la raíz del repositorio activo (si existe). Extrae:
   - `docs_path` — directorio raíz de documentación
   - Estructura de directorios disponible
2. **Localiza el template de Story Map** usando búsqueda dinámica del patrón `template-wizard/resources/templates/story-map-template.md`
3. **Busca un Story Map existente** del proyecto mencionado en `{docs_path}/` (busca archivos que contengan "story-map" o el nombre del proyecto)
4. **Si el usuario indicó documentos fuente**, léelos y extrae: personas, flujos, problemas, scope/MVP
5. **Si el usuario NO indicó documentos fuente y el contexto NO es una sesión en vivo (Modo B)**, busca en el repositorio de documentación: discovery documents, specs, notas de reunión, cualquier documento relevante del proyecto

---

## Paso 1: Detectar Modo de Operación

Según el contexto del usuario, determina cuál de los 3 modos aplica:

| Señal del usuario | Modo |
|-------------------|------|
| "Quiero crear un story map", "genera el story map desde la documentación", "haz el story mapping del proyecto X" | **Modo A: Generar** |
| "Acompáñame en la sesión de planning", "vamos a mapear historias", "estamos en una sesión de story mapping" | **Modo B: Acompañar en Vivo** |
| "Actualiza el story map", "agrega estas historias", "reprioriza el MVP", "continuar el story mapping" | **Modo C: Actualizar** |

Si no queda claro, pregunta: *"¿Quieres que genere un Story Map desde documentación existente, que te acompañe en una sesión de planning en vivo, o que actualice un Story Map que ya existe?"*

---

## Modo A: Generar — Story Map desde documentación

Sigue estos pasos en orden. **Cada paso es un gate de confirmación** — no avances al siguiente sin aprobación del usuario.

### A1. Identificar fuentes de contexto

Si el usuario indicó documentos específicos, úsalos. Si no:
1. Busca en el repositorio de documentación del proyecto
2. Prioriza: discovery documents > specs > notas de reunión > cualquier otro documento
3. Presenta al usuario qué documentos encontraste y de cuáles extraerás contexto
4. Espera confirmación

### A2. Extraer y proponer Goal + Personas

Del contexto extraído:
1. Propón el **Goal** del producto: una frase que responde "¿por qué existe este sistema?"
2. Identifica los usuarios/actores principales
3. Propone las Personas con rol, objetivo y pain points
4. Presenta al usuario para confirmación: *"Este es el Goal y las Personas que identifiqué. ¿Son correctos? ¿Falta algo?"*
   - Si el usuario aprueba el Goal pero ajusta las Personas, re-presenta solo las Personas revisadas antes de avanzar.

### A3. Proponer Backbone (solo Activities)

Con el Goal y Personas confirmados:
1. Identifica las actividades de alto nivel que cada persona necesita completar
2. **Aplica los tests de validación de Nivel 2** a cada Activity propuesta
3. Ordénalas en **flujo narrativo** (no cronológico): "¿En qué orden le explicarías el sistema a alguien?"
4. Presenta el backbone: *"Este es el backbone propuesto — solo las actividades principales en flujo narrativo. ¿Ajustamos algo?"*

**⚠️ NO proponer Tasks ni Stories en este paso.** Solo Activities.

### A3b. Proponer Tasks por Activity

Con el backbone confirmado:
1. Para cada Activity, propone las Tasks (pasos concretos del usuario) de izquierda a derecha
2. **Aplica los tests de validación de Nivel 3** a cada Task
3. Presenta por Activity: *"Estas son las Tasks para '{Activity}'. ¿Ajustamos?"*
4. Si una Activity genera demasiadas Tasks (>8), sugiere dividir la Activity

Tras completar todas las Activities: *"Backbone descompuesto: {n} Activities con {n} Tasks en total. ¿Pasamos a proponer las historias de usuario?"* — espera confirmación antes de avanzar a A4.

### A4. Proponer Stories por Release

Con las Tasks confirmadas:
1. Para cada Task, propone user stories en formato: _Como {persona}, quiero {acción} para {beneficio}_
2. **Aplica los tests de validación de Nivel 4** a cada Story
3. Organiza en releases (MVP, Release 2, Backlog) según la prioridad detectada en la documentación
4. **Clasifica elementos no-acción** que aparezcan: NFRs → Notas técnicas, integraciones → Stories técnicas, spikes → Notas técnicas
5. Presenta por Activity: *"Estas son las Stories para '{Activity}'. ¿Ajustamos prioridades o agregamos algo?"*

### A5. Generar documento y validar

1. Determina la ruta del archivo: por defecto `{docs_path}/50-projects/{nombre-proyecto}/story-map.md`. Si el directorio no existe, pregunta al usuario dónde guardarlo.
2. Rellena el template con Goal, Personas, Backbone (Activities + Tasks), Stories y Releases confirmados
3. Incluye sección `## Notas técnicas` si hay elementos no-acción identificados
4. Genera el Release Summary con conteo de stories por release
5. **Ejecuta la Checklist de Validación** (sección `## Checklist de Validación` más abajo en este documento) y reporta advertencias
6. Agrega entrada en Changelog: `[{fecha}] Sesión 1: Story Map generado desde documentación — {n} actividades, {n} tasks, {n} stories`
7. Presenta la ruta del documento, el resultado de la checklist, y un resumen final

---

## Modo B: Acompañar en Vivo — 6 fases de ejecución

El usuario está en una sesión de planning y quiere al asistente como copiloto en tiempo real. El Modo B se estructura en **6 fases** alineadas con la metodología de Jeff Patton. Cada fase tiene un objetivo claro y un principio de disciplina.

**Al inicio, pregunta:** *"¿En qué fase estamos? ¿Es la primera sesión (empezamos por backbone) o ya tenemos backbone definido?"* — para retomar donde se dejó.

| Fase | Objetivo | Principio |
|------|----------|-----------|
| 0. Preparación | Recopilar insumos, proponer borrador | Llegar con borrador, no con lienzo en blanco |
| 1. Backbone | Definir y validar solo Activities | NO bajar a Tasks ni Stories |
| 2. Tasks | Descomponer cada Activity en Tasks | Activity por activity, izquierda a derecha |
| 3. Stories | Escribir historias debajo de cada Task | Captura libre — la skill ubica en el lugar correcto |
| 4. Priorización | Trazar líneas de release | Dot voting, sanity checks del MVP |
| 5. Validación | Ejecutar checklist sobre el mapa | 7 ítems de verificación |

---

### Fase 0 — Preparación

Carga o crea el documento de Story Map del proyecto.

1. Pregunta: *"¿Qué proyecto estamos mapeando? ¿Quiénes participan en la sesión?"*
2. Si hay documentación fuente disponible (discovery, specs), léela y propón un **borrador de backbone** para que el equipo discuta
3. Si no hay documentación, prepara un lienzo con Goal y Personas para completar con el grupo
4. Presenta: *"Preparé este borrador como punto de partida para la discusión. No es una decisión, es un disparador."*

> ⚠️ El borrador es un **punto de partida para la discusión**, no una decisión. Si llegas con el mapa "terminado", el equipo no se sentirá dueño del resultado.

---

### Fase 1 — Backbone (solo Activities)

**Enfoque:** Solo Activities. **NO bajar a Tasks ni Stories.**

1. **Goal:** Confirma o define el objetivo del producto: *"¿Por qué existe este producto? En una frase."*
2. **Personas:** *"¿Para quién estamos construyendo? Descríbeme los usuarios principales."*
3. **Divergencia:** *"¿Qué HACE el usuario en este sistema? Piensen en verbos — actividades grandes."*
   - Registra cada Activity candidata
4. **Convergencia:** Agrupa similares, elimina duplicados, ordena en flujo narrativo
   - **Aplica tests de validación de Nivel 2** a cada Activity
5. **Lectura del backbone:** Lee todas las Activities de izquierda a derecha como una historia
   - *"¿Falta algo? ¿Sobra algo? ¿El orden narrativo tiene sentido?"*

**Si el usuario baja a Tasks prematuramente:** *"Excelente punto — lo anoto para la fase de Tasks. Ahora mantengámonos en las actividades grandes."*

Tras completar: *"Backbone definido: {n} Activities en flujo narrativo. ¿Pasamos a descomponer en Tasks?"*

---

### Fase 2 — Tasks (descomposición por Activity)

**Enfoque:** Activity por Activity, de izquierda a derecha. **NO bajar a Stories.**

Para cada Activity (15-25 min por Activity):
1. Lee la Activity en voz alta
2. *"¿Qué pasos concretos sigue el usuario aquí? ¿Qué hace primero, después?"*
3. Registra Tasks candidatas debajo de la Activity
4. **Aplica tests de validación de Nivel 3** a cada Task
5. Ordena de izquierda a derecha

**Si una Activity toma demasiado tiempo (>25 min):** *"Esta Activity parece demasiado grande. ¿La dividimos en dos Activities?"*

**Si aparecen Stories:** *"Eso suena a una historia de usuario — lo anoto para la fase de Stories. Ahora enfoquémonos en los pasos del usuario."*

Tras completar todas las Activities: *"Todas las Activities descompuestas: {n} Tasks en total. ¿Pasamos a las historias de usuario?"*

---

### Fase 3 — Stories (captura libre)

Cambia a **modo reactivo**. El usuario describe stories en cualquier orden:

**El usuario describe una story** → Tú:
1. **Aplica los tests de validación de Nivel 4**
2. La ubicas en la Task y Activity correctas
3. Le asignas un release (pregunta si no es claro)
4. La redactas en formato: _Como {persona}, quiero {acción} para {beneficio}_
5. Confirmas brevemente: *"Registrada en 🟡 {Activity} > 🔵 {Task} como [MVP]. ¿Sigo?"*

**El usuario propone un elemento no-acción** → Clasifícalo según la tabla de conceptos no-acción y explica dónde va.

**El usuario quiere repriorizar** → Mueve la story al release indicado y confirma.

**El usuario quiere volver al modo guiado** → Retoma la fase donde se dejó.

**El usuario dice "anota esto"** → Captura directamente sin reformatear.

Tras captura: *"¿Pasamos a priorizar y definir releases?"*

---

### Fase 4 — Priorización y Releases

1. **Recorre el mapa completo** en voz alta para que todos lo tengan fresco
2. Recuerda los constraints: *"¿Hay limitaciones de tiempo, presupuesto o equipo que debamos considerar?"*
3. **Por cada Activity:** *"¿Qué Stories son imprescindibles para que el sistema funcione desde el primer día?"*
4. **Si hay desacuerdo** → sugiere dot voting: *"Cada participante tiene 3 votos por Activity. Marquen las Stories que consideran MVP."*
5. **Traza la línea de MVP** → valida: *"Si entregamos SOLO esto, ¿un usuario puede completar su flujo básico de principio a fin?"*
6. **Sanity checks:**
   - *"¿Puedes quitar alguna Story del MVP y que siga funcionando?"* → Si sí, está sobredimensionado
   - *"Si quitas cualquier Story, ¿deja de funcionar?"* → Si sí con varias, está muy ajustado
7. **Releases siguientes:** Agrupa Stories restantes en R2, R3 sin ser muy preciso
8. Valida: *"No es necesario que todas las Activities tengan Stories en el MVP. Si una Activity completa puede esperar, todas sus Stories van en un release posterior."*

---

### Fase 5 — Validación

Ejecuta la **Checklist de Validación** (sección `## Checklist de Validación` más abajo en este documento) sobre el mapa completo y reporta resultados al grupo.

---

### Cierre de sesión (Modo B)

Cuando el usuario señale que la sesión terminó (o al completar la Fase 5):
1. Genera o actualiza el documento con todo lo capturado
2. Actualiza el Release Summary con conteos
3. Agrega entrada en Changelog: `[{fecha}] Sesión {n}: {resumen de qué se hizo — fases completadas}`
4. Muestra resumen: Goal, Activities, Tasks, Stories por release, decisiones tomadas
5. Pregunta: *"¿Hay algo que quieras ajustar antes de guardar?"*
