<!-- GENERADO por provider-run.mjs --consolidate. No editar a mano: se regenera desde
     docs/research/r5/evidence/*.json y cualquier edición manual se pierde. -->
# R5 · matriz de providers (solo desde evidencia)

| Capability | scripted local | claude-code (sin evidencia) | codex (sin evidencia) |
|---|---|---|---|
| bootstrap | supported | sin-evidencia | sin-evidencia |
| crash recovery | supported | sin-evidencia | sin-evidencia |
| worktree join | not-certified | sin-evidencia | sin-evidencia |
| final gate semantics | identical | sin-evidencia | sin-evidencia |

Fuente: scripted@3f8783b4f254 · claude-code: SIN EVIDENCIA · codex: SIN EVIDENCIA

## Qué certifica esta matriz — y qué no

`scripted` es un controller **determinista**, no un LLM: certifica el contrato
supervisor↔controller (spawn, token de generación, requests consumidas, worktrees,
joins, integración final) con procesos y git reales, sin gastar tokens.

**No certifica que un agente real sepa ocupar ese rol.** Esa es una propiedad del
agente, no del supervisor, y es lo único que requiere una corrida con tokens. Las
columnas `claude-code`/`codex` existen para eso y son opcionales: mientras digan
`sin-evidencia`, nadie verificó esa mitad — no se infiere de la columna `scripted`.
