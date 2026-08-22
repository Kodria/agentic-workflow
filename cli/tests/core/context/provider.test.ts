// cli/tests/core/context/provider.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildContext, sha256 } from '../../../src/core/context/provider';

function tmpRegistry(skillBody: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
    const dir = path.join(root, 'skills/using-awm');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillBody);
    return root;
}

describe('sha256', () => {
    it('is deterministic and hex-encoded', () => {
        expect(sha256('hello')).toBe(sha256('hello'));
        expect(sha256('hello')).toMatch(/^[0-9a-f]{64}$/);
        expect(sha256('hello')).not.toBe(sha256('world'));
    });
});

describe('buildContext', () => {
    it('embeds the using-awm body, version from frontmatter, and active extensions', () => {
        const reg = tmpRegistry('---\nname: using-awm\nversion: "2.1.0"\n---\nBODY-MARKER');
        const ctx = buildContext({ registryRoot: reg, profileExtensions: ['frontend', 'docs'] });
        expect(ctx.markdown).toContain('BODY-MARKER');
        expect(ctx.markdown).toContain('frontend, docs');
        expect(ctx.sourceVersion).toBe('2.1.0');
        expect(ctx.contentHash).toBe(sha256(ctx.markdown));
    });

    it('falls back to version 0.0.0 when frontmatter has no version', () => {
        const reg = tmpRegistry('---\nname: using-awm\n---\nBODY');
        expect(buildContext({ registryRoot: reg, profileExtensions: [] }).sourceVersion).toBe('0.0.0');
    });

    it('throws an actionable error when the using-awm skill is missing', () => {
        const reg = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        expect(() => buildContext({ registryRoot: reg, profileExtensions: [] })).toThrow('using-awm skill not found');
    });
});

function registryRootWithSkill(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-'));
    fs.mkdirSync(path.join(root, 'skills/using-awm'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'skills/using-awm/SKILL.md'),
        '---\nname: using-awm\nversion: "1.3.0"\n---\n\n# Using Skills\n',
    );
    return root;
}

describe('buildContext — declared orchestrators', () => {
    const created: string[] = [];
    afterEach(() => { for (const r of created.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

    it('compone los descriptores declarados en el payload', () => {          // verifies R1.1
        const root = registryRootWithSkill();
        created.push(root);
        const ctx = buildContext({
            registryRoot: root,
            profileExtensions: [],
            declaredOrchestrators: [
                { name: 'mi-proceso', appliesWhen: 'cuando arranco una tarea', terminatesTo: 'development-process' },
            ],
        });
        expect(ctx.markdown).toContain('mi-proceso');
        expect(ctx.markdown).toContain('cuando arranco una tarea');
        expect(ctx.markdown).toContain('development-process');
        expect(ctx.markdown).toContain('# Using Skills');   // el skill sigue entero
    });

    it('sin declarados, el payload es identico al de antes del cambio', () => {  // verifies R6.1
        const root = registryRootWithSkill();
        created.push(root);
        const withEmpty = buildContext({ registryRoot: root, profileExtensions: [], declaredOrchestrators: [] });
        const withNone = buildContext({ registryRoot: root, profileExtensions: [] });
        expect(withEmpty.markdown).toEqual(withNone.markdown);
        expect(withEmpty.markdown).not.toContain('Declared orchestrators');
        expect(withEmpty.contentHash).toEqual(withNone.contentHash);
    });

    it('el hash cambia cuando cambian los declarados', () => {                    // verifies R1.1
        const root = registryRootWithSkill();
        created.push(root);
        const a = buildContext({ registryRoot: root, profileExtensions: [], declaredOrchestrators: [] });
        const b = buildContext({
            registryRoot: root, profileExtensions: [],
            declaredOrchestrators: [{ name: 'x', appliesWhen: 'y', terminatesTo: 'none' }],
        });
        expect(a.contentHash).not.toEqual(b.contentHash);
    });
});

// NOTE: the 'generic robustness invariant' test that validated specific prose in the
// using-awm SKILL.md has been removed — content now lives in awm-baseline-registry
// (an external repo), not in this monorepo. Content-level tests belong there.
