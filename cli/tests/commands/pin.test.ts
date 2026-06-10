// cli/tests/commands/pin.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('pin/unpin (editores de preferences)', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pin-home-'));
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

    const readPrefs = () =>
        JSON.parse(fs.readFileSync(path.join(tmpHome, '.awm/preferences.json'), 'utf-8'));

    it('setPin escribe pins.base normalizado (acepta prefijo v)', () => {
        const { setPin } = require('../../src/commands/pin');
        setPin('base', 'v1.2.0');
        expect(readPrefs().pins).toEqual({ base: '1.2.0' });
    });

    it('setPin acepta un registry adicional configurado', () => {
        const { writeRegistriesConfig } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'equipo', remote: '/tmp/x' }]);
        const { setPin } = require('../../src/commands/pin');
        setPin('equipo', '0.3.0');
        expect(readPrefs().pins).toEqual({ equipo: '0.3.0' });
    });

    it('setPin rechaza un registry desconocido listando los válidos', () => {
        const { setPin } = require('../../src/commands/pin');
        expect(() => setPin('nope', '1.0.0')).toThrow(/nope.*base/s);
    });

    it('setPin rechaza versión malformada', () => {
        const { setPin } = require('../../src/commands/pin');
        expect(() => setPin('base', '1.2')).toThrow(/X\.Y\.Z/);
        expect(() => setPin('base', 'latest')).toThrow(/X\.Y\.Z/);
    });

    it('removePin borra la entrada y reporta si existía', () => {
        const { setPin, removePin } = require('../../src/commands/pin');
        setPin('base', '1.2.0');
        expect(removePin('base')).toBe(true);
        expect(readPrefs().pins).toEqual({});
        expect(removePin('base')).toBe(false);
    });

    it('setPin preserva las demás preferencias y pins existentes', () => {
        const { setPin } = require('../../src/commands/pin');
        setPin('base', '1.0.0');
        const { writeRegistriesConfig } = require('../../src/core/registries');
        writeRegistriesConfig([{ name: 'equipo', remote: '/tmp/x' }]);
        setPin('equipo', '2.0.0');
        const prefs = readPrefs();
        expect(prefs.pins).toEqual({ base: '1.0.0', equipo: '2.0.0' });
        expect(prefs.defaultAgent).toBeDefined();
    });
});
