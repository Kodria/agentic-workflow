// cli/tests/core/context/provider.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildContext, sha256 } from '../../../src/core/context/provider';

function tmpRegistry(skillBody: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
    const dir = path.join(root, 'registry/skills/using-awm');
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
