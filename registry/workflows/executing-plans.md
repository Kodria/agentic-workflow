---
description: Ejecuta un plan de trabajo existente usando la skill adecuada según el contexto
---

# Executing Plans

> [!IMPORTANT]
> **Modo de Agente**: Use **Fast Mode**. El objetivo es la ejecución inmediata y directa basándose en la lógica de decisión de este workflow.

Este workflow ejecuta un plan de trabajo existente seleccionando la skill correcta según el contexto de la sesión y la naturaleza de las tareas.

## Pasos

### 1. Verificar existencia del plan
- Confirmar que existe un plan de trabajo generado previamente (por ejemplo, con el workflow `/writing-plans`).
- Si **NO** existe un plan, informar al usuario y sugerir ejecutar primero `/writing-plans`.

### 2. Analizar las tareas del plan
- Revisar las tareas definidas en el plan de trabajo.
- Determinar si las tareas son **independientes** entre sí (no tienen dependencias secuenciales).

### 3. Verificar contexto de la sesión
- Determinar si estás en la **misma sesión** donde se creó el plan de trabajo.
- Indicadores de misma sesión: tienes acceso directo al plan en el contexto de la conversación actual, conoces las decisiones y discusiones previas que llevaron al plan.

### 4. Seleccionar y ejecutar la skill correcta

```
¿Tengo un plan de trabajo?
├── NO → Informar al usuario. Sugerir ejecutar /writing-plans primero.
└── SI → ¿Las tareas son independientes?
    └── SI → ¿Estoy en la misma sesión del plan?
    │   ├── SI → Ejecutar skill: subagent-driven-development
    │   └── NO → Ejecutar skill: executing-plans
    └── NO → Ejecutar skill: executing-plans
```

#### Opción A: `subagent-driven-development`
- **Condición**: Tareas independientes + misma sesión (hay contexto disponible).
- Leer la skill `subagent-driven-development` (`~/.agents/skills/subagent-driven-development/SKILL.md`) y seguir sus instrucciones.

#### Opción B: `executing-plans`
- **Condición**: Tareas con dependencias O sesión diferente (sin contexto previo).
- Leer la skill `executing-plans` (`~/.agents/skills/executing-plans/SKILL.md`) y seguir sus instrucciones.

## Notas

- Seguir estrictamente las instrucciones de la skill seleccionada.
- No mezclar skills: ejecutar **solo una** según la decisión tomada en el paso 4.