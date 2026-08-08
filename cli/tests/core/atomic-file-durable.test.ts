import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeFileAtomicDurable, fsyncDirSync } from '../../src/core/atomic-file';

describe('writeFileAtomicDurable', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-durable-')); });
    afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    test('escribe contenido y respeta mode 0600 (R1.2)', () => {          // verifies R1.2
        const f = path.join(dir, 'state.json');
        writeFileAtomicDurable(f, '{"a":1}', 0o600);
        expect(fs.readFileSync(f, 'utf8')).toBe('{"a":1}');
        // Windows fs.chmod can only toggle the read-only attribute, not set
        // granular POSIX bits — see tests/core/atomic-file.test.ts for the
        // confirmed 0o600 -> 0o666 shape on win32.
        expect(fs.statSync(f).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600);
    });

    test('sobrevive a reemplazos consecutivos sin residuo tmp (R1.2)', () => {  // verifies R1.2
        const f = path.join(dir, 'state.json');
        writeFileAtomicDurable(f, 'v1', 0o600);
        writeFileAtomicDurable(f, 'v2', 0o600);
        expect(fs.readFileSync(f, 'utf8')).toBe('v2');
        expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp'))).toEqual([]);
    });

    test('fallo del fsync de directorio LANZA — sin fallback silencioso (R1.2)', () => {  // verifies R1.2
        const f = path.join(dir, 'state.json');
        const realOpen = fs.openSync;
        // writeFileAtomic abre el tmp con 'wx'; el fsync de directorio abre con 'r':
        // simulamos que el open del directorio falla (EIO/EPERM segun filesystem).
        jest.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
            if (flags === 'r') throw new Error('EIO simulado');
            return realOpen(p, flags, mode);
        }) as typeof fs.openSync);
        expect(() => writeFileAtomicDurable(f, '{"a":1}', 0o600)).toThrow(/fsync de directorio/);
    });

    test('fsyncDirSync exitoso no lanza sobre un directorio real (R1.2)', () => {  // verifies R1.2
        expect(() => fsyncDirSync(dir)).not.toThrow();
    });

    describe('fsyncDirSync en Windows (R6 CI, 2026-08-08)', () => {
        // Windows no soporta fsync-ear un fd de directorio en absoluto (confirmado en la
        // primera corrida real de R6 en windows-latest: EPERM en TODAS las llamadas,
        // nunca un fallo intermitente) — degrada a no-op solo para esa combinacion exacta
        // (win32 + EPERM en el fsync mismo), nunca para otra plataforma ni otro error.
        const realPlatform = process.platform;
        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        });

        test('EPERM en el fsync no lanza en win32 — degrada a no-op', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const err = new Error('operation not permitted, fsync') as NodeJS.ErrnoException;
            err.code = 'EPERM';
            jest.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw err; });

            expect(() => fsyncDirSync(dir)).not.toThrow();
        });

        test('un error que NO es EPERM en el fsync sigue lanzando en win32', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const err = new Error('disk full') as NodeJS.ErrnoException;
            err.code = 'ENOSPC';
            jest.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw err; });

            expect(() => fsyncDirSync(dir)).toThrow(/fsync de directorio/);
        });

        test('EPERM en el fsync sigue lanzando fuera de win32 — la excepcion es exclusiva de Windows', () => {
            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
            const err = new Error('operation not permitted, fsync') as NodeJS.ErrnoException;
            err.code = 'EPERM';
            jest.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw err; });

            expect(() => fsyncDirSync(dir)).toThrow(/fsync de directorio/);
        });

        test('un fallo en el open (no en el fsync) sigue lanzando incluso en win32', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const realOpen = fs.openSync;
            jest.spyOn(fs, 'openSync').mockImplementation(((p: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
                if (flags === 'r') { const e = new Error('EPERM simulado') as NodeJS.ErrnoException; e.code = 'EPERM'; throw e; }
                return realOpen(p, flags, mode);
            }) as typeof fs.openSync);

            expect(() => fsyncDirSync(dir)).toThrow(/fsync de directorio/);
        });
    });
});
