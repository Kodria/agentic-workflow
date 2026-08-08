// src/core/renderers/skill-source.ts
//
// Shared parsing for the two provider-specific skill renderers
// (cursor-mdc.ts, copilot-instructions.ts): both are sourced from a
// SKILL.md's frontmatter + body, the same relationship renderCodexAgent
// (codex-agent.ts) has with its canonical agent source — transform, not
// link. Reuses discovery.ts's `matchFrontmatterBlock` (already the single
// source of truth for locating the frontmatter block elsewhere in this
// codebase) rather than writing a second frontmatter parser.
import { matchFrontmatterBlock, readFrontmatterDescription } from '../frontmatter';

export type SkillSource = {
    description: string;
    body: string;
};

/**
 * Parses a raw SKILL.md source into its `description` frontmatter field and
 * body content. Mirrors discovery.ts's `readArtifactDescription` for the
 * quote-stripping/block-scalar handling of the `description` line, and
 * canonical-agent.ts's `parseCanonicalAgent` for the "throw on missing
 * required piece" discipline — a renderer should never silently embed an
 * empty description or body.
 */
export function parseSkillSource(source: string): SkillSource {
    const frontmatter = matchFrontmatterBlock(source);
    if (frontmatter === null) throw new Error('skill source requires YAML frontmatter');

    // Delega en readFrontmatterDescription (discovery.ts) — la MISMA funcion
    // que usa el discovery del CLI, incluyendo la resolucion de block scalars
    // (`description: >-` + lineas indentadas). Antes esta funcion tenia su
    // propia copia de la logica, y ambas colapsaban el indicador de block
    // scalar a '' en vez de leer el texto de las lineas siguientes: eso
    // crasheaba `awm add <bundle> -a copilot|cursor` contra un skill real del
    // registry baseline. Una sola implementacion = no pueden volver a
    // divergir.
    const description = readFrontmatterDescription(frontmatter);
    if (!description) throw new Error('skill source requires a non-empty description');

    const bodyMatch = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1].trim() : '';
    if (!body) throw new Error('skill source requires a non-empty body');

    return { description, body };
}
