import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface HtmlTargetOperations { existsSync: typeof fs.existsSync; statSync: typeof fs.statSync; lstatSync: typeof fs.lstatSync; accessSync: typeof fs.accessSync; }
export function resolveHtmlTarget(input: { cwd: string; target: string; force?: boolean }, operations: HtmlTargetOperations = fs): string {
    if (!input || typeof input.cwd !== 'string' || input.cwd.trim() === '' || input.cwd.includes('\0') || typeof input.target !== 'string' || input.target.trim() === '' || input.target.includes('\0') || input.target.startsWith('--')) throw new Error('--html requires a file target');
    if (input.force !== undefined && typeof input.force !== 'boolean') throw new Error('--force must be boolean');
    const target = path.isAbsolute(input.target) ? path.normalize(input.target) : path.resolve(input.cwd, input.target);
    const parent = path.dirname(target);
    if (!operations.existsSync(parent) || !operations.statSync(parent).isDirectory()) throw new Error(`HTML parent directory does not exist: ${parent}`);
    for (let current = parent; ; current = path.dirname(current)) {
        if (operations.lstatSync(current).isSymbolicLink()) throw new Error('HTML parent directory must not contain a symbolic link');
        if (current === path.parse(current).root) break;
    }
    try { operations.accessSync(parent, fs.constants.W_OK); } catch { throw new Error(`HTML parent directory is not writable: ${parent}`); }
    let stat: fs.Stats;
    try { stat = operations.lstatSync(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
        throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('HTML target must be a regular file');
    if (!input.force) throw new Error(`HTML target already exists: ${target}; use --force`);
    return target;
}

export interface HtmlWriteOperations {
    openSync: typeof fs.openSync; writeFileSync: typeof fs.writeFileSync; fsyncSync: typeof fs.fsyncSync;
    closeSync: typeof fs.closeSync; renameSync: typeof fs.renameSync; existsSync: typeof fs.existsSync; unlinkSync: typeof fs.unlinkSync;
}

export function writeHtmlAtomically(input: { cwd: string; target: string; html: string; force?: boolean; platform?: string }, operations: HtmlWriteOperations = fs): void {
    if (!input || typeof input.cwd !== 'string' || input.cwd.trim() === '' || input.cwd.includes('\0')) throw new Error('writeHtmlAtomically requires a non-empty cwd');
    if (typeof input.target !== 'string' || input.target.trim() === '' || !path.isAbsolute(input.target)) throw new Error('writeHtmlAtomically requires a non-empty absolute target');
    if (input.target.includes('\0')) throw new Error('writeHtmlAtomically target must not contain NUL');
    if (typeof input.html !== 'string' || input.html.length === 0) throw new Error('writeHtmlAtomically requires non-empty html');
    if (input.force !== undefined && typeof input.force !== 'boolean') throw new Error('writeHtmlAtomically force must be boolean');
    const platform = input.platform ?? process.platform;
    if (typeof platform !== 'string' || !/^[a-z0-9]+$/i.test(platform)) throw new Error('writeHtmlAtomically platform must be a valid platform');
    const temp = path.join(path.dirname(input.target), `.${path.basename(input.target)}.${process.pid}.${randomUUID()}.tmp`);
    let fd: number | undefined;
    let tempCreated = false;
    try {
        fd = platform === 'win32' ? operations.openSync(temp, 'wx') : operations.openSync(temp, 'wx', 0o600);
        tempCreated = true;
        operations.writeFileSync(fd, input.html, 'utf8');
        operations.fsyncSync(fd);
        operations.closeSync(fd); fd = undefined;
        operations.renameSync(temp, input.target);
    } catch (error) {
        if (fd !== undefined) try { operations.closeSync(fd); } catch { /* best effort */ }
        try { if (tempCreated && operations.existsSync(temp)) operations.unlinkSync(temp); } catch { /* known temp only */ }
        throw error;
    }
}
