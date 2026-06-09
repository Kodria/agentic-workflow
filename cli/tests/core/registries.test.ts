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

    it('listRegistries derives contentRoot under ~/.awm/registries/<name>', () => {
        const m = load();
        m.writeRegistriesConfig([{ name: 'personal', remote: 'r' }]);
        expect(m.listRegistries()).toEqual([
            { name: 'personal', remote: 'r', contentRoot: path.join(tmpHome, '.awm', 'registries', 'personal') },
        ]);
    });

    it('contentRoots prepends the base content dir and filters registries missing on disk', () => {
        const m = load();
        // base existe
        const base = path.join(tmpHome, '.awm', 'cli-source', 'registry');
        fs.mkdirSync(base, { recursive: true });
        // 'present' existe en disco, 'ghost' no
        const present = path.join(tmpHome, '.awm', 'registries', 'present');
        fs.mkdirSync(present, { recursive: true });
        m.writeRegistriesConfig([{ name: 'present', remote: 'r1' }, { name: 'ghost', remote: 'r2' }]);
        expect(m.contentRoots()).toEqual([base, present]);
    });

    it('contentRoots omits the base dir itself when absent (clean machine)', () => {
        const m = load();
        expect(m.contentRoots()).toEqual([]);
    });

    it('validateRegistryLayout requires at least one content dir at the root', () => {
        const m = load();
        const root = path.join(tmpHome, 'somerepo');
        fs.mkdirSync(root, { recursive: true });
        expect(m.validateRegistryLayout(root)).toBe(false);
        fs.mkdirSync(path.join(root, 'skills'));
        expect(m.validateRegistryLayout(root)).toBe(true);
    });
});
