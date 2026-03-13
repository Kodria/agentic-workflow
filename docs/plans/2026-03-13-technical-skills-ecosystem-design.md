# Diseño: Ecosistema de Skills Técnicas Transversales

> **Estado:** Aprobado
> **Fecha:** 2026-03-13
> **Contexto:** Surgió de la etapa de definiciones técnicas en el discovery de un proyecto B2B, donde se necesitaba preparar un pack para sesión con el COE. Se identificó la falta de capacidades técnicas especializadas en el ecosistema de skills.

---

## Problema

El ecosistema actual de skills tiene capacidades de desarrollo (brainstorming → writing-plans → execution) y documentación (docs-system-orchestrator → docs-brainstorming → docs-assistant), pero carece de **expertise técnico especializado** para:

- Diseño de arquitectura de software (más allá de diagramas C4)
- Propuestas de CI/CD
- Identificación y priorización de requisitos no funcionales
- Evaluación comparativa de tecnologías

Estas capacidades se necesitan transversalmente — tanto en flujos de desarrollo como de documentación y discovery.

---

## Decisiones de diseño

### Skills descartadas del análisis inicial

| Skill propuesta | Decisión | Razón |
|---|---|---|
| `technical-review-pack` (orquestador) | **Descartada** | Los orquestadores existentes (`development-process`, `docs-system-orchestrator`) ya pueden consumir las skills especialistas. Se resuelve con template + orquestadores existentes. |
| `decision-log-tracker` | **Descartada como skill** | Se resuelve con template ADR + `template-wizard` para crear + `docs-assistant` para mantener. |
| `integration-risk-matrix` | **Absorbida** | Incluida como capacidad dentro de `architecture-advisor` (fase 5: integraciones y riesgos). |

### Principios de diseño

1. **Skills transversales, no atadas a un proceso.** Pueden ser consumidas desde desarrollo, documentación o discovery.
2. **Dos modos de operación:** Completo (ciclo interactivo full) y Contextual (intervención puntual).
3. **Skills independientes con contrato de interface.** Cada skill define sus inputs, outputs y modos. Los orquestadores se actualizan con awareness en sus catálogos.
4. **Diseñar ≠ ejecutar.** Las skills especialistas diseñan y deciden. La ejecución (documentos, diagramas, código) la hacen los ejecutores existentes (`docs-assistant`, `c4-architecture`, pipeline de desarrollo).
5. **Contexto del proyecto desde dos fuentes:** repositorio (AGENTS.md → README.md → código fuente) o usuario (cuando no hay repo).
6. **Web search para datos actualizados.** Las skills deben usar búsqueda web para validar información que pueda estar desactualizada (benchmarks, pricing, estado de mantenimiento de proyectos OSS).

---

## Inventario de skills nuevas

| Skill | Tipo | Modos | Consume |
|-------|------|-------|---------|
| `architecture-advisor` | Especialista | Completo + Contextual | `c4-architecture`, `technology-evaluator` (contextual) |
| `cicd-proposal-builder` | Especialista | Completo + Contextual | ninguna |
| `nfr-checklist-generator` | Especialista | Completo + Contextual | ninguna |
| `technology-evaluator` | Especialista | Completo + Contextual | ninguna |

---

## Matriz de consumo

| Skill especialista | `brainstorming` | `docs-system-orchestrator` | `docs-brainstorming` | `docs-assistant` | `discovery-assistant` |
|---|---|---|---|---|---|
| `architecture-advisor` | **Sí** — diseñar arquitectura de un feature | **Sí** — delegar "documenta la arquitectura" | **Sí** — planificar docs de arquitectura | **Contextual** — validar/enriquecer contenido técnico mientras escribe | **Sí** — orientar decisiones de arquitectura durante sesión en vivo |
| `cicd-proposal-builder` | **Sí** — definir pipeline al diseñar un feature/proyecto | **Sí** — delegar "necesito propuesta CI/CD" | **Sí** — planificar docs de CI/CD | No | No |
| `nfr-checklist-generator` | **Sí** — definir NFRs temprano en el diseño | **Sí** — delegar "genera checklist de NFRs" | **Sí** — planificar docs de NFRs | No | **Contextual** — durante discovery surgen requisitos no funcionales naturalmente |
| `technology-evaluator` | **Sí** — evaluar opciones tecnológicas al diseñar | **Sí** — delegar "compara estas tecnologías" | **Sí** — planificar docs de evaluación | No | **Contextual** — durante discovery se evalúan opciones tecnológicas |

---

## Contrato estándar de skill especialista

Todas las skills siguen este contrato en su SKILL.md:

```yaml
---
name: skill-name
description: "..."
type: specialist
modes: [complete, contextual]
integrates_with:
  - brainstorming
  - docs-system-orchestrator
  - docs-brainstorming
  - docs-assistant        # solo si aplica
  - discovery-assistant   # solo si aplica
consumes:
  - c4-architecture       # solo si aplica
---
```

### Modo Completo — Ciclo interactivo

1. Recopilar contexto (repo o usuario)
2. Preguntas guiadas una a una
3. Proponer opciones con trade-offs
4. Presentar resultado por secciones con aprobación incremental
5. Generar artefacto de diseño → transferir al ejecutor correspondiente

### Modo Contextual — Intervención puntual

1. Recibir contexto ya establecido del skill que invoca
2. Ejecutar solo la capacidad específica solicitada
3. Retornar resultado al skill invocador
4. No abrir ciclo interactivo nuevo

### Recopilación de contexto del proyecto

```
¿El proyecto tiene repositorio?
├── Sí → Leer AGENTS.md (stack, estructura, convenciones)
│        → Leer README.md (propósito, setup)
│        → Explorar código fuente (módulos, servicios, dependencias)
│        → Preguntar: "¿Tienes contexto adicional relevante?"
└── No → Tomar exclusivamente lo que el usuario proporciona
```

### Artefacto de salida (según contexto de invocación)

| Invocado desde | Artefacto | Quién ejecuta |
|---|---|---|
| `brainstorming` | Decisiones integradas en `*-design.md` | `writing-plans` → `executing-plans` (pipeline de desarrollo) |
| `docs-brainstorming` / `docs-system-orchestrator` | Plan de documentación | `docs-assistant` (produce documentos con templates, invoca `c4-architecture` para diagramas) |
| `discovery-assistant` (contextual) | Información capturada | `discovery-assistant` la integra al discovery |
| Standalone (modo completo) | Plan de documentación | `docs-assistant` |

---

## Diseño por skill

### `architecture-advisor`

Especialista en diseño de arquitectura de software. Guía al usuario desde la comprensión de la necesidad hasta la definición completa de la arquitectura, orientando en decisiones de patrones, componentes, tecnologías, integraciones y trade-offs. Usa el conocimiento del LLM como base de expertise técnico.

#### Modo Completo

| Fase | Qué hace | Output |
|------|----------|--------|
| 1. Entender necesidad | Preguntas guiadas: qué se construye, para quién, restricciones, escala esperada, integraciones | Entendimiento compartido del problema |
| 2. Explorar espacio de soluciones | Proponer 2-3 enfoques arquitectónicos con trade-offs. Orientar en patrones (monolito modular, microservicios, event-driven, serverless, etc.) | Enfoque seleccionado por el usuario |
| 3. Definir componentes | Desglosar en componentes lógicos, definir responsabilidades, interfaces entre ellos, dependencias externas | Mapa de componentes aprobado |
| 4. Decisiones tecnológicas | Para cada componente: lenguaje, framework, base de datos, protocolos. Puede invocar `technology-evaluator` en modo contextual si hay decisión compleja | Stack definido |
| 5. Integraciones y riesgos | Mapear integraciones con sistemas externos, identificar puntos de fallo, proponer mitigaciones | Mapa de integraciones + riesgos |
| 6. Generar artefacto de diseño | Compilar decisiones en artefacto estructurado → transferir al ejecutor correspondiente según contexto de invocación | Plan/design doc |

Cada fase tiene aprobación incremental del usuario.

#### Recopilación de contexto adicional

Además del patrón estándar (AGENTS.md → README.md → código fuente), explora: dependencias existentes, configuraciones de infraestructura, patrones ya establecidos en el codebase.

#### Modo Contextual

| Invocador pide | Qué hace |
|---|---|
| "Necesito definir la arquitectura de este módulo" | Fases 2-5 con contexto ya proporcionado |
| "Qué patrón conviene para este caso?" | Solo fase 2 — proponer opciones |
| "Valida si esta arquitectura tiene sentido" | Review de lo existente + señalar riesgos/mejoras |
| "Necesito diagramas de esto" | Delegar a `c4-architecture` con contexto |
| "Qué riesgos ves en estas integraciones?" | Solo fase 5 |

---

### `cicd-proposal-builder`

Especialista en diseño de pipelines CI/CD. Guía al usuario desde las restricciones del proyecto hasta una propuesta completa de delivery pipeline.

#### Recopilación de contexto adicional

Además del patrón estándar, busca: configs existentes (Dockerfile, .github/workflows, Jenkinsfile, gitlab-ci.yml, etc.).

#### Modo Completo

| Fase | Qué hace | Output |
|------|----------|--------|
| 1. Entender contexto | Stack, cloud provider, equipo (tamaño, experiencia), constraints (compliance, seguridad, regulación) | Restricciones claras |
| 2. Branching strategy | Proponer 2-3 estrategias (trunk-based, gitflow, github flow) con trade-offs según el contexto del equipo | Estrategia seleccionada |
| 3. Ambientes y promoción | Definir ambientes (dev, staging, prod, etc.), estrategia de promoción, manejo de configuración por ambiente | Pipeline de ambientes definido |
| 4. Gates de calidad | Linting, tests unitarios, tests de integración, security scanning, code review, approval gates. Qué es blocking vs advisory | Gates definidos |
| 5. Estrategia de deploy | Blue/green, canary, rolling, feature flags. Trade-offs según infraestructura y tolerancia a downtime | Estrategia seleccionada |
| 6. Generar artefacto de diseño | Compilar decisiones → transferir al ejecutor correspondiente | Plan/design doc |

#### Modo Contextual

| Invocador pide | Qué hace |
|---|---|
| "Necesito definir el pipeline para este proyecto" | Fases 1-5 con contexto ya proporcionado |
| "Qué branching strategy conviene?" | Solo fase 2 |
| "Revisa si este pipeline tiene gaps" | Review de configuración existente + señalar mejoras |
| "Qué gates de calidad debería tener?" | Solo fase 4 |

---

### `nfr-checklist-generator`

Especialista en requisitos no funcionales. Guía al usuario en la identificación, priorización y definición de NFRs, distinguiendo qué debe definirse temprano vs qué puede esperar.

#### Recopilación de contexto adicional

Además del patrón estándar, busca: docs existentes de NFRs, SLAs, runbooks. Detecta qué ya está implementado (logging, monitoring, auth, rate limiting, etc.).

#### Modo Completo

| Fase | Qué hace | Output |
|------|----------|--------|
| 1. Clasificar proyecto | Tipo (B2B, B2C, interno, regulated), industria, criticidad | Perfil del proyecto |
| 2. Categorías aplicables | Presentar categorías relevantes según el perfil: observabilidad, seguridad, data privacy, compliance, performance, disponibilidad, operación/soporte, escalabilidad, accesibilidad | Categorías priorizadas |
| 3. Definir por categoría | Para cada categoría priorizada: métricas/criterios, nivel de exigencia, qué ya existe vs qué falta | NFRs definidos por categoría |
| 4. Priorizar timing | Clasificar cada NFR en: **definir ahora** (retrabajo si se posterga) vs **puede esperar** (se agrega después sin impacto) | Matriz de priorización temporal |
| 5. Generar artefacto de diseño | Compilar → transferir al ejecutor correspondiente | Plan/design doc |

#### Modo Contextual

| Invocador pide | Qué hace |
|---|---|
| "Qué NFRs debería considerar para este proyecto?" | Fases 1-2 rápidas con contexto proporcionado |
| "Qué NFRs no puedo dejar para después?" | Solo fase 4 con NFRs ya conocidos |
| "Revisa si me falta algo en estos NFRs" | Gap analysis contra el perfil del proyecto |
| "Qué nivel de observabilidad necesito?" | Solo una categoría de fase 3 |

---

### `technology-evaluator`

Especialista en evaluación comparativa de tecnologías. Guía al usuario en la selección de cualquier herramienta, framework, librería, base de datos, cloud service o componente tecnológico.

#### Recopilación de contexto adicional

Además del patrón estándar, identifica: tecnologías ya en uso (package.json, go.mod, requirements.txt, etc.), restricciones implícitas por stack actual.

#### Modo Completo

| Fase | Qué hace | Output |
|------|----------|--------|
| 1. Definir qué se evalúa | Tipo de decisión, por qué surge, qué problema resuelve | Alcance de la evaluación |
| 2. Candidatos | Identificar opciones viables. El usuario trae su lista o pide recomendaciones. Filtrar no viables | Lista de candidatos (2-5) |
| 3. Criterios de evaluación | Definir criterios según tipo de decisión y restricciones. Ponderar por importancia | Criterios ponderados |
| 4. Evaluación comparativa | Evaluar cada candidato contra cada criterio. Usar **web search** para validar datos que puedan estar desactualizados (último release, pricing, benchmarks, licencia, estado de mantenimiento) | Matriz de evaluación |
| 5. Recomendación | Presentar recomendación con justificación, riesgos de la opción elegida, en qué escenarios otra opción sería mejor | Decisión informada |
| 6. Generar artefacto de diseño | Compilar → transferir al ejecutor correspondiente | Plan/design doc |

#### Modo Contextual

| Invocador pide | Qué hace |
|---|---|
| "Compara estas 3 opciones para X" | Fases 3-5 con candidatos ya definidos |
| "Qué criterios debería usar para elegir un X?" | Solo fase 3 |
| "Qué opciones hay para resolver X?" | Solo fase 2 — listar candidatos |
| "Valida si esta elección tiene sentido" | Review de decisión existente + señalar riesgos |

---

## Integración con orquestadores existentes

### Cambios en `docs-system-orchestrator`

Agregar 4 entradas al catálogo de skills:

| Necesidad / Estado | Skill Destino | Cuándo usar |
|--------------------|---------------|-------------|
| **Diseñar arquitectura de un sistema** | `architecture-advisor` | El usuario necesita definir o revisar la arquitectura de un proyecto. Ciclo completo interactivo. |
| **Propuesta de CI/CD** | `cicd-proposal-builder` | El usuario necesita definir pipeline, ambientes, branching, deploy strategy. |
| **Definir requisitos no funcionales** | `nfr-checklist-generator` | El usuario necesita identificar y priorizar NFRs para un proyecto. |
| **Evaluar/comparar tecnologías** | `technology-evaluator` | El usuario necesita decidir entre opciones tecnológicas con criterios estructurados. |

### Cambios en `brainstorming`

Agregar directiva de awareness: durante la fase de exploración de enfoques, si detecta que la conversación involucra decisiones de arquitectura, CI/CD, NFRs o selección tecnológica de complejidad significativa, puede invocar la skill especialista correspondiente en modo contextual. No invocar para decisiones triviales.

### Cambios en `docs-brainstorming`

Mismo enfoque que brainstorming. Agregar awareness de skills especialistas para planificación de documentación técnica. El plan que produce debe indicar qué skills de apoyo necesita el ejecutor.

### Cambios en `docs-assistant`

Agregar capacidad de invocar `architecture-advisor` en modo contextual solamente. Para validar/enriquecer contenido de arquitectura mientras escribe. No abre ciclo interactivo nuevo.

### Cambios en `discovery-assistant`

Agregar awareness en Modo C (Acompañar en Vivo): si durante la sesión surgen temas de arquitectura, NFRs o evaluación tecnológica, puede invocar `architecture-advisor`, `nfr-checklist-generator` o `technology-evaluator` en modo contextual. No interrumpe el flujo del discovery.

### Sin cambios

- `development-process` — consume las skills indirectamente vía brainstorming.

---

## Resumen de impacto

| Artefacto | Tipo de cambio |
|-----------|---------------|
| `docs-system-orchestrator/SKILL.md` | Ampliar tabla de catálogo |
| `brainstorming/SKILL.md` | Agregar directiva de awareness |
| `docs-brainstorming/SKILL.md` | Agregar directiva de awareness |
| `docs-assistant/SKILL.md` | Agregar capacidad contextual limitada |
| `discovery-assistant/SKILL.md` | Agregar awareness en Modo C |
| `development-process/SKILL.md` | Sin cambios |
| **4 skills nuevas** | Crear desde cero |
