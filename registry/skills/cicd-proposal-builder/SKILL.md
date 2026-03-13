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

**En Modo Contextual:** Omitir este paso — usar el contexto ya establecido por el skill invocador.

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
| `brainstorming` | Resultado retornado a `brainstorming` para integrar en el diseño | `brainstorming` continúa su flujo (escribe design doc, luego llama a `writing-plans`) |
| `docs-brainstorming` / `docs-system-orchestrator` | Documento de propuesta CI/CD | `docs-assistant` |
| Standalone | Documento de propuesta CI/CD | `docs-assistant` |

---

## Modo Contextual — Intervención Puntual

| Invocador pide | Qué hace |
|---|---|
| "Necesito definir el pipeline para este proyecto" | Fases 1-5 con contexto ya proporcionado |
| "Qué branching strategy conviene?" | Solo fase 2 |
| "Revisa si este pipeline tiene gaps" | Review de configuración existente + señalar mejoras |
| "Qué gates de calidad debería tener?" | Solo fase 4 |

En modo contextual: no abrir ciclo completo, usar contexto del invocador, retornar resultado. Fase 6 no aplica — el invocador maneja la generación del artefacto.

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

Tu único paso final es:
1. Reportar resultado (resumen de la propuesta CI/CD).
2. Indicar siguiente paso según contexto de invocación.
3. Esperar confirmación. No proceder automáticamente.
