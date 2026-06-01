# Post-Implementation QA — Design

## Contexto

El ciclo de desarrollo de AWM hoy salta directamente de ejecución a cierre de rama sin una fase formal de QA. El usuario tiene el hábito de pedir "un review total de lo implementado vs lo planeado y busca posibles bugs" al final del desarrollo — y siempre se encuentran cosas. Esta fase existe informalmente; el objetivo es formalizarla dentro del harness.

## Problema

- No hay fase explícita de QA entre `subagent-driven-development` y `finishing-a-development-branch`
- Los bugs de implementación (lógica, edge cases) y los gaps de fidelidad al plan (sub/sobre-implementación) se descubren de manera ad-hoc
- No existe un ciclo de corrección definido que conecte "encontré un bug" con "está cerrado y verificado"
- El harness engineering previene futuros bugs (preventivo) pero no cierra los actuales (correctivo)

## Tipos de hallazgos — distinción clave

| Tipo | Descripción | Causa raíz | Remediación |
|------|-------------|------------|-------------|
| **B — Fidelidad** | Lo implementado no coincide con lo planeado (falta algo, sobra algo, mal entendido del spec) | Gap de especificación, no bug de código | Subagente de corrección apuntado al gap específico |
| **C — Calidad** | Bug lógico, edge case no manejado, comportamiento inesperado | Error de implementación | `systematic-debugging` → root cause → subagente fix |

## Dos entry points

### Entry Point 1 — Desde development-process (flujo de desarrollo activo)
- Invocado automáticamente como nueva fase entre ejecución y finishing
- Tiene acceso al plan activo (`docs/plans/`)
- Conoce el contexto del desarrollo en curso

### Entry Point 2 — Standalone (bug encontrado de forma independiente)
- El usuario invoca directamente cuando encuentra un bug sin desarrollo previo
- La skill detecta si hay un plan activo en `docs/plans/` (rama feature activa)
- Si hay plan → usa como referencia para contexto
- Si no hay plan → delega directamente a `systematic-debugging`

## Diseño de la skill `post-implementation-qa`

### Nombre: `post-implementation-qa`

### Proceso

```
1. Leer plan activo (docs/plans/YYYY-MM-DD-*-plan.md de la rama actual)
2. Leer implementación real (git diff desde base de la rama)
3. Correr awm sensors run (evidencia estructural)
4. Comparar plan vs. implementación → detectar hallazgos Tipo B
5. Revisar código buscando bugs lógicos → detectar hallazgos Tipo C
6. Presentar lista priorizada al usuario: tipo, descripción, severidad
7. Loop de corrección por hallazgo:
   - Tipo B → subagente de corrección apuntado al gap
   - Tipo C → systematic-debugging → subagente fix
   - Cada fix → awm sensors run + verification-before-completion
8. Cuando lista está vacía → awm sensors run final limpio
9. Dar control a development-process para finishing-a-development-branch
```

### Integración en development-process

Nueva fase entre ejecución y cierre:

```
subagent-driven-development / executing-plans
  → post-implementation-qa  ← NUEVA
  → finishing-a-development-branch
```

Estado de detección en development-process:
- `*-plan.md` existe, todas las tareas completadas, pero QA no realizado → invocar `post-implementation-qa`

### Sub-skill de revisión profunda

El corazón de la fase 4+5 es un subagente de revisión que recibe:
- El plan completo
- El git diff completo de la rama
- El output de `awm sensors run`
- Instrucción: clasificar hallazgos como Tipo B o C, con severidad (blocker / importante / menor)

### Criterios de "QA completo"

- Lista de hallazgos vacía (todos resueltos o descartados con justificación)
- `awm sensors run` limpio (sin nuevos hallazgos)
- `verification-before-completion` pasado para cada fix
- Si algún hallazgo fue recurrente (≥2 veces en sesión) → `harness-retro` antes de continuar

## Qué NO hace esta skill

- No reemplaza `systematic-debugging` — la invoca para Type C
- No hace merge ni PR — eso es `finishing-a-development-branch`
- No genera nuevas features — solo cierra gaps del plan original
- No reemplaza los sensors automáticos del PostToolUse hook

## Conexiones con skills existentes

| Skill | Rol |
|-------|-----|
| `development-process` | La invoca como nueva fase; recibe control cuando QA está completo |
| `systematic-debugging` | Invocada para hallazgos Tipo C (root cause antes de fixear) |
| `subagent-driven-development` | Ejecuta los fixes individuales |
| `verification-before-completion` | Gate obligatorio después de cada fix |
| `harness-retro` | Invocada si algún hallazgo fue recurrente |
| `finishing-a-development-branch` | Fase siguiente cuando QA está limpio |

## Preguntas abiertas resueltas

- **¿El QA es automático o manual?** Se invoca explícitamente (el orquestador lo propone, el usuario aprueba) — no es 100% automático para mantener control
- **¿Acceso al plan?** Sí, siempre lee el plan de la rama activa
- **¿Entry point standalone?** Sí, con detección automática de si hay plan activo
