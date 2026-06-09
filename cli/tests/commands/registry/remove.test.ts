// cli/tests/commands/registry/remove.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('removeRegistry', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regrm-'));
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

    it('removes the config entry and the clone dir', () => {
        const { writeRegistriesConfig, registryContentRoot, readRegistriesConfig } = require('../../../src/core/registries');
        writeRegistriesConfig([{ name: 'personal', remote: 'r' }]);
        fs.mkdirSync(path.join(registryContentRoot('personal'), 'skills'), { recursive: true });

        const { removeRegistry } = require('../../../src/commands/registry/remove');
        const result = removeRegistry('personal');

        expect(result.ok).toBe(true);
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(registryContentRoot('personal'))).toBe(false);
    });

    it('errors on unknown name without touching anything', () => {
        const { removeRegistry } = require('../../../src/commands/registry/remove');
        const result = removeRegistry('nope');
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not found/);
    });
});
