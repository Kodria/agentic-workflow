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
