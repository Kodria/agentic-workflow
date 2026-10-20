import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    AWM_GITIGNORE_BEGIN,
    AWM_GITIGNORE_END,
    renderManagedBlock,
    upsertAwmGitignore,
} from '../../src/core/awm-gitignore';

describe('awm-gitignore managed block', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-gi-'));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('renders the canonical managed block with versioned allowlist entries', () => {
        const block = renderManagedBlock();
        expect(block).toContain(AWM_GITIGNORE_BEGIN);
        expect(block).toContain(AWM_GITIGNORE_END);
        expect(block).toContain('.awm/*');
        expect(block).toContain('!.awm/sensors.json');
        expect(block).toContain('!.awm/sensors.baseline.json');
        expect(block).toContain('!.awm/profile.json');
        expect(block).toContain('!.awm/context-budget.json');
        expect(block).toContain('!.awm/context/');
        expect(block).toContain('!.awm/context/index.json');
    });

    it('creates .gitignore with the managed block and is idempotent', () => {
        upsertAwmGitignore(tmp);
        const first = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
        expect(first).toContain(AWM_GITIGNORE_BEGIN);
        expect(first).toContain(AWM_GITIGNORE_END);
        upsertAwmGitignore(tmp);
        expect(fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8')).toBe(first);
    });

    it('migrates bare .awm/ and .awm lines into the managed block without dropping unrelated rules', () => {
        fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n.awm/\ndist\n');
        upsertAwmGitignore(tmp);
        const text = fs.readFileSync(path.join(tmp, '.gitignore'), 'utf8');
        expect(text).toContain('node_modules');
        expect(text).toContain('dist');
        expect(text).toContain(AWM_GITIGNORE_BEGIN);
        const outside = text.slice(0, text.indexOf(AWM_GITIGNORE_BEGIN));
        expect(outside.split('\n').map((l) => l.trim()).filter(Boolean)).not.toContain('.awm/');
        expect(outside.split('\n').map((l) => l.trim()).filter(Boolean)).not.toContain('.awm');
    });

    it('refuses a symlink .gitignore', () => {
        const target = path.join(tmp, 'ignore-target');
        fs.writeFileSync(target, 'x\n');
        fs.symlinkSync(target, path.join(tmp, '.gitignore'));
        expect(() => upsertAwmGitignore(tmp)).toThrow(/symlink/i);
    });
});
