import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');

describe('native release artifacts', () => {
    it('checks Windows admission before full suites and stops a failed suite without weakening publication', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8');
            expect(workflow).toContain('- name: Windows admission smoke');
            expect(workflow).toContain("if: runner.os == 'Windows'");
            expect(workflow).toContain('run: npx jest tests/commands/plan/index.test.ts --runInBand --bail');
            expect(workflow).toContain('run: npx jest --runInBand --bail');
            expect(workflow.indexOf('- name: Windows admission smoke')).toBeLessThan(workflow.indexOf('run: npx jest --runInBand --bail'));
        }
        const release = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
        expect(release).toMatch(/release:\s*\n\s*needs: test/);
        for (const target of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']) {
            expect(release).toContain(`target: ${target}`);
        }
        expect(release).toContain('cancel-in-progress: false');
    });

    it('keeps native prebuilds generated instead of versioned source', () => {
        const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
        const tracked = execFileSync('git', ['ls-files', '--', 'cli/prebuilds'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        }).trim();

        expect(gitignore).toContain('cli/prebuilds/');
        expect(gitignore).toContain('cli/native-artifacts/');
        expect(tracked).toBe('');
    });
});
