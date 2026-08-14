import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePackSource } from '../../../../src/commands/sensors/compatibility/pack-source';

describe('resolvePackSource', () => {
    it('uses the first registry containing the exact contained pack file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-'));
        try {
            const first = path.join(root, 'first');
            const second = path.join(root, 'second');
            for (const registry of [first, second]) fs.mkdirSync(path.join(registry, 'sensor-packs', 'js-ts'), { recursive: true });
            fs.writeFileSync(path.join(first, 'sensor-packs', 'js-ts', 'pack.json'), '{"from":"first"}');
            fs.writeFileSync(path.join(second, 'sensor-packs', 'js-ts', 'pack.json'), '{"from":"second"}');
            expect(resolvePackSource('js-ts', { registries: [{ name: 'first', remote: '', contentRoot: first }, { name: 'second', remote: '', contentRoot: second }] }).content).toContain('first');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects symlink, non-regular, and escaping pack sources', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-bad-'));
        try {
            const packs = path.join(root, 'sensor-packs');
            fs.mkdirSync(packs, { recursive: true });
            fs.symlinkSync(path.join(root, 'outside.json'), path.join(packs, 'js-ts'));
            fs.writeFileSync(path.join(root, 'outside.json'), '{}');
            expect(() => resolvePackSource('js-ts', { registries: [{ name: 'bad', remote: '', contentRoot: root }] })).toThrow(/symbolic|contain/i);
            expect(() => resolvePackSource('../escape', { registries: [] })).toThrow(/pack/i);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects a symlinked pack directory even when its target remains inside the registry', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-internal-link-'));
        try {
            const packRoot = path.join(root, 'sensor-packs');
            const target = path.join(packRoot, 'js-ts-source');
            fs.mkdirSync(target, { recursive: true });
            fs.writeFileSync(path.join(target, 'pack.json'), '{}');
            fs.symlinkSync(target, path.join(packRoot, 'js-ts'), 'dir');

            expect(() => resolvePackSource('js-ts', { registries: [{ name: 'linked', remote: '', contentRoot: root }] }))
                .toThrow(/symbolic|symlink/i);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
