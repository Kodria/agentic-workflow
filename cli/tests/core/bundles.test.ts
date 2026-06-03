import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverBundles, readCatalog, resolveBundleSkills, BundleDefinition } from '../../src/core/bundles';

function makeFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundles-'));
    const content = path.join(root, 'registry');
    fs.mkdirSync(path.join(content, 'bundles', 'dev'), { recursive: true });
    fs.mkdirSync(path.join(content, 'bundles', 'frontend'), { recursive: true });

    fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
        version: 1,
        bundles: [
            { name: 'dev', source: './bundles/dev', version: '1.0.0', scope: 'baseline' },
            { name: 'frontend', source: './bundles/frontend', version: '1.0.0', scope: 'project' },
        ],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'dev', 'bundle.json'), JSON.stringify({
        name: 'dev', version: '1.0.0', description: 'Dev core', scope: 'baseline', dependsOn: [],
        skills: ['brainstorming', { name: 'architecture-advisor', onSignal: true }],
        workflows: ['development-process'], agents: ['development-process'],
    }));
    fs.writeFileSync(path.join(content, 'bundles', 'frontend', 'bundle.json'), JSON.stringify({
        name: 'frontend', version: '1.0.0', description: 'Frontend', scope: 'project', dependsOn: ['dev'],
        skills: ['impeccable'], workflows: [], agents: [],
    }));
    return content;
}

describe('readCatalog', () => {
    it('reads catalog entries', () => {
        const content = makeFixture();
        const entries = readCatalog(content);
        expect(entries.map((e) => e.name).sort()).toEqual(['dev', 'frontend']);
        expect(entries.find((e) => e.name === 'dev')!.scope).toBe('baseline');
    });
});

describe('discoverBundles', () => {
    it('loads each bundle and normalizes skill refs (string | object)', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const dev = bundles.find((b) => b.name === 'dev')!;
        expect(dev.skills).toEqual([
            { name: 'brainstorming', onSignal: false },
            { name: 'architecture-advisor', onSignal: true },
        ]);
        expect(dev.scope).toBe('baseline');
        expect(dev.dependsOn).toEqual([]);
    });

    it('returns [] when catalog is missing', () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        expect(discoverBundles(empty)).toEqual([]);
    });
});

describe('resolveBundleSkills', () => {
    it('follows dependsOn transitively and dedupes', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const names = resolveBundleSkills('frontend', bundles);
        expect(names.sort()).toEqual(['architecture-advisor', 'brainstorming', 'impeccable']);
    });

    it('returns own skills when no deps', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        expect(resolveBundleSkills('dev', bundles).sort()).toEqual(['architecture-advisor', 'brainstorming']);
    });
});
