import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';

/**
 * A-R1 / A-R2 / V-R3(a), real git. AWM's own cloud recipe (D-7) installs a global
 * `url.<base>.insteadOf` rewrite; `git remote get-url` then reports the rewritten
 * transport URL while `.git/config` keeps the configured one. The rewrite here points
 * at a local bare repository so the test stays offline.
 */
describe('checkCurrentness under a global insteadOf rewrite (real git)', () => {
    const CONFIGURED = 'https://example.test/team/repo.git';
    const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-insteadof-'));
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        const home = path.join(root, 'home');
        fs.mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        const globalConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(globalConfig, [
            '[user]',
            '\temail = test@example.test',
            '\tname = test',
            `[url "${pathToFileURL(path.join(root, 'remote')).href}/"]`,
            '\tinsteadOf = https://example.test/',
            '',
        ].join('\n'));
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        process.env.GIT_CEILING_DIRECTORIES = root;
        jest.resetModules();
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    // Jest's sandboxed `process.env` is a copy: assignments never reach a spawned child
    // by themselves, so every git invocation (setup and the CLI transport) gets it explicitly.
    const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, env: { ...process.env }, stdio: 'pipe', encoding: 'utf8' });
    const realGit = async (cwd: string, args: string[], options: { timeoutMs: number; maxOutputBytes: number }): Promise<string> =>
        (await promisify(execFile)('git', args, { cwd, env: { ...process.env }, timeout: options.timeoutMs, maxBuffer: options.maxOutputBytes })).stdout;

    function cloneTaggedRegistry(): string {
        const seed = path.join(root, 'seed');
        fs.mkdirSync(seed);
        git(seed, ['init', '-q', '-b', 'main']);
        fs.writeFileSync(path.join(seed, 'README.md'), 'registry\n');
        git(seed, ['add', '.']);
        git(seed, ['commit', '-qm', 'initial']);
        git(seed, ['tag', 'v1.0.0']);
        const bare = path.join(root, 'remote', 'team', 'repo.git');
        fs.mkdirSync(path.dirname(bare), { recursive: true });
        git(root, ['clone', '-q', '--bare', seed, bare]);
        const checkout = path.join(root, 'checkout');
        git(root, ['clone', '-q', CONFIGURED, checkout]);
        git(checkout, ['checkout', '-q', 'v1.0.0']);
        return checkout;
    }

    async function check(checkout: string) {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        return checkCurrentness(root, {
            cliVersion: () => '1.2.3',
            now: () => 1_700_000_000_000,
            fetch: jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ version: '1.2.3' }) }),
            readPreferences: () => ({ pins: {} }),
            listRegistries: () => [{ name: 'baseline', remote: CONFIGURED, contentRoot: checkout }],
            git: realGit,
        });
    }

    it('reports the registry current when only the transport URL is rewritten', async () => {
        const checkout = cloneTaggedRegistry();
        expect(git(checkout, ['remote', 'get-url', 'origin']).trim()).not.toBe(CONFIGURED);
        expect(git(checkout, ['config', '--get', 'remote.origin.url']).trim()).toBe(CONFIGURED);

        const report = await check(checkout);

        expect(report.components[1]).toEqual(expect.objectContaining({
            component: 'registry:baseline', status: 'current', installed: 'v1.0.0', latest: 'v1.0.0',
        }));
    });

    it('still reports an origin stored with a different path as unverifiable', async () => {
        const checkout = cloneTaggedRegistry();
        git(checkout, ['remote', 'set-url', 'origin', 'https://example.test/team/other.git']);

        const report = await check(checkout);

        expect(report.components[1]).toEqual(expect.objectContaining({
            status: 'unverifiable', detail: expect.stringMatching(/origin does not match configured remote/i),
        }));
    });
});
