---
description: Invoca al orquestador del ecosistema de documentación. Analiza tu necesidad, elige la skill correcta y te guía de forma interactiva en la creación del documento bajo estándares estrictos.
---

# Docs System Orchestrator Workflow

1. Usa tus herramientas de búsqueda de archivos para localizar dinámicamente la skill `docs-system-orchestrator` (buscar `docs-system-orchestrator/SKILL.md` en las carpetas de skills disponibles). Lee el archivo `SKILL.md` encontrado con `view_file`.
2. Sigue las **Instrucciones de Ejecución** de la skill seleccionada al pie de la letra, pero **siempre en modo interactivo**.
3. El orquestador actuará como un Router Inteligente: analizará la petición del usuario para invocar la skill de documentación adecuada (ej. `template-wizard`, `documenting-modules`, etc.).
4. **REGLA ESTRICTA DE PLANTILLAS (DOCS-AS-CODE):** Antes de generar cualquier contenido nuevo, el agente DEBE validar que exista una plantilla (`template`) oficial que se ajuste a la necesidad del usuario.
   - **Prohibido inventar estructuras:** El agente NUNCA debe inventar un formato de documento por su cuenta.
   - **Adopción Dinámica de la Skill (Creación on-the-fly):** Si no existe un template adecuado para lo que el usuario pide (ej. un template para "Proyectos"), el agente **NO DEBE** inventar uno ni abortar la sesión. En su lugar, DEBE pausar momentáneamente el flujo actual, buscar y leer dinámicamente la skill `template-manager` (ej. buscando `template-manager/SKILL.md`) y ejecutar sus pasos para guiar al usuario interactivamente en la creación de un nuevo template local. Una vez que este template se apruebe y guarde en `docs/templates/`, el Agente DEBE retomar automáticamente el flujo original de documentación usando el template recién creado.
     - *Nota Crítica:* Los templates creados DEBEN ser siempre agnósticos a la tecnología o a la lógica de negocio; es decir, deben ser estándares genéricos reutilizables.
5. **Aprobación e iteración requerida:** Incluso si el agente cuenta con todo el contexto técnico necesario para llenar un template válido, debe presentar un borrador o resumen estructural al usuario y **esperar su confirmación** antes de dar por finalizado el documento o actualizar los índices (como los archivos `README.md`).
   - **Aprobación directa:** Si el usuario aprueba el borrador sin observaciones, el agente procede a finalizar y escribir los archivos correspondientes.
   - **Ciclo de iteración:** Si el usuario desea modificar, extender o iterar sobre el borrador propuesto, el agente **iniciará la etapa interactiva** de la skill correspondiente (ej. `template-wizard` o `docs-assistant`), respetando y guiando el proceso pregunta a pregunta de manera fiel al comportamiento definido en dicha skill.
