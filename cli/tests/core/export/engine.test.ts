import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExport, EXPORT_TARGETS } from '../../../src/core/export';
import { ZipFn } from '../../../src/core/export/types';

const okZip: ZipFn = (cwd, zipName) => {
    fs.writeFileSync(path.join(cwd, zipName), 'fake-zip');
    return { ok: true, missing: false };
};

/** Mismo fixture que resolve.test.ts (root falso con bundle dev + 3 skills). */
function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-engine-root-'));
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
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm.join('\n')}\n---\nBody of ${name}.\n`);
        return dir;
    };
    mk('proc-skill', ['name: proc-skill', 'description: "Process skill."']);
    const mermaid = mk('mermaid', ['name: mermaid', 'version: "1.0.0"', 'portable: true', 'description: "Diagrams."']);
    fs.mkdirSync(path.join(mermaid, 'references'));
    fs.writeFileSync(path.join(mermaid, 'references/flow.md'), 'flow reference bytes');
    const ported = mk('ported', ['name: ported', 'portable: true', 'description: "Ported."']);
    fs.writeFileSync(path.join(ported, 'port.claude-ai.md'), '---\nname: ported\ndescription: "Custom port."\n---\nOverride body, verbatim.\n');
    return root;
}

describe('runExport (engine end-to-end)', () => {
    let root: string;
    let out: string;
    beforeEach(() => {
        root = makeRoot();
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-engine-out-'));
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('exports a bundle: transform for mermaid, verbatim override for ported, skips proc-skill', () => {  // verifies R1, R3, R3.1, R3.2
        const summary = runExport({ name: 'dev', out, roots: [root], zip: okZip });
        expect(summary.kind).toBe('bundle');
        expect(summary.exported.map((e) => e.name).sort()).toEqual(['mermaid', 'ported']);
        expect(summary.skipped).toEqual(['proc-skill']);

        const mermaidMd = fs.readFileSync(path.join(out, 'claude-ai/mermaid/SKILL.md'), 'utf-8');
        expect(mermaidMd).not.toMatch(/^version:/m);
        expect(mermaidMd).not.toMatch(/^portable:/m);
        expect(mermaidMd).toContain('defer to the registry');
        expect(fs.readFileSync(path.join(out, 'claude-ai/mermaid/references/flow.md'), 'utf-8')).toBe('flow reference bytes');

        const portedMd = fs.readFileSync(path.join(out, 'claude-ai/ported/SKILL.md'), 'utf-8');
        expect(portedMd).toBe('---\nname: ported\ndescription: "Custom port."\n---\nOverride body, verbatim.\n');  // cero transforms
    });

    it('rejects an unknown target listing the valid ones', () => {  // verifies R1.3
        expect(() => runExport({ name: 'dev', target: 'hermes', out, roots: [root], zip: okZip }))
            .toThrow(new RegExp(EXPORT_TARGETS.join('|')));
    });

    it('wraps transform errors with the offending file path', () => {  // verifies R3.4
        // portable: true se mantiene (si no, resolve.ts corta antes por R2.x y nunca llega
        // a transform.ts); lo que rompe es la ausencia de "description:", que transform.ts exige.
        fs.writeFileSync(path.join(root, 'skills/mermaid/SKILL.md'), '---\nname: mermaid\nportable: true\n---\nNo description field.\n');
        expect(() => runExport({ name: 'mermaid', out, roots: [root], zip: okZip }))
            .toThrow(/mermaid[/\\]SKILL\.md/);
    });

    it('reads only the provided roots (never ~/.claude/skills)', () => {  // verifies R1.4
        // La lectura sale exclusivamente de roots: un root vacío no resuelve nada.
        // Control negativo real: contentRoots() (el fallback al registry instalado)
        // no debe invocarse en absoluto cuando opts.roots viene dado explícitamente.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const registries = require('../../../src/core/registries');
        const spy = jest.spyOn(registries, 'contentRoots');
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-root-'));
        expect(() => runExport({ name: 'mermaid', out, roots: [empty], zip: okZip })).toThrow(/neither a bundle nor a skill/);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
        fs.rmSync(empty, { recursive: true, force: true });
    });

    it('defaults --out to ./awm-export/<target> under the current working directory', () => {  // verifies R4
        const cwdTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-engine-cwd-'));
        const originalCwd = process.cwd();
        process.chdir(cwdTmp);
        try {
            const summary = runExport({ name: 'mermaid', roots: [root], zip: okZip });  // sin `out`
            expect(summary.outDir).toBe(path.join(cwdTmp, 'awm-export', 'claude-ai'));
            expect(fs.existsSync(path.join(cwdTmp, 'awm-export/claude-ai/mermaid/SKILL.md'))).toBe(true);
        } finally {
            process.chdir(originalCwd);
            fs.rmSync(cwdTmp, { recursive: true, force: true });
        }
    });
});
