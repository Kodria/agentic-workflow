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
        expect(fs.statSync(f).mode & 0o777).toBe(0o600);
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
});
