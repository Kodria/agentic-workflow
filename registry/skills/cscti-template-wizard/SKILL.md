---
name: cscti-template-wizard
description: "Asiste al usuario en la creación de nuevos documentos para CSCTI basándose en plantillas existentes. Usa esta skill cuando el usuario quiera crear un documento desde cero."
---

# CSCTI Template Wizard

> [!IMPORTANT]
> **Modo de Agente**: Use **Execution Mode**. Este flujo es conversacional pero su objetivo final es crear un artefacto (borrador).

## Objetivo
Guiar al usuario para redactar un nuevo borrador de documento eligiendo la plantilla adecuada y haciéndole preguntas progresivas para llenar las distintas secciones definidas en los metadatos de la propia plantilla.

## Algoritmo / Pasos (Ejecución Estricta)

0. **Lectura del Contrato del Repositorio**
   - Leer `AGENTS.md` en la raíz del proyecto. Parsear el frontmatter YAML (`agent_context`) para extraer:
     - `docs_path` — directorio raíz de documentación.
     - `directories.dir_drafts` — carpeta de borradores (por defecto `{docs_path}/drafts`).
   - Usar estas rutas dinámicas en los pasos posteriores.

1. **Fase de Descubrimiento**
   - El agente DEBE listar y leer todos los archivos en `resources/templates/` (relativo a este SKILL.md).
   - Extraer el bloque YAML inicial (entre `---`) prestando especial atención al campo `template_purpose`.

2. **Fase de Análisis y Match**
   - El agente debe cruzar la intención declarada por el usuario al invocar la skill con los `template_purpose` leídos.
   - Si la intención del usuario encaja con una plantilla, el agente le informa al usuario qué plantilla ha elegido y pasa a la fase 3.
   - **Fallback (NO Match):** Si ninguna plantilla aplica, el agente SE DETIENE, le explica al usuario por qué ninguna plantilla existente (como ADR o Estándar) sirve para su requerimiento, y le aconseja crear una nueva plantilla primero si es un formato transversal nuevo.

3. **Fase de Entrevista**
   - Basado en el campo `interview_questions` del metadata de la plantilla seleccionada, el agente debe hacerle las preguntas al usuario de a una por vez o en bloques muy pequeños.
   - Esperar la respuesta del usuario para cada sección/pregunta.

4. **Fase de Generación**
   - Una vez recolectadas las respuestas, el agente consolida la información utilizando el formato/cuerpo Markdown original de la plantilla (ignorando/eliminando el bloque YAML en el documento final).
   
5. **Guardado (Drafting)**
   - El agente genera el documento resultante en la carpeta `{dir_drafts}/`.
   - El nombre del archivo debe seguir la convención kebab-case (ej. `{dir_drafts}/estandar-manejo-errores.md`).
   - El agente finaliza confirmando la ruta al usuario y sugiriéndole invocar posteriormente a la skill `@[/cscti-docs-assistant]` para perfeccionar y oficializar el documento.

