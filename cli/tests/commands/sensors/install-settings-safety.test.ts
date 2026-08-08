// Regresion: `installSensorHook` leia `~/.claude/settings.json` con
// `try { JSON.parse(...) } catch { return {} }` y despues escribia ese `{}` de
// vuelta — o sea, ante un JSON malformado (una coma de mas, el error de edicion
// a mano mas comun) BORRABA el archivo entero del usuario y reportaba exito.
//
// Verificado destruyendo `model`, `permissions` y el propio hook SessionStart de
// AWM. El escritor hermano (`installClaudeHook`) ya se negaba correctamente ante
// el mismo archivo: tres escritores del mismo archivo, tres niveles de dureza.
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('installSensorHook: nunca destruye settings.json del usuario', () => {
    let home: string;
    let settingsPath: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensor-hook-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
        settingsPath = path.join(home, '.claude', 'settings.json');
        jest.resetModules();
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('ante JSON malformado NO reescribe el archivo — falla en vez de destruirlo', () => {
        // Coma de mas: sintacticamente invalido, semanticamente el archivo real
        // del usuario con toda su configuracion.
        const malformed = `{
  "model": "claude-opus-4",
  "permissions": { "allow": ["Bash(npm test)"] },
  "hooks": { "SessionStart": [{ "matcher": "startup", "hooks": [] }] },
}`;
        fs.writeFileSync(settingsPath, malformed);

        const { installSensorHook } = require('../../../src/commands/sensors/install');
        const result = (() => {
            try { return installSensorHook(); } catch (e) { return { threw: e as Error }; }
        })();

        // El contrato es no-destruccion. Que lance o que reporte un fallo son
        // dos formas aceptables de negarse; escribir sobre el archivo no lo es.
        const after = fs.readFileSync(settingsPath, 'utf-8');
        expect(after).toBe(malformed);
        expect(after).toContain('"model"');
        expect(after).toContain('"permissions"');
        expect(JSON.stringify(result)).not.toContain('"status":"installed"');
    });

    it('sobre un settings.json valido, preserva las claves del usuario e instala el hook', () => {
        fs.writeFileSync(settingsPath, JSON.stringify({
            model: 'claude-opus-4',
            permissions: { allow: ['Bash(npm test)'] },
        }, null, 2));

        const { installSensorHook } = require('../../../src/commands/sensors/install');
        installSensorHook();

        const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(after.model).toBe('claude-opus-4');
        expect(after.permissions).toEqual({ allow: ['Bash(npm test)'] });
        expect(after.hooks).toBeDefined();
    });

    it('sin settings.json previo, lo crea sin romper nada', () => {
        const { installSensorHook } = require('../../../src/commands/sensors/install');
        expect(() => installSensorHook()).not.toThrow();
        expect(fs.existsSync(settingsPath)).toBe(true);
        expect(() => JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))).not.toThrow();
    });
});
