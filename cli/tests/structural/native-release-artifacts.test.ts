import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(CLI_ROOT, '..');

function readWorkflow(name: string): string {
    return fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');
}

const HOT_IGNORE = String.raw`node_modules|[/\\]cli[/\\]tests[/\\]commands[/\\]watch[/\\]track-(finalize|freeze)\.test\.ts$`;
const CHANGES_PATTERN = String.raw`[/\\]cli[/\\]tests[/\\](core[/\\]changes|commands[/\\]changes?)[/\\]`;
const HOT_STEP = 'Test hot Windows ARM suites';
const CHANGES_STEP = 'Test Change Record Windows ARM suites';
const CHANGES_RUN = `npx jest --runInBand --bail --testPathPatterns='${CHANGES_PATTERN}'`;
const RELEASE_NEEDS = /^  release:\s*\n    needs: \[test, windows-arm-hot, windows-arm-changes\] # rojo en cualquier plataforma o shard ARM no publica$/m;

function splitJob(workflow: string, name: string): [string, string] {
    const header = new RegExp(`^  ${name}:\\s*$`, 'gm');
    expect(workflow.match(header)).toHaveLength(1);
    const [before, rest] = workflow.split(new RegExp(`^  ${name}:\\s*$`, 'm'));
    expect(rest).toBeDefined();
    return [before, rest.split(/^  [a-z][\w-]*:\s*$/m)[0]];
}

function setupBefore(job: string, step: string): string {
    const marker = `      - name: ${step}\n`;
    expect(job.split(marker)).toHaveLength(2);
    return job.split(marker)[0];
}

function assertArmPartition(source: string, gatesRelease: boolean): void {
    const workflow = source.replace(/\r\n/g, '\n');
    const [matrixJob, hotJob] = splitJob(workflow, 'windows-arm-hot');
    const [, changesJob] = splitJob(workflow, 'windows-arm-changes');
    expect(workflow.indexOf('  windows-arm-hot:')).toBeLessThan(workflow.indexOf('  windows-arm-changes:'));

    // Optional env: (e.g. AWM_BASELINE_REGISTRY_ROOT for RF-5.1 docs contract) may
    // sit between working-directory and run; release.yml still omits it.
    expect(matrixJob).toMatch(
        /- name: Tests?\n        if: matrix\.target != 'win32-arm64'\n        working-directory: cli\n(?:        env:\n(?:          [^\n]+\n)+)?        run: npx jest --runInBand --bail\n/,
    );
    const remainder = matrixJob.match(
        /- name: Tests? \(Windows ARM remainder\)\n        if: matrix\.target == 'win32-arm64'\n        working-directory: cli\n(?:        env:\n(?:          [^\n]+\n)+)?        run: ([^\n]+)/,
    )?.[1];
    expect(remainder).toMatch(/^npx jest --runInBand --bail --testPathIgnorePatterns='[^']+'$/);
    const ignorePattern = remainder?.match(/--testPathIgnorePatterns='([^']+)'/)?.[1];
    expect(ignorePattern).toBe(`${HOT_IGNORE}|${CHANGES_PATTERN}`);
    const ignored = new RegExp(ignorePattern!);
    for (const separator of ['/', '\\']) {
        const root = ['repo', 'cli', 'tests'].join(separator);
        for (const suite of ['track-finalize', 'track-freeze']) {
            expect(ignored.test([root, 'commands', 'watch', `${suite}.test.ts`].join(separator))).toBe(true);
            expect(ignored.test([root, 'other', `${suite}.test.ts`].join(separator))).toBe(false);
        }
    }

    // The shard runs exactly what the remainder excludes beyond the hot suites.
    const changesRun = changesJob.match(/^        run: (npx jest [^\n]+)$/m)?.[1];
    expect(changesRun).toBe(CHANGES_RUN);
    const shardPattern = changesRun?.match(/--testPathPatterns='([^']+)'$/)?.[1];
    expect(shardPattern).toBe(CHANGES_PATTERN);
    expect(ignorePattern).toBe(`${HOT_IGNORE}|${shardPattern}`);
    const shard = new RegExp(shardPattern!);
    for (const separator of ['/', '\\']) {
        const root = ['repo', 'cli', 'tests'].join(separator);
        for (const file of [['core', 'changes', 'x.test.ts'], ['commands', 'change', 'new.test.ts'], ['commands', 'changes', 'list.test.ts']]) {
            const candidate = [root, ...file].join(separator);
            expect(shard.test(candidate)).toBe(true);
            expect(ignored.test(candidate)).toBe(true);
        }
        for (const file of [['core', 'changesets', 'x.test.ts'], ['commands', 'changesets', 'x.test.ts'], ['commands', 'watch', 'track-finalize.test.ts']]) {
            expect(shard.test([root, ...file].join(separator))).toBe(false);
        }
        expect(ignored.test([root, 'core', 'changesets', 'x.test.ts'].join(separator))).toBe(false);
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

    // The Change Record shard is a verbatim copy of the hot job's setup.
    expect(setupBefore(changesJob, CHANGES_STEP)).toBe(setupBefore(hotJob, HOT_STEP));
    expect(changesJob).toContain('runs-on: windows-11-arm');
    expect(changesJob).toContain('run: npm ci');
    expect(changesJob).toContain('run: npm run native:build && npm run build');
    expect(changesJob).toContain('run: npm run native:test-build');
    if (gatesRelease) {
        expect(changesJob).toMatch(/^    permissions:\n      contents: read\n/m);
    }
    const changesStep = changesJob.split(`      - name: ${CHANGES_STEP}\n`)[1].trimEnd();
    expect(changesStep).toBe(`        working-directory: cli\n        run: ${CHANGES_RUN}`);
    expect(changesJob).not.toContain('upload-artifact');
    expect(changesJob).not.toContain('secure-fs-win32-arm64');
    expect(changesJob).not.toMatch(/^\s*if:/m);
    expect(changesJob).not.toContain('continue-on-error');

    if (gatesRelease) {
        expect(workflow).toMatch(RELEASE_NEEDS);
    } else {
        expect(workflow).not.toMatch(/^  release:\s*$/m);
    }
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
        expect(release).toMatch(RELEASE_NEEDS);
        for (const target of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64']) {
            expect(release).toContain(`target: ${target}`);
        }
        expect(release).toContain('cancel-in-progress: false');
    });

    it('partitions the hot and Change Record ARM shards without duplicating the native artifact', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = readWorkflow(name);
            assertArmPartition(workflow, name === 'release.yml');
        }
    });

    it('checks the same partition after a Windows CRLF checkout', () => {
        for (const name of ['ci.yml', 'release.yml']) {
            const workflow = readWorkflow(name);
            assertArmPartition(workflow.replace(/\n/g, '\r\n'), name === 'release.yml');
        }
    });

    it('rejects swapped matrix guards, non-gating ARM shards, drifted partitions and duplicate artifacts', () => {
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
            const nonGatingChanges = workflow.replace('  windows-arm-changes:\n', '  windows-arm-changes:\n    continue-on-error: true\n');
            const skippedChanges = workflow.replace(
                `      - name: ${CHANGES_STEP}\n`,
                `      - name: ${CHANGES_STEP}\n        if: false\n`,
            );
            const maskedChanges = workflow.replace(
                /(run: npx jest --runInBand --bail --testPathPatterns='[^']+')(?=\n)/,
                '$1; exit 0',
            );
            const driftedShard = workflow.replace(
                /(--testPathPatterns='[^']+)changes\?/,
                '$1changes',
            );
            const gates = name === 'release.yml';
            const mutations = [
                swapped, nonGating, duplicateArtifact, broadIgnore, skippedHot, nonGatingRemainder, maskedHot,
                nonGatingChanges, skippedChanges, maskedChanges, driftedShard,
            ];
            if (gates) {
                mutations.push(workflow.replace('needs: [test, windows-arm-hot, windows-arm-changes]', 'needs: [test, windows-arm-hot]'));
            }
            for (const mutated of mutations) {
                expect(mutated).not.toBe(workflow);
                expect(() => assertArmPartition(mutated, gates)).toThrow();
            }
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
