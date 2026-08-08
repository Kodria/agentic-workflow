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

    /** Regresion (CI windows-latest): reproduce el bug real via mock de
     *  process.platform, ya que no hay windows real disponible en este
     *  entorno. Antes del fix, refIsAlive en win32 caia en la rama POSIX
     *  (ps/pgrep), y ps/pgrep alli — cuando resuelven en el PATH — son el
     *  ps/pgrep EMULADO de MSYS/Cygwin, ciego a pids nativos: para el hijo
     *  real y vivo que spawnStructured produce, devolvian exit 1 ("no such
     *  process" segun su vista emulada), que el codigo interpretaba como
     *  "el SO confirmo la muerte" -> refIsAlive(ref) daba `false` -> este
     *  mismo test daba `safeToReplace(ref) === 'safe'` para un proceso
     *  VIVO, violando "JAMAS safe sin evidencia" (R4.2b). Tras el fix,
     *  refIsAlive en win32 usa process.kill(pid,0) (respaldado por el
     *  kernel via libuv) y nunca ps/pgrep. */
    test('safeToReplace en win32 (mockeado): muerto probado (ESRCH real) => safe; vivo => indeterminate, JAMAS safe por ceguera de ps/pgrep emulado (R4.2b)', async () => {
        const originalPlatform = process.platform;
        try {
            const a = adapterFor('codex');
            const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'nWin32');
            Object.defineProperty(process, 'platform', { value: 'win32' });

            // El pid vive de verdad: nunca 'safe' sin evidencia real de muerte.
            expect(a.safeToReplace(ref)).toBe('indeterminate');

            // Un ps/pgrep emulado y ciego (exit 1 para un pid nativo real) ya
            // NO puede empujar el veredicto hacia 'safe': refIsAlive en win32
            // nunca invoca ps/pgrep — SI invoca powershell.exe (win32ProcessInfo,
            // R6 ronda 2) para la verificacion de identidad completa cuando el
            // ref no esta degradado, que es un mecanismo distinto y legitimo
            // (WMI, no la capa emulada MSYS/Cygwin) — no se afirma "cero
            // llamadas", se afirma "ps/pgrep especificamente, nunca".
            const cp = require('child_process');
            const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation(() => {
                const err: any = new Error('no matches found'); err.status = 1; throw err;
            });
            expect(a.safeToReplace(ref)).toBe('indeterminate');
            const calledBinaries = execSpy.mock.calls.map((call) => call[0]);
            expect(calledBinaries).not.toContain('ps');
            expect(calledBinaries).not.toContain('pgrep');
            execSpy.mockRestore();

            child.kill('SIGKILL');

            // Muerte PROBADA por el SO (ESRCH real de process.kill(pid,0)):
            // recien ahi es legitimo declarar 'safe'.
            const deadRef = { ...ref };
            const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
                const err: any = new Error('no such process'); err.code = 'ESRCH'; throw err;
            });
            expect(a.safeToReplace(deadRef)).toBe('safe');
            killSpy.mockRestore();
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
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
