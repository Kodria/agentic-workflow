import fs from 'fs';
import os from 'os';
import path from 'path';
import { injectProjectConstitution } from '../../../src/core/context/project-constitution-inject';

function tmpProject(withConstitution: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-const-'));
    if (withConstitution) fs.writeFileSync(path.join(root, 'CONSTITUTION.md'), '# rules\n');
    return root;
}

describe('injectProjectConstitution (#6)', () => {
    it('writes project-local opencode.json with a relative CONSTITUTION.md instruction', () => {
        const root = tmpProject(true);
        try {
            expect(injectProjectConstitution(root, 'opencode')).toBe('injected');
            const cfg = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8'));
            expect(cfg.instructions).toEqual(['CONSTITUTION.md']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('is idempotent (no duplicate entry on a second run)', () => {
        const root = tmpProject(true);
        try {
            injectProjectConstitution(root, 'opencode');
            expect(injectProjectConstitution(root, 'opencode')).toBe('already');
            const cfg = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8'));
            expect(cfg.instructions).toEqual(['CONSTITUTION.md']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('preserves existing instructions and appends', () => {
        const root = tmpProject(true);
        try {
            fs.writeFileSync(path.join(root, 'opencode.json'),
                JSON.stringify({ $schema: 'x', instructions: ['./AGENTS.md'] }, null, 2));
            expect(injectProjectConstitution(root, 'opencode')).toBe('injected');
            const cfg = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf-8'));
            expect(cfg.instructions).toEqual(['./AGENTS.md', 'CONSTITUTION.md']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns no-constitution and writes nothing when CONSTITUTION.md is absent', () => {
        const root = tmpProject(false);
        try {
            expect(injectProjectConstitution(root, 'opencode')).toBe('no-constitution');
            expect(fs.existsSync(path.join(root, 'opencode.json'))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns not-applicable for Claude (hook delivers it) and writes nothing', () => {
        const root = tmpProject(true);
        try {
            expect(injectProjectConstitution(root, 'claude-code')).toBe('not-applicable');
            expect(fs.existsSync(path.join(root, 'opencode.json'))).toBe(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('throws a clear error when instructions is a non-array', () => {
        const root = tmpProject(true);
        try {
            fs.writeFileSync(path.join(root, 'opencode.json'),
                JSON.stringify({ instructions: 'oops' }));
            expect(() => injectProjectConstitution(root, 'opencode')).toThrow(/must be an array/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
