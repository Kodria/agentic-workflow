// SECURITY regression: `resolveOnPath` used to interpolate its argument into a
// SHELL string (`command -v ${bin}` / `where ${bin}`) and run it through
// execSync. The argument is the first token of a sensor's `cmd`, which comes
// from `.awm/sensors.json` — a file that is COMMITTED IN THE REPO and also
// regenerated from a registry sensor-pack's `defaultCmd`. So both a cloned
// untrusted repo and a third-party registry could reach it.
//
// The token cannot contain whitespace (it is a split token), but that stops
// nothing: `${IFS}` and `$(...)` sidestep it entirely. Confirmed exploit on the
// real binary — `awm sensors status` (and `awm preflight`) executed an attacker
// command and then reported the sensor as HEALTHY, because the injected command
// exited 0:
//
//     {"sensors":{"lint":{"cmd":"foo;touch${IFS}/tmp/PWNED","fast":true}}}
//     $ awm sensors status      # -> /tmp/PWNED created, status "✔ HEALTHY"
//
// `awm sensors status` and `awm preflight` are commands a user reasonably
// expects to be INERT — read-only inspection. The fix removes the shell
// entirely: PATH is resolved in-process, so there is no interpreter to inject
// into, on any platform.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveOnPath } from '../../src/core/paths';

describe('resolveOnPath: sin shell, inmune a inyeccion', () => {
    const realPlatform = process.platform;
    let binDir: string;
    let originalPath: string | undefined;

    beforeEach(() => {
        binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-pathres-'));
        originalPath = process.env.PATH;
        process.env.PATH = binDir;
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: realPlatform });
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        fs.rmSync(binDir, { recursive: true, force: true });
    });

    function setPlatform(p: string) {
        Object.defineProperty(process, 'platform', { value: p });
    }

    /** Un binario "real" en el PATH falso. */
    function putBinary(name: string, mode = 0o755) {
        const p = path.join(binDir, name);
        fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(p, mode);
        return p;
    }

    it('encuentra un binario real presente en PATH', () => {
        setPlatform('linux');
        putBinary('mytool');
        expect(resolveOnPath('mytool')).toBe(true);
    });

    it('devuelve false para un binario ausente', () => {
        setPlatform('linux');
        expect(resolveOnPath('definitivamente-no-existe')).toBe(false);
    });

    it('NO ejecuta un payload de inyeccion — el efecto lateral jamas ocurre (regresion de seguridad)', () => {
        setPlatform('linux');
        const marker = path.join(binDir, 'PWNED');
        // El mismo payload confirmado contra el binario real.
        const payload = `foo;touch\${IFS}${marker}`;
        expect(resolveOnPath(payload)).toBe(false);
        expect(fs.existsSync(marker)).toBe(false);
    });

    it.each([
        ['sustitucion de comando', 'foo$(touch MARKER)'],
        ['backticks', 'foo`touch MARKER`'],
        ['encadenado con &&', 'foo&&touch'],
        ['pipe', 'foo|touch'],
        ['redireccion', 'foo>MARKER'],
        ['newline embebido', 'foo\ntouch MARKER'],
        ['expansion de variable', '$HOME'],
    ])('trata %s como un nombre literal, nunca como sintaxis', (_n, payload) => {
        setPlatform('linux');
        // No existe un archivo con ese nombre literal => false, y nada se ejecuta.
        expect(resolveOnPath(payload)).toBe(false);
    });

    // Solo donde el filesystem PUEDE expresar la premisa. `setPlatform('linux')` cambia
    // lo que hace el codigo, no lo que hace el disco: en un runner Windows `chmod 0o644`
    // no quita ningun bit de ejecucion (no existe), asi que `accessSync(X_OK)` aprueba el
    // archivo y el test fallaba sobre un producto que se comporta bien. La rama win32 —
    // "no exige bit de ejecucion" — la cubre su propio caso mas abajo, que SI es
    // observable ahi.
    const itPosix = realPlatform === 'win32' ? it.skip : it;

    itPosix('en POSIX exige el bit de ejecucion — un archivo no ejecutable no es un binario resoluble', () => {
        setPlatform('linux');
        putBinary('noexec', 0o644);
        expect(resolveOnPath('noexec')).toBe(false);
    });

    it('en win32 resuelve por PATHEXT, incluyendo los shims .cmd de npm (regresion: R1, bug publicado en v3.9.0)', () => {
        setPlatform('win32');
        // En win32 el usuario escribe `eslint`, y lo que existe en disco es
        // `eslint.cmd` — no resolverlo fue un bug real que rompia los sensores.
        fs.writeFileSync(path.join(binDir, 'eslint.cmd'), '@echo off\r\n');
        process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
        expect(resolveOnPath('eslint')).toBe(true);
        expect(resolveOnPath('noexiste')).toBe(false);
    });

    it('en win32 no exige bit de ejecucion (no existe ese concepto ahi)', () => {
        setPlatform('win32');
        fs.writeFileSync(path.join(binDir, 'tool.exe'), '');
        process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
        expect(resolveOnPath('tool')).toBe(true);
    });

    it('un nombre con separador de ruta se chequea como ruta directa, sin recorrer PATH', () => {
        // La plataforma REAL, no una simulada: el invariante es "un nombre que trae el
        // separador de SU plataforma se resuelve como ruta". Fijar 'linux' mientras el
        // disco entrega `D:\...\directo` mezclaba las dos mitades — el codigo buscaba
        // '/' y la ruta traia '\\' — y fallaba por la contradiccion del arreglo, no por
        // el producto. Asi el caso corre de verdad en los dos sistemas operativos.
        setPlatform(realPlatform);
        const abs = putBinary('directo');
        expect(resolveOnPath(abs)).toBe(true);
        expect(resolveOnPath(path.join(binDir, 'no-esta'))).toBe(false);
    });

    it('entradas vacias o no-string no resuelven ni crashean', () => {
        setPlatform('linux');
        expect(resolveOnPath('')).toBe(false);
        expect(resolveOnPath('   ')).toBe(false);
        expect(resolveOnPath(undefined as unknown as string)).toBe(false);
    });

    it('un PATH ausente no crashea', () => {
        setPlatform('linux');
        delete process.env.PATH;
        expect(resolveOnPath('cualquiera')).toBe(false);
    });
});
