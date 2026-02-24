---
name: cscti-template-manager
description: "Administra las plantillas del repositorio. Úsala cuando necesites crear un nuevo formato de documentación transversal o mejorar uno existente."
---

# CSCTI Template Manager

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo es conversacional pero su objetivo final es crear o modificar un artefacto.

## Objetivo
Asistir al administrador o desarrollador en la creación y edición estructurada e inteligente de plantillas de documentación (templates), inyectándoles el formato y metadata YAML requerido (`template_purpose`, `interview_questions`) y depositando/actualizando el archivo final en `~/.agents/skills/cscti-template-wizard/resources/templates/`.

## Algoritmo / Pasos (Ejecución Estricta)

1. **Ingreso del Concepto (Input)**
   - Extraer la intención de la solicitud del usuario (ej. "Un estándar de BD" o "Mejorar la plantilla ADR").

2. **Evaluación de Similitudes (Match Making & Reasoning)**
   - El agente DEBE listar y leer todos los metadatos YAML de los archivos en `~/.agents/skills/cscti-template-wizard/resources/templates/`.
   - Razonar profundamente si el concepto ingresado ya está cubierto, parcial o totalmente, por alguna plantilla existente analizando el `template_purpose`.
   - Si se encuentra una coincidencia lógica, presentarla al usuario explicando el razonamiento y dar a elegir: **A) Editar/Actualizar la existente** o **B) Crear una nueva desde cero**.
   - Si no hay coincidencias obvias, continuar de manera transparente hacia la "Creación desde Cero".

3. **Bifurcación de Flujos**
   
   **Flujo A: Creación desde Cero (Creation Flow)**
   - **Extracción de Contexto:** Formular únicamente las preguntas de clarificación de alto nivel necesarias para comprender el alcance. No estructurar el documento todavía, ni obligar al usuario a redactar.
   - **Generación Autónoma:** En un único paso y de forma autónoma, proponer el cuerpo en Markdown y el respectivo metadato YAML frontal con `template_purpose` y una lista articulada de `interview_questions` lógicas para la plantilla.

   **Flujo B: Edición de Plantilla Existente (Edit Flow)**
   - **Extracción de Contexto de Edición:** Preguntar exactamente qué aspectos de la plantilla actual el usuario desea evolucionar, agregar o remover (nuevas preguntas YAML, cambios en cuerpo Markdown).
   - **Actualización Autónoma:** Proponer la plantilla reescrita (Markdown + YAML) incorporando los cambios solicitados de forma coherente.

4. **Aprobación Conversacional (Review)**
   - Presentar el diseño propuesto (Markdown + YAML) completo en el chat.
   - Esperar retroalimentación. Ajustar iterativamente si el usuario pide modificaciones.

5. **Guardado Directo (Commitment)**
   - Cuando el usuario apruebe la versión explícitamente, escribir/sobrescribir el archivo completo en `~/.agents/skills/cscti-template-wizard/resources/templates/`. El nombre del archivo debe seguir la convención kebab-case (ej. `~/.agents/skills/cscti-template-wizard/resources/templates/nuevo-modelo-template.md`). Confirmar al usuario que la tarea ha finalizado exitosamente.
