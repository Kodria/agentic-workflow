import fs from 'fs';
import path from 'path';
import { makeRepo, posixOnly, type TestRepo } from './helpers';
import {
    createExclusive, createRecordDir, errorCode, inspectRecordDir, readRecord, recordsWithSlug, replaceRecord, unchangedSince,
} from '../../../src/core/changes/record-io';
import { MAX_RECORD_BYTES } from '../../../src/core/changes/types';

// HOME and AWM_HOME point at a throwaway home for the whole file (makeRepo); every scratch directory lives inside it.
let repo: TestRepo;
let n = 0;
beforeAll(() => { repo = makeRepo(); });
afterAll(() => repo.cleanup());
const scratch = (): string => fs.mkdtempSync(path.join(repo.home, `rio${n++}-`));

type Fn = 'mkdirSync' | 'readdirSync' | 'writeFileSync' | 'renameSync' | 'lstatSync';
function intercept(name: Fn, match: (args: unknown[]) => boolean, replace: (real: (...a: unknown[]) => unknown, args: unknown[]) => unknown): void {
    const real = fs[name] as unknown as (...a: unknown[]) => unknown;
    jest.spyOn(fs, name).mockImplementation(((...args: unknown[]) => (match(args) ? replace(real, args) : real(...args))) as never);
}
afterEach(() => jest.restoreAllMocks());

describe('errorCode', () => {
    test.each<[string, unknown, string]>([['an errno error', Object.assign(new Error('x'), { code: 'ENOENT' }), 'ENOENT'], ['an error without a code', new Error('x'), 'unknown'], ['a non-error', 'boom', 'unknown'], ['null', null, 'unknown'], ['a numeric code', { code: 5 }, 'unknown']])('%s', (_n, e, expected) => {
        expect(errorCode(e)).toBe(expected);
    });
});

describe('inspectRecordDir', () => {
    test('is absent when docs does not exist', () => {
        expect(inspectRecordDir(scratch())).toEqual({ kind: 'absent' });
    });
    test('is absent when docs exists without changes', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        expect(inspectRecordDir(root)).toEqual({ kind: 'absent' });
    });
    test('is ok with the directory when both exist', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs', 'changes'), { recursive: true });
        expect(inspectRecordDir(root)).toEqual({ kind: 'ok', dir: path.join(root, 'docs', 'changes') });
    });
    posixOnly('a symlinked docs is unsafe', () => {
        const root = scratch(); const outside = scratch();
        fs.symlinkSync(outside, path.join(root, 'docs'));
        expect(inspectRecordDir(root)).toEqual({ kind: 'unsafe' });
    });
    posixOnly('a symlinked changes is unsafe', () => {
        const root = scratch(); const outside = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.symlinkSync(outside, path.join(root, 'docs', 'changes'));
        expect(inspectRecordDir(root)).toEqual({ kind: 'unsafe' });
    });
    test('a file in place of changes is unsafe', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'changes'), 'x');
        expect(inspectRecordDir(root)).toEqual({ kind: 'unsafe' });
    });
    test('an unreadable path is an error, not absence', () => {
        const root = scratch();
        intercept('lstatSync', (a) => path.basename(String(a[0])) === 'docs', () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
        expect(inspectRecordDir(root)).toEqual({ kind: 'error' });
    });
});

describe('createRecordDir', () => {
    test('creates docs and changes', () => {
        const root = scratch();
        expect(createRecordDir(root)).toEqual({ kind: 'ok', dir: path.join(root, 'docs', 'changes') });
        expect(fs.statSync(path.join(root, 'docs', 'changes')).isDirectory()).toBe(true);
    });
    test('accepts directories that already exist', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs', 'changes'), { recursive: true });
        expect(createRecordDir(root).kind).toBe('ok');
    });
    posixOnly('refuses an existing symlinked docs without creating anything through it', () => {
        const root = scratch(); const outside = scratch();
        fs.symlinkSync(outside, path.join(root, 'docs'));
        expect(createRecordDir(root)).toEqual({ kind: 'unsafe' });
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    posixOnly('checks docs right after creating it, before creating changes inside it', () => {
        const root = scratch(); const outside = scratch();
        intercept('mkdirSync', (a) => path.basename(String(a[0])) === 'docs', (_r, a) => { fs.symlinkSync(outside, String(a[0])); });
        expect(createRecordDir(root)).toEqual({ kind: 'unsafe' });
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    posixOnly('checks changes right after creating it', () => {
        const root = scratch(); const outside = scratch();
        intercept('mkdirSync', (a) => path.basename(String(a[0])) === 'changes', (_r, a) => { fs.symlinkSync(outside, String(a[0])); });
        expect(createRecordDir(root)).toEqual({ kind: 'unsafe' });
        expect(fs.readdirSync(outside)).toEqual([]);
    });
    test('a mkdir failure other than "exists" is an error', () => {
        const root = scratch();
        intercept('mkdirSync', () => true, () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
        expect(createRecordDir(root)).toEqual({ kind: 'error' });
    });
    test('a file in place of docs is unsafe', () => {
        const root = scratch();
        fs.writeFileSync(path.join(root, 'docs'), 'x');
        expect(createRecordDir(root)).toEqual({ kind: 'unsafe' });
    });
});

describe('recordsWithSlug', () => {
    test('lists the records with that slug under any date, and only them', () => {
        const dir = scratch();
        for (const f of ['2026-10-17-a.md', '2026-11-01-a.md', '2026-10-17-ab.md', '2026-10-17-b-a.md', 'a.md', '2026-10-17-A.md', '2026-10-17-a.md.bak']) fs.writeFileSync(path.join(dir, f), 'x');
        expect(recordsWithSlug(dir, 'a')!.sort()).toEqual(['2026-10-17-a.md', '2026-11-01-a.md']);
    });
    test('a directory entry named like a record counts', () => {
        const dir = scratch();
        fs.mkdirSync(path.join(dir, '2026-10-17-a.md'));
        expect(recordsWithSlug(dir, 'a')).toEqual(['2026-10-17-a.md']);
    });
    test('an unreadable directory is null, never an empty list', () => {
        expect(recordsWithSlug(path.join(scratch(), 'missing'), 'a')).toBeNull();
    });
});

describe('readRecord', () => {
    const write = (content: string | Buffer): string => { const f = path.join(scratch(), '2026-10-17-x.md'); fs.writeFileSync(f, content); return f; };
    test('reads the text and a snapshot of the file', () => {
        const f = write('---\nx: 1\n---\n');
        const r = readRecord(f, '2026-10-17-x.md');
        expect(r).toMatchObject({ ok: true, text: '---\nx: 1\n---\n' });
        expect(r.ok && r.snapshot.size).toBe(13);
    });
    test('keeps a leading BOM as U+FEFF instead of dropping it', () => {
        const r = readRecord(write(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('---\n')])), 'n.md');
        expect(r.ok && r.text.charCodeAt(0)).toBe(0xfeff);
    });
    test('refuses invalid UTF-8 as record-invalid', () => {
        expect(readRecord(write(Buffer.from([0xff, 0xfe, 0x0a])), 'n.md')).toMatchObject({ ok: false, code: 'record-invalid' });
    });
    test('refuses a record over the size limit as record-invalid, flagged tooLarge', () => {
        expect(readRecord(write('x'.repeat(MAX_RECORD_BYTES + 1)), 'n.md')).toMatchObject({ ok: false, code: 'record-invalid', tooLarge: true });
    });
    test('only the size refusal is flagged tooLarge', () => {
        expect(readRecord(write(Buffer.from([0xff, 0xfe, 0x0a])), 'n.md')).not.toHaveProperty('tooLarge');
        expect(readRecord(scratch(), 'n.md')).not.toHaveProperty('tooLarge');
    });
    test('accepts a record of exactly the size limit', () => {
        expect(readRecord(write('x'.repeat(MAX_RECORD_BYTES)), 'n.md').ok).toBe(true);
    });
    test('refuses a directory as record-invalid', () => {
        expect(readRecord(scratch(), 'n.md')).toMatchObject({ ok: false, code: 'record-invalid' });
    });
    posixOnly('refuses a symlink as unsafe-path', () => {
        const real = write('x');
        const link = path.join(scratch(), 'l.md');
        fs.symlinkSync(real, link);
        expect(readRecord(link, 'l.md')).toMatchObject({ ok: false, code: 'unsafe-path' });
    });
    test('a missing file is io-failed', () => {
        expect(readRecord(path.join(scratch(), 'gone.md'), 'gone.md')).toMatchObject({ ok: false, code: 'io-failed' });
    });
    test('the message escapes a hostile file name and stays on one line within 300 units', () => {
        const r = readRecord(path.join(scratch(), 'gone.md'), 'a\n\u001b[31m'.repeat(60));
        expect(r.ok).toBe(false);
        const message = r.ok ? '' : r.message;
        // eslint-disable-next-line no-control-regex
        expect(message).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
        expect(message.length).toBeLessThanOrEqual(300);
    });
});

describe('unchangedSince', () => {
    function snapshotOf(content: string): { file: string; snap: NonNullable<ReturnType<typeof snap>> } {
        const file = path.join(scratch(), 'r.md');
        fs.writeFileSync(file, content);
        return { file, snap: snap(file)! };
    }
    function snap(file: string) {
        const r = readRecord(file, 'r.md');
        return r.ok ? r.snapshot : null;
    }
    test('is true for a file nobody touched', () => {
        const { file, snap: s } = snapshotOf('abc');
        expect(unchangedSince(file, s)).toBe(true);
    });
    test('is false when the size changed', () => {
        const { file, snap: s } = snapshotOf('abc');
        fs.appendFileSync(file, 'd');
        expect(unchangedSince(file, s)).toBe(false);
    });
    test('is false when only the modification time changed', () => {
        const { file, snap: s } = snapshotOf('abc');
        const later = new Date(Date.now() + 60_000);
        fs.utimesSync(file, later, later);
        expect(unchangedSince(file, s)).toBe(false);
    });
    test('is false when the size differs, whatever the modification time says', () => {
        const { file, snap: s } = snapshotOf('abc');
        expect(unchangedSince(file, { ...s, size: s.size + 1 })).toBe(false);
    });
    test('is false when the modification time differs, whatever the size says', () => {
        const { file, snap: s } = snapshotOf('abc');
        expect(unchangedSince(file, { ...s, mtimeMs: s.mtimeMs + 1 })).toBe(false);
    });
    test('is false for a directory, even with a snapshot that matches it exactly', () => {
        const dir = scratch();
        const stat = fs.lstatSync(dir);
        expect(unchangedSince(dir, { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino })).toBe(false);
    });
    posixOnly('is false for a symlink, even with a snapshot that matches it exactly', () => {
        const dir = scratch();
        fs.writeFileSync(path.join(dir, 'real.md'), 'abc');
        fs.symlinkSync(path.join(dir, 'real.md'), path.join(dir, 'l.md'));
        const stat = fs.lstatSync(path.join(dir, 'l.md'));
        expect(unchangedSince(path.join(dir, 'l.md'), { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino })).toBe(false);
    });
    test('is false when the file is gone', () => {
        const { file, snap: s } = snapshotOf('abc');
        fs.rmSync(file);
        expect(unchangedSince(file, s)).toBe(false);
    });
    posixOnly('is false when the inode differs (same size and time, another file)', () => {
        const { file, snap: s } = snapshotOf('abc');
        expect(s.ino).not.toBe(0);
        expect(unchangedSince(file, { ...s, ino: s.ino + 1 })).toBe(false);
    });
    test('compares inodes only when the file reports one: an inode of 0 on the file side is ignored', () => {
        const { file, snap: s } = snapshotOf('abc');
        expect(s.ino).not.toBe(0);
        intercept('lstatSync', (a) => a[0] === file, (real, a) => Object.assign(Object.create(Object.getPrototypeOf(real(...a))), real(...a), { ino: 0 }));
        expect(unchangedSince(file, s)).toBe(true);
    });
    test('compares inodes only when both sides carry one', () => {
        const { file, snap: s } = snapshotOf('abc');
        expect(unchangedSince(file, { ...s, ino: 0 })).toBe(true);
    });
    posixOnly('is false when a symlink took its place', () => {
        const { file, snap: s } = snapshotOf('abc');
        const other = path.join(scratch(), 'o.md');
        fs.writeFileSync(other, 'abc');
        fs.rmSync(file);
        fs.symlinkSync(other, file);
        expect(unchangedSince(file, s)).toBe(false);
    });
});

describe('createExclusive', () => {
    test('creates the file with the content', () => {
        const f = path.join(scratch(), 'a.md');
        expect(createExclusive(f, 'hello')).toBe('ok');
        expect(fs.readFileSync(f, 'utf8')).toBe('hello');
    });
    test('never replaces an existing file', () => {
        const f = path.join(scratch(), 'a.md');
        fs.writeFileSync(f, 'old');
        expect(createExclusive(f, 'new')).toBe('exists');
        expect(fs.readFileSync(f, 'utf8')).toBe('old');
    });
    posixOnly('never writes through a symlink at the target', () => {
        const dir = scratch();
        const outside = path.join(dir, 'outside.md');
        fs.writeFileSync(outside, 'precious');
        fs.symlinkSync(outside, path.join(dir, 'a.md'));
        expect(createExclusive(path.join(dir, 'a.md'), 'new')).toBe('exists');
        expect(fs.readFileSync(outside, 'utf8')).toBe('precious');
    });
    test('a failed write leaves no partial file', () => {
        const f = path.join(scratch(), 'a.md');
        intercept('writeFileSync', (a) => typeof a[0] === 'number', () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); });
        expect(createExclusive(f, 'x')).toBe('error');
        expect(fs.existsSync(f)).toBe(false);
    });
    test('a missing directory is an error', () => {
        expect(createExclusive(path.join(scratch(), 'no', 'a.md'), 'x')).toBe('error');
    });
});

describe('replaceRecord', () => {
    test('replaces the content', () => {
        const f = path.join(scratch(), 'a.md');
        fs.writeFileSync(f, 'old');
        expect(replaceRecord(f, 'new')).toEqual({ ok: true });
        expect(fs.readFileSync(f, 'utf8')).toBe('new');
    });
    posixOnly('keeps the mode of the file', () => {
        const f = path.join(scratch(), 'a.md');
        fs.writeFileSync(f, 'old');
        fs.chmodSync(f, 0o640);
        replaceRecord(f, 'new');
        expect(fs.statSync(f).mode & 0o777).toBe(0o640);
    });
    posixOnly('does not replace a symlink', () => {
        const dir = scratch();
        const real = path.join(dir, 'real.md');
        fs.writeFileSync(real, 'precious');
        fs.symlinkSync(real, path.join(dir, 'l.md'));
        expect(replaceRecord(path.join(dir, 'l.md'), 'new')).toMatchObject({ ok: false });
        expect(fs.readFileSync(real, 'utf8')).toBe('precious');
        expect(fs.lstatSync(path.join(dir, 'l.md')).isSymbolicLink()).toBe(true);
    });
    test('a failed rename keeps the old content, reports its code and leaves no temporary file', () => {
        const dir = scratch();
        const f = path.join(dir, 'a.md');
        fs.writeFileSync(f, 'old');
        intercept('renameSync', () => true, () => { throw Object.assign(new Error('nope'), { code: 'EPERM' }); });
        expect(replaceRecord(f, 'new')).toEqual({ ok: false, code: 'EPERM' });
        jest.restoreAllMocks();
        expect(fs.readFileSync(f, 'utf8')).toBe('old');
        expect(fs.readdirSync(dir)).toEqual(['a.md']);
    });
});
