import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveHtmlTarget, writeHtmlAtomically, type HtmlWriteOperations } from '../../../src/core/dashboard/write-html';

describe('writeHtmlAtomically', () => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-html-')); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it.each(['', '--flag'])('rejects invalid target %s', (target) => {
        expect(() => resolveHtmlTarget({ cwd: root, target })).toThrow();
    });
    it('resolves relative targets and refuses overwrite without force', () => {
        const target = resolveHtmlTarget({ cwd: root, target: 'report.html' });
        writeHtmlAtomically({ cwd: root, target, html: '<h1>one</h1>' });
        expect(fs.readFileSync(target, 'utf8')).toBe('<h1>one</h1>');
        expect(() => resolveHtmlTarget({ cwd: root, target: 'report.html' })).toThrow(/exists/i);
        expect(resolveHtmlTarget({ cwd: root, target: 'report.html', force: true })).toBe(target);
    });
    it('rejects directories and symlinks', () => {
        fs.mkdirSync(path.join(root, 'dir'));
        fs.writeFileSync(path.join(root, 'real.html'), 'x');
        fs.symlinkSync(path.join(root, 'real.html'), path.join(root, 'link.html'));
        expect(() => resolveHtmlTarget({ cwd: root, target: 'dir', force: true })).toThrow();
        expect(() => resolveHtmlTarget({ cwd: root, target: 'link.html', force: true })).toThrow();
    });

    it('rejects a symlinked parent but accepts an ordinary nested directory', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-html-outside-'));
        try {
            fs.mkdirSync(path.join(root, 'safe', 'nested'), { recursive: true });
            fs.symlinkSync(outside, path.join(root, 'escape'));
            expect(resolveHtmlTarget({ cwd: root, target: 'safe/nested/report.html' })).toBe(path.join(root, 'safe', 'nested', 'report.html'));
            expect(() => resolveHtmlTarget({ cwd: root, target: 'escape/report.html' })).toThrow('HTML parent directory must not contain a symbolic link');
        } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    });

    it('rejects absent parents and non-regular existing targets', () => {
        expect(() => resolveHtmlTarget({ cwd: root, target: 'missing/report.html' })).toThrow(/parent/i);
        fs.mkdirSync(path.join(root, 'regular-dir'));
        expect(() => resolveHtmlTarget({ cwd: root, target: 'regular-dir', force: true })).toThrow(/regular/i);
    });

    it('rejects an injected unwritable parent before creating any temporary file', () => {
        const operations = { ...fs, accessSync: jest.fn(() => { throw new Error('denied'); }) };
        expect(() => resolveHtmlTarget({ cwd: root, target: 'report.html' }, operations)).toThrow(/writable/i);
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it('accepts a new absolute target and force-replaces only regular files', () => {
        const target = path.join(root, 'absolute.html');
        expect(resolveHtmlTarget({ cwd: root, target })).toBe(target);
        fs.writeFileSync(target, 'old');
        expect(resolveHtmlTarget({ cwd: root, target, force: true })).toBe(target);
    });

    it.each(['openSync', 'writeFileSync', 'fsyncSync', 'renameSync'] as const)('preserves old target and cleans only owned temp when %s fails', (failedOperation) => {
        const target = path.join(root, 'report.html');
        fs.writeFileSync(target, 'previous');
        const operations: HtmlWriteOperations = { ...fs };
        (operations[failedOperation] as unknown as jest.Mock) = jest.fn(() => { throw new Error('injected'); });
        expect(() => writeHtmlAtomically({ cwd: root, target, html: 'new' }, operations)).toThrow('injected');
        expect(fs.readFileSync(target, 'utf8')).toBe('previous');
        expect(fs.readdirSync(root).filter((name) => name.includes('.tmp'))).toEqual([]);
    });

    it('uses Windows inherited-ACL open semantics without a POSIX mode', () => {
        const target = path.join(root, 'windows.html');
        const open = jest.spyOn(fs, 'openSync');
        const original = process.platform;
        try {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            writeHtmlAtomically({ cwd: root, target, html: 'ok' });
            expect(open.mock.calls[0]).toHaveLength(2);
        } finally {
            Object.defineProperty(process, 'platform', { value: original, configurable: true });
            open.mockRestore();
        }
    });

    it('uses mode 0600 for a POSIX adjacent temporary file', () => {
        if (process.platform === 'win32') return;
        const target = path.join(root, 'posix.html');
        const open = jest.spyOn(fs, 'openSync');
        try {
            writeHtmlAtomically({ cwd: root, target, html: 'ok' });
            expect(open.mock.calls[0][2]).toBe(0o600);
        } finally { open.mockRestore(); }
    });

    it.each([
        [{ cwd: '', target: path.join(os.tmpdir(), 'report.html'), html: 'ok' }, 'writeHtmlAtomically requires a non-empty cwd'],
        [{ target: '', html: 'ok' }, 'writeHtmlAtomically requires a non-empty absolute target'],
        [{ target: `${path.sep}tmp${path.sep}report\0.html`, html: 'ok' }, 'writeHtmlAtomically target must not contain NUL'],
        [{ target: 'relative.html', html: 'ok' }, 'writeHtmlAtomically requires a non-empty absolute target'],
        [{ target: path.join(os.tmpdir(), 'report.html'), html: '' }, 'writeHtmlAtomically requires non-empty html'],
        [{ target: path.join(os.tmpdir(), 'report.html'), html: 'ok', force: 'yes' as never }, 'writeHtmlAtomically force must be boolean'],
        [{ target: path.join(os.tmpdir(), 'report.html'), html: 'ok', platform: 'bad platform' }, 'writeHtmlAtomically platform must be a valid platform'],
    ] as const)('validates its public input before filesystem calls', (input, message) => {
        expect(() => writeHtmlAtomically({ cwd: root, ...input } as never)).toThrow(message);
    });
});
