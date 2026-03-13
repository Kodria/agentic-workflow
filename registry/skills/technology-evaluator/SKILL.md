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

**En Modo Contextual:** Omitir este paso — usar el contexto ya establecido por el skill invocador.

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
| `brainstorming` | Resultado de evaluación retornado a `brainstorming` para integrar en el diseño | `brainstorming` continúa su flujo (escribe design doc, luego llama a `writing-plans`) |
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
