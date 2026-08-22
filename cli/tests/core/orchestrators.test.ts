import fs from 'fs';
import path from 'path';
import os from 'os';
import { readDeclaredOrchestrators, collectDeclaredOrchestrators } from '../../src/core/orchestrators';
import { writeRegistriesConfig, registryContentRoot } from '../../src/core/registries';

function registryWith(manifest: unknown): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify(manifest));
    return root;
}

describe('readDeclaredOrchestrators', () => {
    const created: string[] = [];
    afterEach(() => {
        for (const r of created.splice(0)) fs.rmSync(r, { recursive: true, force: true });
    });

    it('lee una declaracion valida', () => {           // verifies R1.1
        const root = registryWith({
            minCliVersion: '8.1.5',
            orchestrator: { name: 'mi-proceso', appliesWhen: 'cuando arranco una tarea', terminatesTo: 'development-process' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics).toEqual([]);
        expect(orchestrators).toHaveLength(1);
        expect(orchestrators[0]).toEqual({
            name: 'mi-proceso',
            appliesWhen: 'cuando arranco una tarea',
            terminatesTo: 'development-process',
        });
    });

    it('un registry sin bloque orchestrator no declara nada y no es un error', () => {  // verifies R1.4
        const root = registryWith({ minCliVersion: '8.1.5' });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('un registry sin manifiesto no declara nada y no es un error', () => {           // verifies R1.4
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toEqual([]);
    });

    it('rechaza una declaracion malformada SIN lanzar, reportandola', () => {           // verifies R1.2
        const root = registryWith({ orchestrator: { name: 'mi-proceso' } });            // falta appliesWhen y terminatesTo
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/appliesWhen/);
    });

    it('rechaza un campo string en blanco (solo espacios) sin lanzar, reportandolo', () => {  // verifies Finding 4: value.trim() === '' branch
        const root = registryWith({ orchestrator: { name: 'x', appliesWhen: '   ', terminatesTo: 'none' } });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/appliesWhen/);
    });

    it('orchestrator: null se rechaza SIN lanzar, reportandolo', () => {               // verifies Finding 3
        const root = registryWith({ orchestrator: null });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('orchestrator: [] (array) se rechaza SIN lanzar — prueba que Array.isArray se chequea, no solo === null', () => {  // verifies Finding 3
        const root = registryWith({ orchestrator: [] });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('orchestrator: 5 (numero) se rechaza SIN lanzar', () => {                       // verifies Finding 3
        const root = registryWith({ orchestrator: 5 });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('orchestrator: "x" (string) se rechaza SIN lanzar', () => {                     // verifies Finding 3
        const root = registryWith({ orchestrator: 'x' });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/must be an object/i);
    });

    it('rechaza un campo que excede la longitud maxima permitida', () => {              // verifies Finding 1
        const root = registryWith({
            orchestrator: { name: 'x'.repeat(501), appliesWhen: 'y', terminatesTo: 'none' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/"name"/);
        expect(diagnostics[0]).toMatch(/500|maximum|exceeds/i);
    });

    it('acepta un campo justo en el limite de longitud maxima (500 caracteres)', () => {  // verifies Finding 1
        const root = registryWith({
            orchestrator: { name: 'x'.repeat(500), appliesWhen: 'y', terminatesTo: 'none' },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics).toEqual([]);
        expect(orchestrators).toHaveLength(1);
    });

    it('un manifiesto con JSON invalido se reporta, no explota', () => {                // verifies R1.2
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        created.push(root);
        fs.writeFileSync(path.join(root, 'awm-registry.json'), '{ no es json');
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
    });

    it('una declaracion invalida no invalida las validas de otros registries', () => {  // verifies R1.2
        const bad = registryWith({ orchestrator: { name: 'roto' } });
        const good = registryWith({
            orchestrator: { name: 'sano', appliesWhen: 'siempre', terminatesTo: 'none' },
        });
        created.push(bad, good);
        const all = [bad, good].map(readDeclaredOrchestrators);
        expect(all[0].orchestrators).toEqual([]);
        expect(all[1].orchestrators).toHaveLength(1);
        expect(all[1].diagnostics).toEqual([]);
    });

    it('rechaza campos de precedencia: no son vocabulario del framework', () => {       // verifies R1.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', precedence: 1 },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics[0]).toMatch(/unknown field "precedence"/i);
    });

    it('rechaza una declaracion que traiga secretos', () => {                            // verifies R5.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', token: 'ghp_abc' },
        });
        created.push(root);
        const { diagnostics } = readDeclaredOrchestrators(root);
        expect(diagnostics[0]).toMatch(/unknown field "token"/i);
    });

    it('rechaza un manifiesto simlinkeado sin lanzar, reportandolo', () => {             // verifies R1.2
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-'));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-outside-'));
        created.push(root, outside);
        fs.writeFileSync(path.join(outside, 'awm-registry.json'), JSON.stringify({
            orchestrator: { name: 'sano', appliesWhen: 'siempre', terminatesTo: 'none' },
        }));
        fs.symlinkSync(path.join(outside, 'awm-registry.json'), path.join(root, 'awm-registry.json'));

        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/symbolic link/i);
    });

    it('un nombre de campo con salto de linea no forja lineas de log adicionales', () => { // verifies R5.3
        const root = registryWith({
            orchestrator: { name: 'x', appliesWhen: 'y', terminatesTo: 'none', 'evil\nfake-warning: injected line': true },
        });
        created.push(root);
        const { orchestrators, diagnostics } = readDeclaredOrchestrators(root);
        expect(orchestrators).toEqual([]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].split('\n')).toHaveLength(1);
        expect(diagnostics[0]).toContain(JSON.stringify('evil\nfake-warning: injected line'));
    });
});

describe('collectDeclaredOrchestrators', () => {
    // Isolates AWM_HOME per CLAUDE.md's testing rule ("ningun test puede tocar el ~/.awm
    // real") — mirrors the pattern in tests/core/context/orchestrator.test.ts.
    let isolatedAwmHome: string;
    let originalAwmHomeEnv: string | undefined;

    beforeEach(() => {
        isolatedAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-orch-collect-home-'));
        originalAwmHomeEnv = process.env.AWM_HOME;
        process.env.AWM_HOME = isolatedAwmHome;
    });

    afterEach(() => {
        if (originalAwmHomeEnv === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHomeEnv;
        fs.rmSync(isolatedAwmHome, { recursive: true, force: true });
    });

    function writeManifest(name: string, manifest: unknown): void {
        const root = registryContentRoot(name);
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify(manifest));
    }

    it('dedupea por nombre entre dos registries, conservando el primero por orden de registries.json', () => {  // verifies Finding 2
        writeRegistriesConfig([
            { name: 'first', remote: 'unused' },
            { name: 'second', remote: 'unused' },
        ]);
        writeManifest('first', {
            orchestrator: { name: 'shared', appliesWhen: 'primero', terminatesTo: 'a' },
        });
        writeManifest('second', {
            orchestrator: { name: 'shared', appliesWhen: 'segundo', terminatesTo: 'b' },
        });

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toHaveLength(1);
        expect(declared[0]).toEqual({ name: 'shared', appliesWhen: 'primero', terminatesTo: 'a' });
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/shared/);
        expect(diagnostics[0]).toMatch(/duplicate|shadow/i);
    });

    it('no dedupea orquestadores con nombres distintos, ambos se conservan', () => {
        writeRegistriesConfig([
            { name: 'first', remote: 'unused' },
            { name: 'second', remote: 'unused' },
        ]);
        writeManifest('first', {
            orchestrator: { name: 'uno', appliesWhen: 'x', terminatesTo: 'a' },
        });
        writeManifest('second', {
            orchestrator: { name: 'dos', appliesWhen: 'y', terminatesTo: 'b' },
        });

        const { declared, diagnostics } = collectDeclaredOrchestrators();

        expect(declared).toHaveLength(2);
        expect(declared.map((d) => d.name).sort()).toEqual(['dos', 'uno']);
        expect(diagnostics).toEqual([]);
    });
});
