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
| 3 Diseño | ✅ | ✅ | Ambas rutearon a brainstorming y produjeron design. (Nota: el snapshot "fino/sin commitear" de OpenCode era un intento PRE-reparación de symlinks; con skills cargadas rehízo bien.) |
| 4 Plan | ✅ | ✅ | Ambas produjeron plan. |
| 5 Ejecución | ✅ | ✅ | **CORRECCIÓN:** OpenCode SÍ invocó skills (`Skill "subagent-driven-development"`, leyó prompts de `~/.agents/skills`), dispatchó implementer + spec review + code-quality review **con fix loop**, commits por tarea. Alta fidelidad — IGUAL que Claude. Linchpin: requirió symlinks reparados (Hallazgo #4). |
| 6 Gate de sensores | ⚠️ | ⚠️ | Mismo falso verde en ambas: `awm sensors run`→solo semgrep "pass". El bug NO lo caza el gate. |
| 6 Gate de sensores | ⚠️ | ⬜ | Hallazgo #2+#3 confirmados: `run`→solo semgrep "pass"; `--fast`→0 sensores "skipped". El verde = disciplina del agente, no el gate. |
| 7 Cerrar + retomar | ✅ | ⬜ | Claude: sesión nueva recuperó estado y recomendó finishing. OpenCode: pendiente. |
| 8 QA | ✅ | ✅‼️ | **DIVERGENCIA CLAVE.** Claude QA: 0 hallazgos → embarcó el bug. OpenCode QA: C1 BLOCKER + C2 → cazó Y arregló (`a01d51c`, guarda `personas<=0` + 2 tests, 6/6). Misma skill, resultado OPUESTO → juicio NO-determinístico. |
| 9 Cierre | 🟡 | 🟡 | Ambas en punto de finishing; proyectos desechables, cerrar como se quiera. Datos del lab ya capturados. |

---

## Dónde estamos ahora

**LAB COMPLETO** — Claude y OpenCode corridos de punta a punta. Quedan solo los cierres de rama (Fase 9), desechables.

## ⭐ VEREDICTO FINAL DE AGNOSTICISMO (empírico, dos herramientas)

**Lo que SÍ es agnóstico (idéntico en Claude y OpenCode):**
1. **Inyección de contexto** — `using-awm` llega a ambas, mismo contenido, distinto mecanismo (hook vivo vs archivo referenciado). Probado Fase 2.
2. **Orquestación del flujo** — ambas rutean development-process → brainstorming → plan → ejecución → QA.
3. **Ejecución de skills CON skills instaladas** — OpenCode replicó subagent dispatch + dos etapas de review + fix loops + QA. Igual que Claude.

**Lo que NO es agnóstico / los gaps (los 5 hallazgos):**
- **#1** `project.profile` crashea en ambas (bug agnóstico).
- **#2** detección de pack → `generic` → gate hueco (falso verde) en ambas. **Prerrequisito de todo.**
- **#3** la calidad/verde viene del **juicio del agente, no de un gate determinístico** — y el juicio es **NO-determinístico**: Claude embarcó el bug `Infinity`, OpenCode lo cazó+arregló. **El hallazgo central.**
- **#4** install/repair de skills es **Claude-only** (2 refs hardcodeadas) → skills de OpenCode rotas hasta reparación manual. Linchpin de la fidelidad de ejecución.
- **#5** **hardcode blando** a `~/.claude` (prosa de skills + prior del modelo) + instalación de skills a OpenCode por 3 mecanismos descoordinados.

**Patrón:** *todo lo que es entrega de contexto es agnóstico; todo lo que toca skills/máquina/resolución asume Claude.* La garantía de calidad es no-determinística → debe moverse a gates determinísticos (ver ⭐ INSIGHT CENTRAL en findings.md).

## Agrupación para el ciclo de diseño
- **Body B-1 — Instalación/reparación agnóstica:** Hallazgos #1, #4, #5, #6 (init/repair/skill-install agnósticos; des-Claude-izar la prosa; unificar mecanismo de install a OpenCode; entregar `CONSTITUTION.md` del proyecto de forma agnóstica vía `config-instructions`).
- **Body B-2 — Gate de calidad determinístico:** Hallazgos #2, #3 + ⭐ insight central (detección de pack real + invariantes de seguridad como gate, no como juicio).
- **Body B-3 — El loop de aprendizaje (el trinquete):** surgido en el diseño de B-2 (2026-06-06). harness-retro está muerto por diseño: no tiene trigger real (es cross-cutting, nadie lo invoca) ni memoria (exige "≥2 ocurrencias" pero nada las registra). Fix: (A) un **ledger persistente cross-sesión** que las skills de review + post-QA anexan con cada hallazgo; (B) harness-retro como **fase terminal del flujo** (post-QA → harness-retro → finishing, ruteado por development-process); (C) interpretar/clusterizar el ledger → presentar candidatos → autorización del usuario → escribir regla (árbol de remediación ya existe) → marcar entradas como estructuralizadas. Sin esto, la capa 5 del portafolio de B-2 es aspiracional. Su propio ciclo design→plan→ejecución.

---

## Instrucciones de retomado (si se cierra la sesión)

1. Leer este runbook + `findings.md`.
2. Mirar la matriz de estado: buscar el último 🟡/⬜.
3. Continuar la guía del instructor desde "Dónde estamos ahora".

---

## Decisión de proceso

Los bugs encontrados se **anotan en `findings.md` y se difieren** — se arreglan DESPUÉS de mapear el cuadro completo (ambas herramientas), salvo que un bug bloquee el avance. Razón: cambiar a modo-fix a mitad del lab fragmenta el contexto; primero el mapa completo (qué falla solo en Claude, qué solo en OpenCode, qué es común), después fix en lote con `systematic-debugging`.
