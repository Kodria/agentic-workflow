import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../atomic-file';
import { RECORD_FILE_RE } from './parse';
import { esc, isObj } from './text-safety';
import { MAX_RECORD_BYTES, RECORD_DIR } from './types';

// Filesystem access to `docs/changes/`: the one place that decides what is safe to read from and write to. Nothing here throws
// (failures come back as a value), no link is ever followed on purpose, and text from the filesystem is escaped before it is
// put into a message.

export const errorCode = (error: unknown): string => (isObj(error) && typeof error.code === 'string' ? error.code : 'unknown');

export type RecordDir = { kind: 'ok'; dir: string } | { kind: 'absent' } | { kind: 'unsafe' } | { kind: 'error' };

type Level = 'dir' | 'absent' | 'unsafe' | 'error';

/** What one path component is, without following links: a real directory, nothing, or something that must not be used. */
function classify(target: string): Level {
    try {
        const stat = fs.lstatSync(target);
        return stat.isSymbolicLink() || !stat.isDirectory() ? 'unsafe' : 'dir';
    } catch (error) {
        return errorCode(error) === 'ENOENT' ? 'absent' : 'error';
    }
}

/** Walks `docs` and `docs/changes` one level at a time: a link or a non-directory on the way is unsafe. */
export function inspectRecordDir(root: string): RecordDir {
    let current = root;
    for (const segment of RECORD_DIR.split('/')) {
        current = path.join(current, segment);
        const level = classify(current);
        if (level !== 'dir') return level === 'absent' ? { kind: 'absent' } : { kind: level };
    }
    return { kind: 'ok', dir: current };
}

/**
 * Creates what is missing, one level at a time, and checks each level right after it was made: a link planted in place of
 * `docs` is seen before `changes` is created inside it, so nothing is ever created through a link.
 */
export function createRecordDir(root: string): RecordDir {
    let current = root;
    for (const segment of RECORD_DIR.split('/')) {
        current = path.join(current, segment);
        try {
            fs.mkdirSync(current);
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') return { kind: 'error' };
        }
        const level = classify(current);
        if (level !== 'dir') return { kind: level === 'absent' ? 'error' : level };
    }
    return { kind: 'ok', dir: current };
}

/** Names of the records with this slug, whatever their date (a directory entry named like a record counts). Null when the directory cannot be listed. */
export function recordsWithSlug(dir: string, slug: string): string[] | null {
    try {
        return fs.readdirSync(dir).filter((name) => RECORD_FILE_RE.exec(name)?.[4] === slug);
    } catch {
        return null;
    }
}

/** What a file looked like when it was read: enough to notice that someone else changed it since. */
export interface FileSnapshot { size: number; mtimeMs: number; ino: number }

/** `tooLarge` marks the size refusal (the validator reports it as `record-too-large`, R1.8); `code` stays `record-invalid` for the writers. */
export type RecordRead = { ok: true; text: string; snapshot: FileSnapshot } | { ok: false; code: string; message: string; tooLarge?: true };

const unreadable = (code: string, message: string, extras: { tooLarge?: true } = {}): RecordRead => ({ ok: false, code, message, ...extras });

/**
 * Reads a record for a rewrite: a regular file (not a link), within the record size limit, valid UTF-8 so that it can be written
 * back byte for byte. `ignoreBOM: true` keeps a leading BOM in the text as U+FEFF (the default would strip it, and the rewrite
 * would drop it silently); the record then does not start with `---` and fails as invalid.
 */
export function readRecord(target: string, name: string): RecordRead {
    const label = esc(name);
    try {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink()) return unreadable('unsafe-path', `${label} is a symlink; refusing to write`);
        if (!stat.isFile()) return unreadable('record-invalid', `${label} is not a regular file`);
        if (stat.size > MAX_RECORD_BYTES) return unreadable('record-invalid', `${label} is larger than ${MAX_RECORD_BYTES} bytes`, { tooLarge: true });
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(target));
        return { ok: true, text, snapshot: { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino } };
    } catch (error) {
        const code = errorCode(error);
        return code === 'ERR_ENCODING_INVALID_ENCODED_DATA' ? unreadable('record-invalid', `${label} is not valid UTF-8`) : unreadable('io-failed', `could not read ${label} (${esc(code)})`);
    }
}

/** True only when the path is still a regular file (not a link) with the size, modification time and inode it had when it was read. */
export function unchangedSince(target: string, snapshot: FileSnapshot): boolean {
    try {
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.size !== snapshot.size || stat.mtimeMs !== snapshot.mtimeMs) return false;
        // An inode number can be 0 or imprecise on some Windows file systems: compare only when both sides carry one.
        return stat.ino === 0 || snapshot.ino === 0 || stat.ino === snapshot.ino;
    } catch {
        return false;
    }
}

/** Exclusive create: never replaces a file, never follows a link at the target. Removes what it created when the write fails. */
export function createExclusive(file: string, content: string): 'ok' | 'exists' | 'error' {
    let fd: number;
    try {
        fd = fs.openSync(file, 'wx', 0o644);
    } catch (error) {
        return errorCode(error) === 'EEXIST' ? 'exists' : 'error';
    }
    try {
        fs.writeFileSync(fd, content, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        return 'ok';
    } catch {
        try { fs.closeSync(fd); } catch { /* the write error is the one that matters */ }
        try { fs.unlinkSync(file); } catch { /* best effort: the file is ours, and incomplete */ }
        return 'error';
    }
}

/** Atomic replacement of an existing record (temporary file + rename, mode kept; a link at the target is refused). */
export function replaceRecord(target: string, content: string): { ok: true } | { ok: false; code: string } {
    try {
        writeFileAtomic(target, content, 0o644);
        return { ok: true };
    } catch (error) {
        return { ok: false, code: errorCode(error) };
    }
}
