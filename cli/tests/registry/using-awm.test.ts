import fs from 'fs';
import path from 'path';

describe('using-awm skill', () => {
    const skillPath = path.join(__dirname, '../../../registry/skills/using-awm/SKILL.md');

    it('exists at the expected path', () => {
        expect(fs.existsSync(skillPath)).toBe(true);
    });

    it('has a valid frontmatter with required fields', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        expect(match).not.toBeNull();

        const frontmatter = match![1];
        expect(frontmatter).toMatch(/^name:\s*using-awm\s*$/m);
        expect(frontmatter).toMatch(/^description:\s*.+$/m);
    });

    it('does NOT contain a model: field (aligned with canon)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).not.toMatch(/^model:\s*/m);
    });

    it('uses tiered triggering (no blanket 1% mandate)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).not.toMatch(/1%/);
        expect(content).toMatch(/always|siempre/i);
        expect(content).toMatch(/signal|señal/i);
    });

    it('contains SUBAGENT-STOP block (prevents recursion)', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/<SUBAGENT-STOP>/);
    });

    it('points to development-process as default orchestrator', () => {
        const content = fs.readFileSync(skillPath, 'utf-8');
        expect(content).toMatch(/development-process/);
    });
});
