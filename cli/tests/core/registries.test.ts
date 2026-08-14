// cli/tests/core/registries.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('core/registries', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-registries-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function load() {
        return require('../../src/core/registries');
    }

    it('readRegistriesConfig returns [] when the config file does not exist', () => {
        expect(load().readRegistriesConfig()).toEqual([]);
    });

    it('write + read round-trips entries', () => {
        const m = load();
        m.writeRegistriesConfig([{ name: 'personal', remote: 'git@github.com:x/y.git' }]);
        expect(m.readRegistriesConfig()).toEqual([{ name: 'personal', remote: 'git@github.com:x/y.git' }]);
    });

    it('readRegistriesConfig throws an explicit error naming the path on corrupt JSON', () => {
        const m = load();
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'registries.json'), '{not json');
        expect(() => m.readRegistriesConfig()).toThrow(/registries\.json/);
    });

    it('readRegistriesConfig throws on non-array or malformed entries', () => {
        const m = load();
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpHome, '.awm', 'registries.json'), JSON.stringify({ foo: 1 }));
        expect(() => m.readRegistriesConfig()).toThrow(/expected a JSON array/);
        fs.writeFileSync(path.join(tmpHome, '.awm', 'registries.json'), JSON.stringify([{ name: 'x' }]));
        expect(() => m.readRegistriesConfig()).toThrow(/malformed entry/);
    });

    it('readRegistriesConfig rejects single-dot name to prevent path traversal', () => {
        const m = load();
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: '.', remote: 'r' }])
        );
        expect(() => m.readRegistriesConfig()).toThrow(/path traversal/);
    });

    it('readRegistriesConfig rejects an empty name that would resolve to the registries parent', () => {
        const m = load();
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: '', remote: 'r' }])
        );
        expect(() => m.readRegistriesConfig()).toThrow(/path traversal/);
        expect(() => m.registryContentRoot('')).toThrow(/Invalid registry name/);
    });

    it.each(['.', 'baseline/skills', 'baseline\\skills'])('registryContentRoot rejects unsafe registry component %s', (name) => {
        expect(() => load().registryContentRoot(name)).toThrow(/Invalid registry name/);
    });

    it('listRegistries derives contentRoot under ~/.awm/registries/<name>', () => {
        const m = load();
        m.writeRegistriesConfig([{ name: 'personal', remote: 'r' }]);
        expect(m.listRegistries()).toEqual([
            { name: 'personal', remote: 'r', contentRoot: path.join(tmpHome, '.awm', 'registries', 'personal') },
        ]);
    });

    it('contentRoots includes only configured registries present on disk', () => {
        const m = load();
        // 'present' existe en disco, 'ghost' no
        const present = path.join(tmpHome, '.awm', 'registries', 'present');
        fs.mkdirSync(path.join(present, 'skills'), { recursive: true });
        m.writeRegistriesConfig([{ name: 'present', remote: 'r1' }, { name: 'ghost', remote: 'r2' }]);
        expect(m.contentRoots()).toEqual([present]);
    });

    it('contentRoots preserves an empty configured registry for later synchronization', () => {
        const m = load();
        const empty = path.join(tmpHome, '.awm', 'registries', 'empty');
        fs.mkdirSync(empty, { recursive: true });
        m.writeRegistriesConfig([{ name: 'empty', remote: 'r1' }]);

        expect(m.contentRoots()).toEqual([empty]);
    });

    it('contentRoots omits a configured registry with nested artifact symlinks', () => {
        const m = load();
        const present = path.join(tmpHome, '.awm', 'registries', 'present');
        const outside = path.join(tmpHome, 'outside-skill.md');
        fs.writeFileSync(outside, 'outside');
        fs.mkdirSync(path.join(present, 'skills', 'linked'), { recursive: true });
        fs.symlinkSync(outside, path.join(present, 'skills', 'linked', 'SKILL.md'));
        m.writeRegistriesConfig([{ name: 'present', remote: 'r1' }]);

        expect(m.contentRoots()).toEqual([]);
    });

    it('contentRoots omits a configured registry root that is itself a symlink', () => {
        const m = load();
        const outside = path.join(tmpHome, 'outside-registry');
        const linked = path.join(tmpHome, '.awm', 'registries', 'linked');
        fs.mkdirSync(path.join(outside, 'skills'), { recursive: true });
        fs.mkdirSync(path.dirname(linked), { recursive: true });
        fs.symlinkSync(outside, linked, 'dir');
        m.writeRegistriesConfig([{ name: 'linked', remote: 'r1' }]);

        expect(m.contentRoots()).toEqual([]);
    });

    it('contentRoots omits a registry with symlinked root metadata', () => {
        const m = load();
        for (const metadata of ['awm-registry.json', 'catalog.json']) {
            const root = path.join(tmpHome, '.awm', 'registries', metadata);
            const outside = path.join(tmpHome, `outside-${metadata}`);
            fs.writeFileSync(outside, '{}');
            fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
            fs.symlinkSync(outside, path.join(root, metadata));
            m.writeRegistriesConfig([{ name: metadata, remote: 'r1' }]);

            expect(m.contentRoots()).toEqual([]);
            fs.rmSync(path.join(tmpHome, '.awm', 'registries', metadata), { recursive: true, force: true });
        }
    });

    it('contentRoots returns [] when no registries are configured', () => {
        const m = load();
        expect(m.contentRoots()).toEqual([]);
    });

    it('treats an errored registry with an unsafe existing layout as unusable', () => {
        const m = load();
        const root = path.join(tmpHome, '.awm', 'registries', 'baseline');
        const outside = path.join(tmpHome, 'outside');
        fs.writeFileSync(outside, 'outside');
        fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
        fs.symlinkSync(outside, path.join(root, 'skills', 'artifact'));
        m.writeRegistriesConfig([{ name: 'baseline', remote: 'r' }]);
        const results = [{ name: 'baseline', action: 'error', error: 'unsafe layout' }];

        expect(m.unusableSyncedRegistries(results)).toEqual([{ name: 'baseline', error: 'unsafe layout' }]);
        expect(() => m.assertSyncedRegistriesUsable(results)).toThrow(/registry sync failed/);
    });

    it('treats an errored registry with an empty existing root as unusable', () => {
        const m = load();
        const root = path.join(tmpHome, '.awm', 'registries', 'baseline');
        fs.mkdirSync(root, { recursive: true });
        m.writeRegistriesConfig([{ name: 'baseline', remote: 'r' }]);
        const results = [{ name: 'baseline', action: 'error', error: 'network unreachable' }];

        expect(m.unusableSyncedRegistries(results)).toEqual([{ name: 'baseline', error: 'network unreachable' }]);
        expect(() => m.assertSyncedRegistriesUsable(results)).toThrow(/registry sync failed/);
    });

    it('requires synchronization before discovery when a configured root is empty', () => {
        const m = load();
        const root = path.join(tmpHome, '.awm', 'registries', 'baseline');
        fs.mkdirSync(root, { recursive: true });
        m.writeRegistriesConfig([{ name: 'baseline', remote: 'r' }]);

        expect(m.registriesNeedSync()).toBe(true);
    });

    it('validateRegistryLayout requires at least one content dir at the root', () => {
        const m = load();
        const root = path.join(tmpHome, 'somerepo');
        fs.mkdirSync(root, { recursive: true });
        expect(m.validateRegistryLayout(root)).toBe(false);
        fs.mkdirSync(path.join(root, 'skills'));
        expect(m.validateRegistryLayout(root)).toBe(true);
    });

    it('validateRegistryLayout accepts a regular capability-only registry', () => {
        const m = load();
        for (const directory of ['hooks', 'sensor-packs']) {
            const root = path.join(tmpHome, `repo-${directory}`);
            fs.mkdirSync(path.join(root, directory), { recursive: true });

            expect(m.validateRegistryLayout(root)).toBe(true);
        }
    });

    it('validateRegistryLayout fails closed when a content entry cannot be inspected', () => {
        const m = load();
        const root = path.join(tmpHome, 'somerepo');
        const inaccessible = path.join(root, 'bundles');
        fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
        const original = fs.lstatSync;
        const lstat = jest.spyOn(fs, 'lstatSync').mockImplementation(((candidate: fs.PathLike) => {
            if (candidate === inaccessible) {
                const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
                throw error;
            }
            return original(candidate);
        }) as unknown as typeof fs.lstatSync);

        try {
            expect(m.validateRegistryLayout(root)).toBe(false);
        } finally {
            lstat.mockRestore();
        }
    });

    it('validateRegistryLayout rejects nested symlinks in every managed registry directory', () => {
        const m = load();
        for (const directory of m.REGISTRY_DIR_NAMES) {
            const root = path.join(tmpHome, `repo-${directory}`);
            const outside = path.join(tmpHome, `outside-${directory}`);
            fs.writeFileSync(outside, 'outside');
            fs.mkdirSync(path.join(root, directory, 'nested'), { recursive: true });
            fs.symlinkSync(outside, path.join(root, directory, 'nested', 'artifact'));

            expect(m.validateRegistryLayout(root)).toBe(false);
        }
    });

    it('validateRegistryLayout rejects symlinked root metadata', () => {
        const m = load();
        for (const metadata of ['awm-registry.json', 'catalog.json']) {
            const root = path.join(tmpHome, `repo-${metadata}`);
            const outside = path.join(tmpHome, `outside-${metadata}`);
            fs.writeFileSync(outside, '{}');
            fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
            fs.symlinkSync(outside, path.join(root, metadata));

            expect(m.validateRegistryLayout(root)).toBe(false);
        }
    });
});
