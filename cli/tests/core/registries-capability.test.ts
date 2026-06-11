// cli/tests/core/registries-capability.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('capabilityRoot', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-capability-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-capability-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('devuelve el primer root configurado que tiene el dir pedido', () => {
        const m = require('../../src/core/registries');
        // dos registries en disco: 'a' sin hooks, 'b' con hooks
        const aRoot = path.join(tmpHome, '.awm/registries/a');
        const bRoot = path.join(tmpHome, '.awm/registries/b');
        fs.mkdirSync(path.join(aRoot, 'skills'), { recursive: true });
        fs.mkdirSync(path.join(bRoot, 'hooks'), { recursive: true });
        m.writeRegistriesConfig([{ name: 'a', remote: 'x' }, { name: 'b', remote: 'y' }]);
        expect(m.capabilityRoot('hooks')).toBe(bRoot);
        expect(m.capabilityRoot('skills')).toBe(aRoot);
    });

    it('ningún root tiene el dir → null', () => {
        const m = require('../../src/core/registries');
        m.writeRegistriesConfig([]);
        expect(m.capabilityRoot('hooks')).toBeNull();
    });
});
