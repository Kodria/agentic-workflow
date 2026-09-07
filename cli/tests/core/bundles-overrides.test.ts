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

describe('bundle override resolution', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bnd-ovr-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('declared override: later root wins, contentRoot and overrode reflect it', () => {
        writeBundleRoot(rootA, 'pack', 's1');
        writeBundleRoot(rootB, 'pack', 's2');
        fs.writeFileSync(path.join(rootB, 'awm-registry.json'), JSON.stringify({ overrides: ['pack'] }));
        const { inspectAllBundles } = require('../../src/core/bundles');
        const result = inspectAllBundles([rootA, rootB]);
        expect(result.bundles).toHaveLength(1);
        expect(result.bundles[0].contentRoot).toBe(rootB);
        expect(result.bundles[0].overrode).toBe(rootA);
        expect(result.bundles[0].skills).toEqual(['s2']);
        expect(result.diagnostics).toHaveLength(0);
    });

    it('undeclared collision still throws naming both sources', () => {
        writeBundleRoot(rootA, 'dup', 's1');
        writeBundleRoot(rootB, 'dup', 's2');
        const { discoverAllBundles } = require('../../src/core/bundles');
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverAllBundles([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
    });
});
