import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePackSource } from '../../../../src/commands/sensors/compatibility/pack-source';

function resolveWithoutNoFollow(...args: Parameters<typeof resolvePackSource>): ReturnType<typeof resolvePackSource> {
    let resolve: typeof resolvePackSource | undefined;
    jest.isolateModules(() => {
        jest.doMock('fs', () => {
            const actual = jest.requireActual<typeof fs>('fs');
            const constants = { ...actual.constants, O_NOFOLLOW: undefined };
            return { __esModule: true, default: { ...actual, constants }, ...actual, constants };
        });
        resolve = require('../../../../src/commands/sensors/compatibility/pack-source').resolvePackSource as typeof resolvePackSource;
    });
    jest.dontMock('fs');
    if (!resolve) throw new Error('portable pack source resolver could not be loaded');
    return resolve(...args);
}

function resolveWithoutNoFollowWithExactStats(...args: Parameters<typeof resolvePackSource>): ReturnType<typeof resolvePackSource> {
    let resolve: typeof resolvePackSource | undefined;
    jest.isolateModules(() => {
        jest.doMock('fs', () => {
            const actual = jest.requireActual<typeof fs>('fs');
            const constants = { ...actual.constants, O_NOFOLLOW: undefined };
            return { __esModule: true, default: { ...actual, constants }, ...actual, constants };
        });
        resolve = require('../../../../src/commands/sensors/compatibility/pack-source').resolvePackSource as typeof resolvePackSource;
    });
    jest.dontMock('fs');
    if (!resolve) throw new Error('portable exact-stat pack source resolver could not be loaded');
    return resolve(...args);
}

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

    it('rejects a symlinked registry content root', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-root-link-'));
        const target = path.join(root, 'target');
        const linked = path.join(root, 'linked');
        try {
            fs.mkdirSync(path.join(target, 'sensor-packs', 'js-ts'), { recursive: true });
            fs.writeFileSync(path.join(target, 'sensor-packs', 'js-ts', 'pack.json'), '{}');
            fs.symlinkSync(target, linked, 'dir');
            expect(() => resolvePackSource('js-ts', { registries: [{ name: 'linked', remote: '', contentRoot: linked }] }))
                .toThrow(/symbolic|symlink/i);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('opens the resolved pack with no-follow semantics before reading it', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-nofollow-'));
        const open = jest.spyOn(fs, 'openSync');
        try {
            const packFile = path.join(root, 'sensor-packs', 'js-ts', 'pack.json');
            fs.mkdirSync(path.dirname(packFile), { recursive: true });
            fs.writeFileSync(packFile, '{}');
            resolvePackSource('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] });
            const flags = open.mock.calls[0]?.[1];
            expect(typeof flags).toBe('number');
            expect((flags as number) & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
        } finally {
            open.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('resolves an inspected regular pack when no-follow is unavailable', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-portable-open-'));
        try {
            const packFile = path.join(root, 'sensor-packs', 'js-ts', 'pack.json');
            fs.mkdirSync(path.dirname(packFile), { recursive: true });
            fs.writeFileSync(packFile, '{"from":"portable"}');

            expect(resolveWithoutNoFollow('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] }).content)
                .toBe('{"from":"portable"}');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('uses exact bigint file identities for the portable safe-open fallback', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-bigint-'));
        const lstat = jest.spyOn(fs, 'lstatSync');
        const fstat = jest.spyOn(fs, 'fstatSync');
        try {
            const packFile = path.join(root, 'sensor-packs', 'js-ts', 'pack.json');
            fs.mkdirSync(path.dirname(packFile), { recursive: true });
            fs.writeFileSync(packFile, '{"from":"bigint"}');

            expect(resolveWithoutNoFollowWithExactStats('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] }).content)
                .toBe('{"from":"bigint"}');
            expect(lstat).toHaveBeenCalledWith(expect.any(String), { bigint: true });
            expect(fstat).toHaveBeenCalledWith(expect.any(Number), { bigint: true });
        } finally {
            lstat.mockRestore();
            fstat.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a parent-directory swap between inspection and no-follow open', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-parent-swap-'));
        const packDir = path.join(root, 'sensor-packs', 'js-ts');
        const movedPackDir = path.join(root, 'sensor-packs', 'js-ts-original');
        const packFile = path.join(packDir, 'pack.json');
        const originalOpen = fs.openSync.bind(fs);
        const open = jest.spyOn(fs, 'openSync');
        let swapped = false;
        try {
            fs.mkdirSync(packDir, { recursive: true });
            fs.writeFileSync(packFile, '{"from":"original"}');
            open.mockImplementation(((file: fs.PathLike, flags: number, mode?: number) => {
                if (!swapped && file === fs.realpathSync(packFile)) {
                    swapped = true;
                    fs.renameSync(packDir, movedPackDir);
                    fs.mkdirSync(packDir, { recursive: true });
                    fs.writeFileSync(packFile, '{"from":"replacement"}');
                }
                return originalOpen(file, flags, mode);
            }) as typeof fs.openSync);
            expect(() => resolvePackSource('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] }))
                .toThrow(/changed|identity|regular|safe/i);
        } finally {
            open.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('accepts a parent symlink replacement when it resolves to the inspected pack inode', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-same-inode-'));
        const packDir = path.join(root, 'sensor-packs', 'js-ts');
        const movedPackDir = path.join(root, 'sensor-packs', 'js-ts-original');
        const packFile = path.join(packDir, 'pack.json');
        const originalOpen = fs.openSync.bind(fs);
        const open = jest.spyOn(fs, 'openSync');
        let swapped = false;
        try {
            fs.mkdirSync(packDir, { recursive: true });
            fs.writeFileSync(packFile, '{"from":"original"}');
            open.mockImplementation(((file: fs.PathLike, flags: number, mode?: number) => {
                if (!swapped && file === fs.realpathSync(packFile)) {
                    swapped = true;
                    fs.renameSync(packDir, movedPackDir);
                    fs.symlinkSync(movedPackDir, packDir, 'dir');
                }
                return originalOpen(file, flags, mode);
            }) as typeof fs.openSync);
            expect(resolvePackSource('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] }).content)
                .toBe('{"from":"original"}');
        } finally {
            open.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects same-inode content growth between inspection and open', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-size-race-'));
        const packFile = path.join(root, 'sensor-packs', 'js-ts', 'pack.json');
        const originalOpen = fs.openSync.bind(fs);
        const open = jest.spyOn(fs, 'openSync');
        let changed = false;
        try {
            fs.mkdirSync(path.dirname(packFile), { recursive: true });
            fs.writeFileSync(packFile, '{"from":"original"}');
            open.mockImplementation(((file: fs.PathLike, flags: number, mode?: number) => {
                if (!changed && file === fs.realpathSync(packFile)) {
                    changed = true;
                    fs.appendFileSync(packFile, 'x');
                }
                return originalOpen(file, flags, mode);
            }) as typeof fs.openSync);
            expect(() => resolveWithoutNoFollow('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] }))
                .toThrow(/changed|size|identity/i);
        } finally {
            open.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects same-inode truncation after safe open before reading', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pack-source-truncate-race-'));
        const packFile = path.join(root, 'sensor-packs', 'js-ts', 'pack.json');
        const originalRead = fs.readSync.bind(fs);
        const read = jest.spyOn(fs, 'readSync');
        let truncated = false;
        try {
            fs.mkdirSync(path.dirname(packFile), { recursive: true });
            fs.writeFileSync(packFile, '{"from":"original"}');
            read.mockImplementation(((descriptor: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => {
                if (!truncated) {
                    truncated = true;
                    fs.truncateSync(packFile, 0);
                }
                return originalRead(descriptor, buffer, offset, length, position);
            }) as typeof fs.readSync);
            expect(() => resolveWithoutNoFollow('js-ts', { registries: [{ name: 'safe', remote: '', contentRoot: root }] }))
                .toThrow(/changed|size|identity/i);
        } finally {
            read.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('bounds diagnostics when a long content root cannot be inspected', () => {
        const contentRoot = path.join(os.tmpdir(), `awm-${'x'.repeat(200_000)}`);
        let message = '';
        try {
            resolvePackSource('js-ts', { registries: [{ name: 'safe', remote: 'https://user:secret@example.invalid/registry', contentRoot }] });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message.length).toBeLessThan(4096);
        expect(message).not.toContain(contentRoot);
        expect(message).not.toContain('secret');
        expect(message).toMatch(/inspect|source|registry/i);
    });
});
