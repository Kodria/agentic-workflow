import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseFactsCatalog } from '../../../src/core/facts/catalog';
import type { FactsCatalog } from '../../../src/core/facts/types';
import {
    CONTEXT_INJECT_MAX_CHARS,
    buildInjection,
    statusFor,
} from '../../../src/core/environments/resolve';
import type { StoredFactValue } from '../../../src/core/environments/store';
import { readValues, writeFact } from '../../../src/core/environments/store';

function isolateHome(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-env-resolve-'));
    process.env.AWM_HOME = path.join(tmp, '.awm');
    process.env.HOME = tmp;
    return tmp;
}

const durableCatalog: FactsCatalog = parseFactsCatalog({
    schemaVersion: 1,
    facts: {
        'repos.root': {
            valueType: 'path',
            durability: 'durable',
            inject: 'reference',
        },
    },
});

const volatileCatalog: FactsCatalog = parseFactsCatalog({
    schemaVersion: 1,
    facts: {
        'aws.token': {
            valueType: 'string',
            durability: 'volatile',
            ttl: 1,
            inject: 'reference',
        },
    },
});

/** Volatile + inject:context — required so the fresh-status gate in buildInjection is reachable. */
const volatileContextCatalog: FactsCatalog = parseFactsCatalog({
    schemaVersion: 1,
    facts: {
        'aws.token': {
            valueType: 'string',
            durability: 'volatile',
            ttl: 1,
            inject: 'context',
        },
    },
});

const contextCatalog: FactsCatalog = parseFactsCatalog({
    schemaVersion: 1,
    facts: {
        'team.color': {
            valueType: 'string',
            durability: 'durable',
            inject: 'context',
        },
        'team.nick': {
            valueType: 'string',
            durability: 'durable',
            inject: 'context',
        },
        'repos.root': {
            valueType: 'path',
            durability: 'durable',
            inject: 'reference',
        },
    },
});

describe('environment resolve / inject (RF-2.3–2.5, RF-3.1–3.2, RNF-2)', () => {
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

    it('exports CONTEXT_INJECT_MAX_CHARS = 2048', () => {
        expect(CONTEXT_INJECT_MAX_CHARS).toBe(2048);
    });

    it('durable value stays fresh after fake clock +1y (RF-2.3)', () => {
        const store: Record<string, StoredFactValue> = {
            'repos.root': {
                value: '/x',
                status: 'fresh',
                updatedAt: '2025-01-01T00:00:00.000Z',
            },
        };
        const now = new Date('2026-01-01T00:00:00.000Z');
        expect(statusFor(durableCatalog, store, now)).toEqual({ 'repos.root': 'fresh' });
        const injection = buildInjection({
            catalog: durableCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'reference',
            now,
        });
        expect(injection.mode).toBe('reference');
        expect(injection.values).toBeUndefined();
    });

    it('volatile+ttl elapsed + inject:context does not serve secret as fresh (RF-2.4/2.5)', () => {
        const secret = 'secret-should-not-serve-as-fresh';
        const store: Record<string, StoredFactValue> = {
            'aws.token': {
                value: secret,
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
                expiresAt: '2026-10-12T00:00:01.000Z',
            },
        };
        const now = new Date('2026-10-12T00:00:02.000Z');
        expect(statusFor(volatileContextCatalog, store, now)['aws.token']).toBe('stale');
        // Catalog inject:context + request inject:context so omitting the stale/fresh
        // gate would put `secret` into values and flip mode to context (mutation-proof).
        const injection = buildInjection({
            catalog: volatileContextCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'context',
            now,
            maxChars: 10_000,
        });
        expect(injection.mode).toBe('reference');
        expect(injection.values).toBeUndefined();
        expect(injection.values?.['aws.token']).toBeUndefined();
        expect(JSON.stringify(injection)).not.toContain(secret);
    });

    it('stored status stale + inject:context does not inline the value (RF-2.4/2.5)', () => {
        const secret = 'stale-context-secret-value';
        const store: Record<string, StoredFactValue> = {
            'aws.token': {
                value: secret,
                status: 'stale',
                updatedAt: '2026-10-12T00:00:00.000Z',
                expiresAt: '2026-10-12T00:00:01.000Z',
            },
        };
        const now = new Date('2026-10-12T00:00:00.500Z'); // before expiresAt; stored status still stale
        expect(statusFor(volatileContextCatalog, store, now)['aws.token']).toBe('stale');
        const injection = buildInjection({
            catalog: volatileContextCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'context',
            now,
            maxChars: 10_000,
        });
        expect(injection.mode).toBe('reference');
        expect(injection.values).toBeUndefined();
        expect(JSON.stringify(injection)).not.toContain(secret);
    });

    it('missing fact → status missing, no default (RF-2.5)', () => {
        expect(statusFor(durableCatalog, {}, new Date())['repos.root']).toBe('missing');
        const injection = buildInjection({
            catalog: durableCatalog,
            store: {},
            storePath: '/store/values.json',
            inject: 'context',
            maxChars: 10_000,
        });
        expect(injection.values).toBeUndefined();
        expect(injection.factIds).toContain('repos.root');
    });

    it('buildInjection({ inject: reference }) returns store path + ids, no values (RF-3.1)', () => {
        const store: Record<string, StoredFactValue> = {
            'team.color': { value: 'blue', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'team.nick': { value: 'ace', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
        };
        const result = buildInjection({
            catalog: contextCatalog,
            store,
            storePath: '/abs/environments/default/values.json',
            inject: 'reference',
        });
        expect(result).toMatchObject({
            mode: 'reference',
            storePath: '/abs/environments/default/values.json',
        });
        expect(result.factIds).toEqual(expect.arrayContaining(['team.color', 'team.nick', 'repos.root']));
        expect(result.values).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('blue');
        expect(JSON.stringify(result)).not.toContain('ace');
    });

    it('buildInjection omits inject option → default reference; no values even when context-fresh exist (RNF-2)', () => {
        const store: Record<string, StoredFactValue> = {
            'team.color': { value: 'blue', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'team.nick': { value: 'ace', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
        };
        // No `inject` field: default must be reference. Mutating default to `context` would
        // include blue/ace and fail these assertions.
        const result = buildInjection({
            catalog: contextCatalog,
            store,
            storePath: '/abs/environments/default/values.json',
            maxChars: CONTEXT_INJECT_MAX_CHARS,
        });
        expect(result.mode).toBe('reference');
        expect(result.values).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('blue');
        expect(JSON.stringify(result)).not.toContain('ace');
    });

    it('unknown/typo inject does not fail open into context; no values inlined (RNF-2)', () => {
        const store: Record<string, StoredFactValue> = {
            'team.color': { value: 'blue', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'team.nick': { value: 'ace', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
        };
        // Runtime typo must not fall through into the context branch (fail-open).
        const result = buildInjection({
            catalog: contextCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'contezt' as unknown as 'context',
            maxChars: CONTEXT_INJECT_MAX_CHARS,
        });
        expect(result.mode).toBe('reference');
        expect(result.values).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('blue');
        expect(JSON.stringify(result)).not.toContain('ace');
    });

    it('inject: context under budget includes fresh context values (RF-3.2)', () => {
        const store: Record<string, StoredFactValue> = {
            'team.color': { value: 'blue', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'team.nick': { value: 'ace', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'repos.root': { value: '/should-not-inline', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
        };
        const result = buildInjection({
            catalog: contextCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'context',
            maxChars: CONTEXT_INJECT_MAX_CHARS,
        });
        expect(result.mode).toBe('context');
        expect(result.values).toEqual({
            'team.color': 'blue',
            'team.nick': 'ace',
        });
        expect(result.values).not.toHaveProperty('repos.root');
        expect(result.warning).toBeUndefined();
    });

    it('inject: context over budget degrades to reference + warning (RF-3.2)', () => {
        const store: Record<string, StoredFactValue> = {
            'team.color': { value: 'blue', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'team.nick': { value: 'ace', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
        };
        const result = buildInjection({
            catalog: contextCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'context',
            maxChars: 1,
        });
        expect(result.mode).toBe('reference');
        expect(result.values).toBeUndefined();
        expect(result.warning).toMatch(/budget|degrad/i);
        expect(result.storePath).toBe('/store/values.json');
        expect(JSON.stringify(result)).not.toMatch(/blue|ace/);
    });

    it('writeFact + statusFor: volatile ttl:1 with past updatedAt is stale', () => {
        writeFact(
            'default',
            'aws.token',
            {
                value: 'tok',
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
            },
            {
                definition: volatileCatalog.facts['aws.token'],
            },
        );
        const store = readValues('default');
        const now = new Date('2026-10-12T00:00:02.000Z');
        expect(statusFor(volatileCatalog, store, now)['aws.token']).toBe('stale');
    });

    it('volatile: now >= expiresAt is stale; missing/garbage expiresAt is stale; null now throws', () => {
        const expired: Record<string, StoredFactValue> = {
            'aws.token': {
                value: 'tok',
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
                expiresAt: '2026-10-12T00:00:01.000Z',
            },
        };
        // Exact boundary: now === expiresAt → stale (>=, not >).
        expect(
            statusFor(volatileCatalog, expired, new Date('2026-10-12T00:00:01.000Z'))['aws.token'],
        ).toBe('stale');
        // One ms before boundary stays fresh.
        expect(
            statusFor(volatileCatalog, expired, new Date('2026-10-12T00:00:00.999Z'))['aws.token'],
        ).toBe('fresh');

        const missingExpires: Record<string, StoredFactValue> = {
            'aws.token': {
                value: 'tok',
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
            },
        };
        expect(statusFor(volatileCatalog, missingExpires, new Date())['aws.token']).toBe('stale');

        const garbageExpires: Record<string, StoredFactValue> = {
            'aws.token': {
                value: 'tok',
                status: 'fresh',
                updatedAt: '2026-10-12T00:00:00.000Z',
                expiresAt: 'not-a-date',
            },
        };
        expect(statusFor(volatileCatalog, garbageExpires, new Date())['aws.token']).toBe('stale');

        expect(() => statusFor(volatileCatalog, expired, null as unknown as Date)).toThrow(/now|Date/i);
        expect(() =>
            buildInjection({
                catalog: volatileCatalog,
                store: expired,
                storePath: '/store/values.json',
                now: new Date(Number.NaN),
            }),
        ).toThrow(/now|Date/i);
    });

    it('inject: context mixed fresh+stale inlines only fresh (RF-3.2)', () => {
        const store: Record<string, StoredFactValue> = {
            'team.color': { value: 'blue', status: 'fresh', updatedAt: '2026-10-12T00:00:00.000Z' },
            'team.nick': { value: 'stale-nick', status: 'stale', updatedAt: '2026-10-12T00:00:00.000Z' },
        };
        const result = buildInjection({
            catalog: contextCatalog,
            store,
            storePath: '/store/values.json',
            inject: 'context',
            maxChars: CONTEXT_INJECT_MAX_CHARS,
        });
        expect(result.mode).toBe('context');
        expect(result.values).toEqual({ 'team.color': 'blue' });
        expect(result.values).not.toHaveProperty('team.nick');
        expect(JSON.stringify(result)).not.toContain('stale-nick');
    });
});
