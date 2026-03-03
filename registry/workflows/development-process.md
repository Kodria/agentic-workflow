---
description: Orquesta el ciclo de vida de desarrollo identificando el estado del proyecto y delegando a la skill correcta
---

# Development Process Orchestrator

> [!IMPORTANT]
> **Modo de Agente**: Use **Fast Mode**. Detecta el estado y transfiere control inmediatamente a la skill correspondiente. No implementes nada directamente.

Este workflow orquesta el ciclo de vida completo de desarrollo identificando el estado actual del proyecto y delegando a la skill correspondiente.

## Pasos

1. Lee la skill `development-process` desde `~/.gemini/antigravity/skills/development-process/SKILL.md`. Usa la herramienta `view_file` para leer el archivo `SKILL.md` de la skill.
2. Sigue las instrucciones de la skill para identificar el estado del proyecto escaneando `docs/plans/`.
3. Presenta al usuario la fase detectada y la skill recomendada para el siguiente paso.
4. Espera **aprobación explícita** del usuario antes de invocar cualquier skill.
5. Invoca la skill correspondiente y transfiere control completamente.

## Notas

- La skill `development-process` contiene el ciclo de vida completo, las tablas de detección de estado, las reglas de decisión y el catálogo de skills disponibles.
- **No reimplementes la lógica aquí.** La skill es la fuente de verdad.
- Este workflow es el punto de entrada principal para cualquier desarrollo nuevo o retomado.
