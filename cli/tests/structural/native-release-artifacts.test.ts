import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');

describe('native release artifacts', () => {
    it('runs each platform suite once without weakening publication', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8');
            expect(workflow).not.toContain('- name: Windows admission smoke');
            expect(workflow).not.toContain('run: npx jest tests/commands/plan/index.test.ts --runInBand --bail');
            expect(workflow).toContain('run: npx jest --runInBand --bail');
        }
        const release = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
        expect(release).toMatch(/release:\s*\n\s*needs: \[test, windows-arm-hot\]/);
        for (const target of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']) {
            expect(release).toContain(`target: ${target}`);
        }
        expect(release).toContain('cancel-in-progress: false');
    });

    it('partitions the two hot ARM suites without duplicating the native artifact', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8');
            const [matrixJob, rest] = workflow.split(/^  windows-arm-hot:\s*$/m);
            expect(rest).toBeDefined();
            const hotJob = rest.split(/^  [a-z][\w-]*:\s*$/m)[0];

            expect(matrixJob).toContain("if: matrix.target != 'win32-arm64'");
            expect(matrixJob).toContain("if: matrix.target == 'win32-arm64'");
            expect(matrixJob).toContain("run: npx jest --runInBand --bail --testPathIgnorePatterns='node_modules|track-(finalize|freeze)\\.test\\.ts$'");
            expect(hotJob).toContain('runs-on: windows-11-arm');
            expect(hotJob).toContain('run: npm run native:build');
            expect(hotJob).toContain('run: npm run native:test-build');
            expect(hotJob).toContain('run: npx jest --runTestsByPath tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-freeze.test.ts --runInBand --bail');
            expect(hotJob).not.toContain('upload-artifact@v4');
            expect(hotJob).not.toContain('secure-fs-win32-arm64');
        }
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

    it('builds the fault-injection addon before every Jest suite without publishing it', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
        expect(pkg.scripts['native:test-build']).toContain('secure_fs_test');
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8');
            const testBuild = workflow.indexOf('run: npm run native:test-build');
            const jest = workflow.indexOf('run: npx jest --runInBand --bail');
            expect(testBuild).toBeGreaterThanOrEqual(0);
            expect(testBuild).toBeLessThan(jest);
            expect(workflow).toContain("'native/build/Release', 'secure_fs_test.node'");
            expect(workflow).not.toContain('path: cli/prebuilds/${{ matrix.target }}/secure_fs_test.node');
            expect(workflow).not.toContain('secure_fs_test.node\n');
        }
    });
});
