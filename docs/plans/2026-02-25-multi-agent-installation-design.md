# Design: Multi-Agent Installation for AWM CLI

## Objetivo
Permitir a los usuarios seleccionar múltiples agentes simultáneamente durante la ejecución de `awm add`, de modo que un único flujo interactivo pueda instalar un mismo artefacto (y sus complementos) en varios entornos (por ejemplo, en `Antigravity` y en `OpenCode` a la vez).

## Cambios Propuestos

### 1. Actualización de Interfaz (Prompts)
- **Prompt de Agentes**: Se sustituirá la función `select()` de `@clack/prompts` por `multiselect()`. 
- **Opciones Disponibles**: El usuario verá una lista (`[ ] Antigravity`, `[ ] OpenCode`) donde podrá seleccionar una, varias o todas las opciones utilizando la barra espaciadora.

### 2. Actualización de Flags (No Interactivo)
- **Bandera `-a, --agent`**: Se actualizará el parseo de esta bandera para que acepte una lista separada por comas.
  - *Ejemplo*: `awm add mi-skill -a antigravity,opencode`
- El CLI dividirá y limpiará (trim) esta cadena para generar un arreglo de agentes (`['antigravity', 'opencode']`).

### 3. Ajuste en Filtro de Tipo de Artefactos (Workflows)
Dado que un usuario podría seleccionar `Antigravity` y `OpenCode` simultáneamente, el prompt que pregunta *"¿Qué quieres instalar? (Skill, Workflow, Process)"* debe:
- Mostrar la opción `Workflow` **siempre que el arreglo de agentes seleccionados incluya "antigravity"** (ya que los workflows solo son funcionales ahí).

### 4. Filtrado de Compatibilidad al Instalar (El Bucle Final)
Actualmente, el final de `cli/src/index.ts` realiza el llamado directo a `installArtifact(...)`.
El nuevo diseño cambiará esto:
1. Iteraremos sobre el arreglo interactivo (o parseado) de agentes (`targetAgents`).
2. Para cada agente en la lista, iteraremos sobre los documentos (`artifactsToInstall`).
3. **Control de Workflows en OpenCode**: Dentro del bucle, agregaremos una regla de compatibilidad:
   - Si el agente actual del bucle es `opencode` y el `artifact.type` es `workflow`, **omitiremos la instalación silenciosamente** y mostraremos un aviso sutil al usuario final (`console.warn` en amarillo) indicando: `"Saltando [Workflow] para OpenCode (no soportado)"`.
4. El resto de las Skills y Procesos se instalarán en ambos sin problemas.

### 5. Resumen Final
El resumen final (`outro` o los `console.log` de "Installed: ...") iterarán sobre todo lo instalado e imprimirán los resultados de manera resumida (Ej: `Installed: mi-skill -> antigravity, opencode`).

---

## Plan de Verificación
1. **Prueba Interactiva Simple**: Lanzar `awm add`, seleccionar ambos agentes, elegir el tipo `Skill`, y comprobar que se instaló correctamente en `.agents/skills` y `.gemini/opencode/skills`.
2. **Prueba Multi-Bandera**: Comprobar el paso de argumentos no interactivos: `awm add mi-skill -a antigravity,opencode -y`.
3. **Prueba Incompatibilidad**: Seleccionar ambos agentes e intentar instalar un Workflow. Comprobar que en *Antigravity* sí se copió el archivo a `workflows`, pero en *OpenCode* se desplegó el aviso sutil en consola y **no** crasheó el sistema.
