# Development Process Orchestrator

> [!IMPORTANT]
> Este workflow delega toda la lógica de orquestación a la skill `development-process`. No dupliques la lógica aquí.

## Cuándo Usar

- Al iniciar cualquier tarea de desarrollo nueva
- Al retomar trabajo en progreso
- Cuando no sabes qué skill invocar a continuación

## Proceso

1. Lee la skill `development-process` desde `~/.gemini/antigravity/skills/development-process/SKILL.md`.
2. Sigue las instrucciones de la skill: identificar estado del proyecto, presentar recomendación, esperar aprobación, invocar la skill correspondiente.
3. La skill contiene el ciclo de vida completo, las tablas de detección de estado, las reglas de decisión y la lista de todas las skills disponibles.

**No reimplementes la lógica aquí.** La skill es la fuente de verdad.
