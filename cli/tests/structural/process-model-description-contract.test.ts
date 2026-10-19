import fs from 'fs';
import path from 'path';

const DESIGN = path.resolve(__dirname, '../../../docs/plans/2026-08-23-process-lifecycle-design.md');

function artifactSection(): string {
    const text = fs.readFileSync(DESIGN, 'utf8');
    const start = text.indexOf('### El artefacto');
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf('\n### ', start + 1);
    return text.slice(start, end === -1 ? undefined : end);
}

describe('process-model contract documents the optional description (PD-4)', () => {
    it('lists description in the frontmatter block as optional', () => {
        const section = artifactSection();
        expect(section).toMatch(/^description: <texto de una línea> {2}# opcional$/m);
    });

    it('states the rules the parser enforces and why the field exists', () => {
        /** Whitespace-normalized so re-wrapping the prose never breaks a pinned phrase. */
        const section = artifactSection().replace(/\s+/g, ' ');
        expect(section).toContain('#### Enmienda 2026-10-18 — `description` opcional');
        expect(section).toContain('una sola línea');
        expect(section).toContain('1024 caracteres');
        expect(section).toContain('Codex');
        expect(section).toContain('único campo opcional');
        expect(section).toContain('parser YAML');
        expect(section).not.toContain('no reemplaza a un parser YAML');
        expect(section).toContain('code points');
    });
});
