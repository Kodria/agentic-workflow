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

describe('installBundlesFromRegistry', () => {
    let tmpHome: string;
    let tmpWork: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-work-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
    });

    it('installs all ambient bundles of the given registry root for the agent', () => {
        const { REGISTRIES_DIR } = require('../../../src/core/registries');
        const regRoot = path.join(REGISTRIES_DIR, 'team');
        writeBundleRoot(regRoot, 'team-pack', 'team-skill');
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: 'team', remote: 'r' }])
        );

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        const results = installBundlesFromRegistry(regRoot, 'all', ['claude-code'], tmpWork);

        expect(results).toHaveLength(1);
        expect(results[0].bundle).toBe('team-pack');
        expect(results[0].installed.length).toBeGreaterThan(0);
        // ambient → global → symlink under the isolated home
        expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'team-skill'))).toBe(true);
    });

    it('returns empty when the registry has no bundles', () => {
        const { REGISTRIES_DIR } = require('../../../src/core/registries');
        const regRoot = path.join(REGISTRIES_DIR, 'empty');
        fs.mkdirSync(path.join(regRoot, 'skills', 's'), { recursive: true });
        fs.writeFileSync(path.join(regRoot, 'skills', 's', 'SKILL.md'), `---\nname: s\ndescription: d\n---\n`);
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: 'empty', remote: 'r' }])
        );

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        expect(installBundlesFromRegistry(regRoot, 'all', ['claude-code'], tmpWork)).toEqual([]);
    });

    it('installs only the named bundles when a list is given', () => {
        const { REGISTRIES_DIR } = require('../../../src/core/registries');
        const regRoot = path.join(REGISTRIES_DIR, 'team');
        writeBundleRoot(regRoot, 'wanted', 'skill-w');
        // second bundle in same catalog
        fs.mkdirSync(path.join(regRoot, 'bundles', 'unwanted'), { recursive: true });
        fs.mkdirSync(path.join(regRoot, 'skills', 'skill-u'), { recursive: true });
        fs.writeFileSync(path.join(regRoot, 'skills', 'skill-u', 'SKILL.md'), `---\nname: skill-u\ndescription: d\n---\n`);
        fs.writeFileSync(
            path.join(regRoot, 'bundles', 'unwanted', 'bundle.json'),
            JSON.stringify({ name: 'unwanted', version: '1.0.0', scope: 'ambient', skills: ['skill-u'] })
        );
        fs.writeFileSync(
            path.join(regRoot, 'catalog.json'),
            JSON.stringify({
                version: 1,
                bundles: [
                    { name: 'wanted', source: './bundles/wanted', version: '1.0.0', scope: 'ambient' },
                    { name: 'unwanted', source: './bundles/unwanted', version: '1.0.0', scope: 'ambient' },
                ],
            })
        );
        fs.mkdirSync(path.join(tmpHome, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.awm', 'registries.json'),
            JSON.stringify([{ name: 'team', remote: 'r' }])
        );

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        const results = installBundlesFromRegistry(regRoot, ['wanted'], ['claude-code'], tmpWork);
        expect(results.map((r: { bundle: string }) => r.bundle)).toEqual(['wanted']);
        expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', 'skill-u'))).toBe(false);
    });
});
