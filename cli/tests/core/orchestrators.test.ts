import fs from 'fs';
import path from 'path';
import os from 'os';
import { readDeclaredOrchestrators } from '../../src/core/orchestrators';

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
