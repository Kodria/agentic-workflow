import fs from 'fs';
import yaml from 'js-yaml';
import { matchFrontmatterBlock } from '../frontmatter';
import { FactsCatalog, SkillNeedsError } from './types';

/**
 * Read the `needs` list from a skill SKILL.md frontmatter.
 * Absent → `[]`. Invalid shape → {@link SkillNeedsError}.
 */
export function readSkillNeeds(skillMdPath: string): string[] {
    let raw: string;
    try {
        const stat = fs.lstatSync(skillMdPath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new SkillNeedsError(`Skill path ${skillMdPath} must be a regular file`);
        }
        raw = fs.readFileSync(skillMdPath, 'utf-8');
    } catch (e) {
        if (e instanceof SkillNeedsError) throw e;
        throw new SkillNeedsError(
            `Cannot read skill at ${skillMdPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    const block = matchFrontmatterBlock(raw);
    if (block === null) return [];
    let parsed: unknown;
    try {
        parsed = yaml.load(block);
    } catch (e) {
        throw new SkillNeedsError(
            `Invalid skill frontmatter at ${skillMdPath}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (parsed === null || parsed === undefined) return [];
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new SkillNeedsError(`Invalid skill frontmatter at ${skillMdPath}: expected a mapping`);
    }
    const needs = (parsed as Record<string, unknown>).needs;
    if (needs === undefined) return [];
    if (!Array.isArray(needs) || needs.some((n) => typeof n !== 'string' || n === '')) {
        throw new SkillNeedsError(
            `Invalid needs at ${skillMdPath}: needs must be a YAML list of non-empty strings`,
        );
    }
    return needs as string[];
}

/** Ids in `needs` that are absent from the catalog (fail-closed; never invent). */
export function findOrphanNeeds(needs: string[], catalog: FactsCatalog): string[] {
    // Own keys only — `in` would treat Object.prototype (toString, …) as catalog facts.
    return needs.filter((id) => !Object.hasOwn(catalog.facts, id));
}
