# R0 — Descubrimiento read-only: diseño del kit de sondas y del informe

> Ejecuta el **Release 0** del brief certificado
> [`2026-07-30-sdd-cycle-optimization-brief.md`](2026-07-30-sdd-cycle-optimization-brief.md)
> (`readiness: ready`, gate 9/9). Tracking: issue
> [agentic-workflow#20](https://github.com/Kodria/agentic-workflow/issues/20).
> Decisiones del dueño en la sesión de diseño: **kit de sondas híbrido**
> (Fase A sandbox / Fase B máquinas del dueño / Fase C consolidación),
> **macOS + Linux** (Windows fuera de alcance), **enfoque B**
> (kit auto-consolidante con doble clase de sonda).

## Requirements

IDs propios de este diseño (`R1`–`R10`), distintos de los `RF-x.y` del brief;
donde una fila materializa la aceptación del brief para Release 0, se cita.

- **R1** — THE kit SHALL vivir íntegramente bajo `docs/research/r0/` y SHALL NOT modificar código de producción, configs existentes ni `~/.awm`. IF una sonda necesita escribir, THEN solo bajo `docs/research/r0/evidence/` o tmpdirs del OS.
- **R2** — WHEN se ejecuta `node docs/research/r0/probes/run.mjs` en macOS o Linux (Node ≥ 20, sin red), THE kit SHALL correr todas las sondas mecánicas y escribir **un** JSON estampado por corrida (provider, entorno, OS, versiones, fecha, resultado por sonda) bajo `evidence/`.
  - **R2.1** — THE sondas SHALL usar solo built-ins de Node (cero dependencias).
  - **R2.2** — WHEN el kit se corre repetidamente, THE evidencia SHALL acumularse (un archivo nuevo por corrida), nunca sobrescribirse.
- **R3** — THE sondas mecánicas SHALL cubrir: supervivencia de proceso detached al cierre de la sesión que lo lanzó, atomicidad de `rename` en el filesystem local, huella del entorno, e inspección **sin autenticación** de los CLIs (`codex`, `opencode`, `claude`): versión y superficie de flags/config relevante a selección de modelo y despacho.
  - **R3.1** — IF un CLI está ausente en la máquina, THEN la sonda SHALL registrar `no-verificable-aquí: binario ausente` y THE corrida SHALL continuar — nunca abortar el run completo.
- **R4** — THE `AGENT-PROTOCOL.md` SHALL definir los ejercicios P1–P5 (paralelismo de subagentes, override de modelo, turno que termina con proceso vivo, worktree, recuperación post-interrupción) con **verdad en archivos**: cada ejercicio produce artefactos estampados bajo `evidence/` + un formulario JSON con respuestas y rutas. IF una respuesta carece de artefacto que la respalde, THEN SHALL registrarse como `no-certificado`, nunca como `soportado`. *(Materializa: matriz con comando/evidencia por celda.)*
- **R5** — WHEN se ejecuta `probes/consolidate.mjs`, THE consolidador SHALL regenerar `capability-matrix.md` exclusivamente desde `evidence/*.json`; el archivo generado SHALL llevar un marcador "generado — no editar a mano".
  - **R5.1** — THE celdas SHALL estar clavadas por `(provider, entorno)` con estado del enum `soportado | no-soportado | degradado | no-verificable-aquí | no-certificado` y enlace a su evidencia.
  - **R5.2** — IF dos corridas aportan evidencia contradictoria para una misma celda, THEN la matriz SHALL mostrar el conflicto explícitamente — nunca conservar en silencio la más reciente.
- **R6** — THE informe SHALL incluir el trabajo sandbox-only de Fase A: mapeo conceptual→real de los sensor-packs del registry (¿admiten set de referencia sin rediseño?), suficiencia del esquema del ledger para la detección empírica, convenciones del CLI, y estudio del runner en Linux (macOS se completa con la corrida del kit del dueño). *(Materializa: mapeo conceptual→real del brief.)*
- **R7** — THE `report.md` SHALL contener: estado real verificado, mapeo conceptual→real, sección de **contradicciones** con el brief, especificación reproducible de fixtures (job largo, job sin output, `orphaned`, fingerprint — especificación, no implementación), y el plan técnico provider-neutral para R1–R5.
  - **R7.1** — IF la evidencia contradice un supuesto del brief, THEN la contradicción SHALL registrarse en el informe y reportarse al dueño — SHALL NOT resolverse asumiendo; si amerita, nace una `DA-#` nueva en el brief.
- **R8** — THE estudio de portabilidad del runner SHALL cubrir macOS y Linux; Windows SHALL declararse fuera de alcance en el informe.
- **R9** — WHILE el dueño no haya validado `report.md`, THE Release 0 SHALL considerarse incompleto — la validación se registra en el issue #20. *(Materializa: "validado por el dueño" de la aceptación.)*
- **R10** — THE corridas obligatorias de la matriz SHALL ser `claude-code@sandbox-remoto` (Fase A), `codex@máquina-del-dueño` y `opencode@máquina-del-dueño` (Fase B); `claude-code@mac-del-dueño` SHALL ser opcional y el informe SHALL declarar qué corridas existieron.

## Estructura

```
docs/research/r0/
  probes/run.mjs           entrypoint mecánico — un comando por máquina
  probes/lib/*.mjs         sondas individuales, Node puro
  probes/consolidate.mjs   evidence/*.json → capability-matrix.md
  AGENT-PROTOCOL.md        ejercicios P1–P5 para el agente de cada provider
  RUNBOOK.md               instrucciones de Fase B para el dueño, paso a paso
  evidence/                un JSON por corrida + artefactos de P1–P5
  capability-matrix.md     generada, nunca editada a mano
  report.md                informe final (Fase C)
```

Autocontenido y retirable post-R0 si el dueño lo decide (mismo patrón que los
artefactos de diseño Stitch). El transporte entre máquinas es esta rama:
`claude/agentic-workflow-awm-issues-dqka6l`.

## Las dos clases de sonda

**Clase 1 — hechos de OS/CLI** (scripts): supervivencia detached, atomicidad,
huella, inspección de CLIs sin auth. Cualquiera las corre; mismo resultado.

**Clase 2 — hechos del harness** (protocolo de agente): paralelismo real de
subagentes, override de modelo, turno que muere con trabajo vivo, worktrees,
recuperación. Ningún script puede probarlas — solo el agente ejercitando sus
herramientas. Para que la evidencia no degenere en prosa, la verdad queda en
artefactos del filesystem (ej. P1: dos subagentes escriben heartbeats con
timestamp; el solapamiento temporal en los archivos prueba el paralelismo,
no el relato del agente).

## Fases

| Fase | Quién / dónde | Contenido |
|---|---|---|
| **A** | Esta sesión (Claude Code sandbox) | Construir el kit · correrlo aquí (primera fila de la matriz) · ejecutar P1–P5 aquí · análisis sandbox-only (R6) · commit del kit + runbook |
| **B** | Dueño, sus máquinas | `git pull` de la rama · correr `run.mjs` + protocolo en Codex y OpenCode (opcional: Claude Code local) · commitear `evidence/` — minutos por corrida |
| **C** | Sesión de consolidación | `consolidate.mjs` → matriz final · `report.md` con contradicciones y plan técnico · validación del dueño en #20 |

Entre A y B el trabajo queda pausado sin deuda: el kit commiteado es el
estado completo. B no me necesita; C no necesita las máquinas del dueño.

## Verificación del kit mismo

El kit es tooling de descubrimiento descartable, no producto — la vara es
proporcional: `run.mjs` y `consolidate.mjs` se smoke-testean en Fase A en este
sandbox (corrida real + regeneración determinística de la matriz desde
fixtures mínimos de evidencia); no se les construye suite formal. La única
lógica con riesgo real de error silencioso —el consolidador (R5.1/R5.2)— se
verifica con un caso de conflicto fabricado antes de confiar en la matriz.

## Non-goals

- Windows (decisión del dueño — se declara en el informe).
- Implementar runner/journal/fixtures — R0 especifica; R1 implementa.
- Corregir contradicciones encontradas — se reportan (R7.1), no se arreglan.
- Sondas que requieran autenticación de Codex/OpenCode desde este sandbox.
- Tocar `~/.awm`, configs del proyecto o código de producción (R1).
