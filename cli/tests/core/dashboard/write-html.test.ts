import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveHtmlTarget, writeHtmlAtomically } from '../../../src/core/dashboard/write-html';

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
});
