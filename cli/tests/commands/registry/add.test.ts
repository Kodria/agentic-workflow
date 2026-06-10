// cli/tests/commands/registry/add.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

function makeSourceRepo(base: string, opts: { skill?: string; empty?: boolean }): string {
    const dir = path.join(base, `src-${opts.skill ?? 'empty'}`);
    fs.mkdirSync(dir, { recursive: true });
    if (!opts.empty && opts.skill) {
        fs.mkdirSync(path.join(dir, 'skills', opts.skill), { recursive: true });
        fs.writeFileSync(path.join(dir, 'skills', opts.skill, 'SKILL.md'), `---\nname: ${opts.skill}\ndescription: d\n---\n`);
    } else {
        fs.writeFileSync(path.join(dir, 'README.md'), 'no content dirs');
    }
    GIT(dir, 'init -q');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    return dir;
}

describe('addRegistry', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('clones, validates, writes config and derives name from remote', async () => {
        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source);

        expect(result.ok).toBe(true);
        expect(result.name).toBe(path.basename(source));
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([{ name: path.basename(source), remote: source }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries', path.basename(source), 'skills/alpha/SKILL.md'))).toBe(true);
    });

    it('is atomic: invalid layout → no config written, clone dir cleaned up', async () => {
        const source = makeSourceRepo(tmpWork, { empty: true });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'bad');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/skills\/, bundles\/, workflows\/, agents\//);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/bad'))).toBe(false);
    });

    it('is atomic: artifact collision with existing content → no config, cleanup, error names both', async () => {
        // base content root with the 'alpha' skill
        const base = path.join(tmpHome, '.awm/cli-source/registry/skills/alpha');
        fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, 'SKILL.md'), '---\nname: alpha\ndescription: base\n---\n');

        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'personal');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/collision/i);
        expect(result.error).toMatch(/alpha/);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/personal'))).toBe(false);
    });

    it('rejects dot as registry name without touching disk', async () => {
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry('/any/remote', '.');
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Invalid registry name/);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
    });

    it('rejects duplicate registry name and clone failure without writing config', async () => {
        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        await addRegistry(source, 'personal');

        const dup = await addRegistry(source, 'personal');
        expect(dup.ok).toBe(false);
        expect(dup.error).toMatch(/already exists/);

        const broken = await addRegistry(path.join(tmpWork, 'no-such-repo'), 'ghost');
        expect(broken.ok).toBe(false);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig().map((r: { name: string }) => r.name)).toEqual(['personal']);
    });
});

describe('registry add + bundle install (post-add flow)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-bundle-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-bundle-work-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWork, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function makeBundleRegistry(base: string, name: string): string {
        const dir = path.join(base, `bundle-src-${name}`);
        fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'skills', name, 'SKILL.md'),
            `---\nname: ${name}\ndescription: d\n---\n`
        );
        fs.mkdirSync(path.join(dir, 'bundles', name), { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'bundles', name, 'bundle.json'),
            JSON.stringify({ name, version: '1.0.0', scope: 'ambient', skills: [name] })
        );
        fs.writeFileSync(
            path.join(dir, 'catalog.json'),
            JSON.stringify({
                version: 1,
                bundles: [{ name, source: `./bundles/${name}`, version: '1.0.0', scope: 'ambient' }],
            })
        );
        GIT(dir, 'init -q');
        GIT(dir, 'add -A');
        GIT(dir, 'commit -qm init');
        return dir;
    }

    it('--install-all simulation: installs bundle and skill symlink after add', async () => {
        const skillName = 'myskill';
        const source = makeBundleRegistry(tmpWork, skillName);
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'team');
        expect(result.ok).toBe(true);

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        const results = installBundlesFromRegistry(result.contentRoot, 'all', ['claude-code'], tmpWork);

        expect(results).toHaveLength(1);
        expect(results[0].bundle).toBe(skillName);

        const skillLink = path.join(tmpHome, '.claude', 'skills', skillName);
        expect(fs.existsSync(skillLink)).toBe(true);

        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toHaveLength(1);
        expect(readRegistriesConfig()[0].name).toBe('team');
    });

    it('--no-install simulation: add persists but skill symlink absent', async () => {
        const skillName = 'noskill';
        const source = makeBundleRegistry(tmpWork, skillName);
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'team');
        expect(result.ok).toBe(true);

        // Simulate --no-install: do not call installBundlesFromRegistry

        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toHaveLength(1);
        expect(readRegistriesConfig()[0].name).toBe('team');

        const skillLink = path.join(tmpHome, '.claude', 'skills', skillName);
        expect(fs.existsSync(skillLink)).toBe(false);
    });

    it('atomicity: failing install does not revert the registry add', async () => {
        const skillName = 'atomicskill';
        const source = makeBundleRegistry(tmpWork, skillName);
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'team');
        expect(result.ok).toBe(true);

        // Corrupt the bundle.json so discoverAllBundles inside installBundlesFromRegistry
        // reads an invalid file and throws, simulating a failing install.
        const bundleJsonPath = path.join(result.contentRoot, 'bundles', skillName, 'bundle.json');
        fs.rmSync(bundleJsonPath);

        const { installBundlesFromRegistry } = require('../../../src/commands/registry/install-bundles');
        // discoverAllBundles skips entries whose bundle.json is missing (continue), so deletion
        // produces an empty result (no throw). Force a failure via corrupted catalog.json instead.
        const catalogPath = path.join(result.contentRoot, 'catalog.json');
        fs.writeFileSync(catalogPath, 'not-json');

        let threw = false;
        try {
            installBundlesFromRegistry(result.contentRoot, 'all', ['claude-code'], tmpWork);
        } catch (_e) {
            threw = true;
        }
        expect(threw).toBe(true);

        // Registry add must still be persisted
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toHaveLength(1);
        expect(readRegistriesConfig()[0].name).toBe('team');

        // Skill symlink must NOT exist (install failed)
        const skillLink = path.join(tmpHome, '.claude', 'skills', skillName);
        expect(fs.existsSync(skillLink)).toBe(false);
    });
});
