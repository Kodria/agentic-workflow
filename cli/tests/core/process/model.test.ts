import { parseProcessFrontmatter } from '../../../src/core/process/model';

const valid = `---
awm: process-model
schema: 1
name: ejemplo-proceso
status: draft
entry_point: true
terminates_to: none
created: 2026-08-23
updated: 2026-08-23
---

# Ejemplo
`;

describe('parseProcessFrontmatter', () => {
    it('acepta el modelo canónico', () => {                                    // verifies R1.2
        const r = parseProcessFrontmatter(valid, 'skills/x/SKILL.md');
        expect(r.diagnostics).toEqual([]);
        expect(r.model).toEqual(expect.objectContaining({
            schema: 1, name: 'ejemplo-proceso', status: 'draft', entryPoint: true, terminatesTo: 'none',
        }));
    });

    it('no infiere: sin el discriminador no es un modelo', () => {              // verifies R1.2
        const r = parseProcessFrontmatter(valid.replace('awm: process-model\n', ''), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics).toEqual([]);   // no es un error: es "no es un modelo"
    });

    it('se detiene ante un schema más nuevo en vez de leerlo como el anterior', () => {  // verifies R1.4
        const r = parseProcessFrontmatter(valid.replace('schema: 1', 'schema: 2'), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/newer/i);
    });

    it.each(['0', '-1', '1.5', 'uno'])('rechaza schema no-entero-positivo %s', (bad) => {  // verifies R1.3
        const r = parseProcessFrontmatter(valid.replace('schema: 1', `schema: ${bad}`), 'skills/x/SKILL.md');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics).not.toEqual([]);
    });

    it.each(['active', 'draft'])('admite status %s', (s) => {                   // verifies R1.9
        expect(parseProcessFrontmatter(valid.replace('status: draft', `status: ${s}`), 'p').model?.status).toBe(s);
    });

    it('rechaza un status inventado', () => {                                   // verifies R1.9
        const r = parseProcessFrontmatter(valid.replace('status: draft', 'status: published'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/status/);
    });

    it('rechaza un campo desconocido en vez de ignorarlo', () => {              // verifies R1.10
        const r = parseProcessFrontmatter(valid.replace('created:', 'api_token: ghp_x\ncreated:'), 'p');
        expect(r.model).toBeUndefined();
        expect(r.diagnostics.join(' ')).toMatch(/unknown field/i);
    });

    it('rechaza un name que no es slug', () => {                                // verifies R1.2
        const r = parseProcessFrontmatter(valid.replace('name: ejemplo-proceso', 'name: ../../etc/passwd'), 'p');
        expect(r.model).toBeUndefined();
    });

    it('nunca lanza ante entrada basura', () => {                               // verifies R1.4
        for (const junk of ['', '---\n', '---\n\x00\n---\n', 'no frontmatter']) {
            expect(() => parseProcessFrontmatter(junk, 'p')).not.toThrow();
        }
    });
});
