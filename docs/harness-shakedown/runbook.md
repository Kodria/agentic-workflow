# Harness Shakedown — Runbook (Claude vs OpenCode)

**Iniciado:** 2026-06-05
**Propósito:** Verificar empíricamente que el arnés AWM funciona end-to-end e **idénticamente** en Claude Code y en OpenCode, construyendo una app trivial a través del ciclo completo de desarrollo en cada herramienta — en directorios separados — y comparando el comportamiento. Meta: prueba real (no documentos) de qué funciona, qué funciona a medias y qué está roto, por herramienta.

**Modelo de trabajo:** lab guiado paso a paso. La sesión "instructor" es una sesión de Claude Code dentro del repo `agentic-workflow`. El flujo de desarrollo real ocurre en directorios de lab separados y en sesiones de agente separadas (una Claude, una OpenCode); el usuario pega el output de vuelta al instructor.

---

## La app bajo prueba

`splitBill(total: number, personas: number, propinaPct: number): number`
- Devuelve el monto por persona, redondeado a 2 decimales, propina incluida.
- **Edge case (el objetivo de QA):** `personas === 0` → debe lanzar error, no dividir por cero.
- Chica (se termina en ~15 min); ejercita los sensores tsc + eslint + jest y le da a QA un bug real que atrapar.

---

## Directorios de lab (separados, fuera del repo agentic-workflow)

| Herramienta | Directorio |
|---|---|
| Claude Code | `~/awm-lab/tip-splitter-claude` |
| OpenCode | `~/awm-lab/tip-splitter-opencode` |

---

## El flujo (idéntico para ambas herramientas)

Correr la misma secuencia en cada herramienta y registrar el estado en la matriz de abajo.

| # | Fase | Comando / Acción | Qué prueba | Señal de éxito |
|---|---|---|---|---|
| 0 | Preflight | `awm --version`, verificar opencode/claude instalados | toolchain presente | ambas CLIs encontradas |
| 1 | Instalar arnés | `mkdir`, `git init`, `awm init --agent <X>` | el arnés se monta en proyecto+máquina | hook/skills/sensores ✔ |
| 2 | Verificar inyección de contexto | Abrir sesión del agente; preguntar "¿qué skills AWM y reglas tenés?" | el contexto llegó al modelo (sin pegárselo) | el agente cita using-awm / CONSTITUTION sin que se lo demos |
| 3 | Diseño | En sesión: "construí splitBill…" → development-process rutea a brainstorming | orquestador + brainstorming funcionan | aparece `docs/plans/*-design.md` |
| 4 | Plan | writing-plans | la planificación funciona | aparece `docs/plans/*-plan.md` |
| 5 | Ejecución | subagent-driven-development / executing-plans + TDD | implementación + sensores por tarea | código + tests commiteados |
| 6 | Gate de sensores | `awm sensors run` | el gate computacional dispara | tsc/lint/test corren; overall pass/fail honesto |
| 7 | Cerrar + retomar | Matar la sesión; reabrir; "continuá" | el contexto se re-inyecta + recuperación de estado | la nueva sesión retoma desde el estado en docs/plans |
| 8 | QA | post-implementation-qa → atrapar edge `personas===0` → fix | el gate correctivo de QA funciona | marker `awm-qa-complete` en el plan |
| 9 | Cierre | finishing-a-development-branch | el cierre de rama funciona | merge / PR |

---

## Matriz de estado

Leyenda: ⬜ no iniciado · 🟡 en progreso · ✅ funciona · ⚠️ parcial · ❌ roto (ver findings.md)

| Fase | Claude | OpenCode | Notas |
|---|---|---|---|
| 0 Preflight | ✅ | ✅ | ambas instaladas; opencode 1.16.2, claude 2.1.166 |
| 1 Instalar arnés | ⚠️ | ⬜ | Claude: hook/skills/sensores ✔ pero `project.profile` crasheó → Hallazgo #1 |
| 2 Verificar inyección de contexto | 🟡 | ⬜ | siguiente paso para Claude |
| 3 Diseño | ⬜ | ⬜ | |
| 4 Plan | ⬜ | ⬜ | |
| 5 Ejecución | ⬜ | ⬜ | |
| 6 Gate de sensores | ⬜ | ⬜ | |
| 7 Cerrar + retomar | ⬜ | ⬜ | |
| 8 QA | ⬜ | ⬜ | |
| 9 Cierre | ⬜ | ⬜ | |

---

## Dónde estamos ahora

Corrida **Claude**, Fase 1 hecha (con Hallazgo #1). **Siguiente:** Fase 2 — abrir sesión de Claude en `~/awm-lab/tip-splitter-claude` y verificar la inyección de contexto (preguntarle al agente qué skills/reglas AWM tiene, sin pegárselas). La corrida de OpenCode no ha empezado.

---

## Instrucciones de retomado (si se cierra la sesión)

1. Leer este runbook + `findings.md`.
2. Mirar la matriz de estado: buscar el último 🟡/⬜.
3. Continuar la guía del instructor desde "Dónde estamos ahora".

---

## Decisión de proceso

Los bugs encontrados se **anotan en `findings.md` y se difieren** — se arreglan DESPUÉS de mapear el cuadro completo (ambas herramientas), salvo que un bug bloquee el avance. Razón: cambiar a modo-fix a mitad del lab fragmenta el contexto; primero el mapa completo (qué falla solo en Claude, qué solo en OpenCode, qué es común), después fix en lote con `systematic-debugging`.
