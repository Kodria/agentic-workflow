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

        // Prefer pack when the check is pack-covered; declare source:"project" for
        // project-owned checks that packs do not (and should not) certify.
        expect(skill).toMatch(/project sensors? vs\.?\s+packs|when to (?:use|declare) (?:a )?project sensor|project-declared sensor versus|versus when to use (?:or extend )?a pack/i);
        expect(skill).toMatch(/"source"\s*:\s*"project"/);
        expect(skill).toMatch(/```json[\s\S]*?"source"\s*:\s*"project"[\s\S]*?```/);
        expect(skill).toMatch(
            /project-declared[\s\S]{0,220}(?:does not|never)\s+(?:block|blocks)[\s\S]{0,100}unattended/i,
        );
    });
});
