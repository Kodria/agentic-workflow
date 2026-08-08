import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
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
        const open = jest.spyOn(fs, 'openSync');
        const rename = jest.spyOn(fs, 'renameSync');

        writeFileAtomic(file, 'content', 0o600);

        const temporary = String(open.mock.calls[0][0]);
        expect(path.dirname(temporary)).toBe(path.dirname(file));
        expect(path.basename(temporary)).toMatch(/^\.AGENTS\.md\.\d+\.[0-9a-f]{32}\.tmp$/);
        expect(open.mock.calls[0][1]).toBe('wx');
        expect(rename).toHaveBeenCalledWith(temporary, file);
        expect(fs.readFileSync(file, 'utf8')).toBe('content');
        // Windows/NTFS has no POSIX permission bits: fs.fchmodSync there can only
        // toggle the read-only attribute, so a *writable* file always reports back
        // mode 0o666 regardless of the finer-grained mode requested (0o600 here) —
        // confirmed directly from windows-latest CI output (R6, 2026-08-08: expected
        // 384/0o600, got 438/0o666). This is a genuine platform capability gap, not a
        // production bug: see the matching note in tests/core/artifact-state.test.ts
        // for why the data this guards doesn't need Windows-specific hardening.
        const expectedMode = process.platform === 'win32' ? 0o666 : 0o600;
        expect(fs.statSync(file).mode & 0o777).toBe(expectedMode);
        expect(fs.existsSync(temporary)).toBe(false);
    });

    it('cleans only its temporary file when rename fails', () => {
        const file = path.join(dir, 'AGENTS.md');
        const open = jest.spyOn(fs, 'openSync');
        const unrelated = path.join(dir, '.unrelated.tmp');
        fs.writeFileSync(unrelated, 'keep');
        jest.spyOn(fs, 'renameSync').mockImplementation(() => {
            throw new Error('rename failed');
        });

        expect(() => writeFileAtomic(file, 'content')).toThrow('rename failed');
        const temp = String(open.mock.calls[0][0]);
        expect(fs.existsSync(temp)).toBe(false);
        expect(fs.readFileSync(unrelated, 'utf8')).toBe('keep');
        expect(fs.existsSync(file)).toBe(false);
    });

    it('preserves the permission bits and content of an existing regular target on failure', () => {
        const file = path.join(dir, 'AGENTS.md');
        fs.writeFileSync(file, 'original', { mode: 0o600 });
        jest.spyOn(fs, 'renameSync').mockImplementation(() => {
            throw new Error('rename failed');
        });

        expect(() => writeFileAtomic(file, 'replacement', 0o644)).toThrow('rename failed');
        expect(fs.readFileSync(file, 'utf8')).toBe('original');
        // Windows fs.chmod can only toggle the read-only attribute, not set
        // granular POSIX bits (see the platform-aware assertion above in this
        // same file for the confirmed 0o600 -> 0o666 shape).
        expect(fs.statSync(file).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600);
    });

    it('preserves existing target permissions after replacement', () => {
        const file = path.join(dir, 'AGENTS.md');
        fs.writeFileSync(file, 'original', { mode: 0o600 });

        writeFileAtomic(file, 'replacement');

        expect(fs.readFileSync(file, 'utf8')).toBe('replacement');
        expect(fs.statSync(file).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600);
    });

    it('rejects a target symlink without severing it or changing its victim', () => {
        const victim = path.join(dir, 'victim');
        const file = path.join(dir, 'AGENTS.md');
        fs.writeFileSync(victim, 'victim');
        fs.symlinkSync(victim, file);

        expect(() => writeFileAtomic(file, 'replacement')).toThrow('refusing to replace symlink');
        expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
    });

    it('cannot follow or remove a pre-created staging symlink', () => {
        const file = path.join(dir, 'AGENTS.md');
        const victim = path.join(dir, 'victim');
        const random = Buffer.alloc(16, 0xab);
        const temporary = path.join(dir, `.AGENTS.md.${process.pid}.${random.toString('hex')}.tmp`);
        fs.writeFileSync(victim, 'victim');
        fs.symlinkSync(victim, temporary);
        jest.spyOn(crypto, 'randomBytes').mockImplementation((() => random) as never);

        expect(() => writeFileAtomic(file, 'replacement')).toThrow();
        expect(fs.lstatSync(temporary).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(victim, 'utf8')).toBe('victim');
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
