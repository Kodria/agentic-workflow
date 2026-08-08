import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function targetMode(file: string): number | undefined {
    try {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) {
            throw new Error(`refusing to replace symlink target: ${file}`);
        }
        return stat.isFile() ? stat.mode & 0o777 : undefined;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

export function writeFileAtomic(file: string, content: string, mode = 0o644): void {
    if (typeof file !== 'string' || file.length === 0) {
        throw new Error('file must be a non-empty string');
    }
    if (typeof content !== 'string') {
        throw new Error('content must be a string');
    }
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
        throw new Error('mode must be an integer between 0 and 0777');
    }

    const existingMode = targetMode(file);
    const effectiveMode = existingMode ?? mode;
    const directory = path.dirname(file);
    const nonce = crypto.randomBytes(16).toString('hex');
    const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${nonce}.tmp`);
    fs.mkdirSync(directory, { recursive: true });

    let descriptor: number | undefined;
    let ownsTemporary = false;
    try {
        descriptor = fs.openSync(temporary, 'wx', effectiveMode);
        ownsTemporary = true;
        fs.writeFileSync(descriptor, content, { encoding: 'utf8' });
        fs.fchmodSync(descriptor, effectiveMode);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        targetMode(file);
        fs.renameSync(temporary, file);
    } catch (error) {
        if (descriptor !== undefined) {
            try {
                fs.closeSync(descriptor);
            } catch {
                // best-effort: preserve the original write error; the descriptor closes on process exit.
            }
        }
        if (ownsTemporary) {
            try {
                fs.rmSync(temporary, { force: true });
            } catch {
                // best-effort: preserve the original write error; a failed temp cleanup may leave one sibling file.
            }
        }
        throw error;
    }
}

/** fsync del directorio contenedor: garantiza que una ENTRADA creada/renombrada
 *  sobrevive un crash del OS. Falla LANZANDO — la durabilidad de la transición
 *  es parte del contrato, nunca un best-effort silencioso (design R1.2,
 *  bloqueador 4 de la review del plan) — EXCEPTO en Windows, donde fsync-ear un
 *  file descriptor de directorio no es una operacion que el SO soporte en
 *  absoluto (no es una falla de durabilidad real: no existe el mecanismo
 *  POSIX que esta funcion intenta invocar). Confirmado via R6 CI (2026-08-08,
 *  primera corrida real en windows-latest): `fs.openSync(dir, 'r')` tiene
 *  exito, pero el `fsyncSync` subsiguiente sobre ese fd siempre falla con
 *  EPERM — libuv mapea asi el resultado de `FlushFileBuffers` sobre un handle
 *  de directorio en Win32, que Windows rechaza categoricamente (no es un
 *  fallo intermitente de hardware/permisos, es ausencia de la capacidad).
 *  NTFS ya registra los renames/creates en su propio journal transaccional,
 *  asi que la garantia de durabilidad de la ENTRADA sigue sostenida por el
 *  filesystem — solo el mecanismo explicito para pedirla no existe ahi.
 *  Por eso, y solo para esta combinacion exacta (win32 + EPERM en el fsync,
 *  nunca en el open), esta funcion degrada a no-op en vez de lanzar; culquier
 *  otra plataforma, o cualquier otro código de error incluso en Windows
 *  (el open fallando, ENOENT, EACCES por permisos reales), sigue lanzando. */
export function fsyncDirSync(dir: string): void {
    let dirFd: number | undefined;
    try {
        dirFd = fs.openSync(dir, 'r');
        try {
            fs.fsyncSync(dirFd);
        } catch (error) {
            if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return;
            throw error;
        }
    } catch (error) {
        throw new Error(`fsync de directorio fallo para ${dir}: ${(error as Error).message}`);
    } finally {
        if (dirFd !== undefined) {
            try {
                fs.closeSync(dirFd);
            } catch {
                // best-effort SOLO el close: el fsync ya ocurrio o ya lanzo.
            }
        }
    }
}

/** writeFileAtomic + fsync del directorio contenedor tras el rename. */
export function writeFileAtomicDurable(file: string, content: string, mode = 0o644): void {
    writeFileAtomic(file, content, mode);
    fsyncDirSync(path.dirname(file));
}
