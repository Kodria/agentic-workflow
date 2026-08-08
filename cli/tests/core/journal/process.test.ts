import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { spawnStructured, refIsAlive, terminateGroupConfirmed, groupIsGone, activitySnapshot, captureSelfRef, captureRefFor, processStatesAreGone } from '../../../src/core/journal/process';
import { isWindowsNative } from '../../../src/core/paths';

describe('process identity', () => {
    test('spawnStructured produce ProcessRef con tupla completa (R2.1, R4.7)', async () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nonce-abc');
        expect(ref.pid).toBe(child.pid);
        expect(ref.spawnNonce).toBe('nonce-abc');
        expect(typeof ref.startTime).toBe('string');
        expect(ref.processGroup).toBeGreaterThan(0);
        // hex real cuando `ps` pudo observar el proceso (caso normal en
        // POSIX); sentinel 'unknown' documentado (ver captureRefFor) cuando
        // no pudo — en win32 esto es la ruta NORMAL, no un error: `ps`/`pgrep`
        // ahi (si resuelven en el PATH) son el ps/pgrep emulado de
        // MSYS/Cygwin, ciego a procesos nativos (ver pidExistsNative en
        // src/core/journal/process.ts). El formato exacto de este campo
        // nunca es la fuente de verdad de vida/muerte — solo lo es refIsAlive
        // (ver los tests de la seccion 'process identity (win32, mockeado)').
        expect(ref.psArgsDigest).toMatch(/^([0-9a-f]{16}|unknown)$/);
        expect(refIsAlive(ref)).toBe(true);
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 300, killGraceMs: 300 });
        expect(dead).toBe(true);
        expect(refIsAlive(ref)).toBe(false);
    });

    test('refIsAlive rechaza cualquier campo distinto de la tupla completa (R2.1) — en win32 nativo, solo identidad reducida (ronda 3, ver src/core/journal/process.ts)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n2');
        if (isWindowsNative()) {
            // win32 real (ronda 3): refIsAlive solo valida pid existente +
            // processGroup === pid; el resto de la tupla es informativo
            // (via WMI, captureRefFor) pero NO gatea el veredicto — gap
            // aceptado y documentado (ver refIsAlive en process.ts).
            expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(true);
            expect(refIsAlive({ ...ref, spawnNonce: 'otro-nonce' })).toBe(true);
            expect(refIsAlive({ ...ref, argvDigest: 'ffffffffffffffff' })).toBe(true);
            expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(true);
            expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
        } else {
            expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(false);
            expect(refIsAlive({ ...ref, spawnNonce: 'otro-nonce' })).toBe(false);
            expect(refIsAlive({ ...ref, argvDigest: 'ffffffffffffffff' })).toBe(false);
            expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(false);
            expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
        }
        child.kill('SIGKILL');
    });

    test('terminateGroupConfirmed no senializa un PGID si la identidad del lider no coincide', async () => {
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'n-no-kill');
        // win32 (ronda 3): un mismatch de SOLO startTime ya no lo detecta
        // refIsAlive ahi (gap de reciclado de PID aceptado, ver process.ts) —
        // se usa un mismatch de processGroup, que SI se valida en ambas
        // plataformas, para que este test siga siendo significativo en
        // cualquier host.
        const mismatched = isWindowsNative()
            ? { ...ref, processGroup: ref.processGroup + 1 }
            : { ...ref, startTime: 'identidad-de-otro-proceso' };
        const confirmed = await terminateGroupConfirmed(mismatched, { termGraceMs: 20, killGraceMs: 20 });
        expect(confirmed).toBe(false);
        expect(refIsAlive(ref)).toBe(true);
        child.kill('SIGKILL');
    });

    test('refIsAlive rechaza un ProcessRef que simula reutilizacion de PID: el pid actual esta vivo, pero pertenecia a un proceso YA MUERTO con identidad distinta (R6)', () => {  // verifies R6
        // El fixture de R6 explicito en el design doc: los PIDs son reciclados
        // por el SO, asi que la identidad JAMAS puede confiarse solo del pid.
        // Simulacion deterministica (evita depender de que el SO realmente
        // recicle un pid dentro del test): un proceso REAL y vivo ahora mismo
        // (mismo pid), pero un ProcessRef que describe un proceso DISTINTO,
        // ya finalizado, que alguna vez tuvo ese mismo pid — startTime, nonce,
        // digest de argv, grupo y digest de `ps args` todos DISTINTOS del
        // proceso real que hoy ocupa ese pid.
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n-reuse-real');
        const reusedPidStaleRef = {
            pid: ref.pid,                                  // el numero de pid SI esta vivo hoy...
            startTime: 'Mon Jan  1 00:00:00 2024',          // ...pero como un proceso YA MUERTO distinto
            spawnNonce: 'nonce-de-un-job-anterior-ya-terminado',
            argvDigest: 'deadbeefdeadbeef',
            processGroup: ref.processGroup + 9999,
            psArgsDigest: 'cafebabecafebabe',
        };
        expect(refIsAlive(reusedPidStaleRef)).toBe(false);   // no es prueba de vida DE ESE proceso logico
        expect(refIsAlive(ref)).toBe(true);                  // el pid real, con su identidad real, sigue vivo
        child.kill('SIGKILL');
    });

    test('terminateGroupConfirmed confirma el GRUPO entero, no solo el lider (R2.1)', async () => {  // verifies R2.1
        // El hijo spawnea un nieto en su mismo grupo; la confirmacion exige pgrep -g vacio.
        const spawnGrandchild = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},5000)']); setTimeout(()=>{}, 5000)";
        const { ref } = spawnStructured(['node', '-e', spawnGrandchild], process.cwd(), 'n3');
        await new Promise((r) => setTimeout(r, 400));      // dejar nacer al nieto
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 2000, killGraceMs: 2000 });
        expect(dead).toBe(true);
        expect(groupIsGone(ref.processGroup)).toBe(true);
    }, 15000);

    test('activitySnapshot reporta cpu y tamanio de grupo de un proceso vivo (soporte R4.2)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n4');
        const snap = activitySnapshot(ref);
        expect(snap).not.toBeNull();
        expect(typeof snap!.cpuTime).toBe('string');
        expect(snap!.groupSize).toBeGreaterThanOrEqual(1);
        child.kill('SIGKILL');
    });

    test('captureSelfRef captura la identidad del proceso actual (R2.1)', () => {  // verifies R2.1
        const self = captureSelfRef('nonce-self');
        expect(self.pid).toBe(process.pid);
        expect(refIsAlive(self)).toBe(true);
    });

    test('un grupo compuesto solo por zombies esta terminado; no espera una senial imposible', () => {
        expect(processStatesAreGone(['Z', 'Z+','Zs', null])).toBe(true);
        expect(processStatesAreGone(['Z', 'S'])).toBe(false);
        expect(processStatesAreGone(['R'])).toBe(false);
    });

    test('refIsAlive nunca declara muerte si ps falla en ejecutarse (no ENOENT como prueba) (R2.1)', () => {  // verifies R2.1
        const cp = require('child_process');
        const self = captureSelfRef('nonce-ps-fail');
        const spy = jest.spyOn(cp, 'execFileSync').mockImplementation(() => {
            const err: any = new Error('spawn ps ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        try {
            expect(refIsAlive(self)).toBe(true);
        } finally {
            spy.mockRestore();
        }
    });

    test('activitySnapshot no crashea si ps falla en la lectura de cpu time (R2.1)', () => {  // verifies R2.1
        const cp = require('child_process');
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n5');
        const spy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args) => {
            const cmd = args[0];
            if (cmd === 'ps') {
                const err: any = new Error('spawn ps ENOENT');
                err.code = 'ENOENT';
                throw err;
            }
            throw new Error('unexpected execFileSync call in this test: ' + cmd);
        });
        try {
            expect(() => activitySnapshot(ref)).not.toThrow();
        } finally {
            spy.mockRestore();
            child.kill('SIGKILL');
        }
    });

    test('spawnStructured usa stdio:ignore — sin pipes que destruir ni EPIPE posible en el hijo (regresion: wrapper detached moria silenciosamente al escribir a un pipe destruido por el padre)', () => {
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n-stdio-ignore');
        expect(child.stdout).toBeNull();
        expect(child.stderr).toBeNull();
        expect(child.stdin).toBeNull();
        expect(refIsAlive(ref)).toBe(true);
        child.kill('SIGKILL');
    });

    test('captureRefFor degrada a unknown si ps falla, nunca crashea al capturar identidad (R2.1)', () => {  // verifies R2.1
        const cp = require('child_process');
        const spy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args) => {
            const err: any = new Error('spawn ps ENOENT');
            err.code = 'ENOENT';
            throw err;
        });
        try {
            expect(() => captureSelfRef('nonce-capture-fail')).not.toThrow();
            const ref = captureSelfRef('nonce-capture-fail');
            expect(ref.startTime).toBe('unknown');
            expect(ref.psArgsDigest).toBe('unknown');
        } finally {
            spy.mockRestore();
        }
    });
});

/** Regresion (CI windows-latest, primera corrida real de la matriz): ps/pgrep,
 *  cuando resuelven en el PATH en Windows, son el ps/pgrep EMULADO de
 *  MSYS/Cygwin (Git for Windows) — una capa con su propia tabla de pids,
 *  ciega a procesos nativos spawneados via CreateProcess (exactamente lo que
 *  produce spawnStructured). El codigo viejo interpretaba el exit 1 de ese
 *  ps/pgrep "ciego" como "el SO confirmo que el pid no existe" — falso, y
 *  rompia el invariante "JAMAS safe sin evidencia": `safeToReplace` devolvia
 *  'safe' para un proceso genuinamente vivo (ver adapter.test.ts). No hay
 *  windows-latest real disponible en este entorno; estos tests mockean
 *  `process.platform` (mismo patron que
 *  tests/commands/sensors/exec-windows.test.ts, que ya cubre exactamente
 *  este problema para sensors/exec.ts::killTree) para ejercitar la rama
 *  win32 REAL del codigo de produccion contra un pid real y vivo. */
describe('process identity (win32, mockeado — sin windows real disponible en este entorno)', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        jest.restoreAllMocks();
    });

    test('refIsAlive en win32 usa process.kill(pid,0), NUNCA ps/pgrep — reproduce el bug: un ps/pgrep "ciego" que devuelve exit 1 para un pid real y vivo ya no lo declara muerto (R2.1, R4.2b)', () => {
        // Ronda 3 (ver refIsAlive en process.ts): el veredicto win32 ya NO
        // depende de si la identidad esta degradada o no ('unknown' vs
        // datos reales de WMI) — refIsAlive ahi SOLO llama a
        // pidExistsNative (process.kill) + convencion de processGroup,
        // incondicionalmente. La precondicion original de este test
        // ("identidad degradada porque no hay powershell.exe real en este
        // entorno") ya no es ni necesaria ni confiable: en windows-latest
        // CI real, powershell.exe SI esta disponible y captureRefFor
        // devuelve un startTime real via WMI — lo cual esta bien, porque
        // esta rama de refIsAlive nunca lo consulta de todos modos.
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n-win32-a');
        const cp = require('child_process');
        // Simula EXACTAMENTE el bug real de CI: ps/pgrep "corren" pero
        // devuelven exit 1 (ceguera de MSYS a pids nativos) para un pid que
        // esta genuinamente vivo — el codigo viejo confiaba en esto.
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation(() => {
            const err: any = new Error('no matches found');
            err.status = 1;
            throw err;
        });
        try {
            expect(refIsAlive(ref)).toBe(true);          // vivo de verdad: nunca declarado muerto
            expect(execSpy).not.toHaveBeenCalled();       // refIsAlive en win32 ni siquiera intenta ps/pgrep/WMI
        } finally {
            child.kill('SIGKILL');
        }
    });

    test('refIsAlive en win32 declara muerte SOLO con ESRCH real de process.kill(pid,0) (R2.1)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
            const err: any = new Error('no such process'); err.code = 'ESRCH'; throw err;
        });
        const fakeRef = { pid: 999999, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        expect(refIsAlive(fakeRef)).toBe(false);
        expect(killSpy).toHaveBeenCalledWith(999999, 0);
    });

    test('pidExistsNative reintenta un ESRCH transitorio antes de declarar muerte — no confia en un unico intento (regresion: CI real windows-latest, dos corridas del mismo commit dieron resultados distintos para un proceso recien spawneado)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        let calls = 0;
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
            calls++;
            if (calls < 3) { const err: any = new Error('transient'); err.code = 'ESRCH'; throw err; }
            return true;   // el pid "aparece" recien al tercer intento — simula la carrera real observada
        });
        const fakeRef = { pid: 424242, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 424242, psArgsDigest: 'x' };
        expect(refIsAlive(fakeRef)).toBe(true);   // NUNCA declara muerte por el ESRCH transitorio de los primeros 2 intentos
        expect(killSpy).toHaveBeenCalledTimes(3);
    });

    test('pidExistsNative absorbe una carrera transitoria mas larga que el presupuesto original — arranque en frio del primer spawn del job (regresion #2: misma falla real, mismo test, tras el fix de 3x50ms ya mergeado)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        let calls = 0;
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
            calls++;
            // El pid tarda 9 intentos en "aparecer" — mas alla del presupuesto
            // anterior (3 intentos) pero dentro del ampliado (10 intentos).
            if (calls < 9) { const err: any = new Error('transient'); err.code = 'ESRCH'; throw err; }
            return true;
        });
        const fakeRef = { pid: 424243, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 424243, psArgsDigest: 'x' };
        expect(refIsAlive(fakeRef)).toBe(true);
        expect(killSpy).toHaveBeenCalledTimes(9);
    });

    test('pidExistsNative declara muerte solo tras agotar el presupuesto ampliado (10 intentos) — un ESRCH sostenido nunca se lee como vivo', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => {
            const err: any = new Error('gone'); err.code = 'ESRCH'; throw err;
        });
        const fakeRef = { pid: 424244, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 424244, psArgsDigest: 'x' };
        expect(refIsAlive(fakeRef)).toBe(false);
        expect(killSpy).toHaveBeenCalledTimes(10);
    });

    test('refIsAlive en win32 NUNCA declara muerte por un error que no sea ESRCH (ej. EPERM: el pid existe pero sin permiso de senializarlo) (R2.1)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        jest.spyOn(process, 'kill').mockImplementation(() => {
            const err: any = new Error('operation not permitted'); err.code = 'EPERM'; throw err;
        });
        // Ronda 3: refIsAlive en win32 ya no consulta WMI/powershell — solo
        // pidExistsNative + convencion de processGroup. EPERM (el pid existe
        // pero sin permiso de senializarlo) no es ESRCH => pidExistsNative
        // dice "vivo"; execFileSync no deberia ni invocarse.
        const cp = require('child_process');
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args: unknown[]) => {
            throw new Error('llamada inesperada a execFileSync en este test: ' + args[0]);
        });
        try {
            const fakeRef = { pid: 4242, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 4242, psArgsDigest: 'x' };
            expect(refIsAlive(fakeRef)).toBe(true);
            expect(execSpy).not.toHaveBeenCalled();
        } finally {
            execSpy.mockRestore();
        }
    });

    test('terminateGroupConfirmed en win32 usa `taskkill /pid <pid> /T /F`, NUNCA process.kill(-pgid) (mismo patron probado en sensors/exec.ts::killTree, ver tests/commands/sensors/exec-windows.test.ts)', async () => {
        // Spawnea en modo POSIX real (platform sin mockear todavia) para que
        // ref.processGroup sea un pgid real de ps (detached:true en esta
        // plataforma) — evita que el pgid observado sea el del test runner.
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'n-win32-taskkill');
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const cp = require('child_process');
        // Ronda 3: refIsAlive en win32 ya no consulta WMI/powershell — solo
        // pidExistsNative (process.kill) + convencion de processGroup, asi
        // que el unico execFileSync que este camino dispara es taskkill.
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args: unknown[]) => {
            const [cmd] = args as [string, string[]];
            if (cmd === 'taskkill') {
                child.kill('SIGKILL');   // simula taskkill matando de verdad al pid real
                return '';
            }
            throw new Error('llamada inesperada a execFileSync en este test: ' + cmd);
        });
        const posixKillSpy = jest.spyOn(process, 'kill');
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 2000, killGraceMs: 500 });
        expect(execSpy).toHaveBeenCalledWith('taskkill', ['/pid', String(ref.pid), '/T', '/F'], expect.anything());
        expect(dead).toBe(true);
        // Nunca la convencion POSIX de pid negativo (grupo) en esta plataforma.
        for (const call of posixKillSpy.mock.calls) {
            expect(call[0] as number).toBeGreaterThanOrEqual(0);
        }
    }, 15000);
});

/** Ronda 2 del fix win32 (R2.1/R6) agrego captura de identidad completa
 *  (startTime/psArgsDigest reales) via WMI (`Get-CimInstance Win32_Process`,
 *  ver win32ProcessInfo) para `captureRefFor`. Ronda 3 (ver refIsAlive en
 *  process.ts) revirtio el USO de esa captura como gate de liveness —
 *  `refIsAlive` en win32 volvio a pid-existence + convencion de
 *  processGroup solamente, tras un falso negativo real en CI (WMI
 *  demostradamente no confiable en su primera corrida real) — pero la
 *  CAPTURA en si (`captureRefFor`) sigue poblando esos campos como
 *  informacion persistida en el ProcessRef, asi que estos dos tests de
 *  captura siguen vigentes. Los tests que ejercitaban `refIsAlive` via el
 *  camino WMI (ronda 2) fueron removidos: ese camino ya no existe en
 *  produccion — ver la suite generica de arriba
 *  ('refIsAlive rechaza cualquier campo...') para la cobertura actual de
 *  refIsAlive en win32. */
describe('process identity (win32, mockeado) — captura de identidad via WMI (R2.1/R6, ronda 2)', () => {
    const originalPlatform = process.platform;

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        jest.restoreAllMocks();
    });

    function mockPowershell(response: string | (() => string)): void {
        const cp = require('child_process');
        jest.spyOn(cp, 'execFileSync').mockImplementation((...args: unknown[]) => {
            const [cmd] = args as [string];
            if (cmd === 'powershell.exe') return typeof response === 'function' ? response() : response;
            throw new Error('llamada inesperada a execFileSync en este test: ' + cmd);
        });
    }

    test('captureRefFor en win32 usa WMI para obtener startTime/psArgsDigest REALES cuando powershell responde (R2.1)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const fakeCreationDate = '2026-08-08T00:00:00.0000000-00:00';
        mockPowershell(JSON.stringify({ CreationDate: fakeCreationDate, CommandLine: 'C:\\node.exe fake-argv' }));
        const ref = captureRefFor(process.pid, 'nonce-win32-wmi-ok', ['node', 'fake-argv']);
        expect(ref.startTime).toBe(fakeCreationDate);              // ya NO 'unknown': WMI respondio
        expect(ref.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);         // digest real, no sentinel
        expect(ref.processGroup).toBe(process.pid);                 // convencion fija win32: sin pgid real jamas
    });

    test('captureRefFor en win32 degrada a unknown si WMI/powershell no responde, nunca crashea (R2.1) — mismo contrato que la rama POSIX', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const cp = require('child_process');
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation(() => {
            const err: any = new Error('powershell no encontrado'); err.code = 'ENOENT'; throw err;
        });
        try {
            expect(() => captureRefFor(process.pid, 'nonce-win32-wmi-fail', ['node'])).not.toThrow();
            const ref = captureRefFor(process.pid, 'nonce-win32-wmi-fail', ['node']);
            expect(ref.startTime).toBe('unknown');
            expect(ref.psArgsDigest).toBe('unknown');
            expect(ref.processGroup).toBe(process.pid);
        } finally {
            execSpy.mockRestore();
        }
    });
});

/** Defense-in-depth: los execFileSync internos de este archivo (psField,
 *  sleepSync, groupIsGone, activitySnapshot) deben capturar el stderr del
 *  subproceso INTERNAMENTE, nunca relayearlo al stderr del proceso llamante
 *  (`inheritStderr`, el default de Node cuando no se pasa `stdio`). Si el
 *  proceso llamante corre con su propio stderr como un pipe roto/destruido
 *  (el patron exacto que crasheaba al wrapper detached antes del fix de
 *  spawnStructured), un relay de inheritStderr dispara un `write EPIPE` no
 *  catcheable por ningun try/catch sincronico (el throw ocurre via el
 *  'error' event del stream, asincronico) — proceso muerto sin excepcion
 *  visible. Este test reproduce esa condicion contra el `dist/` compilado
 *  REAL (no mockeado): un hijo real con stdio pipe cuyos extremos el padre
 *  destruye (igual que hacia el viejo defaultWrapperSpawner), corriendo
 *  `groupIsGone` contra un `pgrep` stub que escribe a stderr (simulando un
 *  binario real que emite ruido/warnings en stderr incluso en el caso
 *  "sin matches") — sin el fix, esto tumba al hijo; con el fix, sobrevive
 *  y devuelve el resultado correcto. */
describe('process.ts execFileSync: stdio explicito evita inheritStderr hacia un pipe roto', () => {
    const DIST_ENTRY = path.resolve(__dirname, '..', '..', '..', 'dist', 'src', 'core', 'journal', 'process.js');

    beforeAll(() => {
        if (!fs.existsSync(DIST_ENTRY)) {
            throw new Error('dist ausente: corre `cd cli && npm run build` antes de este test (verifica el dist compilado real, no el source transpilado por ts-jest)');
        }
    });

    test('groupIsGone sobrevive un pgrep que escribe a stderr, corriendo en un hijo con stdio pipe destruido por su padre (regresion: inheritStderr de execFileSync sin stdio explicito)', async () => {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-execfilesync-hardening-'));
        const stubBin = path.join(workDir, 'pgrep');
        // pgrep "real" que, incluso en el caso feliz (sin matches, exit 1),
        // tambien emite algo en stderr — plausible en entornos reales
        // (locale warnings, etc.) y suficiente para ejercitar inheritStderr.
        fs.writeFileSync(stubBin, '#!/bin/sh\necho "warning: ruido de stderr" 1>&2\nexit 1\n', { mode: 0o755 });
        const outFile = path.join(workDir, 'out.txt');
        const childScript = path.join(workDir, 'child.js');
        fs.writeFileSync(childScript, `
            const fs = require('fs');
            const { groupIsGone } = require(${JSON.stringify(DIST_ENTRY)});
            try {
                const result = groupIsGone(999999);
                fs.writeFileSync(${JSON.stringify(outFile)}, 'RESULT:' + result);
            } catch (e) {
                fs.writeFileSync(${JSON.stringify(outFile)}, 'THREW:' + e.message);
            }
        `);
        const child = spawn(process.execPath, [childScript], {
            cwd: workDir,
            env: { ...process.env, PATH: `${workDir}${path.delimiter}${process.env.PATH}` },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        // El patron exacto que causaba el crash original: el padre destruye
        // su extremo de los pipes del hijo, cerrando el read-end — cualquier
        // escritura del hijo a su propio stdout/stderr despues de esto EPIPE-ea.
        child.stdout?.destroy();
        child.stderr?.destroy();
        const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            child.on('exit', (code, signal) => resolve({ code, signal }));
        });
        expect(exit.signal).toBeNull();               // nunca deberia morir por senial (crash de node = SIGABRT/uncaught != signal, pero confirmamos ausencia de kill externo)
        expect(exit.code).toBe(0);                     // el hijo debe sobrevivir y salir limpio, NO crashear por EPIPE no catcheable
        const out = fs.readFileSync(outFile, 'utf8');
        expect(out).toBe('RESULT:true');               // logica de negocio intacta: pgrep exit 1 => groupIsGone true
        fs.rmSync(workDir, { recursive: true, force: true });
    });
});
