import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeFileAtomic } from '../../src/core/atomic-file';

describe('writeFileAtomic', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-atomic-'));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes through an operation-scoped temporary file and renames it', () => {
        const file = path.join(dir, 'nested', 'AGENTS.md');
        const expectedTemp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
        const rename = jest.spyOn(fs, 'renameSync');

        writeFileAtomic(file, 'content', 0o600);

        expect(rename).toHaveBeenCalledWith(expectedTemp, file);
        expect(fs.readFileSync(file, 'utf8')).toBe('content');
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.existsSync(expectedTemp)).toBe(false);
    });

    it('cleans only its temporary file when rename fails', () => {
        const file = path.join(dir, 'AGENTS.md');
        const temp = path.join(dir, `.AGENTS.md.${process.pid}.tmp`);
        const unrelated = path.join(dir, '.unrelated.tmp');
        fs.writeFileSync(unrelated, 'keep');
        jest.spyOn(fs, 'renameSync').mockImplementation(() => {
            throw new Error('rename failed');
        });

        expect(() => writeFileAtomic(file, 'content')).toThrow('rename failed');
        expect(fs.existsSync(temp)).toBe(false);
        expect(fs.readFileSync(unrelated, 'utf8')).toBe('keep');
        expect(fs.existsSync(file)).toBe(false);
    });

    it.each([
        ['', 'content', 0o644, 'file'],
        ['file', null, 0o644, 'content'],
        ['file', 'content', -1, 'mode'],
        ['file', 'content', 1.5, 'mode'],
        ['file', 'content', 0o10000, 'mode'],
    ])('rejects invalid runtime inputs', (file, content, mode, message) => {
        expect(() => writeFileAtomic(file as never, content as never, mode)).toThrow(message);
    });
});
