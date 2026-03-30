# Design: Skill `story-mapping`

## Propósito

Skill de acompañamiento para sesiones de User Story Mapping (metodología Jeff Patton). Lee contexto de documentación existente del proyecto, facilita la construcción colaborativa del mapa en sesiones de planning, y persiste el resultado en markdown como fuente de verdad con capacidad de sincronización futura a herramientas visuales (Miro u otras).

## Decisiones de diseño

| Decisión | Elección | Razón |
|----------|----------|-------|
| Salida principal | Markdown como fuente de verdad | Docs-as-Code, retomabilidad multi-sesión, independiente de servicios externos |
| Salida visual | Miro como capa futura (no bloqueante) | Se puede agregar incrementalmente vía MCP; la estructura markdown permite mapeo 1:1 |
| Contexto de entrada | Documentos indicados por el usuario o búsqueda en repo de docs | Flexible: funciona con o sin discovery previo |
| Formato de persistencia | Estructura jerárquica con metadata por story | Parseable, actualizable programáticamente, mapeable a Miro |
| Sesiones | Changelog ligero en el documento | Captura contexto que git no registra, sin la ceremonia completa de session log |
| Integración orchestrator | Skill independiente + invocable desde discovery | Modular: valor propio + sinergia con discovery cuando hay contexto |
| Modos de operación | Generar + Acompañar en vivo + Actualizar | Cubre todo el ciclo: desde documentación existente hasta sesiones iterativas |
| Acompañamiento en vivo | Guiado para backbone/steps + captura libre para stories | Lo crítico (backbone) se estructura bien; las stories fluyen naturalmente |

## Modos de operación

| Modo | Trigger | Descripción |
|------|---------|-------------|
| **A: Generar** | Usuario pide crear Story Map desde documentación existente | Lee documentos indicados (o busca en el repo de docs si no se indican), extrae personas/flujos/problemas, propone backbone + steps + stories iniciales |
| **B: Acompañar en vivo** | Usuario inicia sesión de planning | Fase guiada para backbone/steps, captura libre para stories/releases. Alternables |
| **C: Actualizar** | Existe story-map document previo | Retoma sesión anterior, muestra changelog y estado actual, permite agregar/repriorizar/reslicear |

## Estructura del documento Story Map

```markdown
---
project: {nombre}
created: YYYY-MM-DD
last_session: YYYY-MM-DD
status: draft | in-progress | validated
personas:
  - name: {nombre}
    role: {rol}
    goal: {objetivo principal}
---

# Story Map — {Nombre del Proyecto}

## Personas

### {Persona 1}
- **Rol:** {rol}
- **Objetivo:** {goal}
- **Pain points:** {problemas principales}

## Backbone

### 🟪 {Actividad 1}

#### Step: {Paso 1.1}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S | Acceptance: {criterio}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: M
- **[R2]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: L

#### Step: {Paso 1.2}
- **[MVP]** {Story title}
  - ...
- **[Backlog]** {Story title}
  - ...

### 🟪 {Actividad 2}
...

## Release Summary

| Release | Stories | Effort estimate | Goal |
|---------|---------|-----------------|------|
| MVP | {n} | {S/M/L} | {qué puede hacer el usuario end-to-end} |
| Release 2 | {n} | {S/M/L} | {qué agrega} |
| Backlog | {n} | — | {ideas para futuro} |

## Changelog

- [{fecha}] Sesión {n}: {resumen de qué se hizo}
```

## Flujo de cada modo

### Modo A — Generar desde documentación

1. Recibir documentos fuente (explícitos o buscar en repo)
2. Extraer: personas, flujos, problemas, scope/MVP si existe
3. Proponer backbone (actividades + steps) — confirmar con usuario
4. Proponer stories por step organizadas en releases — confirmar
5. Generar documento y agregar entrada en changelog

### Modo B — Acompañar en vivo

1. Setup: identificar proyecto, cargar documento existente o crear nuevo
2. **Fase guiada:** Definir personas → backbone → steps (pregunta por pregunta)
3. **Fase captura libre:** Usuario describe stories en cualquier orden, skill las ubica en el step y release correcto
4. Usuario puede alternar entre modos guiado y libre
5. Cierre de sesión: resumen de cambios, actualizar changelog, guardar documento

### Modo C — Actualizar

1. Cargar documento existente
2. Mostrar estado actual: último changelog, stats (n actividades, n steps, n stories por release)
3. Aceptar actualizaciones: nuevas stories, repriorización, cambio de release, refinamiento de criterios
4. Actualizar changelog al cerrar

## Integración con el ecosistema

### docs-system-orchestrator

Nueva entrada en catálogo de routing:

| Necesidad | Skill Destino | Cuándo usar |
|-----------|---------------|-------------|
| User Story Mapping | `story-mapping` | Crear, actualizar o facilitar sesiones de Story Mapping para planificación de producto. Invocable directamente o sugerida desde discovery. |

### discovery-assistant

Cuando el documento de discovery tiene Etapa 1+ completada (personas, problema, scope definidos), discovery puede sugerir: _"El proyecto tiene suficiente contexto para iniciar un Story Map. ¿Quieres invocar story-mapping?"_

### processes.json

Agregar `"story-mapping"` al array de skills del proceso `"docs"`.

### Ubicación del documento generado

`docs/50-projects/{project-name}/story-map.md` (consistente con donde vive discovery).

## Ruta a Miro (futuro)

La estructura jerárquica del markdown permite mapeo directo:

| Elemento markdown | Elemento Miro |
|-------------------|---------------|
| `### 🟪 {Actividad}` | Frame rosa (backbone) |
| `#### Step: {Paso}` | Sticky note azul dentro del frame |
| `- **[MVP]** {Story}` | Sticky note amarillo, posición Y según release |
| `- **[R2]** {Story}` | Sticky note amarillo, más abajo |
| `## Release Summary` | Líneas divisorias horizontales |

Cuando se integre un MCP de Miro (oficial o comunitario), la skill podría tener un comando de sync que parsee el markdown y cree/actualice el board.

### MCP Servers disponibles para Miro

| Server | Tipo | Capacidades | Notas |
|--------|------|-------------|-------|
| `miroapp/miro-ai` | Oficial | Diagramas, documentos, tablas | No tiene sticky notes/frames nativos |
| `LuotoCompany/mcp-server-miro` | Comunitario | REST API completa: sticky notes, frames, conectores, posicionamiento | Requiere `MIRO_API_TOKEN` + `MIRO_BOARD_ID` |

## No incluido (YAGNI)

- Sincronización bidireccional Miro → markdown
- Integración con Jira/issue trackers
- Estimación automática de effort
- Exportación a CSV/PDF
