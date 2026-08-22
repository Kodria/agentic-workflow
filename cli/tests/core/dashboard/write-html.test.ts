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
        writeHtmlAtomically({ target, html: '<h1>one</h1>' });
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

    it('rejects absent parents and non-regular existing targets', () => {
        expect(() => resolveHtmlTarget({ cwd: root, target: 'missing/report.html' })).toThrow(/parent/i);
        fs.mkdirSync(path.join(root, 'regular-dir'));
        expect(() => resolveHtmlTarget({ cwd: root, target: 'regular-dir', force: true })).toThrow(/regular/i);
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
        expect(() => writeHtmlAtomically({ target, html: 'new' }, operations)).toThrow('injected');
        expect(fs.readFileSync(target, 'utf8')).toBe('previous');
        expect(fs.readdirSync(root).filter((name) => name.includes('.tmp'))).toEqual([]);
    });

    it('uses Windows inherited-ACL open semantics without a POSIX mode', () => {
        const target = path.join(root, 'windows.html');
        const open = jest.spyOn(fs, 'openSync');
        const original = process.platform;
        try {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            writeHtmlAtomically({ target, html: 'ok' });
            expect(open.mock.calls[0]).toHaveLength(2);
        } finally {
            Object.defineProperty(process, 'platform', { value: original, configurable: true });
            open.mockRestore();
        }
    });
});
