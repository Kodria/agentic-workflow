import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { spawnStructured, refIsAlive, terminateGroupConfirmed, groupIsGone, activitySnapshot, captureSelfRef, captureRefFor, processStatesAreGone } from '../../../src/core/journal/process';

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

    test('refIsAlive rechaza cualquier campo distinto de la tupla completa (R2.1)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n2');
        expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(false);
        expect(refIsAlive({ ...ref, spawnNonce: 'otro-nonce' })).toBe(false);
        expect(refIsAlive({ ...ref, argvDigest: 'ffffffffffffffff' })).toBe(false);
        expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(false);
        expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
        child.kill('SIGKILL');
    });

    test('terminateGroupConfirmed no senializa un PGID si la identidad del lider no coincide', async () => {
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'n-no-kill');
        const mismatched = { ...ref, startTime: 'identidad-de-otro-proceso' };
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
        // Aca `spawnStructured` corre ANTES de instalar el mock de
        // execFileSync, y en este entorno (sin powershell.exe real) su
        // intento win32 de WMI falla por ENOENT genuino => captureRefFor
        // degrada la ref a startTime/psArgsDigest 'unknown'. Con una ref
        // degradada, refIsAlive corta ANTES de tocar WMI (ver
        // src/core/journal/process.ts, paso 3 del comentario de refIsAlive)
        // — asi que esta asercion ("execFileSync jamas se llama DENTRO de
        // refIsAlive") sigue siendo exacta pese a que la ronda 2 del fix
        // agrego un camino WMI: ese camino solo se paga con una identidad
        // NO degradada (ver el describe 'identidad completa via WMI' mas
        // abajo para esa cobertura).
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n-win32-a');
        expect(ref.startTime).toBe('unknown');   // precondicion del escenario: identidad degradada
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
            expect(execSpy).not.toHaveBeenCalled();       // refIsAlive en win32 ni siquiera intenta ps/pgrep/WMI con ref degradada
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

    test('refIsAlive en win32 NUNCA declara muerte por un error que no sea ESRCH (ej. EPERM: el pid existe pero sin permiso de senializarlo) (R2.1)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        jest.spyOn(process, 'kill').mockImplementation(() => {
            const err: any = new Error('operation not permitted'); err.code = 'EPERM'; throw err;
        });
        // fakeRef con identidad NO degradada (startTime real, no 'unknown'):
        // fuerza a refIsAlive a llegar hasta el chequeo WMI (paso 4). Se
        // mockea powershell.exe explicitamente como "no disponible" (en vez
        // de dejar que ENOENT ocurra por accidente porque este sandbox no
        // tiene powershell.exe real) para que el test sea explicito sobre
        // que camino ejercita y no dependa de una casualidad del entorno.
        const cp = require('child_process');
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args: unknown[]) => {
            const [cmd] = args as [string];
            if (cmd === 'powershell.exe') { const err: any = new Error('no disponible en este host'); err.code = 'ENOENT'; throw err; }
            throw new Error('llamada inesperada a execFileSync en este test: ' + cmd);
        });
        try {
            const fakeRef = { pid: 4242, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 4242, psArgsDigest: 'x' };
            // pidExistsNative dice "vivo" (EPERM no es ESRCH) y WMI no pudo
            // ejecutar (ENOENT simulado): ninguna de las dos fuentes prueba
            // muerte => jamas declarar muerte (R2.1).
            expect(refIsAlive(fakeRef)).toBe(true);
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
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args: unknown[]) => {
            const [cmd] = args as [string, string[]];
            if (cmd === 'taskkill') {
                child.kill('SIGKILL');   // simula taskkill matando de verdad al pid real
                return '';
            }
            // ref.startTime es real aca (capturada en POSIX antes del mock,
            // ver arriba) => refIsAlive (paso previo a la escalera de kill)
            // llega hasta WMI. Simula "no disponible" explicitamente en vez
            // de depender de un ENOENT accidental de este sandbox — el
            // resultado (fail hacia 'vivo', R2.1) es el mismo que se
            // necesita para que la escalera de terminacion prosiga.
            if (cmd === 'powershell.exe') { const err: any = new Error('no disponible en este host'); err.code = 'ENOENT'; throw err; }
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

/** Ronda 2 del fix win32 (R2.1/R6): la ronda 1 solo probaba existencia
 *  (`pidExistsNative`) — cualquier ref con un pid vivo pasaba, sin importar
 *  si el resto de la tupla (startTime/spawnNonce/argvDigest/psArgsDigest)
 *  coincidia. Eso fallaba exactamente el mismo test que en POSIX (misma
 *  suite, arriba: 'refIsAlive rechaza cualquier campo distinto de la tupla
 *  completa') cuando corre en windows-latest real, porque ahi
 *  `isWindowsNative()` es true de verdad — no hay mock de plataforma que
 *  active/desactive esa cobertura, el mismo test generico ejercita la rama
 *  de produccion real. Estos tests mockean `powershell.exe` (el unico canal
 *  disponible para WMI/Win32_Process en win32, ver win32ProcessInfo) con
 *  una respuesta realista para poder ejercitar y fijar el comportamiento de
 *  esa rama de forma determinista, sin depender de Windows real. */
describe('process identity (win32, mockeado) — identidad completa via WMI (R2.1/R6, ronda 2)', () => {
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

    test('refIsAlive en win32 con identidad NO degradada: la tupla completa coincide via WMI => vivo; CUALQUIER campo alterado => muerto (R2.1, R6 — replica exacta del test generico de POSIX de mas arriba)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const fakeCreationDate = '2026-08-08T00:00:00.0000000-00:00';
        mockPowershell(JSON.stringify({ CreationDate: fakeCreationDate, CommandLine: 'C:\\node.exe fake-argv' }));
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n-win32-full');
        try {
            expect(ref.startTime).toBe(fakeCreationDate);   // precondicion: identidad NO degradada
            expect(refIsAlive(ref)).toBe(true);
            // Cada campo de la tupla, alterado individualmente, rompe la
            // identidad — igual que R2.1/R6 exigen en POSIX (bloqueador 6:
            // nunca PID solo). startTime y processGroup se comparan
            // directo; spawnNonce/argvDigest/psArgsDigest via el digest
            // combinado (identityDigest), igual que la rama POSIX.
            expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(false);
            expect(refIsAlive({ ...ref, spawnNonce: 'otro-nonce' })).toBe(false);
            expect(refIsAlive({ ...ref, argvDigest: 'ffffffffffffffff' })).toBe(false);
            expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(false);
            expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
        } finally {
            child.kill('SIGKILL');
        }
    });

    test('refIsAlive en win32: WMI confirma POSITIVAMENTE ausencia ("absent") — evidencia INDEPENDIENTE de process.kill, corrige el caso donde process.kill fue mockeado/interceptado por otro proposito (regresion: CI real, gate-reconcile.test.ts mockeaba process.kill globalmente para verificar "nunca se envia señal" y eso, con el fix de ronda 1, hacia que pidExistsNative reportara "vivo" para un pid que jamas existio, encadenando en cuelgue de la escalera de terminacion)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        // Simula exactamente el mock incidental de gate-reconcile.test.ts:
        // process.kill mockeado a "siempre exito" (nunca ESRCH) para un
        // proposito ajeno (verificar que nunca se envia señal real), sin
        // intencion de fingir que el pid esta vivo.
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
        mockPowershell('');   // WMI corrio, cero coincidencias: "absent"
        const fakeRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        try {
            expect(refIsAlive(fakeRef)).toBe(false);
        } finally {
            killSpy.mockRestore();
        }
    });

    test('refIsAlive en win32: powershell corre pero devuelve JSON inesperado/no parseable => inconclusive, NUNCA "absent" ni "muerto" (R2.1)', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockPowershell('esto no es JSON valido {{{');
        const fakeRef = { pid: process.pid, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: process.pid, psArgsDigest: 'x' };
        expect(refIsAlive(fakeRef)).toBe(true);   // el proceso actual esta vivo de verdad; salida rota no es prueba de nada
    });

    test('refIsAlive en win32: timeout/fallo de powershell.exe (ETIMEDOUT) nunca declara muerte (R2.1) — silencio no es prueba', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const cp = require('child_process');
        const execSpy = jest.spyOn(cp, 'execFileSync').mockImplementation((...args: unknown[]) => {
            const [cmd] = args as [string];
            if (cmd === 'powershell.exe') { const err: any = new Error('timeout'); err.code = 'ETIMEDOUT'; err.killed = true; throw err; }
            throw new Error('llamada inesperada a execFileSync en este test: ' + cmd);
        });
        try {
            const fakeRef = { pid: process.pid, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: process.pid, psArgsDigest: 'x' };
            expect(refIsAlive(fakeRef)).toBe(true);
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
