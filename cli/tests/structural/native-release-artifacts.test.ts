import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';

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
const HOT_RUN = 'npx jest --runTestsByPath tests/commands/watch/track-finalize.test.ts tests/commands/watch/track-freeze.test.ts --runInBand --bail';
const RELEASE_GATE = ['test', 'windows-arm-changes', 'windows-arm-hot'];
const SHARD_SETUP = [
    { uses: 'actions/checkout@v4' },
    { uses: 'actions/setup-node@v4', with: { 'node-version': '22' } },
    { name: 'Install', 'working-directory': 'cli', run: 'npm ci' },
    { name: 'Build', 'working-directory': 'cli', run: 'npm run native:build && npm run build' },
    { name: 'Build test-only native addon', 'working-directory': 'cli', run: 'npm run native:test-build' },
];

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

type Step = Record<string, unknown>;
type Job = Record<string, unknown> & { steps: Step[] };

function parseJobs(source: string): Record<string, Job> {
    const parsed = yaml.load(source) as { jobs?: Record<string, Job> } | null;
    expect(parsed?.jobs).toBeDefined();
    return parsed!.jobs!;
}

function getJob(jobs: Record<string, Job>, name: string): Job {
    const job = jobs[name];
    expect(job).toBeDefined();
    expect(Array.isArray(job.steps)).toBe(true);
    return job;
}

function keysOf(value: object): string[] {
    return Object.keys(value);
}

// The release job publishes only when every test job passed: no if, no
// continue-on-error, and needs is exactly the three gating jobs in any order.
function assertReleaseGate(jobs: Record<string, Job>): void {
    const release = getJob(jobs, 'release');
    expect(keysOf(release)).not.toContain('if');
    expect(keysOf(release)).not.toContain('continue-on-error');
    for (const step of release.steps) {
        expect(keysOf(step)).not.toContain('continue-on-error');
    }
    expect(Array.isArray(release.needs)).toBe(true);
    const needs = release.needs as string[];
    expect(needs).toHaveLength(RELEASE_GATE.length);
    expect([...needs].sort()).toEqual(RELEASE_GATE);
}

// Gate semantics are asserted on the parsed workflow, so key quoting or escaping
// cannot hide an if or a continue-on-error. Text is checked only where the exact
// text is the contract: the run lines and the A1 comment.
function assertArmPartition(source: string, gatesRelease: boolean): void {
    const workflow = source.replace(/\r\n/g, '\n');
    const jobs = parseJobs(source);
    const names = keysOf(jobs);
    const test = getJob(jobs, 'test');
    const hot = getJob(jobs, 'windows-arm-hot');
    const changes = getJob(jobs, 'windows-arm-changes');
    expect(names.indexOf('windows-arm-hot')).toBeGreaterThan(names.indexOf('test'));
    expect(names.indexOf('windows-arm-changes')).toBe(names.indexOf('windows-arm-hot') + 1);

    // No gating job tolerates failure, at job or step level.
    for (const job of [test, hot, changes]) {
        expect(keysOf(job)).not.toContain('continue-on-error');
        for (const step of job.steps) {
            expect(keysOf(step)).not.toContain('continue-on-error');
        }
    }
    // The ARM shards never skip, at job or step level.
    for (const job of [hot, changes]) {
        expect(keysOf(job)).not.toContain('if');
        for (const step of job.steps) {
            expect(keysOf(step)).not.toContain('if');
        }
    }

    // In the matrix, only the two test steps are guarded, with complementary targets.
    const guarded = test.steps.filter((step) => keysOf(step).includes('if'));
    expect(guarded).toHaveLength(2);
    const [regular, remainder] = guarded;
    expect(regular.name).toMatch(/^Tests?$/);
    expect(regular.if).toBe("matrix.target != 'win32-arm64'");
    expect(regular['working-directory']).toBe('cli');
    expect(regular.run).toBe('npx jest --runInBand --bail');
    expect(remainder.name).toMatch(/^Tests? \(Windows ARM remainder\)$/);
    expect(remainder.if).toBe("matrix.target == 'win32-arm64'");
    expect(remainder['working-directory']).toBe('cli');
    const ignorePattern = String(remainder.run).match(/^npx jest --runInBand --bail --testPathIgnorePatterns='([^']+)'$/)?.[1];
    expect(ignorePattern).toBe(`${HOT_IGNORE}|${CHANGES_PATTERN}`);
    expect(test.steps.filter((step) => step.uses === 'actions/upload-artifact@v4')).toHaveLength(1);

    // A1 comment, directly above the remainder step.
    expect(workflow.split(REMAINDER_COMMENT)).toHaveLength(2);
    const aroundRemainder = workflow.split(/      - name: Tests? \(Windows ARM remainder\)\n/);
    expect(aroundRemainder).toHaveLength(2);
    expect(aroundRemainder[0].endsWith(REMAINDER_COMMENT)).toBe(true);

    // Both shards share the same setup; only their test step differs.
    expect(hot['runs-on']).toBe('windows-11-arm');
    expect(hot.steps.slice(0, -1)).toEqual(SHARD_SETUP);
    expect(hot.steps.at(-1)).toEqual({ name: HOT_STEP, 'working-directory': 'cli', run: HOT_RUN });
    expect(changes.steps.at(-1)).toEqual({ name: CHANGES_STEP, 'working-directory': 'cli', run: CHANGES_RUN });
    expect({ ...changes, steps: changes.steps.slice(0, -1) }).toEqual({ ...hot, steps: hot.steps.slice(0, -1) });
    if (gatesRelease) {
        expect(changes.permissions).toEqual({ contents: 'read' });
    }
    for (const job of [hot, changes]) {
        expect(job.steps.some((step) => String(step.uses ?? '').includes('upload-artifact'))).toBe(false);
        expect(JSON.stringify(job)).not.toContain('secure-fs-win32-arm64');
    }
    const lines = workflow.split('\n');
    expect(lines).toContain(`        run: ${HOT_RUN}`);
    expect(lines).toContain(`        run: ${CHANGES_RUN}`);

    // The remainder ignores exactly the hot suites plus what the Change Record shard runs.
    const ignored = new RegExp(ignorePattern!);
    for (const separator of ['/', '\\']) {
        const root = ['repo', 'cli', 'tests'].join(separator);
        for (const suite of ['track-finalize', 'track-freeze']) {
            expect(ignored.test([root, 'commands', 'watch', `${suite}.test.ts`].join(separator))).toBe(true);
            expect(ignored.test([root, 'other', `${suite}.test.ts`].join(separator))).toBe(false);
        }
    }
    const shardPattern = String(changes.steps.at(-1)?.run).match(/--testPathPatterns='([^']+)'$/)?.[1];
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

    if (gatesRelease) {
        assertReleaseGate(jobs);
        // CI-2 keeps the comment on the release job's needs line.
        const releaseText = workflow.slice(workflow.search(/^  release:\n/m));
        expect(releaseText.match(/^    needs: [^\n]*$/m)?.[0]).toMatch(/ # rojo en cualquier plataforma o shard ARM no publica$/);
    } else {
        expect(names).not.toContain('release');
    }
}

// Rewrites the release job's inline `needs` list in the workflow text.
function rewriteReleaseNeeds(workflow: string, rewrite: (jobs: string[]) => string[]): string {
    const header = workflow.search(/^  release:\n/m);
    expect(header).toBeGreaterThanOrEqual(0);
    const head = workflow.slice(0, header);
    const tail = workflow.slice(header).replace(
        /^(    needs: )\[([^\]\n]*)\]/m,
        (_line, prefix: string, list: string) => `${prefix}[${rewrite(list.split(',').map((job) => job.trim())).join(', ')}]`,
    );
    return head + tail;
}

function permutations(items: string[]): string[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

// Every bypass of the partition or the release gate must make assertArmPartition
// throw: a failed assertion or a mutated text that no longer parses as YAML.
function assertMutationsRejected(workflow: string, gates: boolean): void {
    const jobLevel = (job: string, line: string) => workflow.replace(new RegExp(`^  ${job}:\\n`, 'm'), `  ${job}:\n    ${line}\n`);
    const inStep = (step: string, line: string) => workflow.replace(`      - name: ${step}\n`, `      - name: ${step}\n        ${line}\n`);
    const mutations = [
        // Swapped matrix guards.
        workflow.replace(
            /if: matrix\.target (?:!=|==) 'win32-arm64'/g,
            (guard) => guard.includes('!=') ? "if: matrix.target == 'win32-arm64'" : "if: matrix.target != 'win32-arm64'",
        ),
        // A second producer of the native artifact.
        workflow.replace('uses: actions/upload-artifact@v4', 'uses: actions/upload-artifact@v4\n      - uses: actions/upload-artifact@v4'),
        // A remainder that drops more than the shards run.
        workflow.replace(/(--testPathIgnorePatterns='[^']+)(?=')/, '$1|runner\\.test\\.ts$'),
        // A shard pattern that differs from the remainder's exclusion.
        workflow.replace(/(--testPathPatterns='[^']+)changes\?/, '$1changes'),
        // Masked shard runs.
        workflow.replace(/(run: npx jest --runTestsByPath [^\n]+ --runInBand --bail)(?=\n)/, '$1; exit 0'),
        workflow.replace(/(run: npx jest --runInBand --bail --testPathPatterns='[^']+')(?=\n)/, '$1; exit 0'),
        // Skipped steps or jobs, in any key quoting.
        inStep(HOT_STEP, 'if: false'),
        inStep(HOT_STEP, '"if": always()'),
        inStep(HOT_STEP, "'if': false"),
        inStep(CHANGES_STEP, 'if: false'),
        inStep(CHANGES_STEP, '"if": always()'),
        inStep(CHANGES_STEP, "'if': false"),
        inStep('Upload native secure-fs artifact', "'if': false"),
        jobLevel('windows-arm-hot', '"if": always()'),
        jobLevel('windows-arm-hot', "'if': false"),
        jobLevel('windows-arm-changes', '"if": always()'),
        jobLevel('windows-arm-changes', "'if': false"),
        // Tolerated failures, in any key quoting, escaping or expression form.
        jobLevel('test', "continue-on-error: ${{ matrix.target == 'win32-arm64' }}"),
        jobLevel('test', '"continue-on-error": true'),
        jobLevel('test', '"continue\\x2Don-error": true'),
        jobLevel('windows-arm-hot', 'continue-on-error: true'),
        jobLevel('windows-arm-hot', 'continue-on-error: ${{ true }}'),
        jobLevel('windows-arm-hot', '"continue-on-error": true'),
        jobLevel('windows-arm-changes', 'continue-on-error: true'),
        jobLevel('windows-arm-changes', 'continue-on-error: ${{ true }}'),
        jobLevel('windows-arm-changes', '"continue-on-error": true'),
        inStep(HOT_STEP, '"continue-on-error": true'),
        inStep(CHANGES_STEP, "'continue-on-error': true"),
        workflow.replace(/^(        run: npx jest --runInBand --bail\n)/m, '$1        continue-on-error: true\n'),
        workflow.replace(/(run: npx jest --runInBand --bail --testPathIgnorePatterns='[^']+'\n)/, '$1        continue-on-error: true\n'),
        workflow.replace(/(run: npx jest --runInBand --bail --testPathIgnorePatterns='[^']+'\n)/, '$1        continue-on-error: ${{ true }}\n'),
    ];
    if (gates) {
        mutations.push(
            rewriteReleaseNeeds(workflow, (jobs) => jobs.filter((job) => job !== 'windows-arm-changes')),
            rewriteReleaseNeeds(workflow, (jobs) => [...jobs, 'windows-arm-changes']),
            jobLevel('release', 'if: always()'),
            jobLevel('release', 'if: ${{ !cancelled() }}'),
            jobLevel('release', '"if": always()'),
            jobLevel('release', "'if': false"),
            jobLevel('release', 'continue-on-error: true'),
            jobLevel('release', '"continue-on-error": true'),
            // The needs comment is part of CI-2.
            workflow.slice(0, workflow.search(/^  release:\n/m))
                + workflow.slice(workflow.search(/^  release:\n/m)).replace(/^(    needs: [^\n]*?) # rojo en cualquier plataforma o shard ARM no publica$/m, '$1'),
        );
    }
    for (const mutated of mutations) {
        expect(mutated).not.toBe(workflow);
        expect(() => assertArmPartition(mutated, gates)).toThrow();
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
        assertReleaseGate(parseJobs(release));
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
            assertMutationsRejected(readWorkflow(name), name === 'release.yml');
        }
    });

    it('keeps the whole self-test green when release needs is reordered', () => {
        const workflow = readWorkflow('release.yml');
        let current: string[] = [];
        rewriteReleaseNeeds(workflow, (jobs) => (current = jobs));
        const reorderedJobs = permutations(current).find((jobs) => jobs.join() !== current.join());
        expect(reorderedJobs).toBeDefined();
        const reordered = rewriteReleaseNeeds(workflow, () => reorderedJobs!);
        expect(reordered).not.toBe(workflow);
        expect(() => assertArmPartition(reordered, true)).not.toThrow();
        expect(() => assertMutationsRejected(reordered, true)).not.toThrow();
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
