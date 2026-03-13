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

**En Modo Contextual:** Omitir este paso — usar el contexto ya establecido por el skill invocador.

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
| `brainstorming` | Resultado retornado a `brainstorming` para integrar en el diseño | `brainstorming` continúa su flujo (escribe design doc, luego llama a `writing-plans`) |
| `docs-brainstorming` / `docs-system-orchestrator` | Plan de documentación | `docs-assistant` |
| Standalone | Documento de NFRs priorizados con matriz de timing | `docs-assistant` |

---

## Modo Contextual — Intervención Puntual

| Invocador pide | Qué hace |
|---|---|
| "Qué NFRs debería considerar para este proyecto?" | Fases 1-2 rápidas con contexto proporcionado |
| "Qué NFRs no puedo dejar para después?" | Solo fase 4 con NFRs ya conocidos |
| "Revisa si me falta algo en estos NFRs" | Gap analysis contra el perfil del proyecto |
| "Qué nivel de observabilidad necesito?" | Solo una categoría de fase 3 |

En modo contextual: no abrir ciclo completo, usar contexto del invocador, retornar resultado. Fase 5 no aplica — el invocador maneja la generación del artefacto.

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
