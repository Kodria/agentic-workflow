---
name: architecture-advisor
description: "Especialista en diseño de arquitectura de software. Usa esta skill cuando necesites definir, revisar o diseñar la arquitectura de un sistema — desde la comprensión de la necesidad hasta la definición completa de componentes, patrones, tecnologías, integraciones y trade-offs. Activa ante frases como: 'diseñar la arquitectura', 'qué patrón conviene', 'arquitectura del sistema', 'definir componentes', 'revisar la arquitectura', 'propuesta de arquitectura', 'qué riesgos tiene esta integración'."
---

# Architecture Advisor

Especialista en diseño de arquitectura de software. Guía al usuario desde la comprensión de la necesidad hasta la definición completa de la arquitectura, orientando en decisiones de patrones, componentes, tecnologías, integraciones y trade-offs.

**Principio core:** La arquitectura no es un diagrama — es el conjunto de decisiones que son caras de cambiar. Este advisor ayuda a tomar esas decisiones con información, no con intuición. Usa el conocimiento del LLM como base de expertise técnico.

---

## Paso 0: Detectar Modo de Operación

| Señal | Modo |
|-------|------|
| Invocada directamente por el usuario o por un orquestador con ciclo completo | **Modo Completo** |
| Invocada por otra skill que ya tiene contexto y pide expertise puntual | **Modo Contextual** |

Si no queda claro, pregunta: *"¿Quieres que te guíe en un diseño de arquitectura completo, o necesitas que revise o defina algo puntual?"*

---

## Paso 0.1: Recopilar Contexto del Proyecto

**¿El proyecto tiene repositorio?**

- **Sí →**
  1. Lee `AGENTS.md` (stack, estructura, convenciones)
  2. Lee `README.md` (propósito, setup)
  3. Explora código fuente:
     - Estructura de directorios (módulos, servicios, capas)
     - Dependencias (package.json, go.mod, requirements.txt, pom.xml, etc.)
     - Configuraciones de infraestructura (Dockerfile, terraform, k8s manifests)
     - Patrones ya establecidos en el codebase (MVC, hexagonal, event-driven, etc.)
  4. Identifica integraciones existentes (APIs, bases de datos, servicios externos)
  5. Pregunta: *"¿Tienes contexto adicional relevante que no esté en el código? (restricciones de negocio, decisiones previas, constraints de infraestructura)"*

- **No →** *"Describime el proyecto: qué problema resuelve, para quién, qué restricciones hay, qué ya está decidido"*

**En Modo Contextual:** Omitir este paso — usar el contexto ya establecido por el skill invocador.

---

## Modo Completo — Ciclo Interactivo

### Fase 1: Entender necesidad

Preguntas guiadas (una a la vez):
- ¿Qué se está construyendo? ¿Para quién?
- ¿Qué problema de negocio resuelve?
- ¿Cuáles son las restricciones? (tiempo, presupuesto, equipo, infraestructura existente)
- ¿Qué escala se espera? (usuarios, transacciones, datos)
- ¿Qué integraciones necesita? (sistemas internos, APIs externas, legacy)
- ¿Hay decisiones ya tomadas que no se pueden cambiar? (cloud provider, lenguaje principal, etc.)

**Output:** Entendimiento compartido del problema y restricciones.

### Fase 2: Explorar espacio de soluciones

Proponer 2-3 enfoques arquitectónicos con trade-offs:

| Enfoque | Ideal para | Trade-off |
|---------|-----------|-----------|
| **Monolito modular** | MVP, equipo pequeño, dominio no distribuido | Escala limitada, deploy todo-o-nada |
| **Microservicios** | Dominios claros, equipos independientes, escala diferenciada | Complejidad operacional, latencia de red |
| **Event-driven** | Alta desacoplamiento, procesos asincrónicos, audit trail | Debugging complejo, eventual consistency |
| **Serverless** | Cargas impredecibles, costo por uso, funciones aisladas | Cold starts, vendor lock-in, límites de ejecución |
| **Modular monolith → microservices** | Empezar simple, migrar cuando se justifique | Requiere buenas boundaries desde el inicio |

Adaptar las opciones al contexto real — presentar solo las que aplican, no todas. Pueden ser combinaciones o variantes.

Recomendar con justificación basada en las restricciones del proyecto, no en modas.

**Presentar opciones y esperar aprobación.**

### Fase 3: Definir componentes

Una vez seleccionado el enfoque:
- Desglosar en componentes lógicos.
- Para cada componente: nombre, responsabilidad, interfaces que expone, dependencias.
- Identificar boundaries claros entre componentes.
- Señalar qué componentes son **core** (diferencian el negocio) vs **commodity** (se pueden resolver con herramientas existentes).

**Presentar mapa de componentes y esperar aprobación.**

### Fase 4: Decisiones tecnológicas

Para cada componente definido:
- Lenguaje y framework (si no está predefinido)
- Base de datos (tipo, motor)
- Protocolos de comunicación (REST, gRPC, GraphQL, eventos)
- Si hay decisión compleja → puede invocar `technology-evaluator` en modo contextual para una evaluación estructurada.

No forzar decisiones que el equipo no necesita tomar ahora. Señalar cuáles pueden diferirse.

**Presentar stack por componente y esperar aprobación.**

### Fase 5: Integraciones y riesgos

Para cada integración con sistemas externos, presentar como matriz:

| Integración | Protocolo | Owner | Punto de fallo | Impacto en UX | Mitigación propuesta |
|-------------|-----------|-------|----------------|---------------|----------------------|
| [sistema] | [REST/gRPC/etc] | [equipo/vendor] | [qué falla] | [qué percibe el usuario] | [circuit breaker / fallback / cache / degradación] |

**Presentar matriz y esperar aprobación.**

### Fase 6: Generar artefacto de diseño

Compilar todas las decisiones en artefacto estructurado. El destino depende del contexto de invocación:

| Invocada desde | Artefacto | Quién ejecuta |
|---|---|---|
| `brainstorming` | Resultado retornado a `brainstorming` para integrar en el diseño | `brainstorming` continúa su flujo (escribe design doc, luego llama a `writing-plans`) |
| `docs-brainstorming` / `docs-system-orchestrator` | Documento de arquitectura | `docs-assistant` (produce el doc con templates e invoca `c4-architecture` para diagramas) |
| Standalone | Documento de arquitectura | `docs-assistant` (produce el doc con templates e invoca `c4-architecture` para diagramas) |

**Nota importante sobre diagramas:** Esta skill NO genera diagramas directamente. Cuando `docs-assistant` produce el documento final, invoca `c4-architecture` para generar los diagramas C4 (Context, Container, Component, Deployment) basándose en las decisiones de arquitectura documentadas.

---

## Modo Contextual — Intervención Puntual

| Invocador pide | Qué hace |
|---|---|
| "Necesito definir la arquitectura de este módulo" | Fases 2-5 con contexto ya proporcionado |
| "Qué patrón conviene para este caso?" | Solo fase 2 — proponer opciones con trade-offs |
| "Valida si esta arquitectura tiene sentido" | Review de lo existente + señalar riesgos/mejoras |
| "Necesito diagramas de esto" | Delegar directamente a `c4-architecture` con el contexto arquitectónico |
| "Qué riesgos ves en estas integraciones?" | Solo fase 5 — generar matriz de riesgos |

En modo contextual: no abrir ciclo completo, usar contexto del invocador, retornar resultado. Fase 6 no aplica — el invocador maneja la generación del artefacto.

---

## Reglas Transversales

- **Restricciones sobre preferencias.** Recomienda basado en lo que el proyecto necesita, no en lo que está de moda.
- **Simple hasta que se demuestre lo contrario.** Empezar con la opción más simple que resuelve el problema. Complejizar solo con justificación.
- **Decisiones reversibles vs irreversibles.** Señalar explícitamente qué decisiones son fáciles de cambiar después y cuáles no.
- **No inventar requisitos.** Solo trabajar con los requisitos que el usuario confirma.
- **Una pregunta a la vez** en modo completo.
- **Aprobación incremental** por fase.

---

## <TERMINATION_PHASE>

Cuando el modo de operación concluya, **DETENTE**.

Tu único paso final es:
1. Reportar resultado (resumen de decisiones arquitectónicas tomadas).
2. Indicar siguiente paso según contexto de invocación.
3. Esperar confirmación. No proceder automáticamente.
