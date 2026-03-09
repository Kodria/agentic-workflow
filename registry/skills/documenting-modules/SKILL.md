---
name: documenting-modules
description: "Use this skill AFTER completing development or improvements to document the changes. It analyzes plans and code to generate system documentation in `docs/modules` and updates the README."
---

# Documentación de Módulos

## Descripción General

Esta skill automatiza el proceso de crear documentación del sistema después del desarrollo. Garantiza que cada nuevo módulo o mejora quede correctamente documentado en el directorio `docs/modules` y referenciado en el `README.md`.

## Cuándo Usar

Usa esta skill cuando:
- Acabas de terminar de implementar una funcionalidad o módulo (ej. después de `executing-plans`).
- El usuario te pide "documenta esto" o "actualiza la documentación".
- Estás cerrando un ciclo de desarrollo y necesitas dejar el código en un estado limpio.

## El Proceso

### Paso 0: Leer el Contrato del Repositorio

1. **Lee `AGENTS.md`** en la raíz del proyecto. Parsea el bloque frontmatter YAML (`agent_context`) para extraer:
   - `level` — el nivel de contexto de documentación (`area`, `project` o `component`).
   - `docs_path` — la ruta relativa donde vive la documentación (por defecto `docs`).
2. **Usa `docs_path`** para todas las referencias de ruta posteriores en lugar de hardcodear `docs/`.

### Paso 1: Analizar el Contexto

1. **Lee los Planes**: Busca en `{docs_path}/plans` los planes de diseño e implementación más recientes relacionados con el trabajo recién terminado.
2. **Identifica el Alcance**: Determina si el trabajo es un nuevo módulo independiente (ej. "Planificación Semanal") o una mejora a uno existente (ej. "UI Responsiva").

### Paso 2: Recopilar Datos Estructurados

Analiza el código y los planes para extraer la siguiente información estructurada sobre el módulo:

| Dato | Fuente |
|------|--------|
| Nombre del Módulo | Título del plan o input del usuario |
| Descripción General | Contexto del plan + análisis del código |
| Funcionalidades Clave | Objetivos del plan + funcionalidad implementada |
| Arquitectura Técnica | Análisis de componentes, flujo de datos, lógica clave |
| Uso | Comportamiento visible al usuario desde componentes UI o endpoints de API |

**NO escribas el documento final aún.** Recopila los datos y continúa con el Paso 3.

### Paso 3: Delegar el Formateo al Template Wizard

1. **Localiza el template dinámicamente**: Usa tus herramientas de búsqueda de archivos (ej. `find_by_name`) para encontrar `template-wizard/resources/templates/module-template.md` en tus directorios de skills (`.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`). Lee el template desde la ruta encontrada.
2. **Extrae los metadatos YAML** (`template_purpose`, `interview_questions`) del template.
3. **Rellena automáticamente** cada sección del cuerpo del template usando los datos estructurados recopilados en el Paso 2. Como los datos ya fueron recopilados, NO necesitas hacerle las preguntas de entrevista al usuario — complétalas de forma programática.
4. **Genera el documento final** como un archivo Markdown limpio (sin frontmatter YAML) y guárdalo en `{docs_path}/modules/<categoría>/<nombre-módulo>.md`.

- **Categoría**: Agrupa por dominio (ej. `gestion-tareas`, `ui-ux`, `integraciones`).
- **Nombre de archivo**: Usa nombres descriptivos en kebab-case (ej. `planificacion-semanal.md`).

### Paso 4: Actualizar el Índice

1. **Actualiza `README.md`**: Agrega un enlace al nuevo archivo de documentación en la sección "Documentación del Sistema".
2. **Verifica**: Asegúrate de que el enlace sea relativo y funcione (ej. `[Etiqueta]({docs_path}/modules/categoria/archivo.md)`).

## Reglas

- **Idioma**: Escribe la documentación en **español** (según la convención del proyecto, o según lo declarado en `agent_context.language`).
- **Concisión**: Enfócate en "qué es" y "cómo funciona", no en "cómo lo construimos" (eso está en los planes).
- **Ubicación**: Usa siempre `{docs_path}/modules`. No crees archivos sueltos en la raíz de `{docs_path}/`.
- **Fuente del Template**: Siempre usa el template oficial de `template-wizard/resources/templates/module-template.md` (localizado dinámicamente mediante búsqueda de archivos). Nunca inventes tu propia estructura.
