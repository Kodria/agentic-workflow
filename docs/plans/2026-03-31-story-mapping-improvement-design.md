# Design: Mejora de skill `story-mapping` — Alineación metodológica Jeff Patton

## Propósito

Reescribir la skill `story-mapping` para que siga correctamente la metodología de Jeff Patton según la guía de implementación del usuario. La skill actual tiene brechas metodológicas significativas que producen Story Maps incorrectos.

## Fuente de verdad metodológica

Notion: [User Story Mapping — Guía de implementación](https://www.notion.so/333952a24bf3802b9b46cbc43894c840)

## Archivos a modificar

| Archivo | Ruta | Cambio |
|---------|------|--------|
| SKILL.md | `registry/skills/story-mapping/SKILL.md` | Reescritura completa |
| Template | `registry/skills/template-wizard/resources/templates/story-map-template.md` | Actualizar estructura a 4 niveles |

## Brechas identificadas

| Brecha | Actual (incorrecto) | Propuesto (Patton) |
|--------|---------------------|---------------------|
| Jerarquía incompleta | 3 niveles: Activity → Step → Story | 4 niveles: Goal → Activity → Task → Story |
| Eje horizontal | "orden cronológico" | Flujo narrativo ("¿cómo le explicarías el sistema a alguien?") |
| Sin tests de validación | No tiene | Tests por nivel integrados en el flujo |
| Sin árbol de decisión | No tiene | Flowchart para clasificar elementos ambiguos |
| Conceptos no-acción | No los menciona | Tabla de clasificación + sección `## Notas técnicas` |
| Fases Modo B superficiales | "fase guiada → captura libre" | 6 fases: Preparación → Backbone → Tasks → Stories → Priorización → Validación |
| Sin checklist de validación | No tiene | 7 ítems, ejecución automática al cierre |
| Sin errores comunes | No tiene | 6 patrones detectados proactivamente |
| Colores inconsistentes | 🟪 Activity | 🟡 Activity, 🔵 Task, ⬜ Story |
| Sin guía de priorización | Menciona releases superficialmente | Dot voting, preguntas clave, sanity checks del MVP |

## Decisiones de diseño

| Decisión | Elección | Razón |
|----------|----------|-------|
| Estructura de modos | Mantener 3 modos (A: Generar, B: Acompañar, C: Actualizar) | Funcionan bien, la mejora es en calidad metodológica |
| Paso 0 autodescubrimiento | Sin cambios | Ya funciona correctamente |
| Integraciones ecosistema | Sin cambios | docs-system-orchestrator, discovery-assistant ya integrados |
| Ubicación documento | `docs/50-projects/story-map.md` (mantener, evaluar después) | Consistente con discovery-assistant |
| Terminación | Sin cambios | Ya funciona correctamente |

---

## Mejora 1: Modelo jerárquico — 4 niveles Jeff Patton

### Nivel 1 — Goal (Objetivo)

- **Pregunta clave:** "¿Por qué existe este producto?"
- Es uno solo para todo el mapa (o muy pocos)
- No es una tarjeta del backbone, es el título/encabezado del mapa
- Es la razón de ser del sistema

**Test de validación:**
- ¿Tu sistema entero existe para resolver esto? → Es un Goal
- Si es solo una parte del sistema → Baja de nivel

### Nivel 2 — Activity (🟡 Actividad)

- **Pregunta clave:** "¿Qué está HACIENDO el usuario en este momento?"
- Forman el backbone (fila superior del mapa), de izquierda a derecha
- Son verbos/frases de acción: "Gestionar usuarios", "Consultar reportes"

**Tests de validación:**
- ¿Es un verbo/acción? → Si no, no es Activity
- ¿Contiene múltiples pasos? → Si no tiene pasos internos, es una Task
- ¿Un usuario puede "hacer" esto? → Si es abstracto, es un concepto de negocio (fuera del mapa)
- ¿Se explica en una frase? → Si necesitas un párrafo, divídela

**Bien:** "Gestionar órdenes de compra", "Agendar entrega"
**Mal:** "Logística" (dominio), "Ingresar credenciales" (demasiado pequeño, es Task)

### Nivel 3 — Task (🔵 Tarea)

- **Pregunta clave:** "¿Cuáles son los pasos que el usuario sigue dentro de esta actividad?"
- Van debajo de su Activity padre, de izquierda a derecha
- Acción concreta y específica dentro de una actividad más grande

**Tests de validación:**
- ¿Pertenece claramente a una Activity? → Si no, quizás es una Activity por sí misma
- ¿Es una acción unitaria? → Si tiene sub-pasos, puede ser una Activity
- ¿Describe lo que hace el usuario, no lo que construye el equipo? → Lo que construye el equipo son Stories

**Bien** (dentro de "Gestionar OCs"): "Ver listado de OCs", "Filtrar por estado", "Aceptar una OC"
**Mal:** "Endpoint REST para listar OCs" (detalle técnico), "Como operador, quiero..." (es Story)

### Nivel 4 — Story (⬜ Historia de usuario)

- **Pregunta clave:** "¿Qué exactamente va a construir el equipo de desarrollo?"
- Se apilan verticalmente debajo de su Task padre, priorizadas de arriba a abajo
- Formato: "Como [rol], quiero [acción] para [beneficio]"

**Tests de validación:**
- ¿El equipo puede construir esto en 1-2 sprints? → Si es más grande, divídela
- ¿Tiene un Definition of Done claro? → Si no, es demasiado vaga
- ¿Empieza con "Como [rol], quiero..."? → No obligatorio, pero confirma que es Story

### Eje horizontal — Flujo narrativo

El eje horizontal NO es secuencia estricta. Es flujo narrativo.

- **Pregunta clave para ordenar:** "¿En qué orden le explicarías el sistema a alguien que no lo conoce?"
- Puede tener actividades paralelas o cíclicas
- No es un diagrama de flujo, BPMN ni timeline de implementación

### Árbol de decisión para elementos ambiguos

```
¿Es algo que un usuario HACE en el sistema?
├── No → ¿Es un concepto de negocio/dominio?
│   ├── Sí → Agrupador visual encima del backbone
│   └── No → Fuera del mapa (requisito técnico, spike, constraint)
└── Sí → ¿Tiene múltiples pasos internos?
    ├── No → Es una TASK 🔵
    └── Sí → ¿Es demasiado grande para una sola sesión de trabajo?
        ├── Sí → Es una ACTIVITY 🟡
        └── No → ¿Se puede implementar en 1-2 sprints?
            ├── Sí → Es una STORY ⬜
            └── No → Divídela en varias Stories
```

---

## Mejora 2: Estructura del template markdown

```markdown
---
project: {nombre}
goal: "{objetivo del producto}"
created: YYYY-MM-DD
last_session: YYYY-MM-DD
status: draft | in-progress | validated
personas:
  - name: {nombre}
    role: {rol}
    goal: {objetivo principal}
---

# Story Map — {Nombre del Proyecto}

## Goal
> {Objetivo del producto — una frase que responde "¿por qué existe este sistema?"}

## Personas

### {Persona 1}
- **Rol:** {rol}
- **Objetivo:** {goal}
- **Pain points:** {problemas principales}

## Backbone

### 🟡 {Actividad 1}

#### 🔵 Task: {Tarea 1.1}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S | Acceptance: {criterio}
- **[R2]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_

#### 🔵 Task: {Tarea 1.2}
- **[MVP]** {Story title}
  - ...

### 🟡 {Actividad 2}
...

## Release Summary

| Release | Stories | Effort estimate | Goal |
|---------|---------|-----------------|------|
| MVP | {n} | {S/M/L} | {qué puede hacer el usuario end-to-end} |
| Release 2 | {n} | {S/M/L} | {qué agrega} |
| Backlog | {n} | — | {ideas para futuro} |

## Notas técnicas

Elementos que no son acciones del usuario pero son relevantes para el proyecto:

| Tipo | Descripción | Vinculado a |
|------|-------------|-------------|
| {NFR/Integración/Spike/...} | {descripción} | {Activity o Task relacionada} |

## Changelog

- [{fecha}] Sesión {n}: {resumen de qué se hizo}
```

Cambios vs template actual:
- Sección `## Goal` nueva al inicio
- `goal` en el frontmatter
- `🟪` → `🟡` para Activities
- `#### Step:` → `#### 🔵 Task:`
- Sección `## Notas técnicas` nueva

---

## Mejora 3: Tabla de conceptos no-acción

| Concepto | Ejemplo | Dónde va |
|----------|---------|----------|
| Capacidad de negocio | "Logística", "Due Diligence" | Fuera del mapa — agrupador visual. Se documenta como contexto, no como Activity |
| Requisito técnico / NFR | "Soportar 1000 usuarios concurrentes" | Fuera del mapa — sección `## Notas técnicas` |
| Integración con sistema externo | "Recibir datos vía API desde ERP" | Como Story debajo de la Task que necesita esos datos |
| Proceso batch / automatizado | "Carga nocturna de datos" | Como Story técnica debajo de la Activity que consume esos datos |
| Feature transversal | "Multilenguaje", "Auditoría" | Columna separada al final del backbone, o Stories repetidas bajo varias Tasks |
| Spike / investigación | "Evaluar WebSockets vs polling" | Fuera del mapa — sección `## Notas técnicas` |

**Comportamiento de la skill:** Cuando el usuario proponga un elemento no-acción, la skill lo identifica, explica por qué no entra en el mapa, y sugiere dónde documentarlo.

---

## Mejora 4: Fases de ejecución del Modo B

El Modo B pasa de "fase guiada → captura libre" a 6 fases alineadas con la guía de Notion:

| Fase | Qué se hace | Modalidad | Principio |
|------|-------------|-----------|-----------|
| 0. Preparación | Recopilar insumos, proponer borrador de backbone | Individual | Llegar con un borrador, no con lienzo en blanco |
| 1. Backbone | Definir y validar solo Activities | Grupal | NO bajar a Tasks. Divergencia → Convergencia → Lectura en voz alta |
| 2. Tasks | Descomponer cada Activity en Tasks | Grupal | Activity por activity, izquierda a derecha. Timer: si >25 min, dividir |
| 3. Stories | Escribir historias debajo de cada Task | Mixto | Escritura individual + revisión grupal |
| 4. Priorización | Trazar líneas de release (MVP, R2, R3) | Grupal | Dot voting, sanity checks |
| 5. Validación | Ejecutar checklist sobre el mapa completo | Grupal | 7 ítems de verificación |

**Principio clave:** No bajar de nivel prematuramente. La skill señala cuando el usuario salta niveles.

**Al inicio del Modo B la skill pregunta:** "¿En qué fase estamos?" para retomar donde se dejó.

---

## Mejora 5: Guía de priorización (Fase 4)

1. Recorrer el mapa completo — recordar constraints
2. Por cada Activity: "¿Qué Stories son imprescindibles para que el sistema funcione desde el primer día?"
3. Si hay desacuerdo → dot voting (3 votos por persona por Activity)
4. Trazar línea de MVP → validar: "Si entregamos SOLO esto, ¿un usuario puede completar su flujo básico de principio a fin?"
5. Sanity checks:
   - Demasiado grande: "¿Puedes quitar Stories y que siga funcionando?"
   - Demasiado pequeño: "Si quitas cualquier Story, ¿deja de funcionar?"
6. Releases posteriores: agrupar sin ser muy preciso

---

## Mejora 6: Checklist de validación (7 ítems)

Ejecución automática al cierre de cualquier modo:

- [ ] ¿Cada Activity responde a "qué hace el usuario"? Si es abstracto, no es Activity
- [ ] ¿Cada Task pertenece claramente a una Activity? Si es huérfana, falta una Activity
- [ ] ¿Las Stories son implementables? El equipo debería poder estimar cada una
- [ ] ¿El MVP tiene sentido como producto mínimo? Ni sobredimensionado ni subdimensionado
- [ ] ¿Hay gaps? Leer el backbone de izquierda a derecha — ¿falta algún paso obvio?
- [ ] ¿Las features transversales están contempladas? (autenticación, auditoría, etc.)
- [ ] ¿Cada persona tiene camino en el mapa? Recorrer como cada tipo de usuario

---

## Mejora 7: Detección proactiva de errores comunes

| Error | Detección | Respuesta de la skill |
|-------|-----------|----------------------|
| Capacidad de negocio como Activity | Elemento no es verbo/acción | "'{X}' parece un dominio, no una acción. ¿Qué hace el usuario dentro de {X}?" |
| Story escrita como Task | Formato "Como... quiero..." en nivel de Task | "Esto parece una Story. La bajo al nivel correcto debajo de la Task." |
| Backbone como secuencia estricta | Usuario dice "primero esto, después esto" | "El orden es narrativo, no secuencial. ¿En qué orden le explicarías el sistema a alguien nuevo?" |
| Detalle técnico como tarjeta | "Endpoint REST", "API de..." | "Esto es un detalle técnico. Lo documento en Notas técnicas y lo vinculo a la Story que lo necesita." |
| Story demasiado grande | No estimable en 1-2 sprints | "Esta Story parece demasiado grande. ¿La dividimos?" |
| Task sin Activity padre | Task huérfana | "¿A qué actividad del usuario pertenece esta tarea?" |

---

## Mejora 8: Cambios a Modo A (Generar)

La estructura de pasos se mantiene con estos ajustes:

| Paso | Cambio |
|------|--------|
| A1. Fuentes | Sin cambios |
| A2. Personas | Sin cambios |
| A3. Backbone | Solo Activities — aplicar tests de nivel 2. Flujo narrativo. Confirmar antes de bajar |
| **A3b. Tasks** (nuevo) | Tras confirmar backbone, proponer Tasks por Activity. Aplicar tests de nivel 3. Confirmación separada |
| A4. Stories | Por Task (no por Step). Aplicar tests de nivel 4. Clasificar no-acciones |
| A5. Generar | Incluir `## Goal`, `## Notas técnicas`. Ejecutar checklist de validación |

**Cambio principal:** 3 gates de confirmación separados (Backbone → Tasks → Stories).

## Mejora 9: Cambios a Modo C (Actualizar)

- Renombrar "step" a "task" en toda la lógica
- Aplicar árbol de decisión al agregar elementos
- Ejecutar checklist de validación al cerrar

## Mejora 10: Reglas transversales actualizadas

Las 6 reglas actuales se mantienen con ajustes:
- "Respeta la estructura Jeff Patton" → **Goal → Activity → Task → Story** (4 niveles)
- "Confirma el backbone antes de las stories" → **3 gates: backbone → tasks → stories**
- Nueva: **"El eje horizontal es flujo narrativo, no secuencia estricta."**
- Nueva: **"No bajes de nivel prematuramente."** Si aparece una task/story en fase de backbone, anotar para después.

---

## Lo que NO cambia

- Los 3 modos de operación (Generar, Acompañar, Actualizar)
- El Paso 0 de autodescubrimiento de contexto
- La integración con el ecosistema (docs-system-orchestrator, discovery-assistant, processes.json)
- La ruta de Miro futuro
- La ubicación del documento generado (`docs/50-projects/`)
- La fase de terminación
