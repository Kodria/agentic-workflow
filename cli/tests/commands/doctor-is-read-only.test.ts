// `awm doctor` está documentado como «Read-only dashboard of machine + project harness
// state. **Changes nothing.**» — y escribía.
//
// `getPreferences()` auto-vivifica `preferences.json` con los defaults cuando el archivo
// no existe (`config.ts`: `if (!loaded.exists) savePreferences(DEFAULT_PREFS)`). Un
// getter con efecto de escritura escondido adentro. `doctor` lo llamaba para resolver a
// qué agentes mirar, así que en una máquina limpia el comando de inspección dejaba un
// `preferences.json` con `claude-code` como agente por defecto — que después se lee como
// «el usuario configuró esto» cuando no lo hizo.
//
// Lo encontró el playbook de aceptación en su segundo check, no la suite: ningún test
// preguntaba si un comando de lectura escribía. Se midieron los otros siete comandos de
// inspección (`list`, `preflight`, `sensors status`, `context-budget`, `backup list`,
// `ledger list`, `registry status`) y todos estaban limpios — así que acá el sitio ES la
// clase, con medición en vez de suposición.
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('awm doctor no escribe nada', () => {
    let home: string;
    let projectRoot: string;
    let saved: { HOME?: string; AWM_HOME?: string };
    let writeSpy: jest.SpyInstance;

    beforeEach(() => {
        home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-ro-')));
        saved = { HOME: process.env.HOME, AWM_HOME: process.env.AWM_HOME };
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        projectRoot = path.join(home, 'proj');
        fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
        jest.resetModules();
        writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
        if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
        if (saved.AWM_HOME === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = saved.AWM_HOME;
        fs.rmSync(home, { recursive: true, force: true });
    });

    /** Todo lo que exista bajo `home`, para comparar el antes y el después. */
    const treeOf = (dir: string): string[] => {
        const out: string[] = [];
        const walk = (sub: string) => {
            for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
                const rel = path.join(sub, e.name);
                out.push(rel);
                if (e.isDirectory()) walk(rel);
            }
        };
        walk('.');
        return out.sort();
    };

    it('no crea AWM_HOME ni preferences.json en una máquina limpia', () => {
        const { runDoctor } = require('../../src/commands/doctor');
        const before = treeOf(home);

        runDoctor({ cwd: projectRoot, json: true });

        expect(fs.existsSync(path.join(home, '.awm', 'preferences.json'))).toBe(false);
        expect(treeOf(home)).toEqual(before);
    });

    it('tampoco escribe cuando ya hay preferencias', () => {
        // El otro camino de `getPreferences`: el archivo existe. `migrationRequired`
        // podía reescribirlo — sigue siendo una escritura desde un comando de lectura.
        fs.mkdirSync(path.join(home, '.awm'), { recursive: true });
        const prefsPath = path.join(home, '.awm', 'preferences.json');
        fs.writeFileSync(prefsPath, JSON.stringify({
            enabledAgents: ['claude-code'], defaultAgent: 'claude-code',
            installMethod: 'symlink', defaultScope: 'global',
        }));
        const before = fs.readFileSync(prefsPath, 'utf-8');
        const beforeTree = treeOf(home);

        const { runDoctor } = require('../../src/commands/doctor');
        runDoctor({ cwd: projectRoot, json: true });

        expect(fs.readFileSync(prefsPath, 'utf-8')).toBe(before);
        expect(treeOf(home)).toEqual(beforeTree);
    });

    it('sigue reportando sobre el agente por defecto sin archivo de preferencias', () => {
        // No alcanza con no escribir: tiene que seguir funcionando. Sin preferencias,
        // los defaults en memoria son la respuesta correcta.
        const { runDoctor } = require('../../src/commands/doctor');

        const code = runDoctor({ cwd: projectRoot, json: true });

        expect([0, 1]).toContain(code);   // 0 sano / 1 degradado, nunca 2 (error)
        const emitted = writeSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(JSON.parse(emitted).providers.map((p: { id: string }) => p.id)).toEqual(['claude-code']);
    });
});
