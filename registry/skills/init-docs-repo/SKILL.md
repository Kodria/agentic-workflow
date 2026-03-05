---
name: init-docs-repo
description: "Inicializa o actualiza la estructura de documentación Docs-as-Code para un repositorio de proyecto. Úsala CUANDO se requiera crear o dar formato estándar a la documentación de un repositorio, incluyendo la creación de directorios (docs/00-overview, docs/10-architecture, etc.), copiado de plantillas base, generación de archivos raíz (README.md, CONTRIBUTING.md, CODEOWNERS) y la configuración del contexto agentil mediante AGENTS.md. Soporta la inicialización de repositorios vacíos así como la refactorización o evolución de repositorios existentes basándose en el análisis de contexto de project-context-init."
---

# `init-docs-repo` Skill

## Propósito
Esta skill establece y mantiene la estructura estándar de documentación (Docs-as-Code) del ecosistema en cualquier repositorio. 
Garantiza que todos los repositorios compartan una taxonomía común, facilitando la navegación, el mantenimiento y la contribución escalable por parte de humanos y agentes.

## Contexto y Requisitos
- **Estándar CSCTI:** La estructura generada imita la organización base establecida para la documentación global (e.g., inspirada en `csc-docs`).
- **Modos de Operación:**
    1.  **Initial Setup:** Para repositorios sin estructura previa. Crea los directorios base bajo `docs/`, archivos raíz esenciales y realiza el primer setup de `AGENTS.md`.
    2.  **Evolution/Refactoring:** Para repositorios existentes. Analiza el contexto actual (usando `AGENTS.md` y `project-context-init`) para añadir directorios específicos del proyecto (ej. `docs/api`, `docs/c4-models`) y actualizar los índices, manteniendo la estructura viva y adaptada a su realidad.
- **Autocontención:** Las plantillas base esenciales (como `directory-index-template.md`) están integradas dentro de los recursos de esta skill.

## Dependencias
- `project-context-init`: Utilizada para generar, leer o actualizar el archivo clave `AGENTS.md` que define el contexto del proyecto y guía la evolución de la estructura.

## Flujo de Ejecución (Paso a Paso)

### 1. Inicialización de Contexto y Decisión de Modo
1.  **Verificar existencia de `AGENTS.md`:** Revisa si el archivo raíz `AGENTS.md` existe en el directorio del proyecto destino.
2.  **Invocación a `project-context-init`:**
    *   **Si NO existe:** Invoca [project-context-init](/Users/cencosud/Developments/personal/agentic-workflow/registry/skills/project-context-init) para crear un nuevo `AGENTS.md` base analizando el repositorio. Entra en modo **Initial Setup**.
    *   **Si SÍ existe:** Lee el `AGENTS.md` actual y los directorios existentes en `docs/` para entender el estado actual. Invoca a `project-context-init` para actualizar el contexto si es necesario. Entra en modo **Evolution/Refactoring**.

### 2. Creación de Estructura Base (Solo modo Initial Setup o carpetas faltantes)
1.  **Crear Directorio Raíz de Docs:** Asegura que exista el directorio `docs/` en la raíz del proyecto.
2.  **Crear Subdirectorios Estándar:** Crea los siguientes directorios dentro de `docs/` si no existen:
    *   `00-overview/`
    *   `10-architecture/`
    *   `20-standards/`
    *   `30-processes/`
    *   `40-runbooks/`
    *   `50-projects/`
    *   `adr/`
    *   `plans/`
    *   `templates/`

### 3. Generación de Directorios Dinámicos (Solo modo Evolution/Refactoring)
1.  **Analizar Contexto:** Basado en la información recopilada del paso 1 (especialmente las secciones "Componentes Principales" o "Tecnologías" de `AGENTS.md`), determinar si se requieren carpetas adicionales dentro de `docs/`.
    *   *Ejemplo:* Si el proyecto tiene una API REST extensa, crear `docs/api/`. Si tiene interfaz de usuario compleja, crear `docs/ui/`. Si es intensivo en datos, crear `docs/database/` o `docs/data-models/`.
2.  **Crear Directorios Específicos:** Crear los directorios identificados como necesarios.

### 4. Población de Índices (`README.md` por directorio)
1.  Para **CADA** directorio creado/existente en `docs/` (incluyendo los dinámicos del Paso 3), verificar si existe un archivo `README.md` dentro de él.
2.  **Si NO existe:**
    *   Copiar la plantilla `directory-index-template.md` (ubicada en `resources/templates/` de esta skill).
    *   Completar el título, propósito y estructura basándose en el nombre del directorio y el contexto del proyecto. *(Recomendación: Usar la estructura general para inferir el propósito. Ej. `10-architecture` -> "Documentación de decisiones y diseño arquitectónico").*

### 5. Generación de Archivos Raíz (Si no existen)
1.  **`README.md` (Raíz):** Crear o actualizar el README principal. Debe incluir el nombre del proyecto (extraído de `AGENTS.md`), una breve descripción y enlaces rápidos a los directorios clave dentro de `docs/`.
2.  **`CONTRIBUTING.md`:** Generar un archivo básico de guías de contribución que referencie el estándar general y el proceso de PRs.
3.  **`CODEOWNERS` (Opcional pero recomendado):** Generar una plantilla básica asignando responsables de la documentación.
4.  **`.gitignore`:** Asegurar que existe y contenga entradas comunes (ej. `.DS_Store`, archivos de compilación, si es aplicable).

### 6. Registro en Repositorio Global (Opcional - Acción del Usuario)
1.  **Notificar al Usuario:** Informar al usuario que la estructura local ha sido inicializada/actualizada con éxito.
2.  **Sugerir Registro:** Preguntar explícitamente al usuario si desea registrar este nuevo repositorio/proyecto en el catálogo central (por ejemplo, añadiendo un documento y entrada en la tabla de `csc-docs/docs/50-projects/`).
    *   *Nota: La ejecución de este registro global debe manejarse en una skill separada o como un paso manual guiado, ya que involucra modificar un repositorio diferente.*

## Archivos y Recursos Incluidos
- `resources/templates/directory-index-template.md`: Plantilla base obligatoria para los README.md que actúan como índice de cada subdirectorio.
- *(Opcional)* `resources/templates/runbook-template.md`: Plantilla para guías operativas.

## Indicadores de Éxito
- La estructura de directorios en `docs/` refleja el estándar esperado.
- Cada directorio principal en `docs/` tiene un `README.md` con contenido inicial válido basado en la plantilla y el contexto del proyecto.
- Los archivos raíz (`AGENTS.md`, `README.md`, `CONTRIBUTING.md`) existen y contienen información coherente con el tipo de proyecto.
- (En evolución) La estructura refleja nuevas necesidades detectadas (ej. la aparición de la carpeta `docs/api/`).
