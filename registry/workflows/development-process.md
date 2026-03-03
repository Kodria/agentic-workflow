# Development Process Orchestrator

> [!IMPORTANT]
> Este workflow orquesta el ciclo de vida completo de desarrollo. No implementa nada directamente - identifica el estado del proyecto y delega a la skill correcta.

## Cuándo Usar

- Al iniciar cualquier tarea de desarrollo nueva
- Al retomar trabajo en progreso
- Cuando no sabes qué skill invocar a continuación

## Proceso

### 1. Identificar Estado del Proyecto

Escanea `docs/plans/` buscando artefactos existentes para el tema actual:

| Artefactos encontrados | Estado | Skill a invocar |
|------------------------|--------|-----------------|
| Sin design ni plan | **Nuevo** | `brainstorming` |
| `*-design.md` sin `*-plan.md` | **Diseñado** | `writing-plans` |
| `*-plan.md` con tareas pendientes | **En ejecución** | `executing-plans` o `subagent-driven-development` |
| `*-plan.md` con todas las tareas completas | **Finalizando** | `finishing-a-development-branch` |

### 2. Presentar Estado al Usuario

Reporta:
- Fase actual y artefactos detectados
- Skill recomendada para el siguiente paso
- Justificación de la recomendación

### 3. Esperar Aprobación Explícita

**Nunca invoques la siguiente skill sin confirmación del usuario.**

### 4. Invocar Skill y Transferir Control

La skill invocada toma control completo de la sesión.

## Skills del Ciclo de Vida

### Pipeline (fases secuenciales)

1. **`brainstorming`** - Explora requisitos, diseña solución, genera `*-design.md`
2. **`writing-plans`** - Convierte diseño en plan de implementación paso a paso
3. **`executing-plans`** / **`subagent-driven-development`** - Ejecuta el plan (sesión separada o misma sesión)
4. **`finishing-a-development-branch`** - Merge, PR o limpieza del branch

### Cross-cutting (durante cualquier fase)

- **`test-driven-development`** - Obligatorio durante toda implementación
- **`systematic-debugging`** - Cuando ocurra cualquier bug o fallo
- **`requesting-code-review`** - Después de tareas, features o antes de merge
- **`receiving-code-review`** - Al procesar feedback de code review
- **`verification-before-completion`** - Antes de cualquier claim de completitud

## Reglas de Decisión

- "Construir X" sin design/plan → `brainstorming`
- "Fix bug" → `systematic-debugging`, luego `test-driven-development`
- "Continuar" → Escanear `docs/plans/`, determinar fase, invocar skill
- "Revisar esto" → `requesting-code-review`
