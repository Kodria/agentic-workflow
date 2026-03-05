---
template_purpose: "Framework de Discovery para nuevos proyectos. Permite documentar progresivamente el entendimiento de un proyecto a través de sesiones de exploración."
interview_questions:
  - "nombre_proyecto: ¿Cuál es el nombre del proyecto o iniciativa?"
  - "sponsor: ¿Quién es el sponsor o dueño de negocio?"
  - "delivery_lead: ¿Quién es el PO o Delivery Lead?"
  - "technical_lead: ¿Quién es el Technical Lead?"
  - "contexto_inicial: ¿Cuál es el contexto general del proyecto? ¿Por qué surge ahora?"
  - "problema: ¿Cuál es el problema u oportunidad que se busca resolver?"
  - "actores: ¿Quiénes son los usuarios o actores principales?"
  - "restricciones_conocidas: ¿Hay restricciones de tiempo, presupuesto, tecnología o equipo que ya se conozcan?"
---

# Discovery — [Nombre del Proyecto]

## Snapshot

> Actualizar al inicio de cada sesión.

| Campo | Valor |
|-------|-------|
| **Proyecto / Iniciativa** | … |
| **Sponsor / Dueño de Negocio** | … |
| **PO / Delivery Lead** | … |
| **Technical Lead** | … |
| **Estado del Discovery** | Etapa … (0–6) |
| **Objetivo de la próxima sesión** | … |
| **Riesgo #1 hoy** | … |
| **Fecha de inicio** | YYYY-MM-DD |
| **Última actualización** | YYYY-MM-DD |

---

## Log de Sesiones

> Registrar cada sesión de Discovery. No hay un número predefinido — pueden ser 1 o 10 sesiones según el proyecto.

### Sesión N — YYYY-MM-DD

| Campo | Valor |
|-------|-------|
| **Fecha** | YYYY-MM-DD |
| **Asistentes** | … |
| **Objetivo de la sesión** | … |
| **Etapas cubiertas** | Etapa(s) … |

**Decisiones tomadas:**

- …

**Action items:**

| Acción | Responsable | Fecha límite | Estado |
|--------|-------------|-------------|--------|
| … | … | YYYY-MM-DD | ⬜ Pendiente |

**Notas relevantes:**

- …

---

## Etapa 0 — Preparación

### 0.1 Contexto organizacional

- Organización / área solicitante: …
- Contexto de negocio (¿por qué ahora?): …
- Presupuesto o constraints financieros conocidos: …
- Timeline / deadlines duros: …

### 0.2 Stakeholder Map

| Stakeholder | Rol / Influencia | Interés principal | Nivel de involucramiento |
|-------------|-----------------|-------------------|-------------------------|
| … | … | … | Alto / Medio / Bajo |

Preguntas:

- [ ] ¿Quién puede responder mejor "por qué ahora" y "qué éxito significa"?
- [ ] ¿Quién conoce el proceso actual end-to-end?
- [ ] ¿Quién tiene poder de veto o aprobación final?

### 0.3 Setup de la primera sesión

- Objetivo de la sesión 1 (máx 2): …
- Outputs esperados:
    - [ ] Problema / objetivo preliminar (Etapa 1.1)
    - [ ] Actores preliminares (Etapa 1.2)
    - [ ] Lista de unknowns (Etapa 0.5)
- Agenda (timeboxed): …

Preguntas:

- [ ] ¿Qué decisiones necesitamos habilitar con la sesión 1?
- [ ] ¿Qué tema NO vamos a intentar resolver todavía?

### 0.4 Participantes y owners tentativos

- Sponsor (tentativo): …
- Dueño de negocio (tentativo): …
- PO / Delivery (tentativo): …
- TL: …
- SMEs que probablemente necesitamos (seguridad / datos / operación): …

### 0.5 Unknowns priorizados (Top 10)

> Sale de la sesión 1 y se actualiza sesión a sesión.

| Prioridad | Unknown | Etapa relacionada | Estado |
|-----------|---------|-------------------|--------|
| P0 (bloqueante) | … | … | ⬜ Abierto |
| P0 (bloqueante) | … | … | ⬜ Abierto |
| P1 (importante) | … | … | ⬜ Abierto |
| P2 (deseable) | … | … | ⬜ Abierto |

Preguntas para levantarlos:

- [ ] ¿Qué parte del flujo nadie sabe explicar con claridad hoy?
- [ ] ¿Qué dependencia externa podría bloquear el MVP?
- [ ] ¿Qué restricción (legal / seguridad / datos) podría invalidar el enfoque?

### 0.6 Riesgos iniciales (Top 5)

| Riesgo | Impacto | Probabilidad | Mitigación inicial | Dueño |
|--------|---------|-------------|--------------------|----|
| … | … | … | … | … |

#### ✅ Checklist de salida — Etapa 0

- [ ] Participantes clave identificados y confirmados
- [ ] Unknowns priorizados (al menos Top 5)
- [ ] Agenda de primera sesión definida con objetivos claros
- [ ] Riesgos iniciales registrados
- [ ] Contexto organizacional documentado

---

## Etapa 1 — Alineación y Framing

### 1.1 Problema, objetivo y anti-objetivo

- Problema (1–2 frases): …
- Objetivo del producto: …
- Anti-objetivo (qué NO vamos a optimizar): …

Preguntas:

- [ ] Si este producto existe en 3 meses, ¿qué cambia en el negocio?
- [ ] ¿Qué problema parecido NO quieres resolver aquí?

### 1.2 Usuarios / actores y "Jobs to Be Done"

| Actor | Job to Be Done | Dolor actual | Resultado esperado |
|-------|---------------|-------------|-------------------|
| … | … | … | … |

Preguntas:

- [ ] ¿Quién inicia el proceso y quién lo aprueba?
- [ ] ¿Quién se beneficia y quién carga el costo operativo?

### 1.3 Métricas de éxito (KPI)

- Métrica norte (north star): …
- Leading indicators (señales tempranas): …
- Lagging indicators (resultado final): …
- Métricas de "no degradación" (guardrails): …

Preguntas:

- [ ] ¿Qué métrica te haría decir "esto fue un éxito"?
- [ ] ¿Qué métrica te haría apagar el producto?

### 1.4 Alcance v0 (in/out) y definición de MVP

**In scope v0:**

- …

**Out of scope v0:**

- …

**MVP (capabilities):**

| Capability | Descripción | Prioridad |
|-----------|------------|-----------|
| … | … | Must / Should / Could |

Preguntas:

- [ ] ¿Cuál es el mínimo que entrega valor real?
- [ ] ¿Qué "nice to have" es tentador pero no esencial?

### 1.5 Equipo y capacidades

| Rol | Personas disponibles | Gaps identificados | Necesidad de ramp-up |
|-----|---------------------|-------------------|---------------------|
| … | … | … | … |

### 1.6 Supuestos + plan de validación

| Supuesto | Cómo validar | Dueño | Fecha |
|----------|-------------|-------|-------|
| … | … | … | YYYY-MM-DD |

Preguntas:

- [ ] ¿Qué estás asumiendo como cierto sin evidencia?

#### ✅ Checklist de salida — Etapa 1

- [ ] Problema articulado en 1–2 frases
- [ ] Al menos 2 actores con Jobs to Be Done definidos
- [ ] Al menos 1 métrica de éxito definida
- [ ] Alcance v0 (in/out) acordado
- [ ] Supuestos críticos registrados con plan de validación

---

## Etapa 2 — Dominio y Flujos

### 2.1 Journey principal (happy path)

| Campo | Valor |
|-------|-------|
| **Nombre del flujo** | … |
| **Actor** | … |
| **Disparador (trigger)** | … |
| **Pre-condiciones** | … |

**Pasos:**

1. …
2. …
3. …

| Campo | Valor |
|-------|-------|
| **Resultado / valor entregado** | … |
| **Post-condiciones** | … |

Preguntas:

- [ ] Haz el walkthrough como si yo fuera nuevo: ¿qué pasa primero?
- [ ] ¿Dónde se "atasca" hoy el flujo?

### 2.2 Mapa de datos

| Dato / Entidad | Fuente | Formato | Volumen estimado | Sensibilidad |
|----------------|--------|---------|-----------------|-------------|
| … | … | … | … | Alta / Media / Baja |

### 2.3 Variantes y segmentación

- Variantes por segmento (país / canal / tipo cliente): …
- Reglas que cambian por variante: …

Preguntas:

- [ ] ¿Qué parte del flujo cambia según el contexto?

### 2.4 Excepciones / edge cases

| Excepción | Frecuencia | Manejo actual | Impacto |
|-----------|-----------|---------------|---------|
| … | … | … | … |

Preguntas:

- [ ] ¿Qué pasa cuando falta un dato o llega tarde?
- [ ] ¿Qué pasa si un actor se equivoca o revierte una acción?

### 2.5 Reglas de negocio + glosario

**Reglas:**

| Regla | Fuente | Dueño |
|-------|--------|-------|
| … | … | … |

**Glosario:**

| Término | Definición |
|---------|-----------|
| … | … |

Preguntas:

- [ ] ¿Qué definiciones generan malentendidos típicos?
- [ ] ¿Qué regla es "histórica" pero todos siguen?

#### ✅ Checklist de salida — Etapa 2

- [ ] Happy path del journey principal documentado
- [ ] Excepciones críticas identificadas
- [ ] Glosario base con términos del dominio
- [ ] Mapa de datos principal definido

---

## Etapa 3 — Constraints y No-funcionales

### 3.1 Tech Landscape actual

| Sistema existente | Propósito | Tecnología | Estado | Relación con este proyecto |
|------------------|-----------|-----------|--------|---------------------------|
| … | … | … | Activo / Legacy / Deprecado | … |

- Deuda técnica relevante: …
- Constraints de plataforma: …

### 3.2 Seguridad y compliance

- Clasificación de datos: …
- Requisitos de acceso (authn / authz): …
- Auditoría / traceability: …
- Retención / borrado: …

Preguntas:

- [ ] ¿Qué dato no puede salir de la organización?
- [ ] ¿Quién puede ver / editar qué y por qué?

### 3.3 Performance, volumen y crecimiento

- Usuarios concurrentes: …
- Throughput (req/s, mensajes, archivos/día): …
- Latencia objetivo por operación: …
- Crecimiento esperado (6–12 meses): …

Preguntas:

- [ ] ¿Cuál es el pico (Black Friday / fin de mes / cierre)?

### 3.4 Disponibilidad y resiliencia

- Disponibilidad objetivo: …
- Ventanas de mantenimiento: …
- RTO / RPO (si aplica): …
- Degradación aceptable (modo "read-only", colas, etc.): …

Preguntas:

- [ ] Si falla, ¿qué es lo peor que puede pasar al negocio?

### 3.5 Operación y soporte

- Dueño de operación: …
- On-call: Sí / No | Horario: …
- Monitoreo mínimo: …
- Alertas críticas: …
- Runbooks requeridos: …

Preguntas:

- [ ] ¿Qué incidentes no son aceptables repetir?

### 3.6 Integraciones y dependencias

| Sistema | Tipo | Dueño | Criticidad | Contrato existente | Riesgos |
|---------|------|-------|-----------|-------------------|---------|
| … | API / Eventos / DB / Archivo | … | Alta / Media / Baja | Sí / No | … |

Preguntas:

- [ ] ¿Cuál integración es el "single point of failure"?
- [ ] ¿Qué contrato ya existe y no podemos romper?

### 3.7 Migración de datos (si aplica)

| Fuente | Volumen | Calidad | Estrategia | Ventana de migración |
|--------|---------|---------|-----------|---------------------|
| … | … | Buena / Regular / Mala | Big-bang / Incremental / Dual-write | … |

#### ✅ Checklist de salida — Etapa 3

- [ ] Tech landscape actual documentado
- [ ] Clasificación de datos definida
- [ ] Integraciones críticas mapeadas con dueños
- [ ] Volumetría y performance estimados
- [ ] Migración de datos evaluada (si aplica)

---

## Etapa 4 — Opciones de Solución (alto nivel)

### 4.1 Enfoques (2–3) con trade-offs

**Enfoque A — [Nombre descriptivo]:**

- Descripción: …
- Pros: …
- Contras: …
- Riesgos: …
- Esfuerzo estimado: …

**Enfoque B — [Nombre descriptivo]:**

- Descripción: …
- Pros: …
- Contras: …
- Riesgos: …
- Esfuerzo estimado: …

Preguntas:

- [ ] ¿Qué decisión es irreversible y cómo la evitamos temprano?

### 4.2 Recomendación y decisiones (ADRs)

- Recomendación: …
- Razones: …
- ADRs:
    - Decisión: … (link / ID si usas)

#### ✅ Checklist de salida — Etapa 4

- [ ] Al menos 2 enfoques evaluados con pros/contras
- [ ] Recomendación fundamentada
- [ ] Decisiones arquitectónicas registradas como ADRs

---

## Etapa 5 — Especificación Lista para Construir

### 5.1 MVP como Capabilities + Criterios de Aceptación

| Capability | Descripción | Criterio de aceptación (negocio) | Riesgo |
|-----------|------------|--------------------------------|--------|
| … | … | … | … |

### 5.2 Backlog inicial (Épicas / Capabilities)

| Épica | Objetivo | Alcance | Dependencias | Owner |
|-------|---------|---------|-------------|-------|
| … | … | … | … | … |

### 5.3 Interfaces mínimas (contratos)

| API / Evento | Consumidor | Productor | Inputs / Outputs | Errores esperados |
|-------------|-----------|----------|-----------------|------------------|
| … | … | … | … | … |

### 5.4 Testing mínimo no negociable

| Tipo | Cobertura esperada | Responsable |
|------|-------------------|-------------|
| Unit | … | … |
| Integración | … | … |
| E2E | … | … |
| No funcional (perf / seg) | … | … |

### 5.5 Observabilidad mínima

- KPIs técnicos: …
- Logs / auditoría: …
- Alertas base: …

### 5.6 RACI y Gobernanza

| Actividad | Responsible | Accountable | Consulted | Informed |
|-----------|-----------|------------|----------|---------|
| … | … | … | … | … |

- Frecuencia de reportes: …
- Canal de comunicación: …
- Proceso de escalada: …

#### ✅ Checklist de salida — Etapa 5

- [ ] MVP definido como capabilities con criterios de aceptación
- [ ] Backlog inicial con épicas priorizadas
- [ ] Interfaces / contratos mínimos identificados
- [ ] Testing mínimo acordado
- [ ] RACI definido

---

## Etapa 6 — Gate de Aprobación (pragmático)

### 6.1 Assessment de Readiness

| Dimensión | Estado | Comentario |
|-----------|--------|-----------|
| Problema y alcance claros | 🟢 / 🟡 / 🔴 | … |
| Dominio y flujos entendidos | 🟢 / 🟡 / 🔴 | … |
| Constraints identificados | 🟢 / 🟡 / 🔴 | … |
| Solución recomendada | 🟢 / 🟡 / 🔴 | … |
| Equipo listo | 🟢 / 🟡 / 🔴 | … |
| Riesgos aceptados | 🟢 / 🟡 / 🔴 | … |

### 6.2 Checklist de gate

**Pendientes críticos:**

- [ ] … (owner / fecha / criterio de cierre)

**Riesgos críticos:**

- [ ] … (mitigación o aceptación explícita)

**Aprobación:**

| Aprobado por | Fecha | Alcance aprobado |
|-------------|-------|-----------------|
| … | YYYY-MM-DD | … |

### 6.3 Spikes pendientes (si aplica)

| Spike | Hipótesis | Alcance in/out | Criterio éxito/fracaso | Timebox | Resultado |
|-------|----------|---------------|----------------------|---------|----------|
| … | … | … | … | … | [pendiente] |

#### ✅ Checklist de salida — Etapa 6

- [ ] Assessment de readiness sin rojos (🔴)
- [ ] Pendientes críticos con dueño y fecha
- [ ] Riesgos aceptados explícitamente
- [ ] Aprobación formal registrada

---

## Parking Lot

> Items que surgieron durante el Discovery pero no entran en ninguna etapa aún, o necesitan ser procesados más adelante.

| # | Item | Origen (sesión) | Etapa sugerida | Estado |
|---|------|----------------|---------------|--------|
| 1 | … | Sesión … | Etapa … | ⬜ Pendiente |

---

## Delegación

> Cualquier tarea delegada a un miembro del equipo debe volver con:

- Evidencia / fuente (quién lo dijo / doc / sistema)
- Supuestos y dudas abiertas
- Impacto (producto / tech / operación)
- Recomendación u opciones
