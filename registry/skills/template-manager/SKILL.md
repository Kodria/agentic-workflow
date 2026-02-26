---
name: template-manager
description: "Administra las plantillas de documentación del proyecto. Úsala cuando necesites crear un nuevo formato de documentación transversal o mejorar uno existente."
---

# Template Manager

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo es conversacional pero su objetivo final es crear o modificar un artefacto.

## Paso 0: Autodescubrimiento Contextual de Recursos

Antes de interactuar con el usuario o leer archivos del proyecto, DEBES ubicar dinámicamente tus carpetas de plantillas.

### 0.1 Plantillas Globales (`TEMPLATES_DIR`) — Solo Lectura (Referencia)
- Usa tus herramientas de búsqueda de archivos (e.g. `find_by_name`) para buscar el patrón `template-wizard/resources/templates` dentro de tu entorno de ejecución.
- Busca en las siguientes ubicaciones posibles: `.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`.
- Una vez ubicada la ruta absoluta correcta, guárdala como `TEMPLATES_DIR`.
- **NO uses rutas hardcodeadas.** Si no encuentras la carpeta, informa al usuario y detente.
- **⚠️ SOLO LECTURA.** Las plantillas globales provienen del registry central de AWM y **NUNCA deben ser modificadas** por esta skill. Sirven exclusivamente como catálogo de referencia.

### 0.2 Plantillas Locales (`LOCAL_TEMPLATES_DIR`) — Directorio de Trabajo
- Define `LOCAL_TEMPLATES_DIR` como la ruta `docs/templates/` relativa a la raíz del proyecto actual.
- Si el directorio no existe, se creará automáticamente cuando el usuario apruebe guardar una plantilla.
- **Todas las operaciones de escritura (crear, editar, sobrescribir) se realizan EXCLUSIVAMENTE aquí.**

## Objetivo
Asistir al administrador o desarrollador en la creación y edición estructurada e inteligente de plantillas de documentación **locales al proyecto**, inyectándoles el formato y metadata YAML requerido (`template_purpose`, `interview_questions`) y depositando/actualizando el archivo final en `{LOCAL_TEMPLATES_DIR}` (`docs/templates/`).

## Algoritmo / Pasos (Ejecución Estricta)

1. **Ingreso del Concepto (Input)**
   - Extraer la intención de la solicitud del usuario (ej. "Un estándar de BD" o "Mejorar la plantilla ADR").

2. **Evaluación de Similitudes (Match Making & Reasoning)**
   - El agente DEBE listar y leer los metadatos YAML de los archivos en **ambos** directorios:
     - `{TEMPLATES_DIR}` (plantillas globales — solo lectura).
     - `{LOCAL_TEMPLATES_DIR}` (plantillas locales — si existe).
   - Razonar profundamente si el concepto ingresado ya está cubierto, parcial o totalmente, por alguna plantilla existente analizando el `template_purpose`.
   - Si se encuentra una coincidencia lógica, presentarla al usuario explicando el razonamiento e indicando si es **global** o **local**, y dar a elegir:
     - **A) Hacer un Override Local** (si es global: copiar a `docs/templates/` y editar la copia).
     - **B) Editar/Actualizar la existente** (solo si ya es local).
     - **C) Crear una nueva desde cero** (en `docs/templates/`).
   - Si no hay coincidencias obvias, continuar de manera transparente hacia la "Creación desde Cero".

3. **Bifurcación de Flujos**
   
   **Flujo A: Creación desde Cero (Creation Flow)**
   - **Extracción de Contexto:** Formular únicamente las preguntas de clarificación de alto nivel necesarias para comprender el alcance. No estructurar el documento todavía, ni obligar al usuario a redactar.
   - **Generación Autónoma:** En un único paso y de forma autónoma, proponer el cuerpo en Markdown y el respectivo metadato YAML frontal con `template_purpose` y una lista articulada de `interview_questions` lógicas para la plantilla.

   **Flujo B: Edición de Plantilla Local Existente (Edit Flow)**
   - **Extracción de Contexto de Edición:** Preguntar exactamente qué aspectos de la plantilla actual el usuario desea evolucionar, agregar o remover (nuevas preguntas YAML, cambios en cuerpo Markdown).
   - **Actualización Autónoma:** Proponer la plantilla reescrita (Markdown + YAML) incorporando los cambios solicitados de forma coherente.

   **Flujo C: Override Local de Plantilla Global (Fork Flow)**
   - Copiar el contenido completo de la plantilla global seleccionada.
   - Aplicar las modificaciones solicitadas por el usuario sobre la copia.
   - **IMPORTANTE:** El archivo original en `{TEMPLATES_DIR}` NO se toca. El resultado se guarda como una nueva plantilla local en `{LOCAL_TEMPLATES_DIR}`.

4. **Aprobación Conversacional (Review)**
   - Presentar el diseño propuesto (Markdown + YAML) completo en el chat.
   - Esperar retroalimentación. Ajustar iterativamente si el usuario pide modificaciones.

5. **Guardado Directo (Commitment)**
   - Cuando el usuario apruebe la versión explícitamente, escribir/sobrescribir el archivo en `{LOCAL_TEMPLATES_DIR}` (`docs/templates/`).
   - **IMPORTANTE:** Si el usuario editó una plantilla global desde `{TEMPLATES_DIR}`, el resultado modificado **NO SE GUARDA** allí. Se guarda en `docs/templates/` para que actúe como un override local específico de este proyecto, protegiendo el registry global de AWM.
   - Crear el directorio `docs/templates/` si no existe (`mkdir -p` o equivalente).
   - El nombre del archivo debe seguir la convención kebab-case (ej. `docs/templates/nuevo-modelo-template.md`).
   - Confirmar al usuario que la tarea ha finalizado exitosamente.

