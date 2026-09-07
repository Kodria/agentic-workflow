// cli/tests/core/bundles-multiroot.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeBundleRoot(root: string, bundleName: string, skillName: string | object) {
    const canonicalSkillName = typeof skillName === 'string' ? skillName : (skillName as { name: string }).name;
    fs.mkdirSync(path.join(root, 'bundles', bundleName), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', canonicalSkillName), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', canonicalSkillName, 'SKILL.md'), `---\nname: ${canonicalSkillName}\ndescription: d\n---\n`);
    fs.writeFileSync(
        path.join(root, 'bundles', bundleName, 'bundle.json'),
        JSON.stringify({ name: bundleName, version: '1.0.0', scope: 'ambient', skills: [skillName] })
    );
    fs.writeFileSync(
        path.join(root, 'catalog.json'),
        JSON.stringify({
            version: 1,
            bundles: [{ name: bundleName, source: `./bundles/${bundleName}`, version: '1.0.0', scope: 'ambient' }],
        })
    );
}

describe('bundles multi-root', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bundles-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('discoverAllBundles merges bundles from all roots and stamps contentRoot', () => {
        writeBundleRoot(rootA, 'dev-x', 'sx');
        writeBundleRoot(rootB, 'personal-x', 'px');
        const { discoverAllBundles } = require('../../src/core/bundles');
        const all = discoverAllBundles([rootA, rootB]);
        expect(all.map((b: { name: string }) => b.name).sort()).toEqual(['dev-x', 'personal-x']);
        expect(all.find((b: { name: string }) => b.name === 'personal-x').contentRoot).toBe(rootB);
    });

    it('composes one legacy migration diagnostic for each affected manifest', () => {
        writeBundleRoot(rootA, 'dev-x', { name: 'sx', onSignal: true });
        writeBundleRoot(rootB, 'personal-x', { name: 'px', onSignal: false });
        const { inspectAllBundles } = require('../../src/core/bundles');

        const result = inspectAllBundles([rootA, rootB]);

        expect(result.bundles.map((b: { skills: string[] }) => b.skills)).toEqual([['sx'], ['px']]);
        expect(result.diagnostics).toHaveLength(2);
        expect(new Set(result.diagnostics).size).toBe(2);
    });

    it('discoverAllBundles throws naming both sources on bundle name collision', () => {
        writeBundleRoot(rootA, 'dup', 's1');
        writeBundleRoot(rootB, 'dup', 's2');
        const { discoverAllBundles } = require('../../src/core/bundles');
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(new RegExp(rootB.replace(/[/\\]/g, '.')));
    });

    it('installBundle resolves artifacts from the bundle own contentRoot', () => {
        writeBundleRoot(rootB, 'personal-x', 'px');
        const { discoverAllBundles } = require('../../src/core/bundles');
        const { installBundle } = require('../../src/core/bundle-install');
        const bundles = discoverAllBundles([rootB]);
        const projectRoot = path.join(tmp, 'proj');
        fs.mkdirSync(projectRoot, { recursive: true });

        const summary = installBundle({
            bundleName: 'personal-x',
            bundles,
            agents: ['claude-code'],
            method: 'copy',
            projectRoot,
            scopeOverride: 'local',
        });

        // the skill was copied FROM rootB (its own root), not from the default
        expect(summary.installed.some((l: string) => l.startsWith('px'))).toBe(true);
        expect(summary.skipped.some((l: string) => l.includes('source missing'))).toBe(false);
    });
});
