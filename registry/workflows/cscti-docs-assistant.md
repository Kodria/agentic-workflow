---
description: Inicia el flujo de asistencia documental para aplicar el estándar de CSCTI a un archivo en docs/drafts/.
---

# Flujo de CSCTI Docs Assistant

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo requiere seguir iterativamente un paso a paso para refinar documentos en base a reglas de repositorio.

## Pasos

1. Leer las instrucciones de la skill `cscti-docs-assistant` ubicada en la carpeta de skills globales (`~/.agents/skills/cscti-docs-assistant/SKILL.md`). Usa la herramienta `view_file` para leer el archivo `SKILL.md`.
2. Ejecutar **todos** los pasos definidos en la skill `cscti-docs-assistant` de forma estricta (Context Gathering -> Format Analysis -> Structure Analysis -> Content Refinement -> Finalization & Indexing).
3. Mantener una interacción conversacional realizando una única pregunta iterativa por turno a la hora de refinar el contenido.
4. Al terminar el refino, mover el documento a su destino final y actualizar los índices correspondientes, permitiendo al usuario realizar el commit al final.
