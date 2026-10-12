import fs from 'fs';
import os from 'os';
import path from 'path';
import { Command } from 'commander';
import { registerEnvCommand } from '../../../src/commands/env';
import { getActiveEnvironmentName, readValues, valuesPath } from '../../../src/core/environments/store';
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
    },
};

function isolateHome(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-env-cmd-'));
    process.env.AWM_HOME = path.join(tmp, '.awm');
    process.env.HOME = tmp;
    return tmp;
}

function run(argv: string[], loadCatalog: () => FactsCatalog = () => catalog): { out: string; err: string } {
    const prog = new Command();
    prog.exitOverride();
    prog.configureOutput({ writeErr: () => undefined });
    registerEnvCommand(prog, { loadCatalog, consultedRoots: () => ['/tmp/test-registry'] });
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
        prog.parse(['node', 'awm', 'env', ...argv]);
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

    it('set --value writes under environments/default/values.json without shelling out (RF-2.1, RF-3.3)', () => {
        const spawn = jest.spyOn(require('child_process'), 'spawnSync');
        const execFile = jest.spyOn(require('child_process'), 'execFileSync');
        run(['set', 'repos.root', '--value', '/machine/repos']);
        expect(readValues('default')['repos.root'].value).toBe('/machine/repos');
        expect(fs.existsSync(valuesPath('default'))).toBe(true);
        expect(valuesPath('default')).toContain(path.join('.awm', 'environments', 'default', 'values.json'));
        expect(spawn).not.toHaveBeenCalled();
        expect(execFile).not.toHaveBeenCalled();
        spawn.mockRestore();
        execFile.mockRestore();
    });

    it('status reports missing for unset facts and fresh after set (RF-2.5)', () => {
        let { out } = run(['status']);
        expect(out).toMatch(/repos\.root/);
        expect(out).toMatch(/missing/i);
        run(['set', 'repos.root', '--value', '/r']);
        ({ out } = run(['status']));
        expect(out).toMatch(/fresh/i);
        expect(out).not.toMatch(/\/invented-default/);
    });

    it('edit prints absolute store path', () => {
        const { out } = run(['edit']);
        expect(out).toContain(valuesPath(getActiveEnvironmentName()));
        expect(path.isAbsolute(out.trim().split(/\s+/).find((t) => t.includes('values.json')) || valuesPath('default'))).toBe(true);
    });

    it('refresh --value updates an existing fact without shell (RF-3.3)', () => {
        run(['set', 'aws.profile', '--value', 'old']);
        run(['refresh', 'aws.profile', '--value', 'new-profile']);
        expect(readValues('default')['aws.profile'].value).toBe('new-profile');
    });

    it('refresh without --value in non-interactive mode errors', () => {
        run(['set', 'aws.profile', '--value', 'old']);
        expect(() => run(['refresh', 'aws.profile'])).toThrow(/--value|value/i);
    });

    it('use switches active environment (RF-2.2)', () => {
        run(['use', 'staging']);
        expect(getActiveEnvironmentName()).toBe('staging');
        run(['set', 'repos.root', '--value', '/staging/repos']);
        expect(valuesPath('staging')).toContain(`${path.sep}staging${path.sep}values.json`);
        expect(readValues('staging')['repos.root'].value).toBe('/staging/repos');
    });

    it('set unknown id errors listing consulted roots', () => {
        expect(() => run(['set', 'no.such.fact', '--value', 'x'])).toThrow(/no\.such\.fact/);
        expect(() => run(['set', 'no.such.fact', '--value', 'x'])).toThrow(/test-registry/);
        expect(readValues('default')).toEqual({});
    });

    it('set rejects empty path and leaves store unchanged', () => {
        expect(() => run(['set', 'repos.root', '--value', ''])).toThrow(/path|empty|value/i);
        expect(readValues('default')).toEqual({});
    });

    it('set rejects invalid enum value', () => {
        expect(() => run(['set', 'env.kind', '--value', 'qa'])).toThrow(/enum|dev|prod/i);
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
});
