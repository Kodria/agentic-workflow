// tests/core/executor.test.ts
import { installArtifact, removeArtifact } from '../../src/core/executor';
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
});
