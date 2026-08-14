import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeSensorStatus } from '../../../src/commands/sensors/status';

// `resolveOnPath` resuelve PATH en proceso (ya no invoca un shell — ver el
// comentario de seguridad en core/paths.ts). Estos tests controlan un PATH
// aislado en vez de mockear `execSync`: refleja el mecanismo real y los vuelve
// deterministas. Lo que se verifica en win32 sigue siendo lo mismo que motivo
// este archivo: que un shim `.cmd` de npm resuelva (bug real publicado en
// v3.9.0, donde los sensores quedaban todos "no encontrados" en Windows).
describe('computeSensorStatus — Windows PATH resolution', () => {
    let tmpDir: string;
    let pathDir: string;
    let originalPath: string | undefined;
    let originalPathExt: string | undefined;
    const originalPlatform = process.platform;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-win-'));
        pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-win-path-'));
        originalPath = process.env.PATH;
        originalPathExt = process.env.PATHEXT;
        process.env.PATH = pathDir;
        process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
        Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        if (originalPathExt === undefined) delete process.env.PATHEXT;
        else process.env.PATHEXT = originalPathExt;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(pathDir, { recursive: true, force: true });
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    function writeManifest() {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { security: { cmd: 'semgrep --json .', fast: false } }
        }));
    }

    it('resuelve un binario instalado en win32 via PATHEXT (incluido un shim .cmd)', async () => {
        writeManifest();
        // En win32 el usuario escribe `semgrep` y en disco existe `semgrep.cmd`.
        fs.writeFileSync(path.join(pathDir, 'semgrep.cmd'), '@echo off\r\n');

        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.security.ok).toBe(true);
    });

    it('reporta ok:false en win32 cuando el binario no esta en PATH', async () => {
        writeManifest();
        // PATH aislado y vacio.
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.security.ok).toBe(false);
    });

    it('en win32 no exige bit de ejecucion — un .exe sin permisos POSIX igual resuelve', async () => {
        writeManifest();
        fs.writeFileSync(path.join(pathDir, 'semgrep.exe'), '');
        fs.chmodSync(path.join(pathDir, 'semgrep.exe'), 0o644);

        expect((await computeSensorStatus(tmpDir)).checks.security.ok).toBe(true);
    });
});
