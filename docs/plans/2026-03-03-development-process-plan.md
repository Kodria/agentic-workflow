# Development Process Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar el orquestador `development-process` en el repositorio AWM (creando sus recursos en `registry/`) y expandir el AWM CLI para soportar la distribución de perfiles de agente globales para OpenCode.

**Architecture:** Se crearán tres artefactos en el registry (Skill, Workflow para Antigravity y Agent para OpenCode). Paralelamente, el CLI de AWM (`cli/src/`) será modificado para descubrir, listar e instalar artefactos de tipo "agent", apuntando a la ruta `~/.config/opencode/agents`.

**Tech Stack:** TypeScript (Commander.js, Clack) para el CLI, Markdown para artefactos.

---

### Task 1: Crear la Skill base del Orquestador

**Files:**
- Create: `registry/skills/development-process/SKILL.md`

**Step 1: Crear el template de la skill**
```bash
mkdir -p registry/skills/development-process
```

**Step 2: Redactar la implementación inicial**
Crear contenido base en `registry/skills/development-process/SKILL.md`:
```markdown
---
name: development-process
description: El Orquestador Principal del Sistema. Úsalo para iniciar un proceso de desarrollo o enlazar fases del ciclo de vida.
---

# Development Process (Orquestador)

## Overview
Controla el ciclo de vida de desarrollo utilizando Sesiones de Trabajo y delegando a las skills correspondientes.

## Proceso de Orquestación

1. **Leer Sesión Persistente:** Busca o crea el archivo `docs/plans/YYYY-MM-DD-<tarea>-session.md`.
2. **Identificar Estado:** 
   - Nuevo -> Sugiere iniciar `BRAINSTORMING` invocando `brainstorming`.
   - Planeando -> Sugiere iniciar `writing-plans`.
   - Ejecutando -> Sugiere `subagent-driven-development` o `executing-plans`.
3. **Transferir Control:** Actualiza el archivo de sesión antes de que el usuario apruebe la transición.
```

**Step 3: Commit**
```bash
git add registry/skills/development-process/SKILL.md
git commit -m "feat(registry): add development-process base skill"
```

---

### Task 2: Crear el Workflow para Antigravity

**Files:**
- Create: `registry/workflows/development-process.md`

**Step 1: Redactar implementación del workflow**
Agregar el archivo `registry/workflows/development-process.md`:
```markdown
# Development Process Orchestrator

> [!IMPORTANT]
> **Modo de Agente**: Use el modo del contexto de la sesión (Planning o Execution).

Este workflow guía e integra todo el proceso de desarrollo de AWM en Antigravity.

## Pasos

1. Verifica `docs/plans/` para identificar el archivo `-session.md` más reciente.
2. Lee las instrucciones del orquestador desde `~/.gemini/antigravity/skills/development-process/SKILL.md`.
3. Informa al usuario del estado y presenta la skill lógica sugerida para el siguiente paso.
4. Espera confirmación explícita del usuario para iniciar la siguiente skill.
```

**Step 2: Commit**
```bash
git add registry/workflows/development-process.md
git commit -m "feat(registry): add development-process workflow for antigravity"
```

---

### Task 3: Crear el Agente Global para OpenCode

**Files:**
- Create: `registry/agents/development-process.md`

**Step 1: Crear directorio de agentes en el registry**
```bash
mkdir -p registry/agents
```

**Step 2: Redactar perfil de agente**
Agregar `registry/agents/development-process.md`:
```markdown
---
name: Development Process Orchestrator
description: El Agente Global de AWM. Selecciona este perfil para orquestar el flujo de desarrollo leyendo las sesiones de proyecto.
model: Claude 3.5 Sonnet
---

# Instrucciones del Orquestador Global (OpenCode)

1. Nunca empieces a modificar archivos sin haber discutido el estado del proyecto.
2. Lee siempre el archivo actual de la sesión (`-session.md`) en la raíz del proyecto para ubicar al equipo.
3. Presenta al usuario sus opciones basadas en las skills AWM actuales.
4. Una vez recibas aprobación verbal, invoca la skill correspondiente.
5. Actualiza siempre el documento de sesión cuando ocurran cambios de fase.
```

**Step 3: Commit**
```bash
git add registry/agents/development-process.md
git commit -m "feat(registry): add development-process agent profile for opencode"
```

---

### Task 4: Actualizar procesos AWM en el Registry

**Files:**
- Modify: `registry/processes.json`

**Step 1: Inyectar el orquestador en el core-dev**
Modificar `registry/processes.json` para reflejar el arreglo de `agents`:
```json
// En el objeto de "core-dev":
  {
    "name": "core-dev",
    "description": "Las habilidades fundamentales para el desarrollo guiado por agentes.",
    "skills": ["brainstorming", "writing-plans", "executing-plans", "subagent-driven-development", "test-driven-development", "requesting-code-review", "development-process"],
    "workflows": ["brainstorming", "writing-plans", "executing-plans", "development-process"],
    "agents": ["development-process"]
  }
```

**Step 2: Commit**
```bash
git add registry/processes.json
git commit -m "chore(registry): expose development-process in processes.json core-dev"
```

---

### Task 5: Actualizar AWM CLI Discovery Types

**Files:**
- Modify: `cli/src/core/discovery.ts`

**Step 1: Agregar el descubrimiento lógico de agentes**
Modificar las constantes y definiciones:
```typescript
export const AGENTS_DIR = path.join(REGISTRY_DIR, 'registry', 'agents');
// ...
export interface ProcessDefinition {
    // ...
    workflows: string[];
    agents?: string[];
}
```
Agregar la función `discoverAgents()` equivalente a `discoverWorkflows()` escaneando `AGENTS_DIR`.

**Step 2: Verificar CLI Build**
```bash
cd cli && npm run build
```

**Step 3: Commit**
```bash
git add cli/src/core/discovery.ts
git commit -m "feat(cli): add discovery logic for agent profiles"
```

---

### Task 6: Actualizar AWM Target Paths & Providers

**Files:**
- Modify: `cli/src/providers/index.ts`

**Step 1: Extender ArtifactType y target paths**
```typescript
export type ArtifactType = 'skill' | 'workflow' | 'agent';
```

Modificar bloque para agent opencode:
```typescript
    if (agent === 'opencode') {
        if (type === 'workflow') {
            throw new Error('Workflows are not natively supported by OpenCode.');
        }
        if (type === 'agent') {
            return scope === 'global' ? path.join(homedir, '.config/opencode/agents') : '.agents/profiles';
        }
        return scope === 'global' ? path.join(homedir, '.agents/skills') : '.agents/skills';
    }
```

**Step 2: Commit**
```bash
git add cli/src/providers/index.ts
git commit -m "feat(cli): define opencode agent installation paths"
```

---

### Task 7: Conectar Agents en CLI `add` / `list` / `remove`

**Files:**
- Modify: `cli/src/index.ts`

**Step 1: Mostrar los agentes en las listas**
Modificar la lógica en `buildGroupedOptions` e interface `CombinedArtifact` de `cli/src/index.ts`:
- Incluir `discoverAgents()` invocaciones. 
- Map para integrar `AgentArtifact[]` condicionado a si selectedAgents incluye `'opencode'`.
- Ajustar iconos (ej: agregar `🤖`).

**Step 2: Build & Verify**
```bash
cd cli && npm run build
node dist/index.js list
```
Debe listar ahora SKILLS 🧠, WORKFLOWS ⚡ y AGENTS 🤖.

**Step 3: Final Commit**
```bash
git add cli/src/index.ts
git commit -m "feat(cli): fully integrate agents deployment targeting opencode"
```
