import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');

function readWorkflow(name: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');
}

function assertArmPartition(source: string): void {
    const workflow = source.replace(/\r\n/g, '\n');
    expect(workflow.match(/^  windows-arm-hot:\s*$/gm)).toHaveLength(1);
    const [matrixJob, rest] = workflow.split(/^  windows-arm-hot:\s*$/m);
    expect(rest).toBeDefined();
    const hotJob = rest.split(/^  [a-z][\w-]*:\s*$/m)[0];

    expect(matrixJob).toMatch(/- name: Tests?\n        if: matrix\.target != 'win32-arm64'\n        working-directory: cli\n        run: npx jest --runInBand --bail\n/);
    const remainder = matrixJob.match(/- name: Tests? \(Windows ARM remainder\)\n        if: matrix\.target == 'win32-arm64'\n        working-directory: cli\n        run: ([^\n]+)/)?.[1];
    expect(remainder).toMatch(/^npx jest --runInBand --bail --testPathIgnorePatterns='[^']+'$/);
    const ignorePattern = remainder?.match(/--testPathIgnorePatterns='([^']+)'/)?.[1];
    expect(ignorePattern).toBe(String.raw`node_modules|[/\\]cli[/\\]tests[/\\]commands[/\\]watch[/\\]track-(finalize|freeze)\.test\.ts$`);
    const ignored = new RegExp(ignorePattern!);
    for (const separator of ['/', '\\']) {
        const root = ['repo', 'cli', 'tests'].join(separator);
        for (const suite of ['track-finalize', 'track-freeze']) {
            expect(ignored.test([root, 'commands', 'watch', `${suite}.test.ts`].join(separator))).toBe(true);
            expect(ignored.test([root, 'other', `${suite}.test.ts`].join(separator))).toBe(false);
        }
    }
    const remainderStep = matrixJob.split(/- name: Tests? \(Windows ARM remainder\)\n/)[1]?.split(/^      - name:/m)[0];
    expect(remainderStep).toBeDefined();
    expect(remainderStep).not.toContain('continue-on-error: true');
    expect(matrixJob.match(/uses: actions\/upload-artifact@v4/g)).toHaveLength(1);
    expect(hotJob).toContain('runs-on: windows-11-arm');
    expect(hotJob).toContain('run: npm run native:build');
    expect(hotJob).toContain('run: npm run native:test-build');
    expect(hotJob.split('\n')).toContain('        run: npx jest --runTestsByPath tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-freeze.test.ts --runInBand --bail');
    expect(hotJob).not.toContain('upload-artifact@v4');
    expect(hotJob).not.toContain('secure-fs-win32-arm64');
    expect(hotJob).not.toMatch(/^\s*if:/m);
    expect(hotJob).not.toContain('continue-on-error: true');
}

describe('native release artifacts', () => {
    it('runs each platform suite once without weakening publication', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = readWorkflow(name);
            expect(workflow).not.toContain('- name: Windows admission smoke');
            expect(workflow).not.toContain('run: npx jest tests/commands/plan/index.test.ts --runInBand --bail');
            expect(workflow).toContain('run: npx jest --runInBand --bail');
        }
        const release = readWorkflow('release.yml');
        expect(release).toMatch(/release:\s*\n\s*needs: \[test, windows-arm-hot\]/);
        for (const target of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']) {
            expect(release).toContain(`target: ${target}`);
        }
        expect(release).toContain('cancel-in-progress: false');
    });

    it('partitions the two hot ARM suites without duplicating the native artifact', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = readWorkflow(name);
            assertArmPartition(workflow);
        }
    });

    it('checks the same partition after a Windows CRLF checkout', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = readWorkflow(name);
            assertArmPartition(workflow.replace(/\n/g, '\r\n'));
        }
    });

    it('rejects swapped matrix guards, non-gating hot tests and duplicate artifacts', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = readWorkflow(name);
            const swapped = workflow.replace(
                /if: matrix\.target (?:!=|==) 'win32-arm64'/g,
                (guard) => guard.includes('!=') ? "if: matrix.target == 'win32-arm64'" : "if: matrix.target != 'win32-arm64'",
            );
            const nonGating = workflow.replace('  windows-arm-hot:\n', '  windows-arm-hot:\n    continue-on-error: true\n');
            const duplicateArtifact = workflow.replace(
                'uses: actions/upload-artifact@v4',
                'uses: actions/upload-artifact@v4\n      - uses: actions/upload-artifact@v4',
            );
            const broadIgnore = workflow.replace(
                /(--testPathIgnorePatterns='[^']+)(?=')/,
                '$1|runner\\.test\\.ts$',
            );
            const skippedHot = workflow.replace(
                '      - name: Test hot Windows ARM suites\n',
                '      - name: Test hot Windows ARM suites\n        if: false\n',
            );
            const nonGatingRemainder = workflow.replace(
                /(run: npx jest --runInBand --bail --testPathIgnorePatterns='[^']+'\n)/,
                '$1        continue-on-error: true\n',
            );
            const maskedHot = workflow.replace(
                /(run: npx jest --runTestsByPath [^\n]+ --runInBand --bail)(?=\n)/,
                '$1; exit 0',
            );
            for (const mutated of [swapped, nonGating, duplicateArtifact, broadIgnore, skippedHot, nonGatingRemainder, maskedHot]) {
                expect(mutated).not.toBe(workflow);
            }
            expect(() => assertArmPartition(swapped)).toThrow();
            expect(() => assertArmPartition(nonGating)).toThrow();
            expect(() => assertArmPartition(duplicateArtifact)).toThrow();
            expect(() => assertArmPartition(broadIgnore)).toThrow();
            expect(() => assertArmPartition(skippedHot)).toThrow();
            expect(() => assertArmPartition(nonGatingRemainder)).toThrow();
            expect(() => assertArmPartition(maskedHot)).toThrow();
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
            const workflow = readWorkflow(name);
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
