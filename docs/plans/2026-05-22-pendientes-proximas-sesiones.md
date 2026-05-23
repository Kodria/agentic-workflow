# Pendientes — Próximas sesiones AWM

**Fecha:** 2026-05-22
**Contexto:** Sesión de hoy completó sync superpowers v5.1.0 + bootstrap hook port (`awm hooks`). Este doc captura qué sigue.

---

## ✅ Completado hoy

- Sync superpowers v5.1.0 (skills nuevas: `dispatching-parallel-agents`, `using-git-worktrees`, `writing-skills`; skills actualizadas: `brainstorming`, `writing-plans`, `subagent-driven-development`)
- Campo `model:` removido de las 11 skills (alineado al canon)
- Bootstrap hook port: `awm hooks install/uninstall/status` (Claude Code only)
- Skill `using-awm` con regla 1%, SUBAGENT-STOP, orquestador `development-process`
- Hook HEALTHY en producción — inyecta 3088 chars en cada startup/clear/compact
- PR #1 mergeado a main + install.sh actualizado

---

## 🔜 Pendientes en orden de prioridad

### Quick wins (próxima sesión, <30 min)

**1. E2E manual del hook**
Protocolo en `cli/tests/integration/README.md`. Abrir sesión nueva de Claude Code, decir "haz X feature", verificar que el agente invoque `development-process` o `brainstorming` antes de codear. Guardar el output como `cli/tests/integration/golden-output-2026-05-23.txt`.

**2. Reinstalar skills actualizadas**
Las versiones nuevas de `brainstorming`, `writing-plans` y `subagent-driven-development` están en el registry pero pueden estar como `copy` viejo en `~/.claude/skills/`. Correr `awm add` y reinstalar las 3 para activar Spec Self-Review, Visual Companion, Model Selection, etc.

---

### Deuda técnica AWM (sesión corta)

**3. `awm update` no re-sincroniza `~/.awm/hooks/`**
Si el registry cambia, hay que correr `awm hooks install` manualmente. Fix: una línea en el comando `update` que llame `syncHooks()` si el hook está instalado. Archivo: `cli/src/index.ts` en el handler de `update`.

---

### Harness Engineering — el gap principal (sesiones de diseño + implementación)

Marco de referencia: `tmp/investigation-harness.md`. Hoy estamos al ~65%. El salto a 80%+ viene de P1.

**P1 — Sensores computacionales en el loop (mayor impacto)**

Cablear gates deterministas que el agente corra ANTES de declarar "listo":
- `tsc --noEmit` (TypeScript strict)
- ESLint con mensajes LLM-friendly (incluir instrucción de autocorrección en el mensaje del linter — convierte cada error en corrección automática)
- Semgrep (security patterns)
- Dependency-cruiser (fronteras de arquitectura)

Implementación en AWM:
- Nuevo tipo de artefacto `sensor-pack` (junto a skills/workflows/agents)
- Comando: `awm sensors install --pack js-ts`
- Comando: `awm sensors status` (reporta qué gates están cableados en un repo target)

Design previo requerido (invocar `brainstorming` al inicio de esa sesión).

**P2 — Mutation testing (complemento del TDD)**

Stryker para JS/TS — mide si los tests realmente detectan fallos, no solo si están en verde. Sin esto, el TDD de `subagent-driven-development` puede producir tests en verde que no garantizan comportamiento correcto.

Opciones de implementación:
- Skill nueva `mutation-testing-setup` (Stryker config + thresholds)
- O integración en `test-driven-development` como paso opcional para paths críticos

**P3 — Project Constitution (feedforward SDD)**

Concepto de Spec Kit: `CONSTITUTION.md` versionado con principios no negociables que gobiernan toda la salida del agente (convenciones de testing, fronteras de arquitectura, observabilidad, CLI-first, etc.).

Implementación:
- Skill nueva `project-constitution` — genera `CONSTITUTION.md` desde el contexto del proyecto
- O extensión de `project-context-init` con una sección "constitution"

**P4 — Steering loop como práctica de equipo**

Ritual: cada bug que escapa dos veces → se convierte en regla de linter, test estructural, o skill nueva. El harness deja de ser setup único y pasa a ser práctica de ingeniería continua.

Forma concreta: skill `harness-retro` que captura el fallo y genera el artefacto de remediación (regla de linter / test / skill).

**P5 — Quality left (fast vs slow gates)**

Tu `cicd-proposal-builder` cubre algo de esto. Falta un template "quality-gate matrix":
- Fast (pre-commit): linter, tsc, suite rápida, code review básico
- Slow (post-integración): mutation testing, revisión amplia, fitness functions de arquitectura

---

### Deferred (cuando expandes harnesses)

**Hook port para Antigravity 2.0**
`ProviderConfig` ya tiene `hooks?: HookConfig` extensible. Antigravity 2.0 tiene SessionStart hooks en formato JSON similar a CC. Investigar paths exactos de Antigravity 2.0 (`antigravity.google/docs/home`) antes de implementar.

**Hook port para OpenCode**
Requiere plugin JS/TS (no JSON estático). Más complejo — distribuir un archivo `.ts` desde el registry.

**Branding brainstorm server**
`registry/skills/brainstorming/scripts/frame-template.html:199` dice "Superpowers Brainstorming". Edit de 1 línea si usas el Visual Companion.

---

## Secuencia sugerida

```
Sesión 1 (mañana):
  → E2E manual del hook (10 min)
  → Reinstalar skills actualizadas con awm add
  → Fix awm update + re-sync hooks (30 min, sesión corta)

Sesión 2:
  → brainstorming del sensor-pack (P1)
  → Design + plan de implementación

Sesión 3:
  → Implementar sensor-pack JS/TS (subagent-driven-development)

Sesión 4:
  → Mutation testing setup (P2) + Project constitution (P3)
```

---

## Referencia de investigación

- `tmp/investigation-harness.md` — análisis completo de Harness Engineering, SDD, y por qué superpowers no es suficiente solo
- `docs/plans/2026-05-22-bootstrap-hook-port-design.md` — design del hook
- `docs/plans/2026-05-22-bootstrap-hook-port.md` — plan de implementación
- PR #1: https://github.com/Kodria/agentic-workflow/pull/1
