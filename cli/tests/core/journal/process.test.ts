import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { spawnStructured, refIsAlive, terminateGroupConfirmed, groupIsGone, activitySnapshot, captureSelfRef } from '../../../src/core/journal/process';

describe('process identity', () => {
    test('spawnStructured produce ProcessRef con tupla completa (R2.1, R4.7)', async () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nonce-abc');
        expect(ref.pid).toBe(child.pid);
        expect(ref.spawnNonce).toBe('nonce-abc');
        expect(typeof ref.startTime).toBe('string');
        expect(ref.processGroup).toBeGreaterThan(0);
        expect(ref.psArgsDigest).toMatch(/^[0-9a-f]{16}$/);
        expect(refIsAlive(ref)).toBe(true);
        const dead = await terminateGroupConfirmed(ref, { termGraceMs: 300, killGraceMs: 300 });
        expect(dead).toBe(true);
        expect(refIsAlive(ref)).toBe(false);
    });

    test('refIsAlive rechaza identidad parcial: startTime O psArgsDigest distintos (R2.1)', () => {  // verifies R2.1
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 3000)'], process.cwd(), 'n2');
        expect(refIsAlive({ ...ref, startTime: 'otro-momento' })).toBe(false);
        expect(refIsAlive({ ...ref, psArgsDigest: 'ffffffffffffffff' })).toBe(false);
        expect(refIsAlive({ ...ref, processGroup: ref.processGroup + 1 })).toBe(false);
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
            env: { ...process.env, PATH: `${workDir}:${process.env.PATH}` },
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
