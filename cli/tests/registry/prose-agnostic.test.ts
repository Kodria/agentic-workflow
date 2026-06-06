import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('skill prose stays agent-agnostic (#5)', () => {
    const files = ['writing-skills/SKILL.md', 'project-constitution/SKILL.md'];
    for (const f of files) {
        it(`${f} does not push the model to the ~/.claude/skills path`, () => {
            const txt = fs.readFileSync(path.join(REPO_ROOT, 'registry/skills', f), 'utf-8');
            expect(txt).not.toMatch(/~\/\.claude\/skills/);
            expect(txt).not.toMatch(/\.claude\/settings\.json/);
        });
    }
});
