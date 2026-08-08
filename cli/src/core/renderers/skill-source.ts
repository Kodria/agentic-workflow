// src/core/renderers/skill-source.ts
//
// Shared parsing for the two provider-specific skill renderers
// (cursor-mdc.ts, copilot-instructions.ts): both are sourced from a
// SKILL.md's frontmatter + body, the same relationship renderCodexAgent
// (codex-agent.ts) has with its canonical agent source — transform, not
// link. Reuses discovery.ts's `matchFrontmatterBlock` (already the single
// source of truth for locating the frontmatter block elsewhere in this
// codebase) rather than writing a second frontmatter parser.
import { matchFrontmatterBlock } from '../discovery';

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

    const line = frontmatter.split(/\r?\n/).find((l) => /^description\s*:/.test(l));
    if (!line) throw new Error('skill source requires a non-empty description');
    let description = line.replace(/^description\s*:/, '').trim();
    if (
        (description.startsWith('"') && description.endsWith('"')) ||
        (description.startsWith("'") && description.endsWith("'"))
    ) {
        description = description.slice(1, -1);
    }
    if (!description) throw new Error('skill source requires a non-empty description');

    const bodyMatch = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1].trim() : '';
    if (!body) throw new Error('skill source requires a non-empty body');

    return { description, body };
}
