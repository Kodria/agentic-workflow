# Roadmap — Era de Distribución (AWM para equipos)

**Fecha:** 2026-06-09
**Estado:** ABIERTO — este documento es el índice maestro de la era; se cierra solo cuando todos los workstreams tengan su plan con `<!-- awm-qa-complete -->`.
**Contexto:** El 2026-06-09 se cerró administrativamente todo el backlog de planes de la era "harness personal" (78 docs en `docs/plans/`, todos marcados `awm-qa-complete` o `awm-plan-closed`). Este roadmap arranca la era siguiente: volver AWM distribuible a equipos de desarrollo, no solo de uso personal. Nace del análisis funcional de distribución (sesión 2026-06-09) + los diferidos vivos de la era anterior.

---

## Reglas de disciplina (no negociables)

1. **Ningún hallazgo se pierde.** Todo hallazgo vive en el registro F-n de abajo con su fuente. Si durante el desarrollo aparece un hallazgo nuevo de nivel roadmap, se agrega aquí como F-n en el mismo PR; si es un hallazgo de código de la rama, va al ledger (`awm ledger add`) como siempre.
2. **Cada workstream sigue el ciclo completo.** `development-process` → brainstorming → design → plan → ejecución → `post-implementation-qa`. Un workstream **solo** se considera cerrado cuando su plan tiene el marcador `<!-- awm-qa-complete -->`.
3. **Este roadmap se actualiza en el mismo PR que cierra cada workstream**: checkbox marcado + link al plan ejecutado. Un PR que cierra un WS sin tocar este doc está incompleto.
4. **Nada se marca hecho sin verificación** (`verification-before-completion`). "Debería funcionar" no cierra nada.
5. **Orden de prioridad es compromiso.** No se arranca un WS de prioridad menor habiendo uno mayor sin terminar, salvo decisión explícita registrada aquí.

---

## Registro de hallazgos

| ID | Hallazgo | Fuente | Workstream |
|----|----------|--------|------------|
| F-1 | **Versionado inexistente en la práctica.** Todo en `1.0.0` estático; `awm update` trae HEAD de main; symlinks propagan cambios instantáneamente a todas las máquinas sin changelog, rollback ni ventana de adopción. `skills-lock.json` existe pero el CLI no lo lee (metadata muerta). | Análisis distribución 2026-06-09 | WS-3 |
| F-2 | **Registry único hardcodeado.** URL `github.com/Kodria/agentic-workflow.git` fija en `cli/src/core/registry.ts` e `install.sh`. Un equipo debe forkear todo el monorepo, rompiendo updates upstream. Sin multi-registry ni namespacing. Gobernanza: el único mecanismo de contribución es PR al repo personal de Nicolas. | Análisis distribución 2026-06-09 | WS-2 |
| F-3 | **Distribución source-based frágil.** Requiere git + node + npm + `npm link` + build local por máquina. CLI no publicado en npm (el badge del README apunta a un paquete que no se usa para instalar). | Análisis distribución 2026-06-09 | WS-4 |
| F-4 | **Contenido personal en el repo distribuible.** Bundle `personal-notion` + 3 skills NotionTracker (`career-goal-brainstorm` nombra a Nicolas directamente). `visibility: private` los oculta del listado pero viajan en disco a cada máquina del equipo. | Análisis distribución 2026-06-09 | WS-1 |
| F-5 | **Acoplamiento a Claude Code / agnosticismo inconcluso.** Hooks solo CC; **Antigravity sin estrategia de inyección de contexto ni hooks**; OpenCode sin scope local; `ConventionFileStrategy` (fallback `AGENTS.md`) diferido en decoupling §7; adapters `registry/references/` (codex/copilot/gemini) importados pero no cableados; hook ports Antigravity 2.0/OpenCode diferidos desde pendientes 2026-05-22. | Decoupling design §7 + pendientes 2026-05-22 + análisis 2026-06-09 | WS-6 |
| F-6 | **`awm update` no re-sincroniza `~/.awm/hooks/`.** Verificado 2026-06-09: el handler de `update` en `cli/src/index.ts` regenera contexto y reconcilia symlinks de skills, pero los scripts de hooks son copias que quedan desactualizadas hasta correr `awm hooks install` a mano. En un equipo: N máquinas con hooks viejos en silencio. | Pendientes 2026-05-22 (deuda #3), verificado abierto 2026-06-09 | WS-0 |
| F-7 | **Branding ajeno.** "Superpowers Brainstorming" en `registry/skills/brainstorming/scripts/frame-template.html` líneas 5 y 199. | Pendientes 2026-05-22 (deferred) | WS-0 |
| F-8 | **E2E manual del hook sin golden output.** Protocolo en `cli/tests/integration/README.md`; nunca se guardó el output de referencia. | Pendientes 2026-05-22 (quick win #1) | WS-0 |
| F-9 | **Mutation testing inactivo.** Sensor Stryker existe en el pack js-ts pero `enabled: false` por defecto. Diferido explícito del plan B-2; falta la decisión de activarlo (y para qué paths). | B-2 plan (diferido explícito) | WS-7 |
| F-10 | **Política de idioma indefinida.** ~6 skills, workflows, agents y CLAUDE.md en español; el resto en inglés. Sin decisión es-first / en-first / locales. | Análisis distribución 2026-06-09 | WS-7 |
| F-11 | **Windows nominal.** `run-hook.cmd` es stub; symlinks en Windows requieren developer mode; paths asumen Unix. | Análisis distribución 2026-06-09 | WS-7 |
| F-12 | **Flujo de equipo sin documentar ni endurecer.** El onboarding `git clone` + `awm sync` vía `.awm/profile.json` ya casi existe pero no está documentado como flujo de equipo (senior autorea → PR a registry del equipo → release → `awm update`; nuevo dev → clone + sync). | Análisis distribución 2026-06-09 | WS-5 |

---

## Workstreams (en orden de prioridad)

### WS-0 — Deudas rápidas de la era anterior `[F-6, F-7, F-8]`

Una sesión corta. Sin design previo (alcance trivial y ya especificado).

- [x] Fix: `awm update` re-sincroniza hooks si están instalados (llamada a la lógica de `hooks install` en el handler de `update`, `cli/src/index.ts`) + test (plan: 2026-06-09-ws0-quick-debts-plan.md)
- [x] Edit: branding `frame-template.html:5,199` → AWM (plan: 2026-06-09-ws0-quick-debts-plan.md)
- [x] E2E manual del hook → guardar `cli/tests/integration/golden-output-<fecha>.txt` (skipped by decision — not needed)
- [x] Cierre: plan corto con `awm-qa-complete` (plan: 2026-06-09-ws0-quick-debts-plan.md)

**Criterio de cierre:** los 3 ítems verificados; F-6/F-7/F-8 marcados resueltos en el registro.

### WS-1 — Extracción del contenido personal `[F-4]`

Separar `personal-notion` + las 3 skills NotionTracker a un registry/overlay personal fuera del repo distribuible. Desbloquea WS-2 (es el primer caso de uso real de "segundo registry").

- [ ] Brainstorming + design (¿overlay local? ¿repo privado aparte? ¿mecanismo genérico de registry adicional mínimo?)
- [ ] Plan + ejecución
- [ ] Verificación: clone limpio del repo no contiene contenido personal; tus skills personales siguen funcionando en tu máquina
- [ ] QA → `awm-qa-complete`

### WS-2 — Registry configurable + multi-registry `[F-2]`

La pieza que convierte AWM de "tus skills" en plataforma: remote configurable (env/preferences) y soporte para registry del equipo junto al upstream, con namespacing. Resuelve también la gobernanza (el equipo contribuye a SU registry).

- [ ] Brainstorming + design (modelo de resolución multi-registry, precedencia, namespacing, `awm update` multi-remote)
- [ ] Plan + ejecución
- [ ] Verificación: un repo de contenido distinto al de Kodria funciona end-to-end como registry
- [ ] QA → `awm-qa-complete`

### WS-3 — Versionado real: releases + pinning + lockfile `[F-1]`

Releases taggeados, canal estable separado de main, pinning de versión en `.awm/profile.json` (`{"name": "dev", "version": "1.2.0"}`), y hacer que el CLI lea/escriba un lockfile real (revivir o reemplazar `skills-lock.json`). El symlink sigue siendo el mecanismo; apunta a un tag, no a HEAD.

- [ ] Brainstorming + design (esquema de versiones, canales, formato de lockfile, migración de profiles existentes)
- [ ] Plan + ejecución
- [ ] Verificación: un proyecto pineado NO recibe cambios de main hasta bump explícito; rollback funciona
- [ ] QA → `awm-qa-complete`

### WS-4 — Publicación npm + install simplificado `[F-3]`

CLI estable publicado en npm; `install.sh` se reduce a `npm i -g` (o desaparece). Registries quedan como repos de contenido intercambiables (depende de WS-2). El CLI cambia poco; el contenido cambia mucho — se separan los ciclos de release.

- [ ] Brainstorming + design (separación CLI/registry, versionado del CLI vs del contenido, compatibilidad)
- [ ] Plan + ejecución
- [ ] Verificación: instalación desde cero en máquina limpia sin git clone del monorepo
- [ ] QA → `awm-qa-complete`

### WS-5 — Flujo de equipo documentado y endurecido `[F-12]`

Documentar y probar el ciclo completo de equipo (depende de WS-2/3/4): senior autorea skill → PR al registry del equipo → release taggeado → teammates reciben con `awm update`; nuevo dev → `git clone` + `awm sync`.

- [ ] Runbook de equipo en `docs/` + hardening de los edge cases que aparezcan al probarlo
- [ ] Verificación: onboarding simulado de cero en máquina/usuario limpio
- [ ] QA → `awm-qa-complete`

### WS-6 — Agnosticismo de harness, fase 2 `[F-5]`

Cerrar los diferidos acumulados: estrategia de inyección para Antigravity, scope local de OpenCode, `ConventionFileStrategy` (`AGENTS.md` fallback), evaluación de cablear `registry/references/` como adapters, hook ports si el design los justifica.

- [ ] Brainstorming + design (continúa decoupling §7; decidir alcance real: ¿Antigravity se mantiene como target soportado?)
- [ ] Plan + ejecución
- [ ] QA → `awm-qa-complete`

### WS-7 — Decisiones de política `[F-9, F-10, F-11]`

No es código primero: son tres decisiones que hay que tomar y registrar (y recién entonces ejecutar lo que salga).

- [ ] F-10 Idioma: es-first / en-first / locales → decisión registrada aquí + plan de normalización si aplica
- [ ] F-9 Mutation testing: ¿se activa por defecto? ¿solo paths críticos? → decisión + cambio en pack si aplica
- [ ] F-11 Windows: ¿target soportado o explícitamente no-soportado (documentado)? → decisión + plan si aplica

---

## Estado de cierre

| WS | Hallazgos | Plan ejecutado | QA |
|----|-----------|----------------|----|
| WS-0 | F-6, F-7, F-8 | [2026-06-09-ws0-quick-debts-plan.md](2026-06-09-ws0-quick-debts-plan.md) | ☐ |
| WS-1 | F-4 | — | ☐ |
| WS-2 | F-2 | — | ☐ |
| WS-3 | F-1 | — | ☐ |
| WS-4 | F-3 | — | ☐ |
| WS-5 | F-12 | — | ☐ |
| WS-6 | F-5 | — | ☐ |
| WS-7 | F-9, F-10, F-11 | — | ☐ |

**Este documento se cierra** (marcador `awm-qa-complete` + nota de cierre de era) cuando las 8 filas tengan QA ☑.
