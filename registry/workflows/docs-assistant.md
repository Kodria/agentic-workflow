---
description: Inicia el flujo de asistencia documental para aplicar el estándar Docs-as-Code a un archivo en docs/drafts/.
---

# Flujo de Docs-as-Code Assistant

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo requiere seguir iterativamente un paso a paso para refinar documentos en base a reglas de repositorio.

## Pasos

1. Usar tus herramientas de búsqueda de archivos para localizar dinámicamente la skill `docs-assistant` (buscar `docs-assistant/SKILL.md` en las carpetas de skills disponibles). Leer el archivo `SKILL.md` encontrado con `view_file`.
2. Ejecutar **todos** los pasos definidos en la skill `docs-assistant` de forma estricta (Context Gathering -> Format Analysis -> Structure Analysis -> Content Refinement -> Finalization & Indexing).
3. Mantener una interacción conversacional realizando una única pregunta iterativa por turno a la hora de refinar el contenido.
4. Al terminar el refino, mover el documento a su destino final y actualizar los índices correspondientes, permitiendo al usuario realizar el commit al final.
