import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    discoverBundles,
    readCatalog,
    resolveBundleSkills,
    resolveBundleAgents,
    resolveBundleClosure,
    defaultScopeForBundle,
    BundleDefinition,
} from '../../src/core/bundles';

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

    it('rejects a catalog symlink instead of reading outside the registry', () => {
        const content = makeFixture();
        const outside = path.join(path.dirname(content), 'outside-catalog.json');
        fs.writeFileSync(outside, JSON.stringify({ bundles: [] }));
        fs.rmSync(path.join(content, 'catalog.json'));
        fs.symlinkSync(outside, path.join(content, 'catalog.json'));

        expect(() => readCatalog(content)).toThrow(/symbolic link/);
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

    it('rejects catalog sources that escape the registry content root', () => {
        const content = makeFixture();
        const outside = path.join(path.dirname(content), 'outside');
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'bundle.json'), JSON.stringify({ name: 'outside' }));
        fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
            bundles: [{ name: 'outside', source: '../outside', version: '1.0.0', scope: 'project' }],
        }));

        expect(() => discoverBundles(content)).toThrow(/invalid bundle source/i);
    });

    it('rejects a bundle manifest symlink instead of reading outside the registry', () => {
        const content = makeFixture();
        const outside = path.join(path.dirname(content), 'outside-bundle.json');
        fs.writeFileSync(outside, JSON.stringify({ name: 'outside' }));
        fs.rmSync(path.join(content, 'bundles', 'dev', 'bundle.json'));
        fs.symlinkSync(outside, path.join(content, 'bundles', 'dev', 'bundle.json'));

        expect(() => discoverBundles(content)).toThrow(/symbolic link/);
    });

    it('rejects a catalog source that reaches a bundle through an intermediate symlink', () => {
        const content = makeFixture();
        const outside = path.join(path.dirname(content), 'outside-bundle');
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(outside, 'bundle.json'), JSON.stringify({ name: 'outside' }));
        fs.symlinkSync(outside, path.join(content, 'outside'));
        fs.writeFileSync(path.join(content, 'catalog.json'), JSON.stringify({
            bundles: [{ name: 'outside', source: 'outside', version: '1.0.0', scope: 'project' }],
        }));

        expect(() => discoverBundles(content)).toThrow(/symbolic link/);
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

describe('resolveBundleAgents', () => {
    it('follows dependsOn transitively and dedupes, mirroring resolveBundleSkills', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        expect(resolveBundleAgents('frontend', bundles)).toEqual(['development-process']); // via dep on 'dev'
    });

    it('returns own agents when no deps', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        expect(resolveBundleAgents('dev', bundles)).toEqual(['development-process']);
    });
});

describe('defaultScopeForBundle', () => {
    it('maps baseline and ambient to global, project to local', () => {
        expect(defaultScopeForBundle('baseline')).toBe('global');
        expect(defaultScopeForBundle('ambient')).toBe('global');
        expect(defaultScopeForBundle('project')).toBe('local');
    });
});

describe('resolveBundleClosure', () => {
    it('returns dependencies before the bundle, deduped, in deps-first order', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const closure = resolveBundleClosure('frontend', bundles);
        expect(closure.map((b) => b.name)).toEqual(['dev', 'frontend']);
    });

    it('returns just the bundle when it has no dependencies', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const closure = resolveBundleClosure('dev', bundles);
        expect(closure.map((b) => b.name)).toEqual(['dev']);
    });

    it('returns [] for an unknown bundle name', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        expect(resolveBundleClosure('nope', bundles)).toEqual([]);
    });
});
