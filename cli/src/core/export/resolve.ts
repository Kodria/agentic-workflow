// cli/src/core/export/resolve.ts
//
// Resolución <nombre> → skills a exportar (R1/R1.1) con gate de portabilidad
// (R2.x) y consistencia de override (R3.3). Lee SIEMPRE de content roots del
// registry instalado — nunca de ~/.claude/skills.
import fs from 'fs';
import path from 'path';
import { discoverAllBundles, resolveBundleSkills } from '../bundles';
import { ExportResolution, ResolvedSkill } from './types';

const OVERRIDE_FILE = 'port.claude-ai.md';

/** portable: true en el frontmatter (bloque --- inicial), CRLF-tolerant como readArtifactDescription en discovery.ts. */
function isPortable(skillMd: string): boolean {
    const fmMatch = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) return false;
    return /^portable\s*:\s*true\s*$/m.test(fmMatch[1]);
}

function locate(skillName: string, roots: string[]): ResolvedSkill | null {
    for (const root of roots) {
        const dir = path.join(root, 'skills', skillName);
        const skillFile = path.join(dir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;
        const overridePath = fs.existsSync(path.join(dir, OVERRIDE_FILE))
            ? path.join(dir, OVERRIDE_FILE) : null;
        return { name: skillName, dir, portable: isPortable(fs.readFileSync(skillFile, 'utf-8')), overridePath };
    }
    return null;
}

/** R3.3: un override declara intención de export; sin portable es contrato a medias. */
function assertOverrideConsistency(s: ResolvedSkill): void {
    if (s.overridePath && !s.portable) {
        throw new Error(
            `Inconsistent metadata for skill "${s.name}": ${OVERRIDE_FILE} exists but SKILL.md does not declare portable: true.`
        );
    }
}

export function resolveExport(requested: string, roots: string[]): ExportResolution {
    const bundles = discoverAllBundles(roots);

    if (bundles.some((b) => b.name === requested)) {
        const skills: ResolvedSkill[] = [];
        const skipped: string[] = [];
        for (const name of resolveBundleSkills(requested, bundles)) {
            const s = locate(name, roots);
            if (!s) throw new Error(`Bundle "${requested}" lists skill "${name}" but no content root contains skills/${name}/SKILL.md.`);
            assertOverrideConsistency(s);
            if (s.portable) skills.push(s);
            else skipped.push(s.name);
        }
        if (skills.length === 0) {
            throw new Error(`Bundle "${requested}" has no portable skills — nothing to export. Mark skills with portable: true in their frontmatter.`);
        }
        return { kind: 'bundle', requested, skills, skipped: skipped.sort() };
    }

    const single = locate(requested, roots);
    if (!single) {
        const available = bundles.map((b) => b.name).join(', ') || '(none)';
        throw new Error(`"${requested}" is neither a bundle nor a skill in any content root. Available bundles: ${available}.`);
    }
    assertOverrideConsistency(single);
    if (!single.portable) {
        throw new Error(
            `Skill "${requested}" is not portable (no portable: true in its frontmatter) — it likely depends on filesystem/git and would break on claude.ai.`
        );
    }
    return { kind: 'skill', requested, skills: [single], skipped: [] };
}
