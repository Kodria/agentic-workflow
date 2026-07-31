# RUNBOOK — Fase B (corridas del dueño)

Objetivo: completar la fila `codex@owner-mac` de la matriz (obligatoria —
design doc R10) y, opcional, `claude-code@owner-mac`. *(La fila
`opencode@owner-mac` fue desestimada el 2026-07-31 por decisión del dueño:
OpenCode queda fuera del alcance de la iniciativa — issue #20.)*
Windows está fuera de alcance (decisión de diseño, R8). Cada corrida son
minutos, no horas.

## Por cada provider (Codex; OpenCode desestimado)

1. Abrí una sesión del provider sobre este repo, rama
   `claude/agentic-workflow-awm-issues-dqka6l`, actualizada (`git pull`).
2. Sondas mecánicas — pedile al agente (o corrélo vos):
   `node docs/research/r0/probes/run.mjs --provider codex --env owner-mac`
   (ajustá `--provider` y `--env` según corresponda; `--env` es una etiqueta
   libre estable — usá siempre la misma para tu Mac).
3. Protocolo de agente — decile al agente:
   "Ejecutá `docs/research/r0/AGENT-PROTOCOL.md` de punta a punta y escribí el
   formulario final". Conservá las salidas literales y metadatos pedidos:
   un nombre solicitado por el agente no sustituye el modelo observado, ni un
   timestamp sustituye evidencia de cambio de turno. P5 hacelo en serio: cerrá
   la sesión/app de verdad y retomá en una nueva sin memoria de la anterior.
4. Commiteá TODO lo nuevo bajo `docs/research/r0/evidence/` y pusheá la rama:
   `git add docs/research/r0/evidence/ && git commit -m "evidence(r0): <provider>@owner-mac" && git push`

## Al terminar los dos (o tres) providers

Avisá en la sesión de Claude Code (o en el issue #20): "Fase B lista" —
la Fase C consolida, redacta el informe y te lo trae a validación (R9).

## Si algo falla

No arregles el kit acá: anotá el error como comentario en el issue #20 con el
comando exacto y su salida. El kit se corrige en la sesión de desarrollo y
re-corres solo lo afectado (las corridas se acumulan, nada se pisa).

## Estado para retomar después de la auditoría 2026-07-31

La corrida `codex@agentmobile-linux` es evidencia suplementaria de sandbox,
no la fila obligatoria `codex@owner-mac` de R10. P1 quedó certificado; P2–P5
quedaron `no-certificado` por artefactos insuficientes. En la máquina del dueño
se debe crear una corrida nueva — no renombrar ni reutilizar esos archivos — y
después repetir el protocolo completo con las reglas endurecidas de arriba.
