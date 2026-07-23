import fs from 'fs';
import path from 'path';
import os from 'os';
import { runExportCommand } from '../../src/commands/export';
import { ZipFn } from '../../src/core/export/types';

const okZip: ZipFn = (cwd, zipName) => {
    fs.writeFileSync(path.join(cwd, zipName), 'fake-zip');
    return { ok: true, missing: false };
};

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cmd-root-'));
    fs.mkdirSync(path.join(root, 'bundles/dev'), { recursive: true });
    fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [{ name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' }],
    }));
    fs.writeFileSync(path.join(root, 'bundles/dev/bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', scope: 'baseline', dependsOn: [],
        skills: ['proc-skill', { name: 'mermaid', onSignal: true }], workflows: [], agents: [],
    }));
    const mk = (name: string, fm: string[]) => {
        const dir = path.join(root, 'skills', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${fm.join('\n')}\n---\nBody.\n`);
    };
    mk('proc-skill', ['name: proc-skill', 'description: "P."']);
    mk('mermaid', ['name: mermaid', 'portable: true', 'description: "D."']);
    return root;
}

describe('runExportCommand (salida al usuario)', () => {
    let root: string;
    let out: string;
    let logs: string[];
    const log = (m: string) => logs.push(m);

    beforeEach(() => {
        root = makeRoot();
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cmd-out-'));
        logs = [];
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(out, { recursive: true, force: true });
    });

    it('reports exported skills and visible skips', () => {  // verifies R2.2
        runExportCommand('dev', { target: 'claude-ai', out }, { roots: [root], zip: okZip, log });
        const text = logs.join('\n');
        expect(text).toMatch(/exported bundle.*dev/i);
        expect(text).toContain('mermaid');
        expect(text).toMatch(/skipped.*proc-skill/i);
    });

    it('prints the manual-zip instruction when the binary is missing', () => {  // verifies R4.2
        const missingZip: ZipFn = () => ({ ok: false, missing: true });
        runExportCommand('dev', { target: 'claude-ai', out }, { roots: [root], zip: missingZip, log });
        expect(logs.join('\n')).toMatch(/zip -r/);
    });

    it('propagates unknown-target errors (commander action will exit(1))', () => {  // verifies R1.3
        expect(() => runExportCommand('dev', { target: 'nope', out }, { roots: [root], zip: okZip, log }))
            .toThrow(/Valid targets/);
    });
});
