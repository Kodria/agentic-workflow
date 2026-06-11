// cli/tests/core/registries-seed.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('core/registries — seedBaselineRegistry + contentRoots sin base especial', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;
    let originalBaseRemote: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-seed-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        originalBaseRemote = process.env.AWM_BASE_REMOTE;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        delete process.env.AWM_BASE_REMOTE;
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        if (originalBaseRemote === undefined) delete process.env.AWM_BASE_REMOTE;
        else process.env.AWM_BASE_REMOTE = originalBaseRemote;
    });

    it('seedBaselineRegistry crea registries.json con baseline la primera vez', () => {
        const m = require('../../src/core/registries');
        expect(m.seedBaselineRegistry()).toBe(true);
        expect(m.readRegistriesConfig()).toEqual([
            { name: 'baseline', remote: require('../../src/core/registry').DEFAULT_REMOTE },
        ]);
    });

    it('seedBaselineRegistry respeta AWM_BASE_REMOTE', () => {
        process.env.AWM_BASE_REMOTE = '/tmp/mi-remote';
        jest.resetModules();
        const m = require('../../src/core/registries');
        m.seedBaselineRegistry();
        expect(m.readRegistriesConfig()[0].remote).toBe('/tmp/mi-remote');
        delete process.env.AWM_BASE_REMOTE;
    });

    it('seedBaselineRegistry es no-op si registries.json ya existe (idempotente, respeta ediciones)', () => {
        const m = require('../../src/core/registries');
        m.writeRegistriesConfig([{ name: 'equipo', remote: 'x' }]);
        expect(m.seedBaselineRegistry()).toBe(false);
        expect(m.readRegistriesConfig()).toEqual([{ name: 'equipo', remote: 'x' }]);
    });

    it('contentRoots ya no incluye un root base especial', () => {
        const m = require('../../src/core/registries');
        m.writeRegistriesConfig([]);
        expect(m.contentRoots()).toEqual([]);
    });
});
