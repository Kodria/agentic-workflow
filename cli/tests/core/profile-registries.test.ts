// cli/tests/core/profile-registries.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('profile.registries (pin de proyecto)', () => {
    let tmpProj: string;

    beforeEach(() => {
        tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-prof-'));
        fs.mkdirSync(path.join(tmpProj, '.awm'), { recursive: true });
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpProj, { recursive: true, force: true });
    });

    const writeRaw = (obj: unknown) =>
        fs.writeFileSync(path.join(tmpProj, '.awm/profile.json'), JSON.stringify(obj));

    it('lee registries válido y normaliza el prefijo v', () => {
        writeRaw({ extensions: [], registries: { base: 'v1.2.0', equipo: '0.3.0' } });
        const { readProfile } = require('../../src/core/profile');
        expect(readProfile(tmpProj).registries).toEqual({ base: '1.2.0', equipo: '0.3.0' });
    });

    it('profile sin registries → campo ausente (sin verificación)', () => {
        writeRaw({ extensions: ['x'] });
        const { readProfile } = require('../../src/core/profile');
        const p = readProfile(tmpProj);
        expect(p.extensions).toEqual(['x']);
        expect(p.registries).toBeUndefined();
    });

    it('registries no-objeto → error explícito con path', () => {
        writeRaw({ extensions: [], registries: ['base'] });
        const { readProfile } = require('../../src/core/profile');
        expect(() => readProfile(tmpProj)).toThrow(/profile.*registries/s);
    });

    it('versión malformada → error explícito que nombra la clave', () => {
        writeRaw({ extensions: [], registries: { base: 'latest' } });
        const { readProfile } = require('../../src/core/profile');
        expect(() => readProfile(tmpProj)).toThrow(/base.*latest/s);
    });

    it('writeProfile + readProfile round-trip preserva registries', () => {
        const { readProfile, writeProfile } = require('../../src/core/profile');
        writeProfile(tmpProj, { extensions: ['a'], registries: { base: '1.0.0' } });
        expect(readProfile(tmpProj)).toEqual({ extensions: ['a'], registries: { base: '1.0.0' } });
    });

    it('addExtension preserva registries existente', () => {
        const { readProfile, writeProfile, addExtension } = require('../../src/core/profile');
        writeProfile(tmpProj, { extensions: [], registries: { base: '1.0.0' } });
        addExtension(tmpProj, 'nuevo');
        expect(readProfile(tmpProj)).toEqual({ extensions: ['nuevo'], registries: { base: '1.0.0' } });
    });
});
