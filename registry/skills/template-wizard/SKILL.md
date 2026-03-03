---
name: template-wizard
description: "Asiste al usuario en la creación de nuevos documentos basándose en plantillas existentes. Usa esta skill cuando el usuario quiera crear un documento desde cero."
---

# Template Wizard

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo es conversacional pero su objetivo final es crear un artefacto (borrador).

## Paso 0: Autodescubrimiento Contextual de Recursos

Antes de interactuar con el usuario o leer archivos del proyecto, DEBES ubicar dinámicamente tus carpetas de plantillas.

### 0.1 Plantillas Globales (`TEMPLATES_DIR`) — Solo Lectura
- Usa tus herramientas de búsqueda de archivos (e.g. `find_by_name`) para buscar el patrón `template-wizard/resources/templates` dentro de tu entorno de ejecución.
- Busca en las siguientes ubicaciones posibles: `.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`.
- Una vez ubicada la ruta absoluta correcta, guárdala como `TEMPLATES_DIR`.
- **NO uses rutas hardcodeadas.** Si no encuentras la carpeta, informa al usuario y detente.
- **⚠️ Las plantillas globales son de SOLO LECTURA.** Provienen del registry central de AWM y no deben ser modificadas por el usuario final.

### 0.2 Plantillas Locales (`LOCAL_TEMPLATES_DIR`) — Proyecto Específico
- Define `LOCAL_TEMPLATES_DIR` como la ruta `docs/templates/` relativa a la raíz del proyecto actual.
- Verifica si este directorio existe. Si no existe, simplemente continúa sin plantillas locales (no es obligatorio).
- Las plantillas locales son específicas del proyecto y pueden **sobrescribir** plantillas globales con el mismo `template_purpose`.

## Objetivo
Guiar al usuario para redactar un nuevo borrador de documento eligiendo la plantilla adecuada y haciéndole preguntas progresivas para llenar las distintas secciones definidas en los metadatos de la propia plantilla.

## Algoritmo / Pasos (Ejecución Estricta)

1. **Lectura del Contrato del Repositorio**
   - Leer `AGENTS.md` en la raíz del proyecto. Parsear el frontmatter YAML (`agent_context`) para extraer:
     - `docs_path` — directorio raíz de documentación.
     - `directories.dir_drafts` — carpeta de borradores (por defecto `{docs_path}/drafts`).
   - Usar estas rutas dinámicas en los pasos posteriores.

2. **Fase de Descubrimiento (Catálogo Unificado)**
   - **2.1 Carga Global:** El agente DEBE listar y leer todos los archivos en `{TEMPLATES_DIR}` (plantillas globales). Extraer el bloque YAML inicial (entre `---`) prestando especial atención al campo `template_purpose`. Construir un catálogo en memoria usando `template_purpose` como identificador único.
   - **2.2 Override Local:** El agente DEBE verificar si existe la carpeta `{LOCAL_TEMPLATES_DIR}` (`docs/templates/`) en el proyecto actual.
     - Si **no existe**, continuar con el catálogo global tal cual.
     - Si **existe**, listar y leer todos los archivos `.md` allí. Extraer su `template_purpose`.
       - Si un `template_purpose` local **coincide** con uno global, la plantilla local **reemplaza** a la global en el catálogo.
       - Si el `template_purpose` es **nuevo** (no existente a nivel global), se **agrega** al catálogo como plantilla adicional disponible.
   - El resultado es un catálogo unificado donde las plantillas locales tienen prioridad sobre las globales.

3. **Fase de Análisis y Match**
   - El agente debe cruzar la intención declarada por el usuario al invocar la skill con los `template_purpose` leídos.
   - Si la intención del usuario encaja con una plantilla, el agente le informa al usuario qué plantilla ha elegido y pasa a la fase 4.
   - **Fallback (NO Match):** Si ninguna plantilla aplica, el agente SE DETIENE, le explica al usuario por qué ninguna plantilla existente (como ADR o Estándar) sirve para su requerimiento, y le aconseja crear una nueva plantilla primero si es un formato transversal nuevo.

4. **Fase de Entrevista**
   - Basado en el campo `interview_questions` del metadata de la plantilla seleccionada, el agente debe hacerle las preguntas al usuario de a una por vez o en bloques muy pequeños.
   - Esperar la respuesta del usuario para cada sección/pregunta.

5. **Fase de Generación**
   - Una vez recolectadas las respuestas, el agente consolida la información utilizando el formato/cuerpo Markdown original de la plantilla (ignorando/eliminando el bloque YAML en el documento final).
   
6. **Guardado (Drafting)**
   - El agente genera el documento resultante en la carpeta `{dir_drafts}/`.
   - El nombre del archivo debe seguir la convención kebab-case (ej. `{dir_drafts}/estandar-manejo-errores.md`).

## <TERMINATION_PHASE>

Una vez guardado el borrador, **DETENTE COMPLETAMENTE**. No invoques `docs-assistant` ni ninguna otra skill de forma autónoma.

Tu único paso final es:
1. Confirmar al usuario la ruta exacta donde se guardó el borrador.
2. Preguntar: *"¿Deseas continuar con el proceso de documentación? Si invocas `docs-system-orchestrator`, el orquestador evaluará el siguiente paso (por ejemplo, revisar y oficializar el borrador con `docs-assistant`)."*
3. Esperar confirmación. No proceder automáticamente.
