import { adapterFor } from '../../../src/core/journal/adapter';
import { spawnStructured } from '../../../src/core/journal/process';

describe('ControllerAdapter', () => {
    test('adapterFor resuelve codex y claude-code; provider desconocido lanza (R4.8)', () => {  // verifies R4.8
        expect(adapterFor('codex').provider).toBe('codex');
        expect(adapterFor('claude-code').provider).toBe('claude-code');
        expect(() => adapterFor('otro')).toThrow(/provider/);
    });

    test('safeToReplace: muerto probado => safe; vivo => indeterminate, JAMAS safe sin evidencia (R4.2b)', () => {  // verifies R4.2b
        const a = adapterFor('codex');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        expect(a.safeToReplace(deadRef)).toBe('safe');            // identidad no matchea a nadie vivo => muerte probada
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'nA');
        expect(a.safeToReplace(ref)).toBe('indeterminate');        // vivo: codex no observa llamadas en vuelo => custodia
        child.kill('SIGKILL');
    });

    test('launchArgv construye el comando de reanudacion journal-first (R4.8)', () => {  // verifies R4.8
        const argv = adapterFor('codex').launchArgv('retoma desde next_action');
        expect(argv[0]).toBe('codex');
        expect(argv).toContain('exec');
        expect(argv[argv.length - 1]).toContain('next_action');
        const cl = adapterFor('claude-code').launchArgv('retoma desde next_action');
        expect(cl[0]).toBe('claude');
    });
});
