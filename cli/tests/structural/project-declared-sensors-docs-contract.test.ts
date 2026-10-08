import fs from 'fs';
import path from 'path';

/**
 * CMD-DOCS — RF-5.1 / RF-5.2 (project-declared sensors documentation).
 *
 * Requires a sibling checkout of awm-baseline-registry next to this repo.
 * Missing checkout fails loudly (no silent skip).
 */

const repoRoot = path.resolve(__dirname, '../../..');
const cliReferencePath = path.join(repoRoot, 'docs', 'cli-reference.md');
const setupSensorsPath = path.join(
    repoRoot,
    '..',
    'awm-baseline-registry',
    'skills',
    'setup-sensors',
    'SKILL.md',
);

function sensorsSection(text: string): string {
    const start = text.indexOf('## Sensors (per-project computational checks)');
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const nextH2 = rest.search(/\n## (?!Sensors)/);
    return nextH2 === -1 ? rest : rest.slice(0, nextH2);
}

/** Skill body after YAML frontmatter (content after the closing `---`). */
function skillBody(skill: string): string {
    const match = skill.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
        throw new Error('setup-sensors SKILL.md missing YAML frontmatter delimiters');
    }
    return match[1];
}

/** Named H2 section inside the skill body; fails if the heading is absent. */
function skillSection(body: string, heading: string): string {
    const start = body.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = body.slice(start);
    const nextH2 = rest.search(/\n## /);
    return nextH2 === -1 ? rest : rest.slice(0, nextH2);
}

describe('project-declared sensors docs contract (CMD-DOCS)', () => {
    it('cli-reference sensors section documents project markers, provenance, exit-code, and non-gating (RF-5.2)', () => {
        const text = fs.readFileSync(cliReferencePath, 'utf8');
        const section = sensorsSection(text);

        expect(section).toMatch(/source:\s*"project"|source"\s*:\s*"project"/);
        expect(section).toContain('project-declared');
        expect(section).toContain('exit-code');
        expect(section).toMatch(
            /provenance[\s\S]{0,220}(?:does not|never)\s+(?:block|blocks)[\s\S]{0,100}(?:unattended|gates)/i,
        );
    });

    it('setup-sensors skill documents project vs pack, JSON example, and non-gating provenance (RF-5.1)', () => {
        if (!fs.existsSync(setupSensorsPath)) {
            throw new Error(
                `Sibling registry checkout missing: expected ${setupSensorsPath}. `
                + 'Clone awm-baseline-registry next to agentic-workflow (same parent directory).',
            );
        }

        const skill = fs.readFileSync(setupSensorsPath, 'utf8');
        const body = skillBody(skill);
        // Scope when-to-use / project-vs-packs (and related RF-5.1 prose) to the
        // dedicated body section — frontmatter description must not satisfy these.
        const projectVsPacks = skillSection(body, '## Project sensors vs packs');

        expect(projectVsPacks).toMatch(
            /Prefer a \*\*pack\*\*|Declare a \*\*project sensor\*\*|when the check is project-owned/i,
        );
        expect(projectVsPacks).toMatch(/"source"\s*:\s*"project"/);
        expect(projectVsPacks).toMatch(/```json[\s\S]*?"source"\s*:\s*"project"[\s\S]*?```/);
        expect(projectVsPacks).toMatch(
            /project-declared[\s\S]{0,220}(?:does not|never)\s+(?:block|blocks)[\s\S]{0,100}unattended/i,
        );
    });
});
