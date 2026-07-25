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
});
