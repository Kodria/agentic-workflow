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
| Claude Code | `/Users/cencosud/Developments/personal/test-awm/project-claude` |
| OpenCode | `/Users/cencosud/Developments/personal/test-awm/project-opencode` (a crear) |

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
| 1 Instalar arnés | ⚠️ | ⚠️ | Ambas: hook/skills/sensores ✔. OpenCode: `machine.contextInjection` **APLICÓ** (vs "skipped" en Claude) → `~/.awm/context/awm-context.md` creado + entrada en `opencode.json` verificada. Hallazgos #1 (profile crash) y #2 (pack generic) **reproducen idéntico → agnósticos**. |
| 2 Verificar inyección de contexto | ✅ | ✅ | **PIEZA CENTRAL PROBADA.** OpenCode respondió idéntico a Claude (entry point, regla por niveles, 3 skills) de memoria, sin leer archivos — vía archivo materializado + `instructions[]`, SIN hook. La capa de inyección es agnóstica. |
| 3 Diseño | ✅ | ✅⚠️ | Claude: design commiteado. OpenCode: improvisó brainstorming desde contexto inyectado y produjo design — pero **sin commitear**, más fino, año mal (2025). Bug `personas=0` también fuera de alcance (igual que Claude). |
| 4 Plan | ✅ | ✅⚠️ | Claude: plan commiteado. OpenCode: produjo plan pero **sin commitear** (untracked). Fidelidad menor. |
| 5 Ejecución | ✅ | 🟡 | Claude: subagent-driven (implementer + 2 revisores/tarea, TDD, rechazó 4 FP), 4 tests verdes. OpenCode: scaffold commiteado, en ejecución; sin las dos etapas de review. Observar gate de sensores + commits. |
| 6 Gate de sensores | ⚠️ | ⬜ | Hallazgo #2+#3 confirmados: `run`→solo semgrep "pass"; `--fast`→0 sensores "skipped". El verde = disciplina del agente, no el gate. |
| 7 Cerrar + retomar | ✅ | ⬜ | Sesión nueva recuperó estado sin pistas: "Estado: Finishing", listó design/plan/marker/commit, recomendó finishing-a-development-branch. Re-inyección + recuperación de estado confirmadas. |
| 8 QA | ✅ | ⬜ | corrió automático (TERMINATION_PHASE de SDD), 0 hallazgos. Bug `personas=0` sobrevivió → ver ⭐ INSIGHT CENTRAL en findings.md (alcance vs seguridad). |
| 9 Cierre | 🟡 | ⬜ | Claude lo está ofreciendo; proceder en la sesión |

---

## Dónde estamos ahora

**Claude:** Fases 1-8 ✅ (Fase 9 cierre pendiente en su sesión). 3 hallazgos + ⭐ insight central.
**OpenCode:** Fases 0-2 ✅. **Inyección de contexto agnóstica PROBADA** (Fase 2 idéntica a Claude, sin hook). Hallazgos #1 y #2 confirmados agnósticos.

**Siguiente:** Fase 3 en OpenCode — darle el MISMO pedido de build (`splitBill`) y observar la prueba decisiva del Hallazgo #3: el contexto (instructions) ya probamos que es agnóstico, pero ¿la *maquinaria de ejecución* (Skill tool, dispatch de subagentes, gate de sensores, dos etapas de review) es agnóstica o es Claude-shaped? Hipótesis: OpenCode quizás lea las skills como texto-guía pero no tenga el tooling (Skill/Agent) que las skills AWM asumen → ahí estarían los gaps reales de agnosticismo. Mismo bug plantado (`personas=0` fuera de alcance). Dir: `test-awm/project-opencode`.

---

## Instrucciones de retomado (si se cierra la sesión)

1. Leer este runbook + `findings.md`.
2. Mirar la matriz de estado: buscar el último 🟡/⬜.
3. Continuar la guía del instructor desde "Dónde estamos ahora".

---

## Decisión de proceso

Los bugs encontrados se **anotan en `findings.md` y se difieren** — se arreglan DESPUÉS de mapear el cuadro completo (ambas herramientas), salvo que un bug bloquee el avance. Razón: cambiar a modo-fix a mitad del lab fragmenta el contexto; primero el mapa completo (qué falla solo en Claude, qué solo en OpenCode, qué es común), después fix en lote con `systematic-debugging`.
