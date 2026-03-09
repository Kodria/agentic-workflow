---
name: business-documenting-modules
description: "Use this skill AFTER completing development to document functional business modules into Notion-ready formats in `docs/business-knowledge`. Intelligently distinguishes between technical tasks and actual business features."
---

# Documentación de Módulos de Negocio

## Descripción General

Esta skill automatiza la creación de documentación de alto nivel orientada al negocio, destinada principalmente al repositorio de conocimiento Notion del proyecto. A diferencia de la documentación técnica estándar, esta skill enfatiza el valor de negocio, las reglas, los flujos de usuario y las integraciones.

## Cuándo Usar

Usa esta skill cuando:
- Terminaste un ciclo de desarrollo, especialmente uno que involucra una nueva funcionalidad o una actualización significativa de lógica de negocio.
- El usuario solicita documentación de negocio o pide documentar el módulo para Notion.
- Estás cerrando una funcionalidad completada y los stakeholders o miembros no técnicos del equipo necesitan entender su funcionamiento.

## El Proceso

### Paso 0: Leer el Contrato del Repositorio

1. **Lee `AGENTS.md`** en la raíz del proyecto. Parsea el bloque frontmatter YAML (`agent_context`) para extraer:
   - `level` — el nivel de contexto de documentación (`area`, `project` o `component`).
   - `docs_path` — la ruta relativa donde vive la documentación (por defecto `docs`).
2. **Usa `docs_path`** para todas las referencias de ruta posteriores en lugar de hardcodear `docs/`.

### Paso 1: Filtrado Inteligente (Paso Crítico)

Antes de generar cualquier documentación, DEBES analizar el contexto reciente (ej. desde `task.md`, conversaciones recientes o `{docs_path}/plans`) para determinar la naturaleza del trabajo.

1. **¿Es un Módulo de Negocio Funcional?** ¿Agrega o altera significativamente una funcionalidad con la que interactúan los usuarios finales o el negocio? Ejemplos: "Planificación Semanal", "Flujo de Checkout", "Onboarding de Usuarios".
2. **¿Es una Tarea Técnica?** ¿Es puramente infraestructural, refactorización o un cambio cosmético menor? Ejemplos: "Refactorización de API", "Correcciones de UI responsiva", "Actualización de Dependencias".

**Decisión:**
- Si el trabajo es puramente una **Tarea Técnica**, informa amablemente al usuario que los cambios recientes no constituyen un módulo de negocio central y por lo tanto no se generará documentación de negocio. *Detén la ejecución aquí.*
- Si el trabajo es un **Módulo de Negocio Funcional**, continúa con el Paso 2.

### Paso 2: Recopilar Datos de Negocio Estructurados

Analiza el código, los planes y el contexto reciente para extraer la siguiente información estructurada:

| Dato | Fuente |
|------|--------|
| Nombre del Módulo | Título del plan, nombre de la funcionalidad o input del usuario |
| Propósito y Valor de Negocio | Contexto del plan, user stories, funcionalidades del README |
| Reglas de Negocio Clave | Restricciones del código, lógica de validación, reglas de dominio |
| Journey del Usuario | Flujo de componentes UI, interacciones con la API, user stories |
| Puntos de Integración | Llamadas a servicios, APIs externas, dependencias entre módulos |

**NO escribas el documento final aún.** Recopila los datos y continúa con el Paso 3.

### Paso 3: Delegar el Formateo al Template Wizard

1. **Localiza el template dinámicamente**: Usa tus herramientas de búsqueda de archivos (ej. `find_by_name`) para encontrar `template-wizard/resources/templates/business-knowledge-template.md` en tus directorios de skills (`.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`). Lee el template desde la ruta encontrada.
2. **Extrae los metadatos YAML** (`template_purpose`, `interview_questions`) del template.
3. **Rellena automáticamente** cada sección del cuerpo del template usando los datos estructurados recopilados en el Paso 2. Como los datos ya fueron recopilados, NO necesitas hacerle las preguntas de entrevista al usuario — complétalas de forma programática.
4. **Genera el documento final** como un archivo Markdown limpio (sin frontmatter YAML) y guárdalo en `{docs_path}/business-knowledge/<categoría>/<nombre-módulo>.md`. Crea los directorios necesarios si no existen.

- **Categoría**: Agrupa por dominio de negocio de alto nivel (ej. `planificacion`, `finanzas`, `operaciones-core`).
- **Nombre de archivo**: Usa un nombre descriptivo y legible en kebab-case (ej. `sistema-planificacion-semanal.md`).

### Paso 4: Actualizar el Índice

1. **Actualiza `README.md`**: Si existe una sección de "Conocimiento de Negocio" o "Base de Conocimiento Notion", agrega un enlace al nuevo documento. Si no existe, considera agregar una nota breve o crear un archivo índice en `{docs_path}/business-knowledge/README.md`.

## Reglas

- **Idioma**: Escribe la documentación en **español** (o según lo declarado en `agent_context.language`).
- **Tono**: Mantén un tono profesional, accesible para stakeholders no técnicos y enfocado en resultados de negocio.
- **Enfoque**: **NADA** de detalles técnicos profundos (como consultas de base de datos específicas, nombres de clases o estructuras de componentes) a menos que sea estrictamente necesario para explicar una regla de negocio. Enfócate en el *Qué* y el *Por qué*, no en el *Cómo*.
- **Fuente del Template**: Siempre usa el template oficial de `template-wizard/resources/templates/business-knowledge-template.md` (localizado dinámicamente mediante búsqueda de archivos). Nunca inventes tu propia estructura.
