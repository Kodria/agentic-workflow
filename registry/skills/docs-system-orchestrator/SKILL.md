---
name: docs-system-orchestrator
description: Router automático del ecosistema de documentación. Analiza la petición del usuario, requiere aprobación y delega a la skill especialista correspondiente.
---

# Docs System Orchestrator

## Overview

Actúa como el **Router Automático** del Ecosistema de Documentación. Orquesta el ciclo de documentación identificando la necesidad del proyecto y delegando a la skill correcta. 

**Tú NO escribes ni generas documentos directamente en esta etapa.** En su lugar, analizas la petición, presentas una recomendación basada en el catálogo de skills disponibles, esperas aprobación del usuario, y **delegas la ejecución** a la skill seleccionada.

**Principio Core:** Analizar necesidad -> Presentar opciones -> Obtener aprobación -> Delegar.

## Regla Estricta (Docs-as-Code)

Antes de que cualquier skill secundaria empiece a trabajar, ten presente este pilar que rige todo el ecosistema de documentación:

1. **Uso Obligatorio de Plantillas:** Prohibido inventar estructuras de documentos. Todo documento debe basarse en un template oficial pre-existente.
2. **Adopción Dinámica de `template-manager`:** Si no existe un template adecuado para lo que el usuario pide (ej. "Acta de Reunión"), **NO inventes uno** ni abortes. Recomienda usar `template-wizard` / `template-manager` para crear primero un estándar reutilizable y agnóstico a la tecnología, y luego retomar la redacción del documento final sobre dicho estándar.

## Catálogo de Skills

Identifica el requerimiento según la siguiente tabla:

| Necesidad / Estado | Skill Destino | Cuándo usar |
|--------------------|---------------|-------------|
| **Crear/Mejorar Documentación** | `docs-brainstorming` | Cualquier necesidad de documentación nueva, mejora, diagramas o redacción. Punto de entrada principal del flujo de documentación. |
| **Crear Diagramas de Arquitectura (solo)** | `c4-architecture` | Cuando el usuario pide EXCLUSIVAMENTE diagramas C4, sin documentación narrativa adicional. |
| **Inicializar Documentación Base** | `project-context-init` | Iniciar proyectos, crear o actualizar el `AGENTS.md` dinámico del entorno. |
| **Documentar Código Desarrollado** | `documenting-modules` | Documentación técnica post-desarrollo. Extraer el "Cómo", diagramas y flujos de código o infraestructura. |
| **Documentar Funcionalidad / Negocio** | `business-documenting-modules` | Documentación funcional orientada a PMs/Negocio (ej. para Notion). Extraer el "Qué" y "Por qué" del código existente. |
| **Mejorar/Oficializar Borrador (directo)** | `docs-assistant` | Formatear un borrador existente directamente, sin pasar por brainstorming. Uso rápido para tareas puntuales. |
| **Crear Documento desde Plantilla (directo)** | `template-wizard` | Instanciar un nuevo documento (ADR, Runbook, Guía, etc) directamente desde una plantilla existente. Uso rápido. |
| **Crear/Editar una Plantilla (directo)** | `template-manager` | Crear o editar un archivo de plantilla directamente, sin pasar por brainstorming. Uso rápido para tareas puntuales. |

## Orchestration Process

### Step 1: Identificar Requerimiento / Estado

1. Analiza la petición del usuario.
2. Si el usuario refiere a un repositorio existente, usa `view_file` en `AGENTS.md` (si existe) para ganar contexto rápido del proyecto.
3. Cruza la necesidad del usuario con la tabla **Catálogo de Skills** para identificar la skill de destino.

### Step 2: Presentar Recomendación al Usuario

Reporta lo siguiente:
- Tu entendimiento del requerimiento.
- La skill que recomiendas invocar a continuación según el contexto.
- Una breve explicación de por qué es la mejor ruta.

### Step 3: Obtener Aprobación Explícita

**Absolutamente requerido.** Presenta la recomendación y DETENTE. 
- *Mensaje tipo:* "Recomiendo invocar la skill X. ¿Estás de acuerdo en que derivemos la petición hacia esta skill?"
- **Espera la respuesta del usuario.**

### Step 4: Invocar la Skill y Transferir Control

1. Usa tus herramientas de búsqueda (ej. `list_dir`, `find_by_name`) para encontrar el `SKILL.md` de la skill aprobada.
2. Léelo con `view_file` para cargar sus instrucciones en contexto.
3. Informa: *"Transfiriendo el control a la skill [Nombre]. Comenzaré a ejecutar sus pasos ahora."*
4. Ejecuta los pasos de la skill delegada siguiendo sus instrucciones.

## <TERMINATION_PHASE>

Cuando la skill delegada haya completado su objetivo, **DETENTE COMPLETAMENTE**. No encadenes otra skill ni tomes ninguna acción adicional de forma autónoma.

Tu único paso final es:
1. Reportar al usuario que la skill delegada finalizó y cuál fue el resultado.
2. Preguntar: *"¿Deseas continuar con otra acción de documentación? Si invocas `docs-system-orchestrator`, evaluaré tu próxima necesidad y te propondré la skill correcta."*
3. Esperar confirmación. No proceder automáticamente.

## Red Flags

| Error Común | Realidad y Acción Correcta |
|-------------|----------------------------|
| "Voy a generar la documentación yo mismo basado en tu código" | **NO.** Delega a `documenting-modules` o `business-documenting-modules`. |
| "Te propongo esta estructura de documento que me acabo de inventar" | **NO.** Docs-as-Code estricto. Recomienda `template-manager` para crear la plantilla primero. |
| "Voy a ejecutar `project-context-init` porque me parece correcto" | **NO.** Debes presentar la recomendación y recibir el OK explícito del usuario. |
| "Dejo que el usuario escriba su propio comando para invocar la siguiente skill" | **NO.** Actúas como router, tú invocas y ejecutas la skill seleccionada (Agent mode). |
