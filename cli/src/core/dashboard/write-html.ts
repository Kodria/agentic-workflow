import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export function resolveHtmlTarget(input: { cwd: string; target: string; force?: boolean }): string {
    if (!input || typeof input.cwd !== 'string' || typeof input.target !== 'string' || input.target.trim() === '' || input.target.startsWith('--')) throw new Error('--html requires a file target');
    const target = path.isAbsolute(input.target) ? path.normalize(input.target) : path.resolve(input.cwd, input.target);
    const parent = path.dirname(target);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error(`HTML parent directory does not exist: ${parent}`);
    try { fs.accessSync(parent, fs.constants.W_OK); } catch { throw new Error(`HTML parent directory is not writable: ${parent}`); }
    let stat: fs.Stats;
    try { stat = fs.lstatSync(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
        throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('HTML target must be a regular file');
    if (!input.force) throw new Error(`HTML target already exists: ${target}; use --force`);
    return target;
}

export function writeHtmlAtomically(input: { target: string; html: string }): void {
    if (!input || typeof input.target !== 'string' || typeof input.html !== 'string') throw new Error('writeHtmlAtomically requires target and html');
    const temp = path.join(path.dirname(input.target), `.${path.basename(input.target)}.${process.pid}.${randomUUID()}.tmp`);
    let fd: number | undefined;
    let tempCreated = false;
    try {
        fd = process.platform === 'win32' ? fs.openSync(temp, 'wx') : fs.openSync(temp, 'wx', 0o600);
        tempCreated = true;
        fs.writeFileSync(fd, input.html, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = undefined;
        fs.renameSync(temp, input.target);
    } catch (error) {
        if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
        try { if (tempCreated) fs.unlinkSync(temp); } catch { /* known temp only */ }
        throw error;
    }
}
