---
name: docs-system-orchestrator
description: Router automático del ecosistema de documentación. Analiza la petición del usuario y ejecuta directamente la skill de documentación correspondiente.
---

# Docs System Orchestrator

## 1. Propósito
Actuar como el **Router Automático** del Ecosistema de Documentación. Tú NO sugieres comandos al usuario. En su lugar, **analizas la petición, seleccionas la skill correcta**, lees su `SKILL.md` con `view_file`, y **ejecutas sus pasos directamente** en la misma sesión.

## 2. Inventario de Skills
- **`project-context-init`**: Inicializar/actualizar el `AGENTS.md` dinámico. Úsalo al iniciar proyectos o al cambiar dependencias mayores.
- **`documenting-modules`**: Documentación técnica post-desarrollo. Úsalo para código fuente backend/frontend.
- **`business-documenting-modules`**: Documentación funcional y de negocio para Notion. Úsalo para extraer el "Qué" y "Por qué".
- **`docs-assistant`**: Revisar, formatear y oficializar documentos técnicos siguiendo estándares Docs-as-Code. Úsalo con la carpeta `docs/`.
- **`template-wizard`**: Crear nuevos borradores desde plantillas de documentación existentes.
- **`template-manager`**: Crear o editar plantillas de documentación transversales.

## 3. Árbol de Decisión / Enrutamiento
1. Si el usuario pide "iniciar el agente" o el repo no tiene `AGENTS.md` → **Ejecutar** `project-context-init`.
2. Si el usuario finalizó un desarrollo técnico de código → **Ejecutar** `documenting-modules`.
3. Si el usuario pide extraer reglas de negocio o un manual funcional → **Ejecutar** `business-documenting-modules`.
4. Si el usuario pide crear un ADR, Runbook o Guía desde cero → **Ejecutar** `template-wizard`.
5. Si el usuario tiene un borrador y quiere refinarlo/oficializarlo → **Ejecutar** `docs-assistant`.
6. Si el usuario quiere crear o editar una plantilla de documentación → **Ejecutar** `template-manager`.

## 4. Instrucciones de Ejecución (Router Automático)
1. Analiza la petición del usuario.
2. Si existe un archivo `AGENTS.md` en el repositorio, léelo con `view_file` para ganar contexto del entorno.
3. Según el [Árbol de Decisión], identifica la skill objetivo.
4. **Autodescubrimiento:** Usa tus herramientas de búsqueda de archivos (e.g. `find_by_name`) para localizar el `SKILL.md` de la skill seleccionada dentro de tu entorno de ejecución (`.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`).
5. **Invocación Directa:** Lee el `SKILL.md` encontrado con `view_file`, asimila sus instrucciones en tu contexto actual, y **comienza a ejecutar sus pasos inmediatamente** sin pedirle al usuario que escriba comandos adicionales.
6. **PROHIBIDO:** No le sugieras al usuario que ejecute un comando manualmente. Tú eres el router y ejecutor.
