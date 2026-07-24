import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveExport } from '../../../src/core/export/resolve';

/** Content root falso: catalog + bundle dev + 3 skills. */
function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-export-root-'));
    fs.mkdirSync(path.join(root, 'bundles/dev'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.writeFileSync(path.join(root, 'bundles/dev/bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: ['proc-skill', { name: 'mermaid', onSignal: true }, { name: 'ported', onSignal: true }],
        workflows: [], agents: [],
    }));
    const mk = (name: string, fm: string[]) => {
        const dir = path.join(root, 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm.join('\n')}\n---\nBody.\n`);
        return dir;
    };
    mk('proc-skill', ['name: proc-skill', 'description: "Process skill."']); // NO portable
    mk('mermaid', ['name: mermaid', 'portable: true', 'description: "Diagrams."']);
    const ported = mk('ported', ['name: ported', 'portable: true', 'description: "Ported."']);
    fs.writeFileSync(path.join(ported, 'port.claude-ai.md'), '---\nname: ported\ndescription: "Custom."\n---\nCustom body.\n');
    return root;
}

describe('resolveExport', () => {
    let root: string;
    beforeEach(() => { root = makeRoot(); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('resolves a bundle: portable skills in, non-portable listed as skipped', () => {  // verifies R1, R2, R2.2
        const res = resolveExport('dev', [root]);
        expect(res.kind).toBe('bundle');
        expect(res.skills.map((s) => s.name).sort()).toEqual(['mermaid', 'ported']);
        expect(res.skipped).toEqual(['proc-skill']);
    });

    it('detects the override path when present', () => {  // verifies R3 (input for)
        const res = resolveExport('dev', [root]);
        const ported = res.skills.find((s) => s.name === 'ported')!;
        expect(ported.overridePath).toBe(path.join(root, 'skills/ported/port.claude-ai.md'));
        const mermaid = res.skills.find((s) => s.name === 'mermaid')!;
        expect(mermaid.overridePath).toBeNull();
    });

    it('resolves an individual portable skill', () => {  // verifies R1.1
        const res = resolveExport('mermaid', [root]);
        expect(res.kind).toBe('skill');
        expect(res.skills).toHaveLength(1);
        expect(res.skipped).toEqual([]);
    });

    it('fails on an explicitly requested non-portable skill', () => {  // verifies R2.1
        expect(() => resolveExport('proc-skill', [root])).toThrow(/portable/);
    });

    it('fails on unknown name, listing available bundles', () => {  // verifies R1.2
        expect(() => resolveExport('nope', [root])).toThrow(/dev/);
    });

    it('fails when a bundle has zero portable skills', () => {  // verifies R2.3
        fs.writeFileSync(path.join(root, 'skills/mermaid/SKILL.md'), '---\nname: mermaid\ndescription: "D."\n---\nB.\n');
        fs.writeFileSync(path.join(root, 'skills/ported/SKILL.md'), '---\nname: ported\ndescription: "P."\n---\nB.\n');
        fs.rmSync(path.join(root, 'skills/ported/port.claude-ai.md'));
        expect(() => resolveExport('dev', [root])).toThrow(/no portable skills/i);
    });

    it('fails on override without portable: true (inconsistent metadata)', () => {  // verifies R3.3
        fs.writeFileSync(path.join(root, 'skills/ported/SKILL.md'), '---\nname: ported\ndescription: "P."\n---\nB.\n');
        expect(() => resolveExport('ported', [root])).toThrow(/inconsistent/i);
    });

    it('fails on override without portable: true when resolved via a bundle (assertOverrideConsistency bundle-loop path)', () => {  // verifies R3.3 via bundle
        fs.writeFileSync(path.join(root, 'skills/ported/SKILL.md'), '---\nname: ported\ndescription: "P."\n---\nB.\n');
        expect(() => resolveExport('dev', [root])).toThrow(/inconsistent/i);
    });
});
