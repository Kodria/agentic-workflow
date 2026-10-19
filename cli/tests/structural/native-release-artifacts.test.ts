import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
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
const REMAINDER_COMMENT = "      # The ARM runner's slow suites run in two separate jobs (watch track-finalize/freeze, and the Change Record suites). Keep runInBand within each job; no test file may run twice or be dropped.\n";
const RELEASE_NEEDS = /^    needs: \[([^\]\n]*)\] # rojo en cualquier plataforma o shard ARM no publica$/m;

// Jest compiles --testPathPatterns with the `i` flag but --testPathIgnorePatterns
// without it, so a directory differing only in case would run in both the shard
// and the remainder. Returns every directory that falls in that gap.
function caseOnlyShardPaths(directories: string[], pattern: string): string[] {
    const insensitive = new RegExp(pattern, 'i');
    const sensitive = new RegExp(pattern);
    return directories.filter((directory) => {
        const candidate = `${directory}/`;
        return insensitive.test(candidate) && !sensitive.test(candidate);
    });
}

const SHARD_DIRECTORIES = [['core', 'changes'], ['commands', 'change'], ['commands', 'changes']];

// Each real shard directory must exist with its exact case, hold at least one
// suite and match CHANGES_PATTERN, so the case-only walk cannot pass vacuously.
function shardDirectoryProblems(testsRoot: string): string[] {
    const shard = new RegExp(CHANGES_PATTERN);
    const problems: string[] = [];
    for (const segments of SHARD_DIRECTORIES) {
        const label = segments.join('/');
        let current = testsRoot;
        let found = true;
        for (const segment of segments) {
            // readdirSync keeps the on-disk case even on case-insensitive file systems.
            if (!fs.existsSync(current) || !fs.readdirSync(current).includes(segment)) {
                found = false;
                break;
            }
            current = path.join(current, segment);
        }
        if (!found) {
            problems.push(`${label}: missing with this exact case`);
            continue;
        }
        if (!fs.readdirSync(current).some((entry) => entry.endsWith('.test.ts'))) {
            problems.push(`${label}: holds no *.test.ts`);
        }
        if (!shard.test(`${current}${path.sep}`)) {
            problems.push(`${label}: does not match CHANGES_PATTERN`);
        }
    }
    return problems;
}

// The release job publishes only when every test job passed: no if:, no
// continue-on-error, and needs is exactly the three gating jobs in any order.
function assertReleaseGate(workflow: string): void {
    const [, releaseJob] = splitJob(workflow, 'release');
    expect(releaseJob).not.toMatch(/^\s*if:/m);
    expect(releaseJob).not.toContain('continue-on-error');
    const needs = releaseJob.match(RELEASE_NEEDS)?.[1].split(',').map((job) => job.trim());
    expect(needs).toHaveLength(3);
    expect([...needs!].sort()).toEqual(['test', 'windows-arm-changes', 'windows-arm-hot']);
}

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
    const [, testJob] = splitJob(workflow, 'test');
    expect(testJob).not.toMatch(/^    continue-on-error:/m);
    expect(workflow.indexOf('  windows-arm-hot:')).toBeLessThan(workflow.indexOf('  windows-arm-changes:'));

    // Optional env: (e.g. AWM_BASELINE_REGISTRY_ROOT for RF-5.1 docs contract) may
    // sit between working-directory and run; release.yml still omits it.
    expect(matrixJob.split(REMAINDER_COMMENT)).toHaveLength(2);
    expect(matrixJob.split(/      - name: Tests? \(Windows ARM remainder\)\n/)[0].endsWith(REMAINDER_COMMENT)).toBe(true);
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
    const shard = new RegExp(shardPattern!, 'i');
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
    const remainderStep = matrixJob.split(/- name: Tests? \(Windows ARM remainder\)\n/)[1]?.split(/^      - /m)[0];
    expect(remainderStep).toBeDefined();
    expect(remainderStep).not.toContain('continue-on-error');
    expect(matrixJob.match(/uses: actions\/upload-artifact@v4/g)).toHaveLength(1);
    expect(hotJob).toContain('runs-on: windows-11-arm');
    expect(hotJob).toContain('run: npm run native:build');
    expect(hotJob).toContain('run: npm run native:test-build');
    expect(hotJob.split('\n')).toContain('        run: npx jest --runTestsByPath tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-freeze.test.ts --runInBand --bail');
    expect(hotJob).not.toContain('upload-artifact@v4');
    expect(hotJob).not.toContain('secure-fs-win32-arm64');
    expect(hotJob).not.toMatch(/^\s*if:/m);
    expect(hotJob).not.toContain('continue-on-error');

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
        assertReleaseGate(workflow);
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
        assertReleaseGate(release);
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
            const jobLevel = (job: string, line: string) => workflow.replace(`  ${job}:\n`, `  ${job}:\n    ${line}\n`);
            const gates = name === 'release.yml';
            const mutations = [
                swapped, nonGating, duplicateArtifact, broadIgnore, skippedHot, nonGatingRemainder, maskedHot,
                nonGatingChanges, skippedChanges, maskedChanges, driftedShard,
                jobLevel('test', "continue-on-error: ${{ matrix.target == 'win32-arm64' }}"),
                jobLevel('windows-arm-hot', 'continue-on-error: ${{ true }}'),
                jobLevel('windows-arm-changes', 'continue-on-error: ${{ true }}'),
                workflow.replace(
                    /(run: npx jest --runInBand --bail --testPathIgnorePatterns='[^']+'\n)/,
                    '$1        continue-on-error: ${{ true }}\n',
                ),
            ];
            if (gates) {
                mutations.push(
                    workflow.replace('needs: [test, windows-arm-hot, windows-arm-changes]', 'needs: [test, windows-arm-hot]'),
                    workflow.replace('needs: [test, windows-arm-hot, windows-arm-changes]', 'needs: [test, windows-arm-hot, windows-arm-changes, windows-arm-changes]'),
                    jobLevel('release', 'if: always()'),
                    jobLevel('release', 'if: ${{ !cancelled() }}'),
                    jobLevel('release', 'continue-on-error: true'),
                );
            }
            for (const mutated of mutations) {
                expect(mutated).not.toBe(workflow);
                expect(() => assertArmPartition(mutated, gates)).toThrow();
            }
            if (gates) {
                const reordered = workflow.replace(
                    'needs: [test, windows-arm-hot, windows-arm-changes]',
                    'needs: [windows-arm-changes, test, windows-arm-hot]',
                );
                expect(reordered).not.toBe(workflow);
                expect(() => assertArmPartition(reordered, gates)).not.toThrow();
            }
        }
    });

    it('reports a shard directory that is missing, renamed by case or holds no suite', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-arm-shard-'));
        try {
            const testsRoot = path.join(tmp, 'cli', 'tests');
            for (const segments of SHARD_DIRECTORIES) {
                fs.mkdirSync(path.join(testsRoot, ...segments), { recursive: true });
                fs.writeFileSync(path.join(testsRoot, ...segments, 'x.test.ts'), '');
            }
            expect(shardDirectoryProblems(testsRoot)).toEqual([]);

            fs.renameSync(path.join(testsRoot, 'core', 'changes'), path.join(testsRoot, 'core', 'Changes'));
            expect(shardDirectoryProblems(testsRoot)).toEqual([expect.stringContaining('core/changes')]);
            fs.renameSync(path.join(testsRoot, 'core', 'Changes'), path.join(testsRoot, 'core', 'changes'));

            fs.renameSync(path.join(testsRoot, 'commands', 'change', 'x.test.ts'), path.join(testsRoot, 'commands', 'change', 'helpers.ts'));
            expect(shardDirectoryProblems(testsRoot)).toEqual([expect.stringContaining('commands/change')]);

            fs.rmSync(path.join(testsRoot, 'commands', 'changes'), { recursive: true });
            expect(shardDirectoryProblems(testsRoot)).toHaveLength(2);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it('flags test directories that only the case-insensitive shard pattern selects', () => {
        expect(caseOnlyShardPaths(['repo/cli/tests/core/Changes'], CHANGES_PATTERN)).toEqual(['repo/cli/tests/core/Changes']);
        expect(caseOnlyShardPaths(['repo\\cli\\tests\\commands\\CHANGE'], CHANGES_PATTERN)).toEqual(['repo\\cli\\tests\\commands\\CHANGE']);
        expect(caseOnlyShardPaths(['repo/cli/tests/core/changes', 'repo/cli/tests/commands/change', 'repo/cli/tests/core/Changesets'], CHANGES_PATTERN)).toEqual([]);
    });

    it('has no test directory selected by the shard but kept by the remainder through case alone', () => {
        const testsRoot = path.join(CLI_ROOT, 'tests');
        const directories = (fs.readdirSync(testsRoot, { recursive: true }) as string[])
            .map((relative) => path.join(testsRoot, relative))
            .filter((candidate) => fs.statSync(candidate).isDirectory());
        expect(shardDirectoryProblems(testsRoot)).toEqual([]);
        const flagged = caseOnlyShardPaths(directories, CHANGES_PATTERN);
        if (flagged.length > 0) {
            throw new Error(`Case-only Change Record directories would run in both ARM shards: ${flagged.join(', ')}`);
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
