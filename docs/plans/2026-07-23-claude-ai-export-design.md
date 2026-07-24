# `awm export --target claude-ai` — Design Doc

**Fecha:** 2026-07-23 · **Issue:** [agentic-workflow#9](https://github.com/Kodria/agentic-workflow/issues/9) · **Estado:** aprobado en brainstorming

Comando de export que toma un bundle o skill del registry instalado y genera el artefacto subible a claude.ai como custom skill (carpeta + zip), automatizando las adaptaciones que hoy se hacen a mano en los "environment ports". Valor declarado por el dueño: habilita AWM sin necesidad del binario — usar el registry desde claude.ai web y Cowork móvil/web, donde no hay filesystem.

**Decisiones de brainstorming (todas del dueño):** exportabilidad declarada como metadata en el contenido del registry (no picker, no sin-filtro); adaptación = transform mecánico + override wholesale opcional por skill (no parches declarativos); los ports manuales de `awm-baseline-registry/docs/ports/` se deprecan y migran a overrides junto a sus skills canónicas; empaquetado zip por capas con binario del sistema y fallback a carpeta (sin dependencia nueva).

**Specialist gate (registrado):** arquitectura — aplicó acotado, resuelto en la selección de enfoque (motor en `core/` + comando delgado, patrón de casa); tecnología — no aplicó (única elección abierta, el zip, la resolvió el dueño); NFRs — aplicó trivial, folded como R5.x.

## Requirements

### F1 — Comando y resolución

- **R1** — WHEN `awm export <nombre>` se invoca y `<nombre>` coincide con un bundle en algún content root, THE CLI SHALL exportar todas las skills portables del bundle, con resolución transitiva de `dependsOn` (semántica de `resolveBundleSkills`).
- **R1.1** — WHEN `<nombre>` no coincide con un bundle pero sí con una skill (primer content root que la contenga, orden de `registries.json`), THE CLI SHALL exportar esa skill individual.
- **R1.2** — IF `<nombre>` no coincide con ningún bundle ni skill en ningún content root, THEN THE CLI SHALL fallar con un error que liste los bundles disponibles.
- **R1.3** — THE flag `--target` SHALL ser opcional con default `claude-ai`; IF recibe un valor desconocido, THEN THE CLI SHALL fallar listando los targets válidos.
- **R1.4** — THE export SHALL leer desde los content roots del registry instalado (`contentRoots()`), nunca desde los symlinks de `~/.claude/skills/`.

### F2 — Gate de portabilidad

- **R2** — THE CLI SHALL exportar únicamente skills con `portable: true` en el frontmatter de su `SKILL.md`.
- **R2.1** — IF una skill pedida explícitamente por nombre no es portable, THEN THE CLI SHALL fallar con un error que explique el flag `portable` (nunca skip silencioso).
- **R2.2** — WHILE exporta un bundle, THE CLI SHALL listar visiblemente las skills omitidas por no portables (sin caps silenciosos).
- **R2.3** — IF un bundle no contiene ninguna skill portable, THEN THE CLI SHALL fallar explicándolo.

### F3 — Adaptación

- **R3** — WHEN existe `skills/<name>/port.claude-ai.md` en el content root, THE export SHALL usarlo **verbatim** como `SKILL.md` del artefacto (cero transforms — el autor del override es dueño total, incluida la línea de deferencia).
- **R3.1** — WHEN no existe override, THE export SHALL aplicar el transform mecánico: quitar `version` y `portable` del frontmatter, anexar a `description` la línea de deferencia fija *"In environments with AWM installed (Claude Code), defer to the registry's `<name>` skill — this port is for environments without filesystem access."*, y dejar el body intacto.
- **R3.2** — THE archivos de `references/` SHALL copiarse byte-idénticos en ambos caminos (override y mecánico).
- **R3.3** — IF existe override pero el frontmatter canónico no declara `portable: true`, THEN THE CLI SHALL fallar por metadata inconsistente (un override declara intención de export; sin flag es contrato a medias).
- **R3.4** — IF el `SKILL.md` carece de frontmatter válido (sin bloque `---` delimitado o sin `description`), THEN THE CLI SHALL fallar citando el archivo.

### F4 — Empaquetado

- **R4** — THE export SHALL escribir `<out>/claude-ai/<skill>/` (con `SKILL.md` y `references/` si existen) de forma determinística: el re-export limpia su propio subárbol antes de escribir. Default de `--out`: `./awm-export/`.
- **R4.1** — WHERE el binario `zip` del sistema está disponible, THE export SHALL producir además `<out>/claude-ai/<skill>.zip` subible directo a claude.ai.
- **R4.2** — IF `zip` no está disponible, THEN THE export SHALL dejar la carpeta, imprimir la instrucción de compresión manual, y salir con código 0 (patrón layered-degrade de la casa).

### F5 — Calidad (NFRs folded)

- **R5** — THE motor SHALL vivir en `cli/src/core/export/` con comando delgado en `cli/src/commands/export.ts` (`registerExportCommand`, registrado en `index.ts`); el transform de claude.ai es una función pura separada — costura para targets futuros sin plugin registry.
- **R5.1** — THE tests SHALL usar tmpdirs aislados con `HOME`/`AWM_HOME` sobreescritos (patrón `cli/tests/commands/hooks/install.test.ts`); ningún test toca el `~/.awm` real.
- **R5.2** — THE export SHALL operar completamente offline (sin red).

### F6 — Trabajo hermano de contenido (fuera de este plan)

- **R6** — WHEN el CLI de export esté mergeado, THE dueño SHALL ejecutar el PR de contenido en `awm-baseline-registry` (referenciando `agentic-workflow#9`): marcar `portable: true` en las skills que corresponda, migrar `docs/ports/*.claude-ai.md` a `skills/product-brief/port.claude-ai.md` y `skills/mermaid-diagrams/port.claude-ai.md`, reescribir `docs/environment-ports.md` documentando el flujo `awm export`, y borrar `docs/ports/`. **No es tarea de este repo ni de este plan** — se registra aquí por trazabilidad.

## Diseño

### Superficie del comando

`awm export <nombre> [--target claude-ai] [--out <dir>]`. Resolución bundle-primero, skill-después (R1/R1.1), sobre `contentRoots()` en orden de precedencia. Target default `claude-ai`, validado. Salida en `./awm-export/claude-ai/`.

### Contrato de contenido (leído por el CLI, vive en el registry)

`portable: true` en frontmatter = la skill sobrevive sin filesystem/AWM (propiedad intrínseca, versionada con la skill). Override editorial `port.claude-ai.md` junto al `SKILL.md` para adaptaciones no mecánicas (ej. genericizar invoker-lists). Regla de consistencia R3.3.

### Motor (`cli/src/core/export/`)

- `resolve.ts` — `<nombre>` → lista de `{skillName, contentRoot, portable, overridePath?}`; reutiliza `readCatalog`/`discoverBundles`/`resolveBundleSkills` de `core/bundles.ts`.
- `transform.ts` — `claudeAiTransform(skillMd, skillName)`: función pura string → string. Parsing de frontmatter **line-based sobre frontmatter plano** (los SKILL.md del baseline usan claves de una línea; `description` puede ser larga pero es una sola línea, quoted o no): elimina líneas `version:` y `portable:`, anexa la deferencia dentro de la quote de `description` (o al final de la línea si no está quoted). No se introduce parser YAML — YAGNI y cero deps.
- `pack.ts` — escribe el árbol de salida (limpia subárbol propio primero, R4) y ejecuta el zip por capas: `spawnSync('zip', ['-r', ...])` si el binario existe (detección vía spawn con manejo de ENOENT), fallback a carpeta + mensaje (R4.2).
- `index.ts` — orquestación + tipos.

### Manejo de errores

Todos los IF/THEN de R1.2, R1.3, R2.1, R2.3, R3.3, R3.4 son errores explícitos con mensaje accionable (qué falta y dónde). El único degrade silencioso-con-aviso es el zip ausente (R4.2). En export de bundle, las skips por no-portable se reportan en el output estándar (R2.2).

### Testing

Jest (`--runInBand`), fixtures de registry falso en tmpdir (catalog.json + bundles + skills con/sin `portable`, con/sin override, con/sin `references/`). Unit tests del transform puro (frontmatter quoted/unquoted, campos ausentes, orden de claves). Tests de integración del motor end-to-end (carpeta resultante, contenido adaptado, references byte-idénticas). Test del comando (target desconocido, nombre inexistente, skill no portable). El path del zip se testea con doble estrategia: assert condicional si `zip` existe en el runner + test del fallback simulando ENOENT.

## Fuera de alcance

- Targets adicionales (`hermes`, etc.) — la costura queda (transform separado), la maquinaria no.
- Upload automático a claude.ai — no existe API pública; el criterio de éxito del issue termina en el artefacto subible.
- El PR de contenido en `awm-baseline-registry` (R6) — trabajo hermano post-merge, no de este repo.

## Referencias

- Issue: [`agentic-workflow#9`](https://github.com/Kodria/agentic-workflow/issues/9)
- Ports manuales actuales (a migrar en R6): [`awm-baseline-registry/docs/ports/`](https://github.com/Kodria/awm-baseline-registry/tree/main/docs/ports), headers con las reglas de adaptación que este diseño mecaniza.
- Patrón environment-port: [`awm-baseline-registry/docs/environment-ports.md`](https://github.com/Kodria/awm-baseline-registry/blob/main/docs/environment-ports.md)
- Secuenciación decidida por el dueño: este ciclo precede a [`awm-baseline-registry#12`](https://github.com/Kodria/awm-baseline-registry/issues/12) (capa de presentación HTML) para que esa skill nazca exportable.
