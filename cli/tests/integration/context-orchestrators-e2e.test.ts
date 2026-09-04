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
    fs.mkdirSync(path.join(root, 'skills', 'ejemplo-proceso'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'),
        JSON.stringify([{ name: 'test-registry', remote: 'https://example.invalid/test.git' }]));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: { name: 'ejemplo-proceso', appliesWhen: 'cuando hay una tarea sin plan', terminatesTo: 'development-process' },
    }));
    fs.writeFileSync(path.join(root, 'skills', 'ejemplo-proceso', 'SKILL.md'), '---\nname: ejemplo-proceso\nversion: "1.0.0"\n---\n\n# ejemplo-proceso\n');
    return home;
}

/**
 * Registry con un nombre de orquestador REALISTA: `task_capture_process`, con guion bajo —
 * la misma clase de caracter (`_`) que disparaba el falso-negativo de `--verify` fijado en
 * 3e8ce65 (arg crudo vs. nombre saneado). `seedRegistry()` usa un nombre puramente
 * alfanumerico-con-guiones que nunca ejercito esa clase de caracter a nivel del binario
 * real — este fixture cierra ese hueco (Finding 1 confirmado del QA post-implementacion) y
 * ademas es representativo de lo que la generacion de `process-lifecycle` (Task 5)
 * plausiblemente produce a partir de un `name` tipo slug.
 */
function seedRealisticRegistry(): string {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-e2e-real-')));
    const awmHome = path.join(home, '.awm');
    const root = path.join(awmHome, 'registries', 'test-registry');
    fs.mkdirSync(path.join(root, 'skills', 'task_capture_process'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'),
        JSON.stringify([{ name: 'test-registry', remote: 'https://example.invalid/test.git' }]));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: {
            name: 'task_capture_process',
            appliesWhen: 'cuando llega una tarea sin capturar en el backlog',
            terminatesTo: 'development-process',
        },
    }));
    fs.writeFileSync(path.join(root, 'skills', 'task_capture_process', 'SKILL.md'), '---\nname: task_capture_process\nversion: "1.0.0"\n---\n\n# task_capture_process\n');
    return home;
}

/**
 * DOS registries en el mismo `AWM_HOME`: uno con declaracion valida ('sana') y otro con una
 * declaracion rota (le falta `terminatesTo`) que `readDeclaredOrchestrators`
 * (core/orchestrators.ts) diagnostica sin lanzar (R1.2) — rechaza SOLO esa declaracion,
 * sin invalidar el registry que la contiene ni a los demas. Ejercita R7.1 a nivel del
 * binario real: diagnosticos por stderr sin dejar de listar lo sano por stdout
 * (Finding 2 confirmado del QA post-implementacion, hasta ahora solo unit-testeado en
 * tests/commands/context.test.ts).
 */
function seedMixedRegistries(): string {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-e2e-mixed-')));
    const awmHome = path.join(home, '.awm');
    const sanoRoot = path.join(awmHome, 'registries', 'sano-registry');
    const rotoRoot = path.join(awmHome, 'registries', 'roto-registry');
    fs.mkdirSync(path.join(sanoRoot, 'skills', 'proceso-sano'), { recursive: true });
    fs.mkdirSync(path.join(rotoRoot, 'skills', 'using-awm'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([
        { name: 'sano-registry', remote: 'https://example.invalid/sano.git' },
        { name: 'roto-registry', remote: 'https://example.invalid/roto.git' },
    ]));
    fs.writeFileSync(path.join(sanoRoot, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: { name: 'proceso-sano', appliesWhen: 'cuando hay una tarea sin plan', terminatesTo: 'development-process' },
    }));
    // Declaracion rota: falta "terminatesTo" -- readDeclaredOrchestrators la rechaza y
    // reporta un diagnostico en vez de lanzar o componerla silenciosamente (R1.2).
    fs.writeFileSync(path.join(rotoRoot, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: { name: 'proceso-roto', appliesWhen: 'cuando algo pasa' },
    }));
    fs.writeFileSync(path.join(sanoRoot, 'skills', 'proceso-sano', 'SKILL.md'), '---\nname: proceso-sano\nversion: "1.0.0"\n---\n\n# proceso-sano\n');
    return home;
}

function seedPhantomRegistry(): string {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-e2e-phantom-')));
    const awmHome = path.join(home, '.awm');
    const root = path.join(awmHome, 'registries', 'test-registry');
    fs.mkdirSync(path.join(root, 'skills', 'real-skill'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'),
        JSON.stringify([{ name: 'test-registry', remote: 'https://example.invalid/test.git' }]));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({
        minCliVersion: '8.5.0',
        orchestrator: { name: 'phantom-process', appliesWhen: 'cuando hay una tarea sin plan', terminatesTo: 'development-process' },
    }));
    fs.writeFileSync(path.join(root, 'skills', 'real-skill', 'SKILL.md'), '---\nname: real-skill\nversion: "1.0.0"\n---\n\n# real-skill\n');
    return home;
}

function run(home: string, ...args: string[]) {
    return spawnSync(process.execPath, [DIST, ...args], {
        cwd: CLI_ROOT, encoding: 'utf8',
        env: { ...process.env, HOME: home, AWM_HOME: path.join(home, '.awm'), AWM_NO_UPDATE_CHECK: '1' },
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

describe('awm context orchestrators -- nombre realista con guion bajo (binario real)', () => {   // verifies confirmed Finding 1
    let home: string;
    beforeAll(() => { home = seedRealisticRegistry(); });
    afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

    it('--verify con el nombre RAW declarado (con guion bajo) compone -- regression del fix 3e8ce65', () => {
        const r = run(home, 'context', 'orchestrators', '--verify', 'task_capture_process');
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/composed/i);
    });

    it('la lista en texto plano y --json muestran el nombre saneado (guion bajo removido)', () => {
        const plano = run(home, 'context', 'orchestrators');
        expect(plano.status).toBe(0);
        expect(plano.stdout).toContain('taskcaptureprocess');
        expect(plano.stdout).not.toContain('task_capture_process');

        const json = run(home, 'context', 'orchestrators', '--json');
        expect(json.status).toBe(0);
        expect(JSON.parse(json.stdout).orchestrators[0].name).toBe('taskcaptureprocess');
    });
});

describe('awm context orchestrators -- diagnosticos + sanos mezclados (binario real)', () => {   // verifies confirmed Finding 2 / R7.1
    let home: string;
    beforeAll(() => { home = seedMixedRegistries(); });
    afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

    it('lista el orquestador sano por stdout y diagnostica el roto por stderr sin fallar', () => {
        const r = run(home, 'context', 'orchestrators');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('proceso-sano');
        expect(r.stderr).toContain('warning:');
        expect(r.stderr).toContain('roto-registry');
        expect(r.stderr).toContain('terminatesTo');
    });
});

describe('awm context orchestrators -- declaracion phantom (binario real)', () => {
    let home: string;
    beforeAll(() => { home = seedPhantomRegistry(); });
    afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

    it('--verify devuelve 2 y diagnostica una declaracion sin skill resoluble', () => {
        const r = run(home, 'context', 'orchestrators', '--verify', 'phantom-process');
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/phantom-process/);
        expect(r.stderr).toMatch(/declaration dropped|skill/i);
    });
});

describe('awm context orchestrators -- dropped sanitized collision (real binary)', () => {
    let home: string;
    beforeAll(() => {
        home = seedPhantomRegistry();
        const awmHome = path.join(home, '.awm');
        const phantomRoot = path.join(awmHome, 'registries', 'test-registry');
        const retainedRoot = path.join(awmHome, 'registries', 'retained');
        fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([
            { name: 'test-registry', remote: 'unused' }, { name: 'retained', remote: 'unused' },
        ]));
        fs.writeFileSync(path.join(phantomRoot, 'awm-registry.json'), JSON.stringify({
            orchestrator: { name: 'foo_bar', appliesWhen: 'x', terminatesTo: 'none' },
        }));
        fs.mkdirSync(path.join(retainedRoot, 'skills', 'foobar'), { recursive: true });
        fs.writeFileSync(path.join(retainedRoot, 'skills', 'foobar', 'SKILL.md'), '# foobar\n');
        fs.writeFileSync(path.join(retainedRoot, 'awm-registry.json'), JSON.stringify({
            orchestrator: { name: 'foobar', appliesWhen: 'x', terminatesTo: 'none' },
        }));
    });
    afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

    it('verifies the retained raw name and rejects the dropped raw name', () => {
        expect(run(home, 'context', 'orchestrators', '--verify', 'foobar').status).toBe(0);
        const dropped = run(home, 'context', 'orchestrators', '--verify', 'foo_bar');
        expect(dropped.status).toBe(2);
        expect(dropped.stderr).toContain('declaration dropped');
    });
});
