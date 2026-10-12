import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    FACTS_MIN_CLI_VERSION,
    FactsCatalogError,
} from '../../../src/core/facts/types';
import { parseFactsCatalog } from '../../../src/core/facts/catalog';

const validRepos = {
    schemaVersion: 1,
    facts: {
        'repos.root': {
            description: 'Local root for team clones',
            valueType: 'path',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
        },
    },
};

describe('parseFactsCatalog (RF-1.1)', () => {
    it('exports FACTS_MIN_CLI_VERSION as 9.18.0', () => {
        expect(FACTS_MIN_CLI_VERSION).toBe('9.18.0');
    });

    it('parses a valid schemaVersion 1 catalog with path/prompt/durable/reference', () => {
        const catalog = parseFactsCatalog(validRepos);
        expect(catalog.schemaVersion).toBe(1);
        expect(catalog.facts['repos.root']).toEqual({
            description: 'Local root for team clones',
            valueType: 'path',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
        });
    });

    it('applies defaults durability durable, inject reference, resolution prompt', () => {
        const catalog = parseFactsCatalog({
            schemaVersion: 1,
            facts: {
                'aws.profile': { valueType: 'string' },
            },
        });
        expect(catalog.facts['aws.profile']).toMatchObject({
            valueType: 'string',
            resolution: 'prompt',
            durability: 'durable',
            inject: 'reference',
        });
    });

    it('accepts empty facts object', () => {
        expect(parseFactsCatalog({ schemaVersion: 1, facts: {} }).facts).toEqual({});
    });

    it('rejects bad schemaVersion with FactsCatalogError', () => {
        expect(() => parseFactsCatalog({ schemaVersion: 2, facts: {} })).toThrow(FactsCatalogError);
        expect(() => parseFactsCatalog({ schemaVersion: 2, facts: {} })).toThrow(/schemaVersion/);
    });

    it('rejects missing facts object with FactsCatalogError', () => {
        expect(() => parseFactsCatalog({ schemaVersion: 1 })).toThrow(FactsCatalogError);
        expect(() => parseFactsCatalog({ schemaVersion: 1 })).toThrow(/facts/);
    });

    it('rejects unknown valueType with FactsCatalogError', () => {
        expect(() =>
            parseFactsCatalog({
                schemaVersion: 1,
                facts: { 'repos.root': { valueType: 'blob' } },
            })
        ).toThrow(FactsCatalogError);
        expect(() =>
            parseFactsCatalog({
                schemaVersion: 1,
                facts: { 'repos.root': { valueType: 'blob' } },
            })
        ).toThrow(/valueType/);
    });

    it('rejects resolution: command with message containing those words and v1 (RF-3.3 catalog)', () => {
        expect(() =>
            parseFactsCatalog({
                schemaVersion: 1,
                facts: {
                    'repos.root': { valueType: 'path', resolution: 'command' },
                },
            })
        ).toThrow(FactsCatalogError);
        try {
            parseFactsCatalog({
                schemaVersion: 1,
                facts: {
                    'repos.root': { valueType: 'path', resolution: 'command' },
                },
            });
            fail('expected throw');
        } catch (e) {
            const msg = (e as Error).message;
            expect(msg).toMatch(/resolution:\s*command/i);
            expect(msg).toMatch(/v1/i);
        }
    });

    it('rejects non-dotted fact ids', () => {
        expect(() =>
            parseFactsCatalog({
                schemaVersion: 1,
                facts: { root: { valueType: 'path' } },
            })
        ).toThrow(FactsCatalogError);
        expect(() =>
            parseFactsCatalog({
                schemaVersion: 1,
                facts: { 'Repos.Root': { valueType: 'path' } },
            })
        ).toThrow(FactsCatalogError);
    });

    it('parses from a file path', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-facts-'));
        try {
            const file = path.join(dir, 'facts.json');
            fs.writeFileSync(file, JSON.stringify(validRepos));
            const catalog = parseFactsCatalog(file);
            expect(catalog.facts['repos.root'].valueType).toBe('path');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('requires enum values[] when valueType is enum', () => {
        expect(() =>
            parseFactsCatalog({
                schemaVersion: 1,
                facts: { 'env.tier': { valueType: 'enum' } },
            })
        ).toThrow(FactsCatalogError);
        const ok = parseFactsCatalog({
            schemaVersion: 1,
            facts: { 'env.tier': { valueType: 'enum', values: ['dev', 'prod'] } },
        });
        expect(ok.facts['env.tier'].values).toEqual(['dev', 'prod']);
    });
});
