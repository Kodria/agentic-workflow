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
import { execFileSync } from 'child_process';

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
        fs.mkdirSync(projectRoot, { recursive: true });
        execFileSync('git', ['init', '-q', projectRoot]);
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

    const bytesOf = (dir: string): Array<[string, string]> => {
        const out: Array<[string, string]> = [];
        const walk = (sub: string) => {
            for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
                const rel = path.join(sub, entry.name);
                if (entry.isDirectory()) walk(rel);
                else out.push([rel, fs.readFileSync(path.join(dir, rel)).toString('base64')]);
            }
        };
        walk('.');
        return out.sort(([left], [right]) => left.localeCompare(right));
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

    it('collecting the dashboard leaves project, preferences, journal, ledger, and git bytes unchanged', () => {
        fs.mkdirSync(path.join(home, '.awm', 'ledger'), { recursive: true });
        fs.writeFileSync(path.join(home, '.awm', 'preferences.json'), '{"defaultAgent":"claude-code","enabledAgents":["claude-code"],"installMethod":"symlink","defaultScope":"local"}\n');
        fs.writeFileSync(path.join(home, '.awm', 'ledger', 'events.jsonl'), '{"event":"before"}\n');
        fs.mkdirSync(path.join(projectRoot, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, '.awm', 'profile.json'), '{"extensions":[]}\n');
        fs.writeFileSync(path.join(projectRoot, '.awm', 'journal', 'state.json'), '{"state":"active"}\n');
        const before = { home: bytesOf(home), project: bytesOf(projectRoot), git: (() => { try { return execFileSync('git', ['status', '--porcelain=v1'], { cwd: projectRoot, encoding: 'utf8' }); } catch (error) { return String(error); } })() };

        const { collectDashboardSnapshot } = require('../../src/core/dashboard/collect');
        collectDashboardSnapshot({ cwd: projectRoot, now: '2026-08-22T00:00:00.000Z' });

        const after = { home: bytesOf(home), project: bytesOf(projectRoot), git: (() => { try { return execFileSync('git', ['status', '--porcelain=v1'], { cwd: projectRoot, encoding: 'utf8' }); } catch (error) { return String(error); } })() };
        expect(after).toEqual(before);
    });

    it('--html replaces only its explicitly requested target', () => {
        const target = path.join(projectRoot, 'dashboard.html');
        fs.writeFileSync(target, 'old dashboard');
        const before = { home: bytesOf(home), project: bytesOf(projectRoot) };
        const { runDoctor } = require('../../src/commands/doctor');

        const code = runDoctor({ cwd: projectRoot, html: target, force: true });

        const after = { home: bytesOf(home), project: bytesOf(projectRoot) };
        expect([0, 1]).toContain(code);
        const targetFromHome = path.join('proj', 'dashboard.html');
        expect(after.home.filter(([name]) => name !== targetFromHome)).toEqual(before.home.filter(([name]) => name !== targetFromHome));
        expect(after.project.filter(([name]) => name !== 'dashboard.html')).toEqual(before.project.filter(([name]) => name !== 'dashboard.html'));
        expect(fs.readFileSync(target, 'utf8')).not.toBe('old dashboard');
        expect(after.project.map(([name]) => name).filter((name) => name.includes('.tmp'))).toEqual([]);
    });
});
