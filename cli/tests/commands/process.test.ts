// cli/tests/commands/process.test.ts
import { runProcessList, runProcessShow } from '../../src/commands/process';
import type { ProcessModel } from '../../src/core/process/types';

function model(over: Partial<ProcessModel> = {}): ProcessModel {
    return {
        schema: 1, name: 'mi-proceso', status: 'draft', entryPoint: true, terminatesTo: 'none',
        created: '2026-08-23', updated: '2026-08-23', source: '/r/skills/mi-proceso/SKILL.md',
        body: {
            objective: 'G — Objetivo.', appliesWhen: 'Siempre.',
            structure: [{ id: 'SG-1', text: 'Uno', operations: [{ id: 'OP-1.1', text: 'Hacer' }] }],
            routing: [{ when: 'Al empezar', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' }],
            termination: 'none', unverified: ['Nada.'],
        },
        ...over,
    };
}

describe('awm process list', () => {
    it('reporta los procesos descubiertos', () => {                             // verifies R5.1
        const r = runProcessList({ models: [model()], diagnostics: [] });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stdout).toContain('draft');
    });

    it('sin modelos sale 0 y lo dice, no falla', () => {                        // verifies R7.2
        const r = runProcessList({ models: [], diagnostics: [] });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/no process models/i);
    });

    it('emite los diagnósticos sin dejar de listar los sanos', () => {          // verifies R7.1
        const r = runProcessList({ models: [model()], diagnostics: ['/r/x: invalid process model — boom'] });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stderr).toContain('boom');
    });
});

describe('awm process show --json', () => {
    it('emite el modelo parseado como JSON', () => {                            // verifies R5.1
        const r = runProcessShow({ models: [model()], diagnostics: [] }, 'mi-proceso', true);
        expect(r.code).toBe(0);
        const parsed = JSON.parse(r.stdout);
        expect(parsed).toEqual(expect.objectContaining({ name: 'mi-proceso', schema: 1, status: 'draft' }));
        expect(parsed.body.routing).toEqual([{ when: 'Al empezar', requiredState: '', goesTo: 'OP-1.1', endsAt: 'SG-1' }]);
    });

    it('el JSON no filtra el path del filesystem del registry', () => {         // verifies R5.1
        const parsed = JSON.parse(runProcessShow({ models: [model()], diagnostics: [] }, 'mi-proceso', true).stdout);
        expect(JSON.stringify(parsed)).not.toContain('/r/skills');
    });

    it('un nombre inexistente sale 2 y nombra lo disponible', () => {           // verifies R7.1
        const r = runProcessShow({ models: [model()], diagnostics: [] }, 'no-existe', true);
        expect(r.code).toBe(2);
        expect(r.stderr).toMatch(/no-existe/);
    });
});
