import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    EnvironmentStoreError,
    environmentsRoot,
    getActiveEnvironmentName,
    readValues,
    setActiveEnvironmentName,
    valuesPath,
    writeEnvValue,
    writeFact,
} from '../../../src/core/environments/store';
import type { FactDefinition } from '../../../src/core/facts/types';

function isolateHome(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-env-store-'));
    process.env.AWM_HOME = path.join(tmp, '.awm');
    process.env.HOME = tmp;
    return tmp;
}

describe('environment store (RF-2.1, RF-2.2, RNF-1)', () => {
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

    it('environmentsRoot is under AWM_HOME/environments (RF-2.1)', () => {
        expect(environmentsRoot()).toBe(path.join(process.env.AWM_HOME!, 'environments'));
    });

    it('set writes only under AWM_HOME/environments/default/values.json (RF-2.1)', () => {
        writeFact('default', 'repos.root', {
            value: '/machine/repos',
            status: 'fresh',
            updatedAt: '2026-10-12T00:00:00.000Z',
        });
        const expected = path.join(process.env.AWM_HOME!, 'environments', 'default', 'values.json');
        expect(valuesPath('default')).toBe(expected);
        expect(fs.existsSync(expected)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(expected, 'utf-8'));
        expect(parsed['repos.root']).toMatchObject({
            value: '/machine/repos',
            status: 'fresh',
        });
        // Nothing written outside environments/
        const awm = process.env.AWM_HOME!;
        const entries = fs.readdirSync(awm);
        expect(entries).toEqual(['environments']);
    });

    it('maintains exactly one active environment; default name is default (RF-2.2)', () => {
        expect(getActiveEnvironmentName()).toBe('default');
        writeFact('default', 'repos.root', {
            value: '/a',
            status: 'fresh',
            updatedAt: '2026-10-12T00:00:00.000Z',
        });
        expect(getActiveEnvironmentName()).toBe('default');
        setActiveEnvironmentName('staging');
        expect(getActiveEnvironmentName()).toBe('staging');
        writeFact('staging', 'repos.root', {
            value: '/b',
            status: 'fresh',
            updatedAt: '2026-10-12T00:00:00.000Z',
        });
        expect(getActiveEnvironmentName()).toBe('staging');
        // Switching does not create a second "active" — only one name is active
        setActiveEnvironmentName('default');
        expect(getActiveEnvironmentName()).toBe('default');
    });

    it('readValues returns empty object when store file is missing', () => {
        expect(readValues('default')).toEqual({});
    });

    it('on volatile write sets expiresAt from updatedAt + ttlSeconds', () => {
        const def: FactDefinition = {
            valueType: 'string',
            resolution: 'prompt',
            durability: 'volatile',
            inject: 'reference',
            ttl: 60,
        };
        writeFact(
            'default',
            'aws.token',
            {
                value: 'tok',
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
            },
            { definition: def },
        );
        const stored = readValues('default')['aws.token'];
        expect(stored.expiresAt).toBe('2026-10-12T00:01:00.000Z');
    });

    it('writeEnvValue refuses a target inside a registry tree (RNF-1)', () => {
        const registryRoot = path.join(tmp, 'fake-registry');
        fs.mkdirSync(path.join(registryRoot, 'skills'), { recursive: true });
        const badTarget = path.join(registryRoot, 'environments', 'default', 'values.json');
        expect(() =>
            writeEnvValue(badTarget, { 'repos.root': { value: 'x', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' } }, {
                registryRoots: [registryRoot],
            }),
        ).toThrow(EnvironmentStoreError);
        expect(() =>
            writeEnvValue(badTarget, { 'repos.root': { value: 'x', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' } }, {
                registryRoots: [registryRoot],
            }),
        ).toThrow(/registry/i);
        expect(fs.existsSync(badTarget)).toBe(false);
    });

    it('refuses write when AWM_HOME/environments is a symlink into a registry root (RNF-1)', () => {
        const registryRoot = path.join(tmp, 'fake-registry');
        const registryEnvLanding = path.join(registryRoot, 'hijacked-env');
        fs.mkdirSync(registryEnvLanding, { recursive: true });
        const awm = process.env.AWM_HOME!;
        fs.mkdirSync(awm, { recursive: true });
        // Lexical path is under AWM_HOME; realpath lands inside the registry.
        fs.symlinkSync(registryEnvLanding, path.join(awm, 'environments'));

        expect(() =>
            writeFact(
                'default',
                'repos.root',
                { value: '/leaked', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
                { registryRoots: [registryRoot] },
            ),
        ).toThrow(EnvironmentStoreError);
        expect(() =>
            writeFact(
                'default',
                'repos.root',
                { value: '/leaked', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
                { registryRoots: [registryRoot] },
            ),
        ).toThrow(/registry/i);

        // Nothing materialised inside the registry landing dir.
        expect(fs.readdirSync(registryEnvLanding)).toEqual([]);
        expect(fs.existsSync(path.join(registryEnvLanding, 'default', 'values.json'))).toBe(false);
    });

    it('writeFact rejects empty path valueType without mutating store', () => {
        const def: FactDefinition = {
            valueType: 'path',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
        };
        expect(() =>
            writeFact(
                'default',
                'repos.root',
                { value: '', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
                { definition: def },
            ),
        ).toThrow(EnvironmentStoreError);
        expect(readValues('default')).toEqual({});
    });

    it('writeFact rejects unknown id when catalog is provided', () => {
        expect(() =>
            writeFact(
                'default',
                'unknown.fact',
                { value: 'x', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
                {
                    catalog: { schemaVersion: 1, facts: { 'repos.root': {
                        valueType: 'path',
                        resolution: 'prompt',
                        durability: 'durable',
                        inject: 'reference',
                    } } },
                    consultedRoots: ['/tmp/reg-a', '/tmp/reg-b'],
                },
            ),
        ).toThrow(/unknown\.fact/);
        expect(() =>
            writeFact(
                'default',
                'unknown.fact',
                { value: 'x', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
                {
                    catalog: { schemaVersion: 1, facts: {} },
                    consultedRoots: ['/tmp/reg-a'],
                },
            ),
        ).toThrow(/reg-a/);
        expect(readValues('default')).toEqual({});
    });
});
