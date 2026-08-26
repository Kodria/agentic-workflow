import fs from 'fs';
import os from 'os';
import path from 'path';

describe('checkCurrentness', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-currentness-'));
        jest.resetModules();
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    function deps(overrides: Record<string, unknown> = {}) {
        return {
            cliVersion: () => '1.2.3',
            now: () => 1_700_000_000_000,
            fetch: jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ 'dist-tags': { latest: '1.2.3' } }),
            }),
            readPreferences: () => ({ pins: {} }),
            listRegistries: () => [{ name: 'baseline', remote: 'https://token:secret@example.test/team/repo.git', contentRoot: '/registry' }],
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/tags/v1.2.3\n`;
                if (args[0] === 'remote') return 'https://token:secret@example.test/team/repo.git\n';
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

    it('marks an older pinned registry as pinned-behind with the unpin remedy', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps({
            readPreferences: () => ({ pins: { baseline: '1.0.0' } }),
            git: jest.fn().mockImplementation(async (_cwd: string, args: string[]) => {
                if (args[0] === 'ls-remote') return `${'b'.repeat(40)}\trefs/tags/v1.1.0\n${'a'.repeat(40)}\trefs/tags/v1.0.0\n`;
                if (args[0] === 'remote') return 'https://token:secret@example.test/team/repo.git\n';
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

    it.each([
        ['branch provenance', async (_cwd: string, args: string[]) => args[0] === 'describe' ? Promise.reject(new Error('not a tag')) : args[0] === 'ls-remote' ? `${'a'.repeat(40)}\trefs/tags/v1.2.3\n` : args[0] === 'remote' ? 'https://example.test/team/repo.git\n' : `${'a'.repeat(40)}\n`],
        ['malformed npm semver', undefined],
    ])('fails closed for %s', async (name, git) => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const result = await checkCurrentness(root, deps(name === 'malformed npm semver'
            ? { fetch: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ 'dist-tags': { latest: 'latest' } }) }) }
            : { git }
        ));

        expect(result.components.some((c: { status: string }) => c.status === 'unverifiable')).toBe(true);
    });

    it('bypasses passive update controls and makes no writes', async () => {
        const { checkCurrentness } = require('../../../src/core/currentness/check');
        const before = fs.readdirSync(root);
        const fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
        const result = await checkCurrentness(root, deps({ fetch, env: { AWM_NO_UPDATE_CHECK: '1' } }));

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(result.components[0]).toEqual(expect.objectContaining({ status: 'unverifiable' }));
        expect(fs.readdirSync(root)).toEqual(before);
    });
});
