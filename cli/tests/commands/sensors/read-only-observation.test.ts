import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
    DEFAULT_EXCLUSION_NAMES,
    admissionConfigRemedy,
    createExclusionPolicy,
    filesystemSnapshot,
    gitVerifier,
    loadAdmissionConfig,
    snapshotUnavailableRemedy,
    type AdmissionConfig,
    type CandidateVerdict,
} from '../../../src/commands/sensors/read-only-observation';

describe('read-only observation', () => {
    const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
    let root: string;
    let project: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-readonly-'));
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        const home = path.join(root, 'home');
        fs.mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        const globalConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(globalConfig, '[user]\n\temail = test@example.test\n\tname = test\n');
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        process.env.GIT_CEILING_DIRECTORIES = root;
        project = path.join(root, 'project');
        fs.mkdirSync(project);
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    const write = (relative: string, content = 'x'): void => {
        const file = path.join(project, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    };
    const writeConfig = (value: unknown): void => write('.awm/admission.json', typeof value === 'string' ? value : JSON.stringify(value));
    const git = (args: string[]): string => execFileSync('git', args, { cwd: project, env: { ...process.env }, stdio: 'pipe', encoding: 'utf8' });
    const tiny = { maxEntries: 50, maxBytes: 1024 };
    const nodeModulesOnly = (verdict: CandidateVerdict) =>
        createExclusionPolicy({ defaults: false, rules: [{ kind: 'name', name: 'node_modules' }] }, () => verdict);

    describe('loadAdmissionConfig', () => {
        it('applies the AWM defaults when the file is absent', () => {
            expect(loadAdmissionConfig(project)).toEqual({
                ok: true,
                config: { defaults: true, rules: DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name', name })) },
            });
            expect(DEFAULT_EXCLUSION_NAMES).toEqual(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']);
        });

        it('adds declared name and path rules and can drop the defaults', () => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { defaults: false, exclude: ['storybook-static', 'apps/web/.cache'] } });
            expect(loadAdmissionConfig(project)).toEqual({
                ok: true,
                config: { defaults: false, rules: [{ kind: 'name', name: 'storybook-static' }, { kind: 'path', path: 'apps/web/.cache' }] },
            });
        });

        it('keeps the defaults when only exclude is declared', () => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { exclude: ['out'] } });
            const result = loadAdmissionConfig(project);
            expect(result.ok && result.config.rules).toEqual([...DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name', name })), { kind: 'name', name: 'out' }]);
        });

        it.each([
            ['not json', '(file)'],
            [[], '(root)'],
            [{ schemaVersion: 2 }, 'schemaVersion'],
            [{ readOnlyObservation: {} }, 'schemaVersion'],
            [{ schemaVersion: 1, extra: true }, 'extra'],
            [{ schemaVersion: 1, readOnlyObservation: null }, 'readOnlyObservation'],
            [{ schemaVersion: 1, readOnlyObservation: { other: 1 } }, 'readOnlyObservation.other'],
            [{ schemaVersion: 1, readOnlyObservation: { defaults: 'yes' } }, 'readOnlyObservation.defaults'],
            [{ schemaVersion: 1, readOnlyObservation: { exclude: 'node_modules' } }, 'readOnlyObservation.exclude'],
        ])('rejects %j at field %s', (value, field) => {
            writeConfig(value);
            expect(loadAdmissionConfig(project)).toEqual({ ok: false, field, message: expect.any(String) });
        });

        it.each([
            '', '/abs', 'C:/abs', 'a/../b', './a', 'a//b', 'a\\b', '*.log', 'a?', '[a]', 'a\nb', 'a\u0000b', 'dist/',
            '.git', '.awm', '.awm/cache', '.git/hooks', '.AWM', 'packages/a/.awm', 'sub/.git', 'a/.AWM/b', 42,
        ])('rejects the exclude entry %j', entry => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { exclude: [entry] } });
            expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: 'readOnlyObservation.exclude[0]', message: expect.any(String) });
        });

        it('bounds and neutralizes an unknown field name in the diagnostic', () => {
            writeConfig(`{"schemaVersion":1,"${'k'.repeat(100)}\\n":true}`);
            const result = loadAdmissionConfig(project);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.field.length).toBeLessThanOrEqual(64);
                expect(result.field).not.toMatch(/[\u0000-\u001f]/);
            }
        });

        it('fails loudly on an empty project root', () => {
            expect(() => loadAdmissionConfig('')).toThrow(/non-empty string/);
        });
    });

    describe('createExclusionPolicy', () => {
        const config = (rules: AdmissionConfig['rules']): AdmissionConfig => ({ defaults: false, rules });

        it('matches a name rule at any depth and a path rule only at its exact path', () => {
            const seen: string[] = [];
            const policy = createExclusionPolicy(config([{ kind: 'name', name: 'node_modules' }, { kind: 'path', path: 'apps/web/.cache' }]), relative => {
                seen.push(relative);
                return 'excluded';
            });
            expect(policy.isExcluded('node_modules', 'node_modules')).toBe(true);
            expect(policy.isExcluded('packages/a/node_modules', 'node_modules')).toBe(true);
            expect(policy.isExcluded('apps/web/.cache', '.cache')).toBe(true);
            expect(policy.isExcluded('apps/api/.cache', '.cache')).toBe(false);
            expect(policy.isExcluded('src', 'src')).toBe(false);
            expect(seen).toEqual(['node_modules', 'packages/a/node_modules', 'apps/web/.cache']);
        });

        it('verifies each candidate once and reports sorted evidence', () => {
            const verdicts: Record<string, CandidateVerdict> = {
                'b/node_modules': 'excluded', 'a/node_modules': 'not-ignored', dist: 'contains-tracked', node_modules: 'git-unavailable',
            };
            const verifier = jest.fn((relative: string) => verdicts[relative]);
            const policy = createExclusionPolicy({ defaults: true, rules: [{ kind: 'name', name: 'node_modules' }, { kind: 'name', name: 'dist' }] }, verifier);
            for (const relative of ['b/node_modules', 'a/node_modules', 'dist', 'node_modules', 'b/node_modules']) {
                policy.isExcluded(relative, relative.split('/').pop()!);
            }
            expect(verifier).toHaveBeenCalledTimes(4);
            expect(policy.evidence()).toEqual({
                defaults: true,
                excluded: ['b/node_modules'],
                rejected: [
                    { path: 'a/node_modules', reason: 'not-ignored' },
                    { path: 'dist', reason: 'contains-tracked' },
                    { path: 'node_modules', reason: 'git-unavailable' },
                ],
            });
        });

        it('never excludes anything under .git or .awm, whatever the verifier says', () => {
            const verifier = jest.fn((): CandidateVerdict => 'excluded');
            const policy = createExclusionPolicy(
                config([{ kind: 'name', name: 'dist' }, { kind: 'name', name: 'build' }, { kind: 'name', name: 'node_modules' }]),
                verifier,
            );
            expect(policy.isExcluded('.awm/dist', 'dist')).toBe(false);
            expect(policy.isExcluded('.AWM/build', 'build')).toBe(false);
            expect(policy.isExcluded('.git/x/node_modules', 'node_modules')).toBe(false);
            expect(verifier).not.toHaveBeenCalled();
            expect(policy.evidence()).toEqual({ defaults: false, excluded: [], rejected: [] });
            expect(policy.isExcluded('packages/a/dist', 'dist')).toBe(true);
        });

        it('never excludes a .git or .awm directory at any depth, nor anything inside one', () => {
            const verifier = jest.fn((): CandidateVerdict => 'excluded');
            const policy = createExclusionPolicy(
                config([{ kind: 'name', name: '.awm' }, { kind: 'name', name: '.GIT' }, { kind: 'name', name: 'dist' }, { kind: 'path', path: 'packages/a/.awm' }]),
                verifier,
            );
            expect(policy.isExcluded('packages/a/.awm', '.awm')).toBe(false);
            expect(policy.isExcluded('sub/.GIT', '.GIT')).toBe(false);
            expect(policy.isExcluded('packages/a/.awm/dist', 'dist')).toBe(false);
            expect(verifier).not.toHaveBeenCalled();
            expect(policy.evidence()).toEqual({ defaults: false, excluded: [], rejected: [] });
            expect(policy.isExcluded('packages/a/dist', 'dist')).toBe(true);
        });

        it('treats only an exact .git or .awm segment as reserved', () => {
            writeConfig({ schemaVersion: 1, readOnlyObservation: { defaults: false, exclude: ['my.awm', '.gitignore-dir', 'x.git', '.awmx'] } });
            const loaded = loadAdmissionConfig(project);
            expect(loaded.ok).toBe(true);
            if (!loaded.ok) return;
            const policy = createExclusionPolicy(loaded.config, () => 'excluded');
            for (const name of ['my.awm', '.gitignore-dir', 'x.git', '.awmx']) expect(policy.isExcluded(`pkg/${name}`, name)).toBe(true);
        });

        it('fails loudly without a validated config or verifier', () => {
            expect(() => createExclusionPolicy(undefined as never, () => 'excluded')).toThrow(/validated admission config/);
            expect(() => createExclusionPolicy(config([]), undefined as never)).toThrow(/candidate verifier/);
        });
    });

    describe('filesystemSnapshot', () => {
        it('skips an excluded directory so an ignored heavy tree stays within the limits', () => {
            write('src/a.ts', 'export {};\n');
            write('node_modules/pkg/big.js', 'x'.repeat(2048));
            expect(filesystemSnapshot(project, nodeModulesOnly('excluded'), tiny)).toEqual({ ok: true, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
            expect(filesystemSnapshot(project, nodeModulesOnly('not-ignored'), tiny)).toEqual({ ok: false, failure: 'limit-bytes' });
        });

        it('reports the entry limit distinctly', () => {
            write('a.txt');
            write('b.txt');
            write('c.txt');
            expect(filesystemSnapshot(project, undefined, { maxEntries: 2, maxBytes: 1024 })).toEqual({ ok: false, failure: 'limit-entries' });
        });

        it('ignores creating, changing or deleting an excluded directory but not changes elsewhere', () => {
            write('src/a.ts', 'a');
            const policy = nodeModulesOnly('excluded');
            const before = filesystemSnapshot(project, policy, tiny);
            write('node_modules/pkg/index.js', 'created by a sensor');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            write('node_modules/pkg/index.js', 'changed by a sensor');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            fs.rmSync(path.join(project, 'node_modules'), { recursive: true });
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            write('src/a.ts', 'changed');
            expect(filesystemSnapshot(project, policy, tiny)).not.toEqual(before);
        });

        it('never descends into the root .git and never asks about a linked directory', () => {
            write('.git/HEAD', 'ref');
            write('real/file.txt');
            fs.symlinkSync(path.join(project, 'real'), path.join(project, 'node_modules'), 'junction');
            const verifier = jest.fn((): CandidateVerdict => 'excluded');
            const policy = createExclusionPolicy({ defaults: false, rules: [{ kind: 'name', name: 'node_modules' }] }, verifier);
            const before = filesystemSnapshot(project, policy, tiny);
            write('.git/HEAD', 'changed');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            expect(verifier).not.toHaveBeenCalled();
        });

        it('returns unreadable for a missing root and rejects invalid arguments', () => {
            expect(filesystemSnapshot(path.join(root, 'missing'))).toEqual({ ok: false, failure: 'unreadable' });
            expect(() => filesystemSnapshot('')).toThrow(/non-empty string/);
            expect(() => filesystemSnapshot(project, undefined, { maxEntries: 0, maxBytes: 1 })).toThrow(/positive integers/);
        });
    });

    describe('remedies', () => {
        it('names the exceeded limit and the admission file', () => {
            expect(snapshotUnavailableRemedy('limit-bytes')).toMatch(/1 GiB/);
            expect(snapshotUnavailableRemedy('limit-bytes')).toContain('.awm/admission.json');
            expect(snapshotUnavailableRemedy('limit-entries')).toMatch(/250000 observed entries/);
            expect(snapshotUnavailableRemedy('limit-entries')).toContain('.awm/admission.json');
            expect(snapshotUnavailableRemedy('unreadable')).toBe('run admission from a readable git worktree');
        });

        it('names the offending admission field', () => {
            expect(admissionConfigRemedy({ field: 'schemaVersion', message: 'must be 1' })).toBe('repair .awm/admission.json: schemaVersion must be 1');
        });
    });

    describe('gitVerifier (real git)', () => {
        it('excludes only ignored directories that hold no tracked file', () => {
            git(['init', '-q', '-b', 'main']);
            write('.gitignore', 'node_modules/\ndist\n');
            write('node_modules/pkg/index.js');
            write('vendor/lib.js');
            write('dist/keep.txt');
            write('src/a.ts');
            git(['add', '.gitignore', 'src', 'vendor']);
            git(['add', '-f', 'dist/keep.txt']);
            git(['commit', '-qm', 'initial']);
            write('scratch/tmp.txt');

            const verify = gitVerifier(project, { ...process.env });

            expect(verify('node_modules')).toBe('excluded');
            expect(verify('dist')).toBe('contains-tracked');
            expect(verify('vendor')).toBe('contains-tracked');
            expect(verify('scratch')).toBe('not-ignored');
        });

        // Directory names containing ":" cannot exist on Windows.
        const posixOnly = process.platform === 'win32' ? it.skip : it;

        posixOnly.each([[':(top)x'], [':/x']])('treats the directory %s literally, never as pathspec magic', name => {
            git(['init', '-q', '-b', 'main']);
            write('.gitignore', 'x/\n');
            write('x/ignored.txt');
            write(`${name}/f.txt`);
            git(['add', '-f', '--', `./${name}/f.txt`]);
            git(['add', '.gitignore']);
            git(['commit', '-qm', 'initial']);

            expect(gitVerifier(project, { ...process.env })(name)).toBe('contains-tracked');
        });

        it('treats glob characters in a directory name literally', () => {
            git(['init', '-q', '-b', 'main']);
            write('.gitignore', 'a\\[b\\]/\nc\\[d\\]/\n');
            write('a[b]/f.txt');
            write('c[d]/g.txt');
            write('src/a.ts');
            git(['add', '.gitignore', 'src']);
            git(['add', '-f', '--', './c[d]/g.txt']);
            git(['commit', '-qm', 'initial']);

            const verify = gitVerifier(project, { ...process.env });

            expect(verify('a[b]')).toBe('excluded');
            expect(verify('c[d]')).toBe('contains-tracked');
        });

        it('reports git-unavailable outside a worktree', () => {
            write('node_modules/pkg/index.js');
            expect(gitVerifier(project, { ...process.env })('node_modules')).toBe('git-unavailable');
        });

        it('fails loudly on an empty project root', () => {
            expect(() => gitVerifier('')).toThrow(/non-empty string/);
        });
    });
});
