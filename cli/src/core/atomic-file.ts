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
