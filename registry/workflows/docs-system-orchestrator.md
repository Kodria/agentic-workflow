---
description: Orquesta el ecosistema de documentación identificando la necesidad del proyecto y delegando a la skill correcta
---

# Docs System Orchestrator

> [!IMPORTANT]
> **Modo de Agente**: Use **Fast Mode**. Detecta el estado y transfiere control inmediatamente a la skill correspondiente. No implementes nada ni generes documentos directamente.

Este workflow orquesta el ciclo completo de documentación identificando la necesidad actual y delegando a la skill de documentación adecuada.

## Pasos

1. Lee la skill `docs-system-orchestrator` desde `~/.gemini/antigravity/skills/docs-system-orchestrator/SKILL.md`. Usa la herramienta `view_file` para leer el archivo `SKILL.md` de la skill.
2. Sigue las instrucciones de la skill para identificar la necesidad basándose en el contexto y la petición del usuario.
3. Presenta al usuario la necesidad detectada y la skill recomendada para el siguiente paso.
4. Espera **aprobación explícita** del usuario antes de invocar cualquier skill.
5. Invoca la skill correspondiente y transfiere control completamente.

## Notas

- La skill `docs-system-orchestrator` contiene las reglas Docs-as-Code, las tablas de enrutamiento y el catálogo de skills de documentación disponibles.
- **No reimplementes la lógica aquí.** La skill es la fuente de verdad.
- Este workflow es el punto de entrada principal para cualquier requerimiento de documentación técnico, de negocio o de plantillas.
