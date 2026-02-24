---
name: docs-system-orchestrator
description: Índice maestro y orquestador del ecosistema de documentación. Úsalo para saber qué skill de documentación ejecutar y cuándo.
---

# Docs System Orchestrator

## 1. Propósito
Actuar como el Índice Maestro y Enrutador del Ecosistema de Documentación. No ejecuta documentos directamente, sino que guía al agente o usuario sobre qué herramienta emplear.

## 2. Inventario de Skills
- **`project-context-init`**: Inicializar/actualizar el `AGENTS.md` dinámico. Úsalo al iniciar proyectos o al cambiar dependencias mayores.
- **`documenting-modules`**: Documentación técnica post-desarrollo. Úsalo para código fuente backend/frontend.
- **`business-documenting-modules`**: Documentación funcional y de negocio para Notion. Úsalo para extraer el "Qué" y "Por qué".
- **`cscti-docs-assistant`**: Revisar y crear documentos técnicos institucionales (Docs-as-Code). Úsalo con la carpeta `docs/`.
- **`cscti-template-wizard`**: Crear nuevos borradores desde plantillas CSCTI.

## 3. Árbol de Decisión / Enrutamiento
1. Si el usuario pide "iniciar el agente" o el repo no tiene `AGENTS.md` -> Sugiere `/project-context-init`.
2. Si el usuario finalizó un desarrollo técnico de código -> Sugiere `/documenting-modules`.
3. Si el usuario pide extraer reglas de negocio o un manual funcional -> Sugiere `/business-documenting-modules`.
4. Si el usuario pide crear un ADR, Runbook o Guía en `csc-docs` -> Sugiere `/cscti-template-wizard` (si es desde cero) o `/cscti-docs-assistant` (si ya hay borrador).

## 4. Instrucciones de Ejecución
1. Analiza la petición del usuario.
2. Si existe un archivo `AGENTS.md` en el repositorio, léelo velozmente usando `view_file` para ganar contexto del entorno.
3. Según el [Árbol de Decisión], provee al usuario la recomendación de qué comando ejecutar (ej. "Te sugiero correr `/documenting-modules` con este prompt..."). No invoques a los agentes tú mismo.
