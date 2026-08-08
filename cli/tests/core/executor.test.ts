// tests/core/executor.test.ts
import { installArtifact, removeArtifact, stageArtifact, replaceArtifact } from '../../src/core/executor';
import fs from 'fs';
import path from 'path';

describe('Executor Engine', () => {
    const sourceDir = path.join(__dirname, 'mock_source');
    const targetDir = path.join(__dirname, 'mock_target');

    beforeEach(() => {
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, 'test.txt'), 'hello');
        fs.mkdirSync(targetDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(targetDir, { recursive: true, force: true });
    });

    it('creates a symlink successfully', () => {
        const dest = path.join(targetDir, 'my-skill');
        installArtifact(sourceDir, dest, 'symlink');
        expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    });

    it('copies the directory successfully', () => {
        const dest = path.join(targetDir, 'my-copied-skill');
        installArtifact(sourceDir, dest, 'copy');
        expect(fs.lstatSync(dest).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(dest, 'test.txt'))).toBe(true);
    });

    it('removes an installed artifact', () => {
        const dest = path.join(targetDir, 'to-remove');
        installArtifact(sourceDir, dest, 'symlink');
        expect(fs.existsSync(dest)).toBe(true);

        removeArtifact(dest);
        expect(fs.existsSync(dest)).toBe(false);
    });

    it('throws when removing a non-existent artifact', () => {
        const dest = path.join(targetDir, 'does-not-exist');
        expect(() => removeArtifact(dest)).toThrow('Artifact not found');
    });

    it('never removes the live target before staging succeeds', () => {
        const missingSource = path.join(sourceDir, 'does-not-exist-source');
        const target = path.join(targetDir, 'target');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'sentinel'), 'before');

        expect(() => installArtifact(missingSource, target, 'copy')).toThrow('Source path does not exist');
        expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('before'); // verifies R17
    });

    it('stageArtifact stages next to the target without touching it, replaceArtifact swaps it in', () => {
        const target = path.join(targetDir, 'staged-target');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'sentinel'), 'before');

        const staged = stageArtifact(sourceDir, target, 'copy');
        expect(fs.readFileSync(path.join(target, 'sentinel'), 'utf8')).toBe('before'); // untouched pre-replace
        expect(fs.existsSync(path.join(staged, 'test.txt'))).toBe(true);

        replaceArtifact(staged, target);
        expect(fs.existsSync(path.join(target, 'sentinel'))).toBe(false);
        expect(fs.existsSync(path.join(target, 'test.txt'))).toBe(true);
        expect(fs.existsSync(staged)).toBe(false);
    });

    // Regression: a directory *symlink* ('dir') needs SeCreateSymbolicLinkPrivilege
    // on native Windows, which unprivileged accounts (incl. GitHub Actions'
    // windows-latest runner) don't have — every `awm init` install of a skill/
    // agent directory threw EPERM there, failing the step and exiting the whole
    // run with code 2 (see tests/integration/codex-provider-isolated.test.ts).
    // A 'junction' is a different NTFS reparse-point kind that any account can
    // create, and Node reports it the same way a symlink is reported
    // (isSymbolicLink() true, readlinkSync() resolves it), so this only needs
    // to change the `type` argument passed to fs.symlinkSync on win32 — nothing
    // downstream (verify(), R19 hashing, doctor checks) needs to change.
    describe('on native Windows', () => {
        const realPlatform = process.platform;
        let symlinkSpy: jest.SpyInstance;

        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            symlinkSpy = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => undefined as unknown as void);
        });

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
            symlinkSpy.mockRestore();
        });

        it('stages a directory symlink as a junction instead of a dir-symlink', () => {
            const target = path.join(targetDir, 'win-skill');
            stageArtifact(sourceDir, target, 'symlink');

            expect(symlinkSpy).toHaveBeenCalledTimes(1);
            const [calledSource, , calledType] = symlinkSpy.mock.calls[0];
            expect(calledSource).toBe(sourceDir);
            expect(calledType).toBe('junction');
        });

        // Regression (Failure 4/5, R6 round 3): a junction is a NTFS
        // *directory* reparse point — it has no equivalent for a single FILE
        // artifact (an agent/workflow .md). Before this branch existed, a file
        // source got the exact same 'junction' treatment as a directory, which
        // does not correctly resolve back to the file — see
        // tests/core/bundle-install.test.ts's "claude-code agents" case, which
        // reproduced this on windows-latest as a silently-missing target file.
        it('stages a FILE source with a file-typed symlink, not a junction', () => {
            const fileSource = path.join(sourceDir, 'test.txt');
            const target = path.join(targetDir, 'win-agent.md');
            stageArtifact(fileSource, target, 'symlink');

            expect(symlinkSpy).toHaveBeenCalledTimes(1);
            const [calledSource, , calledType] = symlinkSpy.mock.calls[0];
            expect(calledSource).toBe(fileSource);
            expect(calledType).toBe('file');
        });

        it('falls back to a plain copy for a FILE source when the file symlink throws (EPERM — no SeCreateSymbolicLinkPrivilege)', () => {
            symlinkSpy.mockImplementation(() => {
                const err: any = new Error('EPERM: operation not permitted, symlink');
                err.code = 'EPERM';
                throw err;
            });

            const fileSource = path.join(sourceDir, 'test.txt');
            const target = path.join(targetDir, 'win-agent-fallback.md');
            const staged = stageArtifact(fileSource, target, 'symlink');

            expect(fs.lstatSync(staged).isSymbolicLink()).toBe(false);
            expect(fs.readFileSync(staged, 'utf8')).toBe('hello');
        });
    });
});
