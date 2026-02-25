---
name: template-wizard
description: "Asiste al usuario en la creación de nuevos documentos basándose en plantillas existentes. Usa esta skill cuando el usuario quiera crear un documento desde cero."
---

# Template Wizard

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo es conversacional pero su objetivo final es crear un artefacto (borrador).

## Paso 0: Autodescubrimiento Contextual de Recursos

Antes de interactuar con el usuario o leer archivos del proyecto, DEBES ubicar dinámicamente tu carpeta de recursos de plantillas.
- Usa tus herramientas de búsqueda de archivos (e.g. `find_by_name`) para buscar el patrón `template-wizard/resources/templates` dentro de tu entorno de ejecución.
- Busca en las siguientes ubicaciones posibles: `.agents/skills/`, `.agent/skills/`, `~/.gemini/antigravity/skills/`, `~/.agents/skills/`.
- Una vez ubicada la ruta absoluta correcta, guárdala como `TEMPLATES_DIR` y úsala como prefijo para todas las operaciones de lectura/escritura de plantillas en esta sesión.
- **NO uses rutas hardcodeadas.** Si no encuentras la carpeta, informa al usuario y detente.

## Objetivo
Guiar al usuario para redactar un nuevo borrador de documento eligiendo la plantilla adecuada y haciéndole preguntas progresivas para llenar las distintas secciones definidas en los metadatos de la propia plantilla.

## Algoritmo / Pasos (Ejecución Estricta)

1. **Lectura del Contrato del Repositorio**
   - Leer `AGENTS.md` en la raíz del proyecto. Parsear el frontmatter YAML (`agent_context`) para extraer:
     - `docs_path` — directorio raíz de documentación.
     - `directories.dir_drafts` — carpeta de borradores (por defecto `{docs_path}/drafts`).
   - Usar estas rutas dinámicas en los pasos posteriores.

2. **Fase de Descubrimiento**
   - El agente DEBE listar y leer todos los archivos en `{TEMPLATES_DIR}`.
   - Extraer el bloque YAML inicial (entre `---`) prestando especial atención al campo `template_purpose`.

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
   - El agente finaliza confirmando la ruta al usuario y sugiriéndole invocar posteriormente la skill `docs-assistant` para perfeccionar y oficializar el documento.
