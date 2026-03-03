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
