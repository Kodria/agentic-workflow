import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { mergeFactDefinitions, registerEnvCommand, type EnvCommandDeps } from '../../../src/commands/env';
import {
    getActiveEnvironmentName,
    readValues,
    valuesPath,
    writeFact,
} from '../../../src/core/environments/store';
import type { FactsCatalog } from '../../../src/core/facts/types';

const catalog: FactsCatalog = {
    schemaVersion: 1,
    facts: {
        'repos.root': {
            valueType: 'path',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
        },
        'aws.profile': {
            valueType: 'string',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
        },
        'env.kind': {
            valueType: 'enum',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
            values: ['dev', 'prod'],
        },
        'aws.token': {
            valueType: 'string',
            resolution: 'prompt',
            durability: 'volatile',
            inject: 'reference',
            ttl: 1,
        },
    },
};

function isolateHome(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-env-cmd-'));
    process.env.AWM_HOME = path.join(tmp, '.awm');
    process.env.HOME = tmp;
    return tmp;
}

async function run(
    argv: string[],
    loadCatalog: () => FactsCatalog = () => catalog,
    extraDeps: EnvCommandDeps = {},
): Promise<{ out: string; err: string }> {
    const prog = new Command();
    prog.exitOverride();
    prog.configureOutput({ writeErr: () => undefined });
    registerEnvCommand(prog, {
        loadCatalog,
        consultedRoots: () => ['/tmp/test-registry'],
        stdinIsTTY: () => false,
        ...extraDeps,
    });
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        await prog.parseAsync(['node', 'awm', 'env', ...argv]);
    } finally {
        // keep spies until we collect
    }
    const out =
        outSpy.mock.calls.map((c) => String(c[0])).join('') +
        logSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    const err =
        errSpy.mock.calls.map((c) => String(c[0])).join('') +
        errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
    outSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    return { out, err };
}

describe('awm env commands (RF-2, RF-3.3)', () => {
    let tmp: string;
    let prevHome: string | undefined;
    let prevAwm: string | undefined;

    beforeEach(() => {
        prevHome = process.env.HOME;
        prevAwm = process.env.AWM_HOME;
        tmp = isolateHome();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
        if (prevAwm === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = prevAwm;
    });

    it('set --value writes under environments/default/values.json without shelling out (RF-2.1, RF-3.3)', async () => {
        const spawn = jest.spyOn(require('child_process'), 'spawnSync');
        const execFile = jest.spyOn(require('child_process'), 'execFileSync');
        await run(['set', 'repos.root', '--value', '/machine/repos']);
        expect(readValues('default')['repos.root'].value).toBe('/machine/repos');
        expect(fs.existsSync(valuesPath('default'))).toBe(true);
        expect(valuesPath('default')).toContain(path.join('.awm', 'environments', 'default', 'values.json'));
        expect(spawn).not.toHaveBeenCalled();
        expect(execFile).not.toHaveBeenCalled();
        spawn.mockRestore();
        execFile.mockRestore();
    });

    it('status reports missing for unset facts and fresh after set (RF-2.5)', async () => {
        let { out } = await run(['status']);
        expect(out).toMatch(/repos\.root:\s*missing/);
        expect(out).toMatch(/aws\.profile:\s*missing/);
        await run(['set', 'repos.root', '--value', '/r']);
        ({ out } = await run(['status']));
        expect(out).toMatch(/repos\.root:\s*fresh/);
        // Unset sibling stays missing — no silent default invent for other ids.
        expect(out).toMatch(/aws\.profile:\s*missing/);
        expect(out).not.toMatch(/aws\.profile:\s*fresh/);
    });

    it('status reports stale for expired volatile fact (RF-2.5)', async () => {
        writeFact(
            'default',
            'aws.token',
            {
                value: 'tok',
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
            },
            { definition: catalog.facts['aws.token'] },
        );
        const { out } = await run(['status'], () => catalog, {
            now: () => new Date('2026-10-12T00:00:02.000Z'),
        });
        expect(out).toMatch(/aws\.token:\s*stale/);
    });

    it('edit prints absolute store path', async () => {
        const { out } = await run(['edit']);
        expect(out).toContain(valuesPath(getActiveEnvironmentName()));
        expect(path.isAbsolute(out.trim().split(/\s+/).find((t) => t.includes('values.json')) || valuesPath('default'))).toBe(true);
    });

    it('refresh --value updates an existing fact without shell (RF-3.3)', async () => {
        await run(['set', 'aws.profile', '--value', 'old']);
        await run(['refresh', 'aws.profile', '--value', 'new-profile']);
        expect(readValues('default')['aws.profile'].value).toBe('new-profile');
    });

    it('refresh without --value in non-interactive mode errors', async () => {
        await run(['set', 'aws.profile', '--value', 'old']);
        await expect(run(['refresh', 'aws.profile'])).rejects.toThrow(/--value|value/i);
    });

    it('use switches active environment (RF-2.2)', async () => {
        await run(['use', 'staging']);
        expect(getActiveEnvironmentName()).toBe('staging');
        await run(['set', 'repos.root', '--value', '/staging/repos']);
        expect(valuesPath('staging')).toContain(`${path.sep}staging${path.sep}values.json`);
        expect(readValues('staging')['repos.root'].value).toBe('/staging/repos');
    });

    it('set unknown id errors listing consulted roots', async () => {
        await expect(run(['set', 'no.such.fact', '--value', 'x'])).rejects.toThrow(/no\.such\.fact/);
        await expect(run(['set', 'no.such.fact', '--value', 'x'])).rejects.toThrow(/test-registry/);
        expect(readValues('default')).toEqual({});
    });

    it('set rejects empty path and leaves store unchanged', async () => {
        await expect(run(['set', 'repos.root', '--value', ''])).rejects.toThrow(/path|empty|value/i);
        expect(readValues('default')).toEqual({});
    });

    it('set rejects invalid enum value', async () => {
        await expect(run(['set', 'env.kind', '--value', 'qa'])).rejects.toThrow(/enum|dev|prod/i);
        expect(readValues('default')).toEqual({});
    });

    it('set never imports child_process for resolution (RF-3.3)', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '../../../src/commands/env/index.ts'),
            'utf-8',
        );
        expect(src).not.toMatch(/child_process/);
        expect(src).not.toMatch(/\bexecSync\b|\bspawnSync\b|\bexecFileSync\b/);
    });

    it('set without --value on TTY uses promptFn (RF-3.3)', async () => {
        const prompts: string[] = [];
        await run(['set', 'repos.root'], () => catalog, {
            stdinIsTTY: () => true,
            promptValue: (q) => {
                prompts.push(q);
                return '/prompted/repos';
            },
        });
        expect(prompts.length).toBeGreaterThanOrEqual(1);
        expect(readValues('default')['repos.root'].value).toBe('/prompted/repos');
    });

    it('set without --value when not TTY keeps requireValue error (RF-3.3)', async () => {
        await expect(run(['set', 'repos.root'], () => catalog, { stdinIsTTY: () => false })).rejects.toThrow(
            /--value|value/i,
        );
    });

    it('refresh --all on TTY prompts each store id via promptFn', async () => {
        await run(['set', 'repos.root', '--value', '/old']);
        await run(['set', 'aws.profile', '--value', 'old-profile']);
        const seen: string[] = [];
        const answers: Record<string, string> = {
            'repos.root': '/new',
            'aws.profile': 'new-profile',
        };
        await run(['refresh', '--all'], () => catalog, {
            stdinIsTTY: () => true,
            promptValue: (q) => {
                const id = Object.keys(answers).find((k) => q.includes(k));
                if (!id) throw new Error(`unexpected prompt: ${q}`);
                seen.push(id);
                return answers[id];
            },
        });
        expect(seen.sort()).toEqual(['aws.profile', 'repos.root']);
        expect(readValues('default')['repos.root'].value).toBe('/new');
        expect(readValues('default')['aws.profile'].value).toBe('new-profile');
    });

    it('refresh --all when not TTY keeps clear error', async () => {
        await run(['set', 'repos.root', '--value', '/old']);
        await expect(run(['refresh', '--all'], () => catalog, { stdinIsTTY: () => false })).rejects.toThrow(
            /--all|interactive|factId|--value|TTY/i,
        );
    });

    it('inject prints buildInjection JSON (default reference)', async () => {
        await run(['set', 'repos.root', '--value', '/r']);
        const { out } = await run(['inject']);
        const parsed = JSON.parse(out.trim());
        expect(parsed.mode).toBe('reference');
        expect(parsed.storePath).toContain('values.json');
        expect(parsed.factIds).toEqual(expect.arrayContaining(['repos.root']));
        expect(parsed.values).toBeUndefined();
    });

    it('inject --mode context includes fresh context values when catalog allows', async () => {
        const contextCatalog: FactsCatalog = {
            schemaVersion: 1,
            facts: {
                'team.color': {
                    valueType: 'string',
                    resolution: 'prompt',
                    durability: 'durable',
                    inject: 'context',
                },
            },
        };
        await run(['set', 'team.color', '--value', 'blue'], () => contextCatalog);
        const { out } = await run(['inject', '--mode', 'context'], () => contextCatalog);
        const parsed = JSON.parse(out.trim());
        expect(parsed.mode).toBe('context');
        expect(parsed.values).toEqual({ 'team.color': 'blue' });
    });

    it('mergeFactDefinitions refuses to weaken volatile → durable (secret revive)', () => {
        const into: FactsCatalog['facts'] = {
            'aws.token': {
                valueType: 'string',
                resolution: 'prompt',
                durability: 'volatile',
                inject: 'context',
                ttl: 60,
            },
        };
        mergeFactDefinitions(into, {
            'aws.token': {
                valueType: 'string',
                resolution: 'prompt',
                durability: 'durable',
                inject: 'context',
            },
        });
        expect(into['aws.token'].durability).toBe('volatile');
        expect(into['aws.token'].ttl).toBe(60);
    });
});
