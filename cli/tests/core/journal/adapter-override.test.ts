// R5 Task 16 (cierre por controller scripteado): `AWM_CONTROLLER_ARGV` es lo que vuelve
// FALSIFICABLE la afirmacion "el supervisor no conoce providers". Sin este seam, los unicos
// controllers posibles eran `codex` y `claude-code`, asi que la agnosticidad no se podia
// comprobar ni romper — solo creer.
import { adapterFor, CONTROLLER_ARGV_ENV } from '../../../src/core/journal/adapter';

describe('adapterFor · override de argv del controller', () => {
    const previous = process.env[CONTROLLER_ARGV_ENV];
    afterEach(() => {
        if (previous === undefined) delete process.env[CONTROLLER_ARGV_ENV];
        else process.env[CONTROLLER_ARGV_ENV] = previous;
    });

    it('sin override, cada provider conserva su argv nativo', () => {
        delete process.env[CONTROLLER_ARGV_ENV];
        expect(adapterFor('codex').launchArgv('P')[0]).toBe('codex');
        expect(adapterFor('claude-code').launchArgv('P')[0]).toBe('claude');
    });

    it('con override, el prompt viaja como ULTIMO argumento — el token llega igual', () => {
        process.env[CONTROLLER_ARGV_ENV] = JSON.stringify(['node', '/tmp/ctl.mjs', '--flag']);
        const argv = adapterFor('codex').launchArgv('Generacion activa: abc123');
        expect(argv).toEqual(['node', '/tmp/ctl.mjs', '--flag', 'Generacion activa: abc123']);
    });

    it('el override NO reemplaza el resto del adapter (fencing/custodia siguen siendo del provider)', () => {
        process.env[CONTROLLER_ARGV_ENV] = JSON.stringify(['node', 'ctl.mjs']);
        const a = adapterFor('claude-code');
        expect(a.provider).toBe('claude-code');
        // `safeToReplace` es la señal POSITIVA que decide si el supervisor releva o entra en
        // custodia. Si el override la tocara, un controller scripteado podría autorizar un
        // relevo que el provider real nunca autorizaría — el seam quedaría mintiendo.
        expect(a.safeToReplace).toBe(adapterFor('codex').safeToReplace);
    });

    it.each([
        ['claude -p "hola"', 'una linea de shell'],
        ['[]', 'array vacio'],
        ['["node", ""]', 'string vacio'],
        ['["node", 3]', 'elemento no-string'],
        ['{"cmd":"node"}', 'objeto en vez de array'],
    ])('rechaza %s (%s) en vez de caer al provider nativo', (raw) => {
        process.env[CONTROLLER_ARGV_ENV] = raw;
        // Fail-closed a propósito: un override mal escrito que "funciona igual" lanzaría el
        // agente REAL — con su costo en tokens — sin que nadie note que el override no aplicó.
        expect(() => adapterFor('codex')).toThrow(CONTROLLER_ARGV_ENV);
    });

    it('un override en blanco es ausencia, no error', () => {
        process.env[CONTROLLER_ARGV_ENV] = '   ';
        expect(adapterFor('codex').launchArgv('P')[0]).toBe('codex');
    });
});
