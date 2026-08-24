import { runContextOrchestrators } from '../../src/commands/context';

const collected = (declared: { name: string; appliesWhen: string; terminatesTo: string }[], diagnostics: string[] = []) =>
    ({ declared, diagnostics });

const uno = { name: 'mi-proceso', appliesWhen: 'cuando hay una tarea', terminatesTo: 'development-process' };

describe('awm context orchestrators', () => {
    it('lista los orquestadores compuestos', () => {                             // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: false });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stdout).toContain('development-process');
    });

    it('sin declarados sale 0 y lo dice, no falla', () => {                      // verifies R7.2
        const r = runContextOrchestrators(collected([]), { json: false });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/no declared orchestrators/i);
    });

    it('emite los diagnosticos sin dejar de listar los sanos', () => {           // verifies R7.1
        const r = runContextOrchestrators(collected([uno], ['/r/awm-registry.json: boom']), { json: false });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('mi-proceso');
        expect(r.stderr).toContain('boom');
    });

    it('--json emite la lista compuesta como JSON', () => {                      // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: true });
        expect(r.code).toBe(0);
        expect(JSON.parse(r.stdout)).toEqual({ orchestrators: [uno] });
    });

    it('--verify sale 0 cuando el nombre esta compuesto', () => {                // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: false, verify: 'mi-proceso' });
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/composed/i);
    });

    it('--verify sale 2 y nombra lo disponible cuando no esta', () => {          // verifies R3.5
        const r = runContextOrchestrators(collected([uno]), { json: false, verify: 'no-existe' });
        expect(r.code).toBe(2);
        expect(r.stderr).toContain('no-existe');
        expect(r.stderr).toContain('mi-proceso');
    });

    it('sanea bytes de control antes de escribir a la terminal', () => {         // verifies R5.4
        const hostil = { name: 'x\x1b[31m', appliesWhen: 'w\x07', terminatesTo: 't\x00' };
        const r = runContextOrchestrators(collected([hostil]), { json: false });
        // eslint-disable-next-line no-control-regex -- verificamos la ausencia deliberada de C0
        expect(r.stdout).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    });
});
