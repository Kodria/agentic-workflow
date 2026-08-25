// cli/tests/core/registry-manifest.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('registry manifest (awm-registry.json)', () => {
    let tmpHome: string;
    let tmpWork: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-work-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    function load() {
        return require('../../src/core/registries');
    }

    it('returns empty overrides when manifest file is absent', () => {
        const { readRegistryManifest } = load();
        const m = readRegistryManifest(tmpWork);
        expect(m.overrides.size).toBe(0);
    });

    it('parses a valid manifest into a Set of names', () => {
        fs.writeFileSync(
            path.join(tmpWork, 'awm-registry.json'),
            JSON.stringify({ overrides: ['brainstorming', 'writing-plans'] })
        );
        const { readRegistryManifest } = load();
        const m = readRegistryManifest(tmpWork);
        expect(m.overrides.has('brainstorming')).toBe(true);
        expect(m.overrides.has('writing-plans')).toBe(true);
        expect(m.overrides.size).toBe(2);
    });

    it('treats a manifest without "overrides" key as empty', () => {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({}));
        const { readRegistryManifest } = load();
        expect(readRegistryManifest(tmpWork).overrides.size).toBe(0);
    });

    it('throws with the file path on corrupt JSON — never silently empty', () => {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), '{nope');
        const { readRegistryManifest } = load();
        expect(() => readRegistryManifest(tmpWork)).toThrow(/awm-registry\.json/);
    });

    it('rejects a manifest symlink instead of reading outside the registry', () => {
        const outside = path.join(tmpHome, 'outside-manifest.json');
        fs.writeFileSync(outside, JSON.stringify({ overrides: ['outside'] }));
        fs.symlinkSync(outside, path.join(tmpWork, 'awm-registry.json'));
        const { readRegistryManifest } = load();

        expect(() => readRegistryManifest(tmpWork)).toThrow(/symbolic link/);
    });

    it('throws when overrides is not an array of strings', () => {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({ overrides: 'brainstorming' }));
        const { readRegistryManifest } = load();
        expect(() => readRegistryManifest(tmpWork)).toThrow(/array of strings/);
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({ overrides: [42] }));
        jest.resetModules();
        expect(() => load().readRegistryManifest(tmpWork)).toThrow(/array of strings/);
    });

    it.each(['', '.', '..', 'a/b', 'a\\b', '../up'])(
        'rejects override name %j (path traversal guard)',
        (bad) => {
            fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify({ overrides: [bad] }));
            const { readRegistryManifest } = load();
            expect(() => readRegistryManifest(tmpWork)).toThrow(/path traversal/);
        }
    );

    it('registryNameForPath maps configured registries and returns null for unknown paths', () => {
        const m = load();
        const regPath = path.join(m.registriesDir(), 'team-acme', 'skills', 'x');
        expect(m.registryNameForPath(regPath)).toBe('team-acme');
        expect(m.registryNameForPath('/somewhere/else')).toBeNull();
    });

    // minCliVersion tests (WS-4)
    function writeManifest(data: Record<string, unknown>) {
        fs.writeFileSync(path.join(tmpWork, 'awm-registry.json'), JSON.stringify(data));
    }

    it('minCliVersion válido se expone normalizado (acepta prefijo v)', () => {
        writeManifest({ minCliVersion: 'v2.1.0' });
        const { readRegistryManifest } = load();
        expect(readRegistryManifest(tmpWork).minCliVersion).toBe('2.1.0');
    });

    it('minCliVersion ausente → undefined', () => {
        writeManifest({ overrides: [] });
        const { readRegistryManifest } = load();
        expect(readRegistryManifest(tmpWork).minCliVersion).toBeUndefined();
    });

    it.each([['banana'], ['2.1'], [2], [null]])('minCliVersion malformado %p → error explícito', (bad) => {
        writeManifest({ minCliVersion: bad });
        const { readRegistryManifest } = load();
        expect(() => readRegistryManifest(tmpWork)).toThrow(/minCliVersion/);
    });

    it('reads projectContextSchema 1 without changing legacy manifests', () => {
        writeManifest({ minCliVersion: '9.2.1', projectContextSchema: 1 });
        const { readRegistryManifest } = load();
        expect(readRegistryManifest(tmpWork)).toEqual({
            overrides: new Set(), minCliVersion: '9.2.1', projectContextSchema: 1,
        });

        writeManifest({ minCliVersion: '9.2.1' });
        expect(readRegistryManifest(tmpWork).projectContextSchema).toBeUndefined();
    });

    it.each([0, 2, -1, 1.5, '1', null])('rejects unsupported project context schema %p', (value) => {
        writeManifest({ projectContextSchema: value });
        const { readRegistryManifest } = load();
        expect(() => readRegistryManifest(tmpWork)).toThrow(/projectContextSchema.*exactly 1/);
    });

    it('resolves the first usable Context Kernel declaration and retains malformed manifest diagnostics', () => {
        const { registriesDir, writeRegistriesConfig, resolveProjectContextSchema } = load();
        writeRegistriesConfig([
            { name: 'broken', remote: 'https://example.invalid/broken.git' },
            { name: 'active', remote: 'https://example.invalid/active.git' },
        ]);
        for (const name of ['broken', 'active']) fs.mkdirSync(path.join(registriesDir(), name, 'skills'), { recursive: true });
        fs.writeFileSync(path.join(registriesDir(), 'broken', 'awm-registry.json'), JSON.stringify({ projectContextSchema: 2 }));
        fs.writeFileSync(path.join(registriesDir(), 'active', 'awm-registry.json'), JSON.stringify({ projectContextSchema: 1 }));

        const result = resolveProjectContextSchema();
        expect(result.declaration).toEqual(expect.objectContaining({ registry: expect.objectContaining({ name: 'active' }), schema: 1 }));
        expect(result.diagnostics).toEqual([expect.stringMatching(/broken.*projectContextSchema.*exactly 1/)]);
    });
});
