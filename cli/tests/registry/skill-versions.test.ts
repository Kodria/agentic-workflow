import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.join(__dirname, '../../../registry/skills');

function frontmatter(file: string): string {
    const raw = fs.readFileSync(file, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : '';
}

describe('skill frontmatter version', () => {
    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .filter((e) => fs.existsSync(path.join(SKILLS_DIR, e.name, 'SKILL.md')))
        .map((e) => e.name);

    it('finds the 44 skills', () => {
        expect(dirs.length).toBe(44);
    });

    it.each(dirs)('skill "%s" declares a semver version', (name) => {
        const fm = frontmatter(path.join(SKILLS_DIR, name, 'SKILL.md'));
        expect(fm).toMatch(/^version:\s*["']?\d+\.\d+\.\d+["']?\s*$/m);
    });
});
