# Plan de Corrección Integral: Desacoplar Skills del Flujo de Ejecución

## Análisis del Problema
Actualmente, el framework base tiene un patrón de _skill-chaining_ (encadenamiento de skills) incrustado en su código, lo cual asume flujos continuos y rompe con nuestro nuevo principio de Orquestación Central donde **`development-process` es el único autorizado para proponer transiciones de fase**.

Tras una auditoría del pipeline completo, hemos detectado que 4 skills críticas intentan transicionar de estado sin pasar por el orquestador:
1. `brainstorming`: Invoca inmediatamente `writing-plans`.
2. `writing-plans`: Invoca directamente la ejecución.
3. `executing-plans`: Invoca automáticamente `finishing-a-development-branch`.
4. `subagent-driven-development`: Igual que la anterior, trata de finalizar la rama automáticamente.

## Proposed Changes

La solución universal para todas estas skills es borrar sus instrucciones de encadenamiento y, en su lugar, estandarizar un comportamiento de salida `<TERMINATION_PHASE>` que devuelva amablemente el control al usuario o al flujo del orquestador.

### Skills Principales

#### [MODIFY] brainstorming/SKILL.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/skills/brainstorming/SKILL.md)
- Eliminar el "Paso 6" del checklist y ajustar el grafo `.dot`.
- Eliminar la instrucción de llamar `writing-plans`.
- Añadir `<TERMINATION_PHASE>` instruyendo detenerse y preguntar al usuario si desea invocar `development-process` para continuar.

#### [MODIFY] writing-plans/SKILL.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/skills/writing-plans/SKILL.md)
- Eliminar opciones de "Execution Handoff" manejadas internamente.
- Añadir `<TERMINATION_PHASE>`.

#### [MODIFY] executing-plans/SKILL.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/skills/executing-plans/SKILL.md)
- Eliminar el "Step 5: Complete Development" que obliga el uso de `finishing-a-development-branch`.
- Añadir `<TERMINATION_PHASE>` para reportar resultados finales e instar a usar el orquestador.

#### [MODIFY] subagent-driven-development/SKILL.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/skills/subagent-driven-development/SKILL.md)
- Eliminar del grafo y del proceso las menciones de disparar automáticamente `finishing-a-development-branch`.
- Añadir `<TERMINATION_PHASE>`.

### Implementación del TERMINATION_PHASE
Esta sección será insertada al final de cada archivo modificado:
```markdown
## <TERMINATION_PHASE>
Una vez que hayas completado los objetivos de esta skill, **DETENTE COMPLETAMENTE**. NO invoques ni sugieras comandos técnicos de otras skills por tu cuenta. 

Tu único paso final es:
1. Reportar al usuario que tu labor ha concluido.
2. Preguntarle: *"¿Deseas que invoque el orquestador de proyectos para evaluar la siguiente fase?"*
3. Esperar confirmación. Si el usuario acepta, invoca el workflow o el prompt primario para que el orquestador (`development-process`) reasuma el control de la sesión.
```

## Verification Plan

### Manual Verification
1. Abrir sesión con OpenCode (usando el agente primary).
2. Hacer un cambio que invoque `brainstorming` (fase nueva).
3. Tras generar el diseño, validar que OpenCode pausa y no escribe el plan de inmediato.
4. Escribir "Continuar". Validar que OpenCode invoca `development-process` y evalúa que el estado cambió a 'Designed', pidiendo permiso para la siguiente fase.
