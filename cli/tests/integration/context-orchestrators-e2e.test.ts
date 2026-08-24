import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = path.resolve(__dirname, '../..');
const DIST = path.join(CLI_ROOT, 'dist', 'src', 'index.js');

/** Registry de prueba con un orquestador declarado. Nunca toca el ~/.awm real (R7.4). */
function seedRegistry(): string {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-e2e-')));
    const awmHome = path.join(home, '.awm');
    const root = path.join(awmHome, 'registries', 'test-registry');
    fs.mkdirSync(path.join(root, 'skills', 'using-awm'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'),
        JSON.stringify([{ name: 'test-registry', remote: 'https://example.invalid/test.git' }]));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: { name: 'ejemplo-proceso', appliesWhen: 'cuando hay una tarea sin plan', terminatesTo: 'development-process' },
    }));
    fs.writeFileSync(path.join(root, 'skills', 'using-awm', 'SKILL.md'), '---\nname: using-awm\nversion: "1.0.0"\n---\n\n# using-awm\n');
    return home;
}

function run(home: string, ...args: string[]) {
    return spawnSync(process.execPath, [DIST, ...args], {
        cwd: CLI_ROOT, encoding: 'utf8',
        env: { ...process.env, HOME: home, AWM_HOME: path.join(home, '.awm') },
    });
}

describe('awm context orchestrators (binario real)', () => {
    let home: string;
    beforeAll(() => { home = seedRegistry(); });
    afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

    it('reporta el orquestador declarado por el registry sembrado', () => {      // verifies R3.5
        const r = run(home, 'context', 'orchestrators');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('ejemplo-proceso');
    });

    it('--json emite la lista parseable', () => {                                // verifies R3.5
        const r = run(home, 'context', 'orchestrators', '--json');
        expect(r.status).toBe(0);
        expect(JSON.parse(r.stdout).orchestrators[0].name).toBe('ejemplo-proceso');
    });

    it('--verify cierra el ciclo de verificacion con exit code', () => {         // verifies R3.5
        expect(run(home, 'context', 'orchestrators', '--verify', 'ejemplo-proceso').status).toBe(0);
        const ausente = run(home, 'context', 'orchestrators', '--verify', 'no-existe');
        expect(ausente.status).toBe(2);
        expect(ausente.stderr).toContain('ejemplo-proceso');
    });
});
