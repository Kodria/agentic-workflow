# R1 — Runbook de validacion en maquina real (dueño)

Requiere: rama actualizada, `cd cli && npm run build`, y el binario local
(`node cli/dist/src/index.js`, alias abajo como `awm-dev`).

## Escenario Codex (Mac y/o VPS) — el dolor #2 curado

1. En el repo del proyecto: `awm-dev watch --init` (crea el journal de la rama
   e imprime los verificadores requeridos detectados — verificar que coinciden
   con la config real del repo).
2. En una terminal: `awm-dev watch --provider codex` (queda en foreground).
3. En otra terminal, simular el ciclo: pedir un job
   (`awm-dev job request --generation <token-de-la-generacion-activa> -- npm test`)
   y verificar con `awm-dev job ps` que lo ejecuta el supervisor via
   exec-wrapper, no tu sesion.
4. Corte real: cerra la sesion de Codex a mitad de un ciclo. Verificar que el
   supervisor detecta el silencio (suspected-stall, solo observacion), y que
   SOLO releva cuando ademas la actividad del process group esta congelada Y el
   adapter afirma `safeToReplace` (muerte probada); si no puede probarlo, entra
   en custodia BLOCKED conservando el lock — verificar que NO mata nada en ese
   caso. Tras el relevo, el orquestador nuevo retoma desde `next_action` sin
   duplicar trabajo (`awm job list`: cero jobs duplicados).
5. `awm-dev job gate` en rojo mientras haya pendientes; verde solo al final;
   el supervisor se apaga solo tras COMPLETE liberando el lock. Verificar con
   `ps` que no queda NINGUN proceso awm/codex huerfano.
6. `awm-dev job export --provider codex` deja el artefacto sanitizado en
   `.awm/journal/<rama>/export/` — revisar timestamps por fase, despachos
   reales y campos `unobservable` declarados.

## Escenario Claude Code — neutralidad (R5.4)

1. Opt-out: correr un ciclo SDD normal SIN `watch --init` => cero cambios de flujo.
2. Opt-in: `watch --init` + la misma bateria del escenario Codex con
   `--provider claude-code`.

## Registro

Resultado (paso a paso, con cualquier desviacion) como comentario en
agentic-workflow#20. R1 no se declara aceptado sin este registro (R8.1).
