import fs from 'fs';
import path from 'path';

/**
 * CMD-DOCS — RF-5.1 / RF-5.2 (project-declared sensors documentation).
 *
 * Resolves awm-baseline-registry from (in order):
 * 1. `AWM_BASELINE_REGISTRY_ROOT` (CI docs checkout)
 * 2. nested `repoRoot/awm-baseline-registry` (CI support-matrix layout)
 * 3. sibling `repoRoot/../awm-baseline-registry` (maintainer workspace)
 *
 * Prefer a checkout that already contains RF-5.1 (`## Project sensors vs packs`).
 * Missing / too-old checkouts fail loudly (no silent skip).
 */

const repoRoot = path.resolve(__dirname, '../../..');
const cliReferencePath = path.join(repoRoot, 'docs', 'cli-reference.md');
const RF51_HEADING = '## Project sensors vs packs';

function setupSensorsSkillPath(registryRoot: string): string {
    return path.join(registryRoot, 'skills', 'setup-sensors', 'SKILL.md');
}

function resolveSetupSensorsPath(): string {
    const envRoot = process.env.AWM_BASELINE_REGISTRY_ROOT?.trim();
    // When CI/maintainer sets the override, that root is authoritative (no silent
    // fallback to a nested immutable pin that lacks RF-5.1 prose).
    const candidates = envRoot
        ? [path.resolve(envRoot)]
        : [
            path.join(repoRoot, 'awm-baseline-registry'),
            path.join(repoRoot, '..', 'awm-baseline-registry'),
        ];

    const existing = candidates
        .map(root => ({ root, skill: setupSensorsSkillPath(root) }))
        .filter(entry => fs.existsSync(entry.skill));

    if (existing.length === 0) {
        throw new Error(
            'Baseline registry checkout missing for RF-5.1 docs contract. Tried:\n'
            + candidates.map(root => `  - ${setupSensorsSkillPath(root)}`).join('\n')
            + '\nClone awm-baseline-registry as a sibling, nest it under the CLI repo, '
            + 'or set AWM_BASELINE_REGISTRY_ROOT to a checkout that includes setup-sensors RF-5.1.',
        );
    }

    const withRf51 = existing.find(entry => fs.readFileSync(entry.skill, 'utf8').includes(RF51_HEADING));
    if (!withRf51) {
        throw new Error(
            'Baseline registry checkout is present but too old for RF-5.1 '
            + `(missing ${RF51_HEADING}). Checked:\n`
            + existing.map(entry => `  - ${entry.skill}`).join('\n')
            + '\nPoint AWM_BASELINE_REGISTRY_ROOT at a registry tip that documents project-declared sensors '
            + '(coordinated awm-baseline-registry PR), without replacing the immutable v2.0.1 support-matrix pin.',
        );
    }
    return withRf51.skill;
}

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
        // Optional pack (omit or null) — RF-5.2 clause already in cli-reference prose.
        expect(section).toMatch(
            /[Pp]ack may be omitted or set\s+to\s+`?null`?[\s\S]{0,120}project-declared/i,
        );
        // JSON-vs-schema diagnostics distinction — RF-5.2.
        expect(section).toMatch(
            /not valid JSON[\s\S]{0,220}schema-invalid/i,
        );
    });

    it('setup-sensors skill documents project vs pack, JSON example, and non-gating provenance (RF-5.1)', () => {
        const setupSensorsPath = resolveSetupSensorsPath();
        const skill = fs.readFileSync(setupSensorsPath, 'utf8');
        const body = skillBody(skill);
        // Scope when-to-use / project-vs-packs (and related RF-5.1 prose) to the
        // dedicated body section — frontmatter description must not satisfy these.
        const projectVsPacks = skillSection(body, RF51_HEADING);

        // Both guidance clauses are required — Prefer|Declare OR let either alone satisfy.
        expect(projectVsPacks).toMatch(/Prefer a \*\*pack\*\*/);
        expect(projectVsPacks).toMatch(/Declare a \*\*project sensor\*\*\s+when\s+the check is project-owned/i);
        expect(projectVsPacks).toMatch(/"source"\s*:\s*"project"/);
        expect(projectVsPacks).toMatch(/```json[\s\S]*?"source"\s*:\s*"project"[\s\S]*?```/);
        expect(projectVsPacks).toMatch(
            /project-declared[\s\S]{0,220}(?:does not|never)\s+(?:block|blocks)[\s\S]{0,100}unattended/i,
        );
    });
});
