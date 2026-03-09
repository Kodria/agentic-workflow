---
name: template-manager
description: "Administra las plantillas de documentación del proyecto. Úsala cuando necesites crear un nuevo formato de documentación transversal o mejorar uno existente. Supports plan-driven execution with subdelegation to support skills."
---

# Template Manager

## Paso 0: Autodescubrimiento Contextual de Recursos

Antes de interactuar con el usuario o leer archivos del proyecto, DEBES ubicar dinámicamente tus directorios de templates.

### 0.1 Plantillas Globales (`TEMPLATES_DIR`) — Solo Lectura (Referencia)
- Usa herramientas de búsqueda de archivos (ej. `find_by_name`) para encontrar el patrón `template-wizard/resources/templates` dentro de tu entorno de ejecución.
- Busca en: `.agents/skills/`, `.agent/skills/`, `~/.agents/skills/`, etc.
- Guarda la ruta absoluta encontrada como `TEMPLATES_DIR`.
- **NO uses rutas hardcodeadas.** Si no encuentras el directorio, informa al usuario y detente.
- **⚠️ SOLO LECTURA.** Las plantillas globales provienen del registry central de AWM y NUNCA deben ser modificadas por esta skill.

### 0.2 Plantillas Locales (`LOCAL_TEMPLATES_DIR`) — Directorio de Trabajo
- Define `LOCAL_TEMPLATES_DIR` como `docs/templates/` relativo a la raíz del proyecto actual.
- Si el directorio no existe, se creará cuando el usuario apruebe guardar un template.
- **Todas las operaciones de escritura (crear, editar, sobrescribir) ocurren EXCLUSIVAMENTE aquí.**

## Paso 1: Detección de Modo de Operación

Determina cómo fue invocada esta skill:

- **Modo Plan:** Se proporcionó o referenció un plan de documentación (generado por `docs-brainstorming`). El plan es un archivo `.md` en `docs/plans/` con entregables estructurados de tipo "Template".
  → Continúa con **Modo Plan** (Paso 2P).

- **Modo Directo:** No existe plan de documentación. El usuario invoca esta skill directamente.
  → Continúa con **Modo Directo** (Paso 2D).

---

## Modo Plan

### Paso 2P: Lectura del Plan

1. Lee el archivo `.md` del plan de documentación.
2. Extrae:
   - **Contexto Recopilado** — fuente primaria de información.
   - **Entregables** — la lista de entregables de tipo template con tipos, destinos y requerimientos de skill de apoyo.
   - **Criterios de Aceptación** — definición de terminado.

### Paso 3P: Ejecución por Entregable

Para cada entregable del plan:

**a. Evaluar necesidad de skill de apoyo:**
- Revisa el campo "Requiere skill de apoyo" del entregable.
- Si se necesita una skill de apoyo → sigue el **Protocolo de Subdelegación** (más abajo).

**b. Ejecutar el flujo correspondiente:**
- Determina si este entregable requiere Creación, Edición u Override según el contexto del plan y el estado actual de los templates globales/locales.
- **Creación:** Genera el cuerpo del template en Markdown + metadatos YAML frontales (`template_purpose`, `interview_questions`).
- **Edición:** Aplica modificaciones a un template local existente.
- **Override:** Copia un template global a local y aplica las modificaciones.

**c. Presentar al usuario:**
- Muestra el template completo (Markdown + YAML) para revisión.

**d. Iterar hasta aprobación:**
- Si el usuario solicita cambios → aplica y presenta de nuevo.
- Si el usuario aprueba → guarda y pasa al siguiente entregable.

### Paso 4P: Guardado

- Escribe/sobreescribe los templates aprobados en `{LOCAL_TEMPLATES_DIR}`.
- **IMPORTANTE:** Los resultados NUNCA se guardan en `{TEMPLATES_DIR}` (global). Siempre en `docs/templates/`.
- Crea el directorio si no existe.
- Los nombres de archivo deben seguir la convención `kebab-case`.

---

## Modo Directo (Flujo Legado)

Este modo preserva el comportamiento original para invocaciones directas sin un plan.

### Paso 2D: Ingreso del Concepto
- Extrae la intención de la solicitud del usuario (ej. "Un estándar de BD" o "Mejorar el template de ADR").

### Paso 3D: Evaluación de Similitudes
- Lista y lee los metadatos YAML de los archivos en **ambos** directorios:
  - `{TEMPLATES_DIR}` (templates globales — solo lectura).
  - `{LOCAL_TEMPLATES_DIR}` (templates locales — si existe).
- Evalúa si el concepto ya está cubierto (total o parcialmente) por un template existente, analizando `template_purpose`.
- Si se encuentra coincidencia, preséntala al usuario indicando si es **global** o **local**, y ofrece:
  - **A) Override Local** (si es global: copiar a `docs/templates/` y editar la copia).
  - **B) Editar/Actualizar** (solo si ya es local).
  - **C) Crear desde cero** (en `docs/templates/`).
- Si no hay coincidencia, procede directamente a "Creación desde Cero".

### Paso 4D: Bifurcación de Flujos

**Flujo A: Creación desde Cero**
- Haz solo las preguntas de clarificación de alto nivel necesarias para entender el alcance.
- En un solo paso autónomo, propone el cuerpo en Markdown y los metadatos YAML frontales con `template_purpose` e `interview_questions`.

**Flujo B: Editar Template Local Existente**
- Pregunta qué aspectos del template actual el usuario quiere evolucionar.
- Propone el template reescrito (Markdown + YAML) incorporando los cambios de forma coherente.

**Flujo C: Override Local de Template Global**
- Copia el contenido completo del template global seleccionado.
- Aplica las modificaciones solicitadas por el usuario sobre la copia.
- **IMPORTANTE:** El archivo original en `{TEMPLATES_DIR}` NO se toca.

### Paso 5D: Aprobación Conversacional
- Presenta el diseño propuesto (Markdown + YAML) completo en el chat.
- Espera feedback. Ajusta iterativamente si el usuario solicita modificaciones.

### Paso 6D: Guardado Directo
- Cuando el usuario apruebe explícitamente, escribe/sobreescribe el archivo en `{LOCAL_TEMPLATES_DIR}`.
- Crea `docs/templates/` si no existe.
- El nombre de archivo debe seguir la convención `kebab-case`.
- Confirma al usuario que la tarea está completa.

---

## Protocolo de Subdelegación a Skills de Apoyo

Cuando estés ejecutando un entregable y encuentres un bloque que requiere capacidades especializadas, sigue este protocolo:

### SD-1: Detección

Identifica la necesidad mediante:
- **Explícita:** El plan indica "Requiere skill de apoyo: `<nombre>`" en el entregable.
- **Implícita:** Durante la ejecución detectas que un bloque del template requiere capacidades especializadas.

### SD-2: Consulta del Registro

Revisa el Registro de Skills de Apoyo (más abajo).
- Si existe coincidencia → continúa con SD-3.
- Si NO existe coincidencia → informa al usuario. Ofrece: (a) generar el contenido con tu mejor criterio, o (b) dejar la sección marcada como pendiente.

### SD-3: Confirmación con el Usuario

Antes de invocar, informa al usuario:
- Qué skill vas a invocar y por qué.
- Qué contexto le vas a pasar.
- **Espera aprobación explícita.**

### SD-4: Invocación

1. Localiza el `SKILL.md` de la skill usando autodescubrimiento dinámico.
2. Lee el `SKILL.md` para cargar las instrucciones.
3. Pasa el contexto relevante del plan.
4. Ejecuta el flujo de trabajo de la skill de apoyo.

### SD-5: Incorporación

- Toma el resultado e incorpóralo en el template en la ubicación correcta.
- Continúa con el siguiente bloque o entregable.

### Registro de Skills de Apoyo

| Tipo de Bloque | Skill | Detectar cuando... |
|----------------|-------|--------------------|
| Diagramas de arquitectura C4 | `c4-architecture` | El entregable requiere diagramas de contexto, contenedores, componentes, despliegue o flujos dinámicos |
| Documento desde plantilla existente | `template-wizard` | Un entregable necesita instanciar un documento nuevo basado en una plantilla oficial |

> **Extensibilidad:** Para agregar una nueva skill de apoyo, agrega una fila a esta tabla.
