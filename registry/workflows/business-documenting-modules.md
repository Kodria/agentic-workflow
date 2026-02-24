---
description: Documenta módulos a nivel de negocio para Notion usando business-documenting-modules
---

# Business Documenting Modules

> [!IMPORTANT]
> **Modo de Agente**: Use **Fast Mode**. El objetivo es evaluar y documentar el valor de negocio de manera eficiente.

Este workflow analiza los recientes desarrollos para determinar si constituyen un módulo de negocio funcional y, de ser así, automatiza la creación de documentación de alto nivel (orientada a Notion).

## Pasos

1.  Leer las instrucciones de la skill `business-documenting-modules` ubicada en la carpeta de skills globales (`~/.agents/skills/business-documenting-modules/SKILL.md`). Usa la herramienta `view_file`.
2.  Seguir **todos** los pasos definidos en la skill, prestando **especial atención al Paso 1 (Intelligent Filtering)** para decidir si aplica la documentación o no.
3.  Si aplica, generar los archivos en `docs/business-knowledge` utilizando la plantilla definida en la skill.

## Notas

-   Asegurar que la evaluación de "Módulo Funcional vs Tarea Técnica" sea estricta.
-   La documentación generada debe estar en español y libre de jerga excesivamente técnica, ideal para exportar a Notion.
