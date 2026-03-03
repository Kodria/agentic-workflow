# Design Doc: Integración del Orquestador "development-process"

## 1. Visión General
El objetivo de este diseño es definir la arquitectura de un ecosistema de desarrollo agnóstico, gestionado por el Agentic Workflow Manager (AWM). En lugar de depender de reglas heurísticas dispersas por proyecto, se implementará un "Orquestador de Orquestadores" llamado `development-process`. 

Este orquestador actuará como el director del ciclo de vida del software, guiando al usuario entre las diferentes skills (como `brainstorming`, `writing-plans`, `executing-plans`, etc.) independientemente de si utiliza OpenCode o Antigravity.

## 2. Arquitectura de Estado Persistente (Sesiones)
El mayor desafío de la orquestación agnóstica es la pérdida de contexto en sesiones largas o al cambiar de IDE. 

### 2.1 Archivos de Sesión
El ecosistema completo dependerá de archivos de estado persistentes, alojados en el directorio del proyecto (por ejemplo, `docs/plans/YYYY-MM-DD-<tarea>-session.md`).
*   **Inicio:** Cuando el usuario invoca `development-process` para una nueva tarea, se crea el archivo de sesión.
*   **Contenido:** El archivo debe actuar como "memoria compartida" almacenando la meta, contexto, estado actual (fase del ciclo de vida) y los punteros a los planes generados (Design Doc, Action Plan).

### 2.2 Integración Continua (Handoffs)
Ninguna skill del ecosistema actuará en el vacío. Todas las skills (`brainstorming`, `writing-plans`, etc.) deberán incluir una regla en su `SKILL.md` indicando que, al finalizar su tarea, deben:
1.  Actualizar el archivo de la sesión `-session.md`.
2.  Devolver explícitamente el control al orquestador `development-process`.

## 3. Integración y Comportamiento por IDE
El orquestador mantendrá la misma lógica base en todas las plataformas, pero su punto de invocación y forma de presentarse se adaptarán a la naturaleza de cada IDE. Es estrictamente un proceso **Guiado**, no autónomo, requiriendo autorización del usuario antes de ejecutar pasos.

### 3.1 Antigravity (Flujo Estructurado)
*   **Implementación:** Se distribuye como un Workflow Global (`/development-process`).
*   **Rutas Deseadas:**
    *   Skills: `~/.gemini/antigravity/skills`
    *   Workflows Globales: `~/.gemini/antigravity/global_workflows`
*   **Comportamiento:** El usuario llama al workflow. El orquestador lee la sesión actual, informa del estado, sugiere la siguiente skill y espera aprobación. Al terminar un paso, otra skill pide autorización para continuar con `development-process`.

### 3.2 OpenCode / Cursor (Agente Global Guiado)
*   **Implementación:** Se distribuye como un Perfil de Agente Global (evitando modificar el `AGENTS.md` o `.cursorrules` local del proyecto).
*   **Rutas Deseadas:**
    *   Skills: `~/.agents/skills`
    *   Agentes (OpenCode): `~/.config/opencode/agents` o `~/.opencode/agents` (A definir por CLI)
*   **Comportamiento:** El usuario selecciona el agente `development-process`. El agente lee pasivamente la sesión en el proyecto, presenta al usuario un análisis de las siguientes steps recomendadas y espera aprobación para invocar la skill correspondiente.

## 4. Evolución del CLI (AWM)
Para soportar estas instalaciones, el CLI de AWM no debe predecir ni deducir ubicaciones estáticas o hardcodeadas en tiempo de ejecución de manera aleatoria, sino centralizadas.
*   **Configuración:** El AWM CLI mantendrá un archivo de configuración propio (ej. `~/.awmrc` o `~/.config/awm/config.json`) almacenando las rutas base explícitas para OpenCode, Cursor y Antigravity.
*   **Instalación Racional:** Al hacer `awm add development-process`, el CLI compilará las versiones correctas (Agente vs Workflow) consultando dichas rutas y posicionando los ficheros en los directorios globales adecuados del usuario.
