# Docs System Orchestrator Refactor Plan

Refactorizar el `docs-system-orchestrator` para que siga el mismo principio arquitectónico del `development-process`: un workflow que actúa como un punto de entrada muy ligero (Fast Mode) que delega a una skill dedicada, la cual contiene todas las reglas de decisión, ciclos de vida y validaciones, requiriendo siempre la aprobación del usuario antes del enrutamiento final.

## Proposed Changes

### Workflows

#### [MODIFY] docs-system-orchestrator.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/workflows/docs-system-orchestrator.md)
- **Cambio Conceptual:** Eliminar toda la lógica de negocio, validaciones de templates y ciclos iterativos presentes en el archivo.
- **Nuevo Contenido:** 
  - Definir que debe ejecutarse en **Fast Mode** (sin implementar nada directamente).
  - Configurar 5 pasos simples equivalentes a `development-process`:
    1. Leer la skill `docs-system-orchestrator/SKILL.md`.
    2. Seguir las instrucciones para identificar la necesidad y estado.
    3. Presentar al usuario la recomendación de la skill objetivo.
    4. Esperar aprobación explícita.
    5. Invocar la skill.

---

### Agents

#### [NEW] docs-system-orchestrator.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/agents/docs-system-orchestrator.md)
- **Propósito:** Actuar como Agent Profile para uso en OpenCode.
- **Contenido:**
  - Frontmatter con `mode: primary` (o router).
  - Instrucción base de que NO documente directamente nada.
  - Al iniciar una sesión, su primera directiva es invocar la skill `docs-system-orchestrator` y seguir exactamente sus pasos (analizar -> presentar recomendación -> pedir aprobación -> delegar).
  - Reglas de restricción similares a `development-process` para evitar inventar plantillas y evitar actuar sin aprobación.

---

### Skills

#### [MODIFY] docs-system-orchestrator/SKILL.md (file:///Users/cencosud/Developments/personal/agentic-workflow/registry/skills/docs-system-orchestrator/SKILL.md)
- **Cambio Conceptual:** Consolidar la lógica extraída del workflow antiguo, mejorar la definición del ciclo de resolución e implementar explícitamente la pausa de aprobación antes de ejecutar otra skill.
- **Nuevas Secciones:**
  - **Overview:** Establece el principio core (Analizar necesidad -> Presentar opciones -> Obtener aprobación -> Delegar).
  - **Regla Estricta de Plantillas (Docs-as-Code):** Migrada desde el workflow. Establece la obligación de usar plantillas y no inventar estructuras. Define la adopción dinámica de `template-manager` si falta una plantilla.
  - **Catálogo de Skills:** Ya existe, se mantiene estructurado como una tabla clara (similar a `development-process`).
  - **Orchestration Process:**
    1. Identificar Requerimiento / Estado.
    2. Presentar Estado y Recomendación al usuario.
    3. Obtener Aprobación Explícita (No invocar sin confirmación).
    4. Invocar la Skill y Transferir Control.
  - **Red Flags:** Agregado para guiar sobre comportamientos prohibidos (ej. "Voy a inventar un formato" -> No, usa `template-manager`).

## Verification Plan

### Manual Verification
1. En la sesión actual u otra, invocar `@/docs-system-orchestrator` y describir una necesidad, como: *"Quiero documentar el frontend que acabo de terminar"*.
2. Verificar que el workflow actúe rápidamente (Fast Mode) y sólo analice la petición en base al nuevo `SKILL.md`.
3. Validar que el agente presente la recomendación (ej. invocar `documenting-modules`) y SE DETENGA a pedir aprobación explícita.
4. Tras confirmar, el agente debe proceder a transferir contexto a la skill seleccionada.
5. Probar el flujo de ausencia de template solicitando: *"Quiero crear un acta de reunión"*. El agente debería recomendar usar/crear un template y sugerir invocar `template-wizard` / `template-manager`.
