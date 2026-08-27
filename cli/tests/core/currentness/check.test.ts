import fs from 'fs';
import os from 'os';
import path from 'path';

describe('checkCurrentness', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-currentness-'));
        jest.resetModules();
    });

    afterEach(() => {
        jest.useRealTimers();
        fs.rmSync(root, { recursive: true, force: true });
    });

    function deps(overrides: Record<string, unknown> = {}) {
        return {
            cliVersion: () => '1.2.3',
            now: () => 1_700_000_000_000,
            fetch: jest.fn().mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ version: '1.2.3' }),
            }),
            readPreferences: () => ({ pins: {} }),
            listRegistries: () => [{ name: 'baseline', remote: 'https://example.test/team/repo.git', contentRoot: '/registry' }],
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/v1.2.3\n`;
                if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
                if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
                if (args[0] === 'describe') return 'v1.2.3\n';
                throw new Error(`unexpected git invocation: ${args.join(' ')}`);
            }),
            ...overrides,
        };
    }

    it('reports authoritative current CLI and registry without exposing URL credentials', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps());

        expect(result.components).toEqual([
            expect.objectContaining({ component: 'cli', installed: '1.2.3', latest: '1.2.3', status: 'current', channel: 'stable' }),
            expect.objectContaining({ component: 'registry:baseline', installed: 'v1.2.3', latest: 'v1.2.3', status: 'current', channel: 'stable' }),
        ]);
        expect(JSON.stringify(result)).not.toContain('secret');
        expect(result.components[1].source).toBe('https://example.test/team/repo.git');
    });

    it('reads npm currentness from the bounded latest metadata endpoint', async () => {
        const fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({ version: '1.2.3' }),
        });
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({ fetch }));

        expect(fetch).toHaveBeenCalledWith(
            'https://registry.npmjs.org/agentic-workflow-manager/latest',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(result.components[0]).toEqual(expect.objectContaining({ status: 'current', latest: '1.2.3' }));
    });

    it('marks an older pinned registry as pinned-behind with the unpin remedy', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            readPreferences: () => ({ pins: { baseline: '1.0.0' } }),
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'b'.repeat(40)}\trefs/tags/v1.1.0\n${'a'.repeat(40)}\trefs/tags/v1.0.0\n`;
                if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
                if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
                if (args[0] === 'describe') return 'v1.0.0\n';
                throw new Error('unexpected');
            }),
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({
            status: 'pinned-behind',
            pin: '1.0.0',
            remedy: 'awm unpin baseline && awm update --yes',
        }));
    });

    it('marks an npm latest version above the max-safe numeric boundary as stale', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            cliVersion: () => '1.9007199254740992.0',
            fetch: jest.fn().mockResolvedValue({
                ok: true,
                text: async () => JSON.stringify({ version: '1.9007199254740993.0' }),
            }),
        }));

        expect(result.components[0]).toEqual(expect.objectContaining({
            installed: '1.9007199254740992.0',
            latest: '1.9007199254740993.0',
            status: 'stale',
        }));
    });

    it('marks a registry tag above the max-safe numeric boundary as stale', async () => {
        const installed = 'v1.9007199254740992.0';
        const latest = 'v1.9007199254740993.0';
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'b'.repeat(40)}\trefs/tags/${latest}\n${'a'.repeat(40)}\trefs/tags/${installed}\n`;
                if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
                if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
                if (args[0] === 'describe') return `${installed}\n`;
                throw new Error('unexpected');
            }),
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({ installed, latest, status: 'stale' }));
    });

    it('discovers an unprefixed stable SemVer tag while ignoring prereleases', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/1.2.4\n${'b'.repeat(40)}\trefs/tags/1.2.5-rc.1\n`;
                if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
                if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
                if (args[0] === 'describe') return '1.2.4\n';
                throw new Error('unexpected');
            }),
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({
            installed: '1.2.4', latest: '1.2.4', status: 'current',
        }));
    });

    it('marks a lower installed version stale even when it shares the latest tag SHA', async () => {
        const sharedSha = 'a'.repeat(40);
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${sharedSha}\trefs/tags/v1.2.4\n`;
                if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
                if (args[0] === 'rev-parse') return `${sharedSha}\n`;
                if (args[0] === 'describe') return 'v1.2.3\n';
                throw new Error('unexpected');
            }),
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({
            installed: 'v1.2.3', latest: 'v1.2.4', status: 'stale', remedy: 'awm update --yes',
        }));
    });

    it.each([
        ['branch provenance', async (_cwd: string, args: string[]) => args[0] === 'describe' ? Promise.reject(new Error('not a tag')) : args[0] === 'ls-remote' ? `${'a'.repeat(40)}\trefs/tags/v1.2.3\n` : args[0] === 'remote' ? 'https://example.test/team/repo.git\n' : `${'a'.repeat(40)}\n`],
        ['malformed npm semver', undefined],
    ])('fails closed for %s', async (name, git) => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps(name === 'malformed npm semver'
            ? { fetch: jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ version: 'latest' }) }) }
            : { git }
        ));

        expect(result.components.some((c: { status: string }) => c.status === 'unverifiable')).toBe(true);
    });

    it('bypasses passive update controls and makes no writes', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const before = fs.readdirSync(root);
        const fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '' });
        const result = await checkCurrentness(root, deps({ fetch, env: { AWM_NO_UPDATE_CHECK: '1' } }));

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result.components[0]).toEqual(expect.objectContaining({ status: 'unverifiable' }));
        expect(fs.readdirSync(root)).toEqual(before);
    });

    it('returns a complete strict report when the local registry inventory is malformed', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            listRegistries: () => { throw new Error('Invalid registries config at /private/registries.json'); },
        }));

        expect(result.components).toEqual(expect.arrayContaining([
            expect.objectContaining({ component: 'cli', status: 'current' }),
            expect.objectContaining({
                component: 'registry:inventory', status: 'unverifiable',
                source: '[configured registry inventory]',
                remedy: 'Repair the local registry inventory and rerun strict preflight.',
            }),
        ]));
        expect(JSON.stringify(result)).not.toContain('/private/registries.json');
    });

    it('settles deterministically when an injected fetch ignores abort and later rejects', async () => {
        jest.useFakeTimers();
        let rejectFetch!: (reason: Error) => void;
        const fetch = jest.fn(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const pending = checkCurrentness(root, deps({ fetch }));

        await jest.advanceTimersByTimeAsync(2_000);
        await expect(pending).resolves.toEqual(expect.objectContaining({
            components: expect.arrayContaining([expect.objectContaining({ component: 'cli', status: 'unverifiable' })]),
        }));

        rejectFetch(new Error('late fetch failure'));
        await Promise.resolve();
    });

    it('settles deterministically when an injected Git transport ignores its timeout and later rejects', async () => {
        jest.useFakeTimers();
        let rejectGit!: (reason: Error) => void;
        const git = jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
            if (args[0] === 'ls-remote') return new Promise((_resolve, reject) => { rejectGit = reject; });
            if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
            if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
            if (args[0] === 'describe') return 'v1.2.3\n';
            throw new Error('unexpected');
        });
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const pending = checkCurrentness(root, deps({ git }));

        await jest.advanceTimersByTimeAsync(2_000);
        await expect(pending).resolves.toEqual(expect.objectContaining({
            components: expect.arrayContaining([expect.objectContaining({ component: 'registry:baseline', status: 'unverifiable' })]),
        }));

        rejectGit(new Error('late Git failure'));
        await Promise.resolve();
    });

    it('rejects oversized npm metadata before attempting JSON parsing', async () => {
        const parse = jest.fn(() => ({ 'dist-tags': { latest: '1.2.3' } }));
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            fetch: jest.fn().mockResolvedValue({
                ok: true,
                text: async () => 'x'.repeat(64 * 1024 + 1),
                json: parse,
            }),
        }));

        expect(result.components[0]).toEqual(expect.objectContaining({ status: 'unverifiable' }));
        expect(parse).not.toHaveBeenCalled();
    });

    it.each([
        'http://example.test/team/repo.git',
        'ftp://example.test/team/repo.git',
        'https://username:password@example.test/team/repo.git',
        'ssh://git:secret@example.test/team/repo.git',
        'git@example.test:team/repo.git?token=secret',
    ])('rejects non-authoritative transport %s before Git invocation', async (remote) => {
        const git = jest.fn();
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            listRegistries: () => [{ name: 'baseline', remote, contentRoot: '/registry' }],
            git,
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({
            source: '[configured remote]',
            status: 'unverifiable',
        }));
        expect(git).not.toHaveBeenCalled();
    });

    it.each([
        ['ssh://username@example.test/team/repo.git', 'ssh://example.test/team/repo.git'],
        ['username@github.example:team/repo.git', 'github.example:team/repo.git'],
    ])('accepts auth-free SSH and SCP remotes while rendering a safe source for %s', async (remote, expectedSource) => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            listRegistries: () => [{ name: 'baseline', remote, contentRoot: '/registry' }],
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/v1.2.3\n`;
                if (args[0] === 'remote') return `${remote}\n`;
                if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
                if (args[0] === 'describe') return 'v1.2.3\n';
                throw new Error('unexpected');
            }),
        }));

        expect(result.components[1].source).toBe(expectedSource);
        expect(JSON.stringify(result)).not.toContain('username');
        expect(JSON.stringify(result)).not.toContain('password');
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('treats the peeled commit of an annotated stable tag as authoritative', async () => {
        const tagObject = 'b'.repeat(40);
        const peeledCommit = 'a'.repeat(40);
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${tagObject}\trefs/tags/v1.2.3\n${peeledCommit}\trefs/tags/v1.2.3^{}\n`;
                if (args[0] === 'remote') return 'https://example.test/team/repo.git\n';
                if (args[0] === 'rev-parse') return `${peeledCommit}\n`;
                if (args[0] === 'describe') return 'v1.2.3\n';
                throw new Error('unexpected');
            }),
        }));

        expect(result.components[1]).toEqual(expect.objectContaining({ status: 'current', latest: 'v1.2.3' }));
    });
});
