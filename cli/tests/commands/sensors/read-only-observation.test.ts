import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, type SpawnSyncOptions, type SpawnSyncReturns, type spawnSync } from 'child_process';
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
    const symlinksSupported = ((): boolean => {
        const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-symlink-probe-'));
        try {
            fs.writeFileSync(path.join(probe, 'target'), 'x');
            fs.symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'));
            return true;
        } catch {
            return false;
        } finally {
            fs.rmSync(probe, { recursive: true, force: true });
        }
    })();
    const symlinkOnly = symlinksSupported ? it : it.skip;
    // Modes, fifos and ':' in names are not portable to Windows.
    const posixOnly = process.platform === 'win32' ? it.skip : it;
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
        jest.restoreAllMocks();
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

        it.each([
            [{ schemaVersion: 1 }],
            [{ schemaVersion: 1, readOnlyObservation: {} }],
        ])('treats the minimal config %j as the defaults', value => {
            writeConfig(value);
            expect(loadAdmissionConfig(project)).toEqual({
                ok: true,
                config: { defaults: true, rules: DEFAULT_EXCLUSION_NAMES.map(name => ({ kind: 'name', name })) },
            });
            expect(DEFAULT_EXCLUSION_NAMES).toHaveLength(8);
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

        it('strips C1, separator and bidi control characters from an unknown field name', () => {
            const hostile = 'a\u009bb\u0085c\u202ed\u2028e\u2029f\u2066g\u2069h\u202ai\u200ej\u200fk\u061cl';
            writeConfig(JSON.stringify({ schemaVersion: 1, [hostile]: true }));
            const result = loadAdmissionConfig(project);
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.field).toBe('a?b?c?d?e?f?g?h?i?j?k?l');
                expect(result.field.length).toBeLessThanOrEqual(64);
            }
        });

        describe('the config file itself', () => {
            const configPath = (): string => path.join(project, '.awm', 'admission.json');
            const jsonPaddedTo = (bytes: number): string => `{"schemaVersion":1}${' '.repeat(bytes - '{"schemaVersion":1}'.length)}`;

            it('fails closed when the file cannot be read for a reason other than being absent', () => {
                fs.mkdirSync(configPath(), { recursive: true });
                expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: '(file)', message: expect.any(String) });
            });

            // ENOTDIR is POSIX behavior: on Windows a file in the middle of a path reads as ENOENT.
            posixOnly('fails closed when .awm is not a directory', () => {
                write('.awm', 'not a directory');
                expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: '(file)', message: expect.any(String) });
            });

            it('accepts a file of exactly 65536 bytes and rejects one byte more', () => {
                writeConfig(jsonPaddedTo(65536));
                expect(loadAdmissionConfig(project).ok).toBe(true);
                writeConfig(jsonPaddedTo(65537));
                expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: '(file)', message: 'is larger than 65536 bytes' });
            });

            it('fails closed when reading a regular, small file fails', () => {
                writeConfig({ schemaVersion: 1 });
                const realRead = fs.readFileSync;
                jest.spyOn(fs, 'readFileSync').mockImplementation(((target: unknown, ...rest: unknown[]) => {
                    if (typeof target === 'string' && target.endsWith('admission.json')) throw new Error('EIO');
                    return (realRead as (...args: unknown[]) => unknown)(target, ...rest);
                }) as unknown as typeof fs.readFileSync);
                expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: '(file)', message: 'could not be read' });
            });

            symlinkOnly('rejects a symlink even when it points at a valid regular file', () => {
                write('real-admission.json', '{"schemaVersion":1}');
                fs.mkdirSync(path.dirname(configPath()), { recursive: true });
                fs.symlinkSync(path.join(project, 'real-admission.json'), configPath());
                expect(loadAdmissionConfig(project)).toEqual({ ok: false, field: '(file)', message: 'must be a regular file, not a link or device' });
            });
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
                'c/dist': 'excluded',
            };
            const verifier = jest.fn((relative: string) => verdicts[relative]);
            const policy = createExclusionPolicy({ defaults: true, rules: [{ kind: 'name', name: 'node_modules' }, { kind: 'name', name: 'dist' }] }, verifier);
            // Insertion order is deliberately reverse-alphabetical: evidence() must sort, not echo it.
            for (const relative of ['node_modules', 'dist', 'c/dist', 'b/node_modules', 'a/node_modules', 'b/node_modules']) {
                policy.isExcluded(relative, relative.split('/').pop()!);
            }
            expect(verifier).toHaveBeenCalledTimes(5);
            expect(policy.evidence()).toEqual({
                defaults: true,
                excluded: ['b/node_modules', 'c/dist'],
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

        it('allows exactly the entry limit and rejects one entry more', () => {
            write('a.txt');
            write('b.txt');
            write('c.txt');
            expect(filesystemSnapshot(project, undefined, { maxEntries: 3, maxBytes: 1024 })).toEqual({ ok: true, digest: expect.any(String) });
            write('d.txt');
            expect(filesystemSnapshot(project, undefined, { maxEntries: 3, maxBytes: 1024 })).toEqual({ ok: false, failure: 'limit-entries' });
        });

        it('allows exactly the byte limit and rejects one byte more', () => {
            write('f.txt', 'x'.repeat(10));
            expect(filesystemSnapshot(project, undefined, { maxEntries: 50, maxBytes: 10 })).toEqual({ ok: true, digest: expect.any(String) });
            write('f.txt', 'x'.repeat(11));
            expect(filesystemSnapshot(project, undefined, { maxEntries: 50, maxBytes: 10 })).toEqual({ ok: false, failure: 'limit-bytes' });
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

        it('hashes observed directories without their size, so edits inside a nested excluded directory leave the digest unchanged', () => {
            // ext4 reports a constant directory size; tmpfs, APFS and NTFS do not. Simulate the
            // size-sensitive case so the rule is pinned on every platform.
            const realLstat = fs.lstatSync;
            jest.spyOn(fs, 'lstatSync').mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
                const stat = (realLstat as (...args: unknown[]) => fs.Stats)(target, ...rest);
                if (!stat.isDirectory()) return stat;
                const size = 4096 + 1024 * fs.readdirSync(target).length;
                return new Proxy(stat, { get: (object, key) => (key === 'size' ? size : Reflect.get(object, key, object)) });
            }) as unknown as typeof fs.lstatSync);
            write('packages/x/src/a.ts', 'a');
            write('packages/x/node_modules/pkg/index.js', 'one');
            const policy = nodeModulesOnly('excluded');
            const before = filesystemSnapshot(project, policy, tiny);
            expect(before.ok).toBe(true);
            write('packages/x/node_modules/pkg/extra.js', 'created');
            write('packages/x/node_modules/other/deep/file.js', 'created');
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            write('packages/x/node_modules/pkg/index.js', 'grown'.repeat(20));
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            fs.rmSync(path.join(project, 'packages', 'x', 'node_modules', 'pkg'), { recursive: true });
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            fs.rmSync(path.join(project, 'packages', 'x', 'node_modules'), { recursive: true });
            expect(filesystemSnapshot(project, policy, tiny)).toEqual(before);
            write('packages/x/src/a.ts', 'changed');
            expect(filesystemSnapshot(project, policy, tiny)).not.toEqual(before);
        });

        describe('what the digest covers', () => {
            const digestOf = (): string => {
                const result = filesystemSnapshot(project, undefined, tiny);
                if (!result.ok) throw new Error(`snapshot failed: ${result.failure}`);
                return result.digest;
            };

            it('changes on a same-size content edit', () => {
                write('f.txt', 'aaaa');
                const before = digestOf();
                write('f.txt', 'bbbb');
                expect(digestOf()).not.toBe(before);
            });

            posixOnly('changes on a file mode change', () => {
                write('f.txt', 'same');
                fs.chmodSync(path.join(project, 'f.txt'), 0o644);
                const before = digestOf();
                fs.chmodSync(path.join(project, 'f.txt'), 0o755);
                expect(digestOf()).not.toBe(before);
            });

            posixOnly('changes on a directory mode change', () => {
                write('sub/f.txt', 'same');
                const dir = path.join(project, 'sub');
                fs.chmodSync(dir, 0o755);
                const before = digestOf();
                try {
                    fs.chmodSync(dir, 0o700);
                    expect(digestOf()).not.toBe(before);
                } finally {
                    fs.chmodSync(dir, 0o755);
                }
            });

            symlinkOnly('changes when a symlink is retargeted to a same-size file', () => {
                write('a.txt', 'same');
                write('b.txt', 'same');
                fs.symlinkSync('a.txt', path.join(project, 'link'));
                const before = digestOf();
                fs.rmSync(path.join(project, 'link'));
                fs.symlinkSync('b.txt', path.join(project, 'link'));
                expect(digestOf()).not.toBe(before);
            });

            it('observes a nested .git but skips the root one', () => {
                write('.git/HEAD', 'root');
                write('sub/.git/HEAD', 'nested one');
                const before = digestOf();
                write('.git/HEAD', 'root changed');
                expect(digestOf()).toBe(before);
                write('sub/.git/HEAD', 'nested two');
                expect(digestOf()).not.toBe(before);
            });

            posixOnly('hashes a special file by path and mode without reading it', () => {
                write('f.txt', 'x');
                const before = digestOf();
                execFileSync('mkfifo', [path.join(project, 'pipe')], { env: { ...process.env } });
                expect(filesystemSnapshot(project, undefined, tiny)).toEqual({ ok: true, digest: expect.any(String) });
                expect(digestOf()).not.toBe(before);
            });
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

        it.each([
            [{ maxEntries: NaN, maxBytes: 10 }],
            [{ maxEntries: 1.5, maxBytes: 10 }],
            [{ maxEntries: Infinity, maxBytes: 10 }],
            [{ maxEntries: 10, maxBytes: 0 }],
            [{ maxEntries: 10, maxBytes: -1 }],
            [{ maxEntries: 10, maxBytes: NaN }],
        ])('rejects the snapshot limits %j instead of disabling the bound', limits => {
            expect(() => filesystemSnapshot(project, undefined, limits)).toThrow(/positive integers/);
        });

        it('rejects a whitespace-only root everywhere a root is taken', () => {
            expect(() => filesystemSnapshot('   ')).toThrow(/non-empty string/);
            expect(() => loadAdmissionConfig('   ')).toThrow(/non-empty string/);
            expect(() => gitVerifier('   ')).toThrow(/non-empty string/);
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

    describe('gitVerifier fail-closed branches (fake spawn)', () => {
        type Reply = Partial<SpawnSyncReturns<string>>;
        const verifierWith = (lsFiles: Reply, checkIgnore: Reply = { status: 1 }) => {
            const calls: Array<{ args: string[]; options: SpawnSyncOptions }> = [];
            const spawn = ((_command: string, args: string[], options: SpawnSyncOptions) => {
                calls.push({ args, options });
                return (args[0] === 'ls-files' ? lsFiles : checkIgnore) as SpawnSyncReturns<string>;
            }) as unknown as typeof spawnSync;
            return { verify: gitVerifier(project, { MARKER: 'env' }, spawn), calls };
        };

        it.each([
            ['ls-files ENOBUFS', { error: Object.assign(new Error('buffer'), { code: 'ENOBUFS' }) }, undefined, 'contains-tracked'],
            ['ls-files spawn error', { error: new Error('x') }, undefined, 'git-unavailable'],
            ['ls-files status 128', { status: 128, stdout: '' }, undefined, 'git-unavailable'],
            ['ls-files lists a file', { status: 0, stdout: 'a/b\0' }, { status: 0 }, 'contains-tracked'],
            ['check-ignore spawn error', { status: 0, stdout: '' }, { error: new Error('x') }, 'git-unavailable'],
            ['check-ignore status 2', { status: 0, stdout: '' }, { status: 2 }, 'git-unavailable'],
            ['check-ignore status 128', { status: 0, stdout: '' }, { status: 128 }, 'git-unavailable'],
            ['check-ignore status 1', { status: 0, stdout: '' }, { status: 1 }, 'not-ignored'],
            ['check-ignore status 0', { status: 0, stdout: '' }, { status: 0 }, 'excluded'],
        ] as Array<[string, Reply, Reply | undefined, CandidateVerdict]>)('%s', (_label, lsFiles, checkIgnore, expected) => {
            expect(verifierWith(lsFiles, checkIgnore).verify('pkg/node_modules')).toBe(expected);
        });

        it('scrubs repository-location variables from the child env without mutating the input', () => {
            const input: NodeJS.ProcessEnv = {
                PATH: '/usr/bin', GIT_CONFIG_GLOBAL: '/tmp/gitconfig', GIT_CEILING_DIRECTORIES: '/tmp',
                GIT_DIR: '/x', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x', git_index_file: '/x', GIT_OBJECT_DIRECTORY: '/x',
                GIT_ALTERNATE_OBJECT_DIRECTORIES: '/x', GIT_COMMON_DIR: '/x', GIT_NAMESPACE: 'x', GIT_PREFIX: 'x',
            };
            const snapshot = { ...input };
            const seen: Array<NodeJS.ProcessEnv | undefined> = [];
            const spawn = ((_command: string, args: string[], options: SpawnSyncOptions) => {
                seen.push(options.env);
                return (args[0] === 'ls-files' ? { status: 0, stdout: '' } : { status: 1 }) as SpawnSyncReturns<string>;
            }) as unknown as typeof spawnSync;
            gitVerifier(project, input, spawn)('pkg');
            expect(seen).toHaveLength(2);
            for (const env of seen) {
                expect(env).toEqual({ PATH: '/usr/bin', GIT_CONFIG_GLOBAL: '/tmp/gitconfig', GIT_CEILING_DIRECTORIES: '/tmp' });
            }
            expect(input).toEqual(snapshot);
        });

        it('invokes git without a shell, rooted, bounded and after --', () => {
            const { verify, calls } = verifierWith({ status: 0, stdout: '' }, { status: 0 });
            verify('pkg/node_modules');
            expect(calls.map(call => call.args)).toEqual([
                ['ls-files', '-z', '--', './pkg/node_modules'],
                ['check-ignore', '-q', '--', './pkg/node_modules'],
            ]);
            for (const { options } of calls) {
                expect(options.cwd).toBe(project);
                expect(options.timeout).toBeGreaterThan(0);
                expect(options.maxBuffer).toBeGreaterThan(0);
                expect(options.shell).toBeFalsy();
                expect(options.env).toEqual({ MARKER: 'env' });
            }
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

        it('is not redirected to another index by an inherited GIT_INDEX_FILE', () => {
            git(['init', '-q', '-b', 'main']);
            write('.gitignore', 'dist\n');
            write('dist/f');
            git(['add', '.gitignore']);
            git(['add', '-f', '--', 'dist/f']);
            git(['commit', '-qm', 'initial']);

            const verify = gitVerifier(project, { ...process.env, GIT_INDEX_FILE: path.join(root, 'missing-index') });

            expect(verify('dist')).toBe('contains-tracked');
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
