# Technical Skills Ecosystem Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create 4 transversal specialist skills (architecture-advisor, cicd-proposal-builder, nfr-checklist-generator, technology-evaluator) and integrate them into existing orchestrators.

**Architecture:** Skills follow a standard specialist contract with dual-mode operation (complete/contextual). Each skill is a standalone SKILL.md in `registry/skills/<name>/`. Existing orchestrators are updated with awareness directives and catalog entries. Skills are registered in `registry/processes.json` under both `core-dev` and `docs` processes.

**Tech Stack:** Markdown SKILL.md files with YAML frontmatter. No code — these are prompt-driven skills.

**Design doc:** `docs/plans/2026-03-13-technical-skills-ecosystem-design.md`

---

### Task 1: Create `technology-evaluator` skill

**Why first:** No dependencies on other new skills. `architecture-advisor` (Task 4) consumes this skill in contextual mode, so it must exist first.

**Files:**
- Create: `registry/skills/technology-evaluator/SKILL.md`

**Step 1: Create the skill directory**

Run: `mkdir -p registry/skills/technology-evaluator`

**Step 2: Write SKILL.md**

Create `registry/skills/technology-evaluator/SKILL.md` with the following content:

```markdown
---
name: technology-evaluator
description: "Especialista en evaluación comparativa de tecnologías. Usa esta skill cuando necesites decidir entre opciones tecnológicas (frameworks, librerías, bases de datos, cloud services, herramientas) con criterios estructurados y scoring. Activa ante frases como: 'compara estas opciones', 'qué framework debería usar', 'evalúa estas alternativas', 'necesito elegir entre X e Y', 'qué base de datos conviene para este caso'."
---

# Technology Evaluator

Especialista en evaluación comparativa de tecnologías. Guía al usuario en la selección de cualquier herramienta, framework, librería, base de datos, cloud service o componente tecnológico mediante un proceso estructurado de criterios, evaluación y scoring.

**Principio core:** El input es declarativo (qué necesito, qué restricciones tengo), el output es un artefacto concreto (matriz de evaluación con recomendación). La decisión final siempre es del usuario.

---

## Paso 0: Detectar Modo de Operación

| Señal | Modo |
|-------|------|
| Invocada directamente por el usuario o por un orquestador con ciclo completo | **Modo Completo** |
| Invocada por otra skill (brainstorming, docs-brainstorming, discovery-assistant) que ya tiene contexto establecido y pide expertise puntual | **Modo Contextual** |

Si no queda claro, pregunta: *"¿Quieres que te guíe en una evaluación completa desde cero, o necesitas que evalúe algo puntual dentro del trabajo que ya estamos haciendo?"*

---

## Paso 0.1: Recopilar Contexto del Proyecto

Antes de preguntar al usuario:

**¿El proyecto tiene repositorio?**

- **Sí →**
  1. Lee `AGENTS.md` (stack, convenciones, estructura)
  2. Lee `README.md` (propósito, setup)
  3. Identifica tecnologías ya en uso (package.json, go.mod, requirements.txt, pom.xml, Gemfile, etc.)
  4. Detecta restricciones implícitas por stack actual
  5. Pregunta: *"¿Hay estándares corporativos o restricciones adicionales que apliquen?"*

- **No →** Toma exclusivamente lo que el usuario proporciona.

---

## Modo Completo — Ciclo Interactivo

### Fase 1: Definir qué se evalúa

Preguntas guiadas (una a la vez):
- ¿Qué tipo de decisión es? (framework, DB, UI library, cloud service, herramienta, etc.)
- ¿Por qué surge esta necesidad? ¿Qué problema resuelve?
- ¿Ya tienen algo en uso que quieren reemplazar? ¿Por qué?

**Output:** Alcance de la evaluación claro y compartido.

### Fase 2: Identificar candidatos

- Si el usuario trae su lista → validar que sean opciones viables dado el contexto.
- Si el usuario pide recomendaciones → proponer opciones basadas en el contexto del proyecto.
- Filtrar candidatos claramente no viables (incompatibilidad de licencia, proyecto abandonado, no soporta el runtime, etc.).
- **Usar web search** para validar estado actual de cada candidato (último release, actividad del repo, licencia vigente).
- Limitar a 2-5 candidatos finales.

**Presentar al usuario y esperar aprobación antes de continuar.**

### Fase 3: Definir criterios de evaluación

Proponer criterios relevantes según el tipo de decisión y restricciones. Ejemplos por categoría:

| Categoría | Criterios posibles |
|-----------|-------------------|
| Técnicos | Performance, bundle size, type safety, API design, extensibilidad |
| Ecosistema | Comunidad, documentación, plugins/integraciones, adopción en la industria |
| Operacionales | Learning curve, debugging experience, tooling, migration path |
| Estratégicos | Licencia, mantenimiento activo, backing corporativo, roadmap |
| Compatibilidad | Integración con stack actual, soporte de runtime, requisitos de infra |

- Pedir al usuario que pondere por importancia (alta/media/baja o peso numérico).
- No incluir criterios que no aplican al contexto.

**Presentar criterios ponderados y esperar aprobación.**

### Fase 4: Evaluación comparativa

Para cada candidato contra cada criterio:
- Evaluar con datos concretos, no opiniones vagas.
- **Usar web search** para validar datos que puedan estar desactualizados (benchmarks recientes, pricing actual, estado de mantenimiento, breaking changes).
- Ser honesto cuando no hay datos claros para un criterio — señalar que requiere PoC o benchmark propio.
- Presentar en formato matriz.

**Presentar matriz de evaluación y esperar aprobación.**

### Fase 5: Recomendación

- Presentar recomendación con justificación clara.
- Señalar riesgos de la opción recomendada.
- Indicar en qué escenarios otra opción sería mejor.
- Si la evaluación es muy cerrada, decirlo — no forzar un ganador artificial.

**Presentar recomendación y esperar aprobación.**

### Fase 6: Generar artefacto de diseño

Compilar todas las decisiones en un artefacto estructurado. El destino depende del contexto de invocación:

| Invocada desde | Artefacto | Quién ejecuta |
|---|---|---|
| `brainstorming` | Decisiones integradas en `*-design.md` | `writing-plans` → `executing-plans` |
| `docs-brainstorming` / `docs-system-orchestrator` | Plan de documentación | `docs-assistant` produce el documento con templates |
| Standalone | Plan de documentación | `docs-assistant` |

---

## Modo Contextual — Intervención Puntual

La skill recibe contexto del invocador y ejecuta solo la capacidad solicitada:

| Invocador pide | Qué hace |
|---|---|
| "Compara estas 3 opciones para X" | Fases 3-5 con candidatos ya definidos |
| "Qué criterios debería usar para elegir un X?" | Solo fase 3 |
| "Qué opciones hay para resolver X?" | Solo fase 2 — listar candidatos |
| "Valida si esta elección tiene sentido" | Review de decisión existente + señalar riesgos |

En modo contextual:
- No abrir ciclo interactivo completo.
- Usar el contexto ya establecido por el skill invocador.
- Retornar resultado al invocador para que lo integre en su flujo.

---

## Reglas Transversales

- **No fuerces un ganador.** Si las opciones son equivalentes, dilo.
- **Datos sobre opiniones.** Respalda cada evaluación con datos concretos o señala que es una valoración subjetiva.
- **Web search obligatorio** en fase 2 y 4 para validar estado actual de los candidatos.
- **Una pregunta a la vez** en modo completo.
- **Aprobación incremental** — presentar resultados por fase y esperar confirmación.

---

## <TERMINATION_PHASE>

Cuando el modo de operación concluya, **DETENTE**.

Tu único paso final es:
1. Reportar el resultado al usuario (resumen de evaluación y recomendación).
2. Indicar el siguiente paso según el contexto de invocación.
3. Esperar confirmación. No proceder automáticamente.
```

**Step 3: Verify the file exists and frontmatter is valid**

Run: `head -5 registry/skills/technology-evaluator/SKILL.md`
Expected: YAML frontmatter with name and description.

**Step 4: Commit**

```bash
git add registry/skills/technology-evaluator/SKILL.md
git commit -m "feat: add technology-evaluator specialist skill"
```

---

### Task 2: Create `nfr-checklist-generator` skill

**Files:**
- Create: `registry/skills/nfr-checklist-generator/SKILL.md`

**Step 1: Create the skill directory**

Run: `mkdir -p registry/skills/nfr-checklist-generator`

**Step 2: Write SKILL.md**

Create `registry/skills/nfr-checklist-generator/SKILL.md` with the following content:

```markdown
---
name: nfr-checklist-generator
description: "Especialista en requisitos no funcionales. Usa esta skill cuando necesites identificar, priorizar y definir NFRs para un proyecto — observabilidad, seguridad, data privacy, compliance, performance, operación/soporte. Activa ante frases como: 'qué no funcionales necesito', 'checklist de NFRs', 'qué definir temprano', 'requisitos de seguridad', 'necesito definir observabilidad', 'qué compliance aplica'."
---

# NFR Checklist Generator

Especialista en requisitos no funcionales. Guía al usuario en la identificación, priorización y definición de NFRs, distinguiendo qué debe definirse temprano (para no rehacer) vs qué puede esperar.

**Principio core:** Un NFR bien definido temprano ahorra meses de retrabajo. Un NFR mal priorizado consume tiempo que el proyecto no tiene. El output es un checklist priorizado y accionable.

---

## Paso 0: Detectar Modo de Operación

| Señal | Modo |
|-------|------|
| Invocada directamente por el usuario o por un orquestador con ciclo completo | **Modo Completo** |
| Invocada por otra skill que ya tiene contexto y pide expertise puntual | **Modo Contextual** |

Si no queda claro, pregunta: *"¿Quieres que te guíe en una definición completa de NFRs desde cero, o necesitas que revise algo puntual?"*

---

## Paso 0.1: Recopilar Contexto del Proyecto

**¿El proyecto tiene repositorio?**

- **Sí →**
  1. Lee `AGENTS.md` (stack, tipo de proyecto, estructura)
  2. Lee `README.md` (propósito)
  3. Busca docs existentes de NFRs, SLAs, runbooks
  4. Detecta qué ya está implementado (logging frameworks, monitoring, auth, rate limiting, health checks, etc.)
  5. Pregunta: *"¿Hay requisitos regulatorios o de compliance que apliquen?"*

- **No →** *"Describime: tipo de proyecto (B2B, B2C, interno, regulated), industria, usuarios esperados, criticidad operacional"*

---

## Modo Completo — Ciclo Interactivo

### Fase 1: Clasificar proyecto

Preguntas guiadas (una a la vez):
- ¿Qué tipo de proyecto es? (B2B, B2C, interno, plataforma, regulated)
- ¿Qué industria? (retail, finanzas, salud, gobierno, etc.)
- ¿Cuál es la criticidad operacional? (si se cae, ¿qué pasa?)
- ¿Cuántos usuarios se esperan? ¿Hay picos de tráfico?
- ¿Hay regulaciones que apliquen? (PCI-DSS, GDPR, SOX, HIPAA, etc.)

**Output:** Perfil del proyecto claro.

### Fase 2: Categorías aplicables

Según el perfil, presentar las categorías relevantes con su prioridad sugerida:

| Categoría | Qué cubre | Relevancia típica |
|-----------|-----------|-------------------|
| **Observabilidad** | Logging, monitoring, alerting, tracing, dashboards | Siempre alta |
| **Seguridad** | AuthN, AuthZ, encryption, secret management, vulnerability scanning | Siempre alta |
| **Data Privacy** | PII handling, data retention, consent, right to deletion | Alta si B2C o regulated |
| **Compliance** | Regulaciones específicas, auditoría, certificaciones | Alta si regulated |
| **Performance** | Latencia, throughput, response time, capacidad | Alta si user-facing |
| **Disponibilidad** | Uptime SLA, disaster recovery, failover, backup/restore | Alta si crítico |
| **Escalabilidad** | Horizontal/vertical scaling, capacity planning | Media-alta según volumen |
| **Operación/Soporte** | Deployment, rollback, incident response, runbooks, on-call | Siempre media-alta |
| **Accesibilidad** | WCAG, screen readers, keyboard navigation | Alta si B2C web |

- No incluir categorías que claramente no aplican al contexto.
- El usuario puede agregar o quitar categorías.

**Presentar y esperar aprobación.**

### Fase 3: Definir por categoría

Para cada categoría priorizada (una a la vez):
- Proponer métricas/criterios concretos según el perfil del proyecto.
- Indicar qué nivel de exigencia es razonable para el tipo de proyecto.
- Señalar qué ya existe vs qué falta (si hay contexto de repo).
- Ejemplos concretos, no definiciones abstractas.

Ejemplo para Observabilidad en un B2B:
- ✅ Logging estructurado (JSON) en todos los servicios
- ✅ Correlation ID propagado entre servicios
- ✅ Health check endpoint en cada servicio
- ✅ Dashboard de métricas de negocio (pedidos/hora, errores de pago)
- ⬚ Alerting configurado para SLOs definidos
- ⬚ Distributed tracing entre servicios

**Presentar NFRs por categoría y esperar aprobación antes de pasar a la siguiente.**

### Fase 4: Priorizar timing

Clasificar cada NFR definido en:

| Timing | Criterio | Ejemplo |
|--------|----------|---------|
| **Definir ahora** | Si no se define temprano, hay retrabajo significativo o riesgo operacional | Logging estructurado (cambiar formato después requiere migrar todo), AuthN/AuthZ (agregarlo después es reescritura) |
| **Puede esperar** | Se puede agregar después sin impacto arquitectónico | Dashboard avanzado, alerting fino, accessibility improvements |

Presentar la matriz completa con justificación de cada clasificación.

**Presentar y esperar aprobación.**

### Fase 5: Generar artefacto de diseño

Compilar en artefacto estructurado. Destino según contexto de invocación:

| Invocada desde | Artefacto | Quién ejecuta |
|---|---|---|
| `brainstorming` | Decisiones integradas en `*-design.md` | `writing-plans` → `executing-plans` |
| `docs-brainstorming` / `docs-system-orchestrator` | Plan de documentación | `docs-assistant` |
| `discovery-assistant` (contextual) | Información integrada al discovery | `discovery-assistant` |
| Standalone | Plan de documentación | `docs-assistant` |

---

## Modo Contextual — Intervención Puntual

| Invocador pide | Qué hace |
|---|---|
| "Qué NFRs debería considerar para este proyecto?" | Fases 1-2 rápidas con contexto proporcionado |
| "Qué NFRs no puedo dejar para después?" | Solo fase 4 con NFRs ya conocidos |
| "Revisa si me falta algo en estos NFRs" | Gap analysis contra el perfil del proyecto |
| "Qué nivel de observabilidad necesito?" | Solo una categoría de fase 3 |

En modo contextual: no abrir ciclo completo, usar contexto del invocador, retornar resultado.

---

## Reglas Transversales

- **Concreto sobre abstracto.** "Logging estructurado JSON" es un NFR. "Tener buena observabilidad" no lo es.
- **El timing es tan importante como el NFR.** No basta con listar — hay que decir cuándo.
- **No inflar el checklist.** Solo NFRs que aplican al perfil del proyecto. Un proyecto interno sin datos sensibles no necesita GDPR.
- **Una pregunta a la vez** en modo completo.
- **Aprobación incremental** por fase.

---

## <TERMINATION_PHASE>

Cuando el modo de operación concluya, **DETENTE**.

1. Reportar resultado (resumen de NFRs definidos y priorización temporal).
2. Indicar siguiente paso según contexto de invocación.
3. Esperar confirmación. No proceder automáticamente.
```

**Step 3: Verify the file**

Run: `head -5 registry/skills/nfr-checklist-generator/SKILL.md`

**Step 4: Commit**

```bash
git add registry/skills/nfr-checklist-generator/SKILL.md
git commit -m "feat: add nfr-checklist-generator specialist skill"
```

---

### Task 3: Create `cicd-proposal-builder` skill

**Files:**
- Create: `registry/skills/cicd-proposal-builder/SKILL.md`

**Step 1: Create the skill directory**

Run: `mkdir -p registry/skills/cicd-proposal-builder`

**Step 2: Write SKILL.md**

Create `registry/skills/cicd-proposal-builder/SKILL.md` with the following content:

```markdown
---
name: cicd-proposal-builder
description: "Especialista en diseño de pipelines CI/CD. Usa esta skill cuando necesites definir pipeline, estrategia de branching, ambientes, gates de calidad, estrategia de deploy o controles mínimos. Activa ante frases como: 'necesito un pipeline', 'propuesta de CI/CD', 'qué branching strategy', 'cómo configuro los ambientes', 'qué gates de calidad debería tener', 'estrategia de deploy'."
---

# CI/CD Proposal Builder

Especialista en diseño de pipelines CI/CD. Guía al usuario desde las restricciones del proyecto hasta una propuesta completa de delivery pipeline, cubriendo branching strategy, ambientes, gates de calidad, estrategia de deploy y controles mínimos.

**Principio core:** Un pipeline bien diseñado es invisible — el equipo hace push y las cosas correctas pasan. Un pipeline mal diseñado es un cuello de botella que nadie quiere tocar. El output es una propuesta concreta y accionable.

---

## Paso 0: Detectar Modo de Operación

| Señal | Modo |
|-------|------|
| Invocada directamente por el usuario o por un orquestador con ciclo completo | **Modo Completo** |
| Invocada por otra skill que ya tiene contexto y pide expertise puntual | **Modo Contextual** |

Si no queda claro, pregunta: *"¿Quieres que te guíe en el diseño completo del pipeline, o necesitas resolver algo puntual (branching, ambientes, gates)?"*

---

## Paso 0.1: Recopilar Contexto del Proyecto

**¿El proyecto tiene repositorio?**

- **Sí →**
  1. Lee `AGENTS.md` (stack, cloud provider, estructura)
  2. Lee `README.md` (propósito, setup)
  3. Busca configs de CI/CD existentes:
     - `.github/workflows/*.yml` (GitHub Actions)
     - `Jenkinsfile` (Jenkins)
     - `.gitlab-ci.yml` (GitLab CI)
     - `Dockerfile`, `docker-compose.yml`
     - `Makefile`, `Taskfile.yml`
     - `terraform/`, `pulumi/`, `cdk/`
  4. Identifica scripts de build/test existentes (package.json scripts, Makefile targets, etc.)
  5. Pregunta: *"¿Hay restricciones adicionales? (compliance, cloud provider fijo, equipo de plataforma que aprueba cambios)"*

- **No →** *"Describime: stack tecnológico, cloud provider, cantidad de ambientes que necesitas, requisitos de compliance"*

---

## Modo Completo — Ciclo Interactivo

### Fase 1: Entender contexto

Preguntas guiadas (una a la vez):
- ¿Cuál es el stack tecnológico? (lenguajes, frameworks, runtime)
- ¿Qué cloud provider usan? (AWS, GCP, Azure, on-prem, híbrido)
- ¿Tamaño y experiencia del equipo? (impacta complejidad tolerable del pipeline)
- ¿Hay constraints de compliance o seguridad? (aprobaciones manuales, security scans obligatorios, ambientes aislados)
- ¿Hay CI/CD existente que se quiere mejorar o es desde cero?

**Output:** Restricciones claras y compartidas.

### Fase 2: Branching strategy

Proponer 2-3 estrategias con trade-offs según el contexto:

| Estrategia | Ideal para | Trade-off |
|-----------|-----------|-----------|
| **Trunk-based** | Equipos maduros, CD, feature flags | Requiere disciplina y buena cobertura de tests |
| **GitHub Flow** | Equipos medianos, PRs, releases frecuentes | Balance entre simplicidad y control |
| **GitFlow** | Releases planificados, múltiples versiones en producción | Complejidad alta, branches de larga vida |

Recomendar con justificación basada en el contexto del equipo.

**Presentar opciones y esperar aprobación.**

### Fase 3: Ambientes y promoción

Definir:
- Qué ambientes existen (dev, staging, QA, pre-prod, prod)
- Cómo se promueve código entre ambientes (automático vs manual)
- Manejo de configuración por ambiente (env vars, secrets, feature flags)
- Aislamiento entre ambientes (red, datos, accesos)

Proponer el mínimo viable de ambientes para el contexto, no el máximo posible.

**Presentar propuesta y esperar aprobación.**

### Fase 4: Gates de calidad

Para cada gate, definir si es **blocking** (rompe el pipeline) o **advisory** (reporta pero no bloquea):

| Gate | Qué valida | Cuándo corre | Blocking? |
|------|-----------|-------------|-----------|
| Linting | Estilo y formato de código | En cada push | Según equipo |
| Unit tests | Lógica de negocio | En cada push | Sí |
| Integration tests | Interacción entre componentes | En PR / pre-merge | Sí |
| Security scan | Vulnerabilidades en deps y código | En PR | Según criticidad |
| Code review | Revisión humana | En PR | Sí |
| Smoke tests | Funcionalidad básica post-deploy | Post-deploy a staging | Sí |
| Performance tests | Regresiones de rendimiento | Pre-release (opcional) | Advisory |

Adaptar según el stack y las restricciones.

**Presentar gates y esperar aprobación.**

### Fase 5: Estrategia de deploy

Proponer 2-3 opciones con trade-offs:

| Estrategia | Ideal para | Trade-off |
|-----------|-----------|-----------|
| **Rolling** | Aplicaciones stateless, infraestructura simple | Downtime mínimo pero rollback lento |
| **Blue/Green** | Zero-downtime requerido, rollback instantáneo | Costo doble de infra durante deploy |
| **Canary** | Releases de alto riesgo, validación gradual | Complejidad de routing y monitoring |
| **Feature Flags** | Separar deploy de release, A/B testing | Deuda técnica si no se limpian |

Recomendar según la tolerancia a downtime y la infraestructura disponible.

**Presentar opciones y esperar aprobación.**

### Fase 6: Generar artefacto de diseño

Compilar todas las decisiones en artefacto estructurado:

| Invocada desde | Artefacto | Quién ejecuta |
|---|---|---|
| `brainstorming` | Decisiones integradas en `*-design.md` | `writing-plans` → `executing-plans` |
| `docs-brainstorming` / `docs-system-orchestrator` | Plan de documentación | `docs-assistant` |
| Standalone | Plan de documentación | `docs-assistant` |

---

## Modo Contextual — Intervención Puntual

| Invocador pide | Qué hace |
|---|---|
| "Necesito definir el pipeline para este proyecto" | Fases 1-5 con contexto ya proporcionado |
| "Qué branching strategy conviene?" | Solo fase 2 |
| "Revisa si este pipeline tiene gaps" | Review de configuración existente + señalar mejoras |
| "Qué gates de calidad debería tener?" | Solo fase 4 |

En modo contextual: no abrir ciclo completo, usar contexto del invocador, retornar resultado.

---

## Reglas Transversales

- **Mínimo viable, no máximo posible.** Un pipeline simple que funciona es mejor que uno complejo que nadie entiende.
- **Automatizar lo repetitivo, no lo excepcional.** No construir gates para casos que pasan una vez al año.
- **El pipeline es código.** Todo versionado, todo reproducible, nada manual que pueda olvidarse.
- **Una pregunta a la vez** en modo completo.
- **Aprobación incremental** por fase.

---

## <TERMINATION_PHASE>

Cuando el modo de operación concluya, **DETENTE**.

1. Reportar resultado (resumen de la propuesta CI/CD).
2. Indicar siguiente paso según contexto de invocación.
3. Esperar confirmación. No proceder automáticamente.
```

**Step 3: Verify the file**

Run: `head -5 registry/skills/cicd-proposal-builder/SKILL.md`

**Step 4: Commit**

```bash
git add registry/skills/cicd-proposal-builder/SKILL.md
git commit -m "feat: add cicd-proposal-builder specialist skill"
```

---

### Task 4: Create `architecture-advisor` skill

**Why last among new skills:** Consumes `technology-evaluator` (Task 1) and `c4-architecture` (already exists) in contextual mode, so they must exist first.

**Files:**
- Create: `registry/skills/architecture-advisor/SKILL.md`

**Step 1: Create the skill directory**

Run: `mkdir -p registry/skills/architecture-advisor`

**Step 2: Write SKILL.md**

Create `registry/skills/architecture-advisor/SKILL.md` with the following content:

```markdown
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

Adaptar las opciones al contexto real — no siempre son estas. Pueden ser combinaciones.

Recomendar con justificación basada en las restricciones del proyecto, no en modas.

**Presentar opciones y esperar aprobación.**

### Fase 3: Definir componentes

Una vez seleccionado el enfoque:
- Desglosar en componentes lógicos.
- Para cada componente: nombre, responsabilidad, interfaces que expone, dependencias.
- Identificar boundaries claros entre componentes.
- Señalar qué componentes son core (diferencian el negocio) vs commodity (se pueden resolver con herramientas existentes).

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

Para cada integración con sistemas externos:
- **Dependencia:** qué sistema, qué protocolo, quién lo mantiene
- **Punto de fallo:** qué pasa si esta integración falla
- **Impacto en UX:** cómo percibe el usuario la falla
- **Mitigación propuesta:** circuit breaker, fallback, retry, cache, graceful degradation
- **Owner sugerido:** quién debería ser responsable de esta integración

Presentar como matriz de riesgos de integración.

**Presentar y esperar aprobación.**

### Fase 6: Generar artefacto de diseño

Compilar todas las decisiones en artefacto estructurado. El destino depende del contexto de invocación:

| Invocada desde | Artefacto | Quién ejecuta |
|---|---|---|
| `brainstorming` | Decisiones integradas en `*-design.md` | `writing-plans` → `executing-plans` |
| `docs-brainstorming` / `docs-system-orchestrator` | Plan de documentación | `docs-assistant` (produce documentos con templates, invoca `c4-architecture` para diagramas) |
| `discovery-assistant` (contextual) | Información integrada al discovery | `discovery-assistant` |
| Standalone | Plan de documentación | `docs-assistant` |

**Nota sobre diagramas:** Esta skill NO genera diagramas directamente. Cuando el ejecutor (`docs-assistant`) produce el documento final, invoca `c4-architecture` para generar los diagramas C4 correspondientes basándose en las decisiones de arquitectura documentadas.

---

## Modo Contextual — Intervención Puntual

| Invocador pide | Qué hace |
|---|---|
| "Necesito definir la arquitectura de este módulo" | Fases 2-5 con contexto ya proporcionado |
| "Qué patrón conviene para este caso?" | Solo fase 2 — proponer opciones con trade-offs |
| "Valida si esta arquitectura tiene sentido" | Review de lo existente + señalar riesgos/mejoras |
| "Necesito diagramas de esto" | Delegar a `c4-architecture` con el contexto arquitectónico |
| "Qué riesgos ves en estas integraciones?" | Solo fase 5 — matriz de riesgos |

En modo contextual: no abrir ciclo completo, usar contexto del invocador, retornar resultado.

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

1. Reportar resultado (resumen de decisiones arquitectónicas).
2. Indicar siguiente paso según contexto de invocación.
3. Esperar confirmación. No proceder automáticamente.
```

**Step 3: Verify the file**

Run: `head -5 registry/skills/architecture-advisor/SKILL.md`

**Step 4: Commit**

```bash
git add registry/skills/architecture-advisor/SKILL.md
git commit -m "feat: add architecture-advisor specialist skill"
```

---

### Task 5: Update `docs-system-orchestrator` catalog

**Files:**
- Modify: `registry/skills/docs-system-orchestrator/SKILL.md`

**Step 1: Read current catalog table**

Run: `cat registry/skills/docs-system-orchestrator/SKILL.md`
Locate the table under `## Catálogo de Skills`.

**Step 2: Add 4 new entries to the catalog table**

After the existing entry for `discovery-assistant`, add these rows:

```markdown
| **Diseñar arquitectura de un sistema** | `architecture-advisor` | El usuario necesita definir, revisar o diseñar la arquitectura de un proyecto. Ciclo completo interactivo que cubre patrones, componentes, tecnologías, integraciones y riesgos. |
| **Propuesta de CI/CD** | `cicd-proposal-builder` | El usuario necesita definir pipeline, estrategia de branching, ambientes, gates de calidad o estrategia de deploy. |
| **Definir requisitos no funcionales** | `nfr-checklist-generator` | El usuario necesita identificar y priorizar NFRs para un proyecto (observabilidad, seguridad, compliance, performance, etc.). |
| **Evaluar/comparar tecnologías** | `technology-evaluator` | El usuario necesita decidir entre opciones tecnológicas con criterios estructurados y scoring comparativo. |
```

**Step 3: Verify the table renders correctly**

Read the file and check the table has the new entries after the existing ones.

**Step 4: Commit**

```bash
git add registry/skills/docs-system-orchestrator/SKILL.md
git commit -m "feat: add specialist skills to docs-system-orchestrator catalog"
```

---

### Task 6: Update `brainstorming` with awareness directive

**Files:**
- Modify: `registry/skills/brainstorming/SKILL.md`

**Step 1: Read current file**

Run: `cat registry/skills/brainstorming/SKILL.md`

**Step 2: Add awareness section**

After the `## Key Principles` section at the end of the file, add:

```markdown

## Specialist Skills Awareness

During the approach exploration phase (Propose 2-3 approaches), if you detect the conversation involves decisions of significant complexity in these areas, you may invoke the corresponding specialist skill in **contextual mode** to enrich the discussion:

| Area | Skill | When to invoke |
|------|-------|----------------|
| Architecture design | `architecture-advisor` | Designing system architecture, choosing patterns, defining components, evaluating integrations |
| CI/CD pipeline | `cicd-proposal-builder` | Defining delivery pipeline, branching strategy, environments, deploy strategy |
| Non-functional requirements | `nfr-checklist-generator` | Identifying and prioritizing NFRs early in design |
| Technology selection | `technology-evaluator` | Evaluating and comparing technology options with structured criteria |

**Rules:**
- Only invoke for decisions of **significant complexity** — do not invoke for trivial choices.
- Invoke in **contextual mode** — the specialist answers a specific question and returns control to you.
- The specialist's output is integrated into the design document you are building, not written as a separate artifact.
- You remain in control of the brainstorming flow. The specialist is a consultant, not a replacement.
```

**Step 3: Verify**

Read the file and confirm the new section appears at the end.

**Step 4: Commit**

```bash
git add registry/skills/brainstorming/SKILL.md
git commit -m "feat: add specialist skills awareness to brainstorming"
```

---

### Task 7: Update `docs-brainstorming` with awareness directive

**Files:**
- Modify: `registry/skills/docs-brainstorming/SKILL.md`

**Step 1: Read current file**

Run: `cat registry/skills/docs-brainstorming/SKILL.md`

**Step 2: Add awareness section**

After the `## Principios Clave` section at the end of the file, add:

```markdown

## Awareness de Skills Especialistas

Al planificar documentación técnica, si detectas que el contenido requiere expertise especializado, puedes indicar en el plan de documentación que el ejecutor (`docs-assistant`) necesita invocar skills de apoyo.

| Área | Skill | Cuándo indicar en el plan |
|------|-------|--------------------------|
| Arquitectura de software | `architecture-advisor` | El entregable requiere definir o documentar arquitectura con decisiones de patrones, componentes, integraciones |
| Pipeline CI/CD | `cicd-proposal-builder` | El entregable requiere documentar o definir pipeline de delivery |
| Requisitos no funcionales | `nfr-checklist-generator` | El entregable requiere identificar y priorizar NFRs |
| Evaluación tecnológica | `technology-evaluator` | El entregable requiere evaluación comparativa de opciones tecnológicas |

**Reglas:**
- Incluye la skill de apoyo en el campo "Requiere skill de apoyo" del entregable en el plan.
- Si la necesidad de documentación **es principalmente** uno de estos temas (ej. "necesito documentar la arquitectura del sistema"), considera si la skill especialista debería ser invocada en modo completo antes de generar el plan — en ese caso, recomienda al usuario invocar la skill directamente o vía `docs-system-orchestrator`.
- Tú planificas, el ejecutor ejecuta. No invoques skills especialistas directamente — indícalas en el plan.
```

**Step 3: Verify**

Read the file and confirm.

**Step 4: Commit**

```bash
git add registry/skills/docs-brainstorming/SKILL.md
git commit -m "feat: add specialist skills awareness to docs-brainstorming"
```

---

### Task 8: Update `docs-assistant` support skills registry

**Files:**
- Modify: `registry/skills/docs-assistant/SKILL.md`

**Step 1: Read current file**

Locate the table under `### Registro de Skills de Apoyo`.

**Step 2: Add new entries to the registry table**

After the existing entries for `c4-architecture` and `template-wizard`, add:

```markdown
| Diseño y validación de arquitectura | `architecture-advisor` | El entregable requiere definir decisiones arquitectónicas, validar un diseño existente, o enriquecer contenido técnico de arquitectura. **Invocar solo en modo contextual** — para validar/enriquecer, no para ciclo completo. |
```

**Step 3: Verify**

Read the table section and confirm the new entry.

**Step 4: Commit**

```bash
git add registry/skills/docs-assistant/SKILL.md
git commit -m "feat: add architecture-advisor to docs-assistant support registry"
```

---

### Task 9: Update `discovery-assistant` with Mode C awareness

**Files:**
- Modify: `registry/skills/discovery-assistant/SKILL.md`

**Step 1: Read current file**

Locate the `## Modo C: Acompañar en Vivo` section, specifically the `### C2. Flujo de acompañamiento` subsection.

**Step 2: Add specialist awareness after the existing C2 bullets**

After the line `**El usuario dice "anota esto"** → Lo capturas directamente sin reformatear.`, add:

```markdown

**Surgen temas técnicos que requieren expertise especializado** → Si durante la sesión se discuten decisiones de arquitectura, requisitos no funcionales o evaluación de tecnologías, puedes invocar la skill especialista correspondiente en **modo contextual**:

| Tema detectado | Skill | Ejemplo de intervención |
|----------------|-------|------------------------|
| Arquitectura del sistema | `architecture-advisor` | "¿Qué patrón conviene para este caso?" → la skill propone opciones con trade-offs |
| Requisitos no funcionales | `nfr-checklist-generator` | "¿Qué NFRs deberíamos definir temprano?" → la skill identifica los prioritarios |
| Selección tecnológica | `technology-evaluator` | "¿Qué framework conviene más?" → la skill evalúa con criterios |

**Reglas de invocación contextual durante sesión:**
- No interrumpas el flujo del discovery. La skill aporta y tú retomas.
- Captura el resultado de la skill en el campo correspondiente del documento de discovery.
- No invoques en modo completo — solo intervenciones puntuales que enriquezcan la sesión.
```

**Step 3: Verify**

Read the Mode C section and confirm the new block appears.

**Step 4: Commit**

```bash
git add registry/skills/discovery-assistant/SKILL.md
git commit -m "feat: add specialist skills awareness to discovery-assistant Mode C"
```

---

### Task 10: Register new skills in `processes.json`

**Files:**
- Modify: `registry/processes.json`

**Step 1: Read current file**

Run: `cat registry/processes.json`

**Step 2: Add new skills to both processes**

The 4 new skills are transversal — they belong in both `core-dev` and `docs` processes.

Update `core-dev` skills array to include: `"architecture-advisor"`, `"cicd-proposal-builder"`, `"nfr-checklist-generator"`, `"technology-evaluator"`

Update `docs` skills array to include the same 4 skills.

The resulting file should be:

```json
[
  {
    "name": "core-dev",
    "description": "Las habilidades fundamentales para el desarrollo guiado por agentes.",
    "skills": ["brainstorming", "writing-plans", "executing-plans", "subagent-driven-development", "test-driven-development", "requesting-code-review", "development-process", "finishing-a-development-branch", "receiving-code-review", "verification-before-completion", "systematic-debugging", "project-context-init", "architecture-advisor", "cicd-proposal-builder", "nfr-checklist-generator", "technology-evaluator"],
    "workflows": ["development-process"],
    "agents": ["development-process"]
  },
  {
    "name": "docs",
    "description": "Herramientas de documentación con estándar Docs-as-Code",
    "skills": ["docs-system-orchestrator", "docs-brainstorming", "docs-assistant", "template-manager", "template-wizard", "documenting-modules", "business-documenting-modules", "c4-architecture", "init-docs-repo", "project-context-init", "discovery-assistant", "architecture-advisor", "cicd-proposal-builder", "nfr-checklist-generator", "technology-evaluator"],
    "workflows": ["docs-system-orchestrator"],
    "agents": ["docs-system-orchestrator"]
  }
]
```

**Step 3: Verify JSON is valid**

Run: `cat registry/processes.json | python3 -m json.tool`
Expected: Valid JSON output without errors.

**Step 4: Commit**

```bash
git add registry/processes.json
git commit -m "feat: register specialist skills in core-dev and docs processes"
```

---

### Task 11: Final verification

**Step 1: Verify all 4 new skill directories exist**

Run: `ls -la registry/skills/ | grep -E "(architecture-advisor|cicd-proposal-builder|nfr-checklist-generator|technology-evaluator)"`
Expected: 4 directories listed.

**Step 2: Verify all SKILL.md files have valid frontmatter**

Run: `for skill in architecture-advisor cicd-proposal-builder nfr-checklist-generator technology-evaluator; do echo "=== $skill ===" && head -4 "registry/skills/$skill/SKILL.md"; done`
Expected: Each shows `---`, `name:`, `description:`, `---`.

**Step 3: Verify processes.json includes all new skills**

Run: `python3 -c "import json; data=json.load(open('registry/processes.json')); skills=set(); [skills.update(p['skills']) for p in data]; needed={'architecture-advisor','cicd-proposal-builder','nfr-checklist-generator','technology-evaluator'}; print('OK' if needed.issubset(skills) else f'MISSING: {needed-skills}')"`
Expected: `OK`

**Step 4: Verify modified skills have new content**

Run: `grep -l "architecture-advisor" registry/skills/*/SKILL.md`
Expected: Should list at least: `docs-system-orchestrator`, `brainstorming`, `docs-assistant`, `discovery-assistant`, and `architecture-advisor` itself.

**Step 5: Review git log**

Run: `git log --oneline -12`
Expected: 10 new commits (Tasks 1-10) plus the design doc commit.
