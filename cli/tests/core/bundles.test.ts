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
    createBundleDiagnosticReporter,
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
        skills: ['brainstorming', 'architecture-advisor'],
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
    it('loads each bundle with canonical skill names', () => {
        const content = makeFixture();
        const bundles = discoverBundles(content);
        const dev = bundles.find((b) => b.name === 'dev')!;
        expect(dev.skills).toEqual(['brainstorming', 'architecture-advisor']);
        expect(dev.scope).toBe('baseline');
        expect(dev.dependsOn).toEqual([]);
    });

    it('canonicalizes legacy skill objects and reports one bounded migration diagnostic per manifest', () => {
        const content = makeFixture();
        const manifest = path.join(content, 'bundles', 'dev', 'bundle.json');
        fs.writeFileSync(manifest, JSON.stringify({
            name: 'dev', version: '1.0.0', scope: 'baseline',
            skills: [
                { name: 'brainstorming', onSignal: true },
                { name: 'architecture-advisor', onSignal: false },
            ],
        }));
        const { inspectBundles } = require('../../src/core/bundles');

        const result = inspectBundles(content);

        expect(result.bundles[0].skills).toEqual(['brainstorming', 'architecture-advisor']);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]).toContain('bundle.json');
        expect(result.diagnostics[0]).toContain('skills: ["skill-name"]');
        expect(result.diagnostics[0]).toMatch(/v10/i);
        expect(result.diagnostics[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
        expect(result.diagnostics[0]).not.toContain('{"name"');
        expect(result.diagnostics[0].length).toBeLessThanOrEqual(512);
    });

    it('forwards one deduplicated legacy diagnostic to an injected reporter', () => {
        const content = makeFixture();
        const manifest = path.join(content, 'bundles', 'dev', 'bundle.json');
        fs.writeFileSync(manifest, JSON.stringify({
            name: 'dev', version: '1.0.0', scope: 'baseline',
            skills: [{ name: 'brainstorming', onSignal: true }, { name: 'architecture-advisor', onSignal: false }],
        }));
        const diagnostics: string[] = [];

        const bundles = discoverBundles(content, (diagnostic) => diagnostics.push(diagnostic));

        expect(bundles[0].skills).toEqual(['brainstorming', 'architecture-advisor']);
        expect(diagnostics).toHaveLength(1);
    });

    it('creates a command-scoped warning reporter that suppresses repeated diagnostics', () => {
        const warnings: string[] = [];
        const report = createBundleDiagnosticReporter((warning) => warnings.push(warning));

        report('legacy warning');
        report('legacy warning');

        expect(warnings).toEqual(['warning: legacy warning']);
    });

    it('sanitizes, bounds, and then deduplicates caller-provided diagnostics', () => {
        const warnings: string[] = [];
        const report = createBundleDiagnosticReporter((warning) => warnings.push(warning));
        const payload = `legacy\x1b\n${'x'.repeat(600)}`;

        report(payload);
        report(`legacy ${'x'.repeat(600)}`);

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/^warning: legacy /);
        expect(warnings[0]).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
        expect(warnings[0].length).toBeLessThanOrEqual('warning: '.length + 512);
    });

    it.each([
        ['missing skills', undefined, /skills/],
        ['a non-array skills value', 'brainstorming', /skills/],
        ['an empty string skill', [''], /skills\[0\]/],
        ['an array skill', [['brainstorming']], /skills\[0\]/],
        ['a null skill', [null], /skills\[0\]/],
        ['an object missing name', [{ onSignal: true }], /skills\[0\]/],
        ['an object with an empty name', [{ name: '', onSignal: true }], /skills\[0\]/],
        ['an object with a non-string name', [{ name: 1, onSignal: true }], /skills\[0\]/],
        ['an object with a non-boolean onSignal', [{ name: 'brainstorming', onSignal: 'true' }], /skills\[0\]/],
        ['an object with an unknown key', [{ name: 'brainstorming', extra: true }], /skills\[0\]/],
    ])('rejects %s with a safe manifest identity', (_case, skills, location) => {
        const content = makeFixture();
        const manifest = path.join(content, 'bundles', 'dev', 'bundle.json');
        const bundle: Record<string, unknown> = { name: 'dev', version: '1.0.0', scope: 'baseline' };
        if (skills !== undefined) bundle.skills = skills;
        fs.writeFileSync(manifest, JSON.stringify(bundle));

        expect(() => discoverBundles(content)).toThrow(/bundle\.json/);
        expect(() => discoverBundles(content)).toThrow(location);
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
