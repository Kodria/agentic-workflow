---
template_purpose: "Framework de User Story Mapping para planificación de producto siguiendo la metodología de Jeff Patton (4 niveles: Goal → Activity → Task → Story). Permite documentar progresivamente el mapa de historias de usuario a través de sesiones de planning colaborativas."
interview_questions:
  - "nombre_proyecto: ¿Cuál es el nombre del proyecto o producto?"
  - "goal_producto: ¿Cuál es el objetivo principal del producto? (una frase que responda '¿por qué existe este sistema?')"
  - "personas: ¿Quiénes son los usuarios o personas principales del producto?"
  - "contexto_inicial: ¿Hay documentación existente del proyecto (discovery, specs, notas) que deba leer?"
  - "releases_planificados: ¿Cuántos releases o incrementos tienen en mente? (ej. MVP, Release 2, Backlog)"
---

# Story Map — {nombre_proyecto}

## Goal
> {goal_producto — una frase que responde "¿por qué existe este sistema?"}

## Personas

### {Persona 1}
- **Rol:** …
- **Objetivo:** …
- **Pain points:** …

## Backbone

> 🟡 Activities: grandes bloques del viaje del usuario (flujo narrativo, no secuencia estricta). 🔵 Tasks: pasos concretos dentro de cada actividad. ⬜ Stories: organizadas verticalmente por release — más arriba = más prioritario.

### 🟡 {Actividad 1}

#### 🔵 Task: {Tarea 1.1}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S/M/L | Acceptance: …
- **[Release 2]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S/M/L | Acceptance: …
- **[Backlog]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S/M/L | Acceptance: …

#### 🔵 Task: {Tarea 1.2}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S/M/L | Acceptance: …

### 🟡 {Actividad 2}

#### 🔵 Task: {Tarea 2.1}
- **[MVP]** {Story title}
  - _Como {persona}, quiero {acción} para {beneficio}_
  - Status: pending | Effort: S/M/L | Acceptance: …

## Release Summary

| Release | Stories | Effort estimate | Goal |
|---------|---------|-----------------|------|
| MVP | 0 | — | … |
| Release 2 | 0 | — | … |
| Backlog | 0 | — | … |

## Notas técnicas

Elementos que no son acciones del usuario pero son relevantes para el proyecto:

| Tipo | Descripción | Vinculado a |
|------|-------------|-------------|
| {NFR/Integración/Spike/…} | {descripción} | {Activity o Task relacionada} |

## Changelog

- [YYYY-MM-DD] Sesión 1: Story Map creado — …
