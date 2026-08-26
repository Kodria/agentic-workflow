<!-- AWM:CONTEXT-KERNEL:START v1 -->
<!-- awm-context:CTX-AGENTS-001 -->
# AGENTS.md — Guía de mantenimiento de AWM

<!-- awm-context:CTX-AGENTS-002 -->
Esta es la guía de mantenimiento de este repo (el CLI de AWM) — no la función del propio CLI que genera un `AGENTS.md` para *otros* proyectos (ver `cli/src/core/context/strategies/`, `cli/src/core/renderers/`). Cada entrada es un patrón confirmado contra el código real, curado con la misma disciplina merge-and-prune que `harness-retro` aplica en cualquier proyecto: fusionar lo nuevo en la sección que corresponde, podar lo que ya no aplica, nunca apilar un log crudo. La procedencia detallada (release, fecha, commit) vive en el historial de git y en `docs/plans/`; acá va la lección accionable, no el diario de la sesión. Todo agente que trabaje en este repo debe leerlo antes de tocar código.

<!-- awm-context:CTX-AGENTS-003 -->
---

<!-- awm-context:CTX-AGENTS-058 -->
## Layout del repo y de la instalación

<!-- awm-context:CTX-AGENTS-059 -->
- **Este repo** contiene solo el CLI TypeScript (`cli/`). El contenido (skills, bundles, sensor-packs, hooks) vive en repos externos: `awm-baseline-registry` y `awm-documentation-registry`.
- **No hay `registry/` en este repo** ni `~/.awm/cli-source/`. El concepto `cli-source` fue eliminado.
- **Layout de instalación:** `~/.awm/registries/<name>/` — cada registry configurado se clona ahí. Los skills se instalan como symlinks hacia esos paths.
- **Descubrimiento de contenido:** `contentRoots()` devuelve los paths bajo `~/.awm/registries/` según la config. No hay constante fija de `baseRoot` ni de `cliSource`.

<!-- AWM:CONTEXT-KERNEL:END v1 -->
