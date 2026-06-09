// cli/tests/core/bundles-multiroot.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

function writeBundleRoot(root: string, bundleName: string, skillName: string) {
    fs.mkdirSync(path.join(root, 'bundles', bundleName), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', skillName), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', skillName, 'SKILL.md'), `---\nname: ${skillName}\ndescription: d\n---\n`);
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

    it('discoverAllBundles throws naming both sources on bundle name collision', () => {
        writeBundleRoot(rootA, 'dup', 's1');
        writeBundleRoot(rootB, 'dup', 's2');
        const { discoverAllBundles } = require('../../src/core/bundles');
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
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
