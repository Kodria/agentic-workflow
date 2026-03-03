---
description: Ejecuta un plan de trabajo existente usando la skill executing-plans
---

# Executing Plans

> [!IMPORTANT]
> Este workflow ejecuta un plan de trabajo existente. Sigue estrictamente la skill `executing-plans`.

Este workflow ejecuta un plan de trabajo existente generado previamente por la skill `writing-plans`.

## Pasos

1. Verificar que existe un plan de trabajo generado previamente en `docs/plans/`.
2. Si **NO** existe un plan, informar al usuario y sugerir ejecutar primero `/writing-plans`.
3. Leer las instrucciones de la skill `executing-plans` ubicada en la carpeta de skills (`~/.agents/skills/executing-plans/SKILL.md`). Usa la herramienta `view_file` para leer el archivo `SKILL.md` de la skill.
4. Seguir **todos** los pasos definidos en la skill `executing-plans` sin omitir ninguno.
5. La skill encadenará automáticamente hacia `finishing-a-development-branch` al terminar. Permitir que el encadenamiento natural ocurra.

## Notas

- Seguir estrictamente las instrucciones de la skill seleccionada.
- La skill maneja la ejecución en batches con checkpoints de revisión entre batches.
- No mezclar skills ni alterar el flujo definido en la skill.