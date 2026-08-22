// cli/tests/commands/registry/add.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// @clack/prompts ships as ESM; mock it so Jest (CommonJS mode) can load
// `commands/registry/index.ts` (same pattern as hooks/router.test.ts and
// commands/update.test.ts). Only the CLI-wiring describe block below exercises
// this — the rest of this file talks to `addRegistry` directly and never
// touches @clack/prompts.
jest.mock('@clack/prompts', () => ({
    intro: jest.fn(),
    outro: jest.fn(),
    confirm: jest.fn(),
    isCancel: jest.fn(() => false),
    spinner: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
    multiselect: jest.fn(),
    select: jest.fn(),
}));

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

function makeSourceRepo(base: string, opts: { skill?: string; empty?: boolean; contentFile?: string; contentSymlink?: string; nestedSkillSymlink?: string; nestedHookSymlink?: string }): string {
    const dir = path.join(base, `src-${opts.skill ?? 'empty'}`);
    fs.mkdirSync(dir, { recursive: true });
    if (opts.contentSymlink) {
        fs.symlinkSync(opts.contentSymlink, path.join(dir, 'skills'));
    } else if (opts.contentFile) {
        fs.writeFileSync(path.join(dir, opts.contentFile), 'not a content directory');
    } else if (opts.nestedHookSymlink) {
        fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
        fs.symlinkSync(opts.nestedHookSymlink, path.join(dir, 'hooks', 'session-start'));
    } else if (!opts.empty && opts.skill) {
        fs.mkdirSync(path.join(dir, 'skills', opts.skill), { recursive: true });
        if (opts.nestedSkillSymlink) {
            fs.symlinkSync(opts.nestedSkillSymlink, path.join(dir, 'skills', opts.skill, 'SKILL.md'));
        } else {
            fs.writeFileSync(path.join(dir, 'skills', opts.skill, 'SKILL.md'), `---\nname: ${opts.skill}\ndescription: d\n---\n`);
        }
    } else {
        fs.writeFileSync(path.join(dir, 'README.md'), 'no content dirs');
    }
    GIT(dir, 'init -q');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    return dir;
}

describe('deriveRegistryName', () => {
    // Regression: on native Windows, a local clone source is a backslash-separated
    // path (e.g. `C:\Users\runner\AppData\Local\Temp\awm-regadd-work-xyz\src-alpha`).
    // The old `split(/[/:]/)` only split on '/' and ':', so the whole backslash-joined
    // tail after the drive letter's ':' survived as one segment — `deriveRegistryName`
    // returned a name containing backslashes, which addRegistry's own
    // `/[/\\]/.test(name)` guard then rejected as invalid, making every
    // `addRegistry(localWindowsPath)` call fail with "Invalid registry name" on
    // windows-latest CI (got `result.ok === false` instead of `true`).
    it('derives the basename from a Windows-style backslash path', () => {
        const { deriveRegistryName } = require('../../../src/commands/registry/add');
        const winPath = 'C:\\Users\\runner\\AppData\\Local\\Temp\\awm-regadd-work-xyz\\src-alpha';
        expect(deriveRegistryName(winPath)).toBe('src-alpha');
    });

    it('derives the basename from a POSIX path (unchanged behavior)', () => {
        const { deriveRegistryName } = require('../../../src/commands/registry/add');
        expect(deriveRegistryName('/tmp/awm-regadd-work-xyz/src-alpha')).toBe('src-alpha');
    });

    it('still strips a trailing .git and derives from an https remote URL', () => {
        const { deriveRegistryName } = require('../../../src/commands/registry/add');
        expect(deriveRegistryName('https://github.com/Kodria/awm-baseline-registry.git')).toBe('awm-baseline-registry');
    });

    it('still derives from an SSH-style remote (host:org/repo.git)', () => {
        const { deriveRegistryName } = require('../../../src/commands/registry/add');
        expect(deriveRegistryName('git@github.com:Kodria/awm-baseline-registry.git')).toBe('awm-baseline-registry');
    });
});

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

    it('rejects a regular file that masquerades as a content directory', async () => {
        const source = makeSourceRepo(tmpWork, { contentFile: 'skills' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'not-a-registry');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/skills\/, bundles\/, workflows\/, agents\//);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/not-a-registry'))).toBe(false);
    });

    it('rejects a symlink that masquerades as a content directory', async () => {
        const source = makeSourceRepo(tmpWork, { contentSymlink: '.' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'linked-content');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/skills\/, bundles\/, workflows\/, agents\//);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/linked-content'))).toBe(false);
    });

    it('rejects a nested artifact symlink before discovery can read it', async () => {
        const outside = path.join(tmpWork, 'outside-skill.md');
        fs.writeFileSync(outside, 'host-only content');
        const source = makeSourceRepo(tmpWork, { skill: 'linked', nestedSkillSymlink: outside });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'nested-link');

        expect(result.ok).toBe(false);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/nested-link'))).toBe(false);
    });

    it('rejects a nested hook symlink before capability consumers can use it', async () => {
        const outside = path.join(tmpWork, 'outside-hook');
        fs.writeFileSync(outside, 'host-only content');
        const source = makeSourceRepo(tmpWork, { nestedHookSymlink: outside });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, 'nested-hook-link');

        expect(result.ok).toBe(false);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/nested-hook-link'))).toBe(false);
    });

    it('is atomic: artifact collision with existing configured registry → no config, cleanup, error names both', async () => {
        // First registry already registered with the 'alpha' skill
        const source1 = path.join(tmpWork, 'src-alpha-1');
        fs.mkdirSync(path.join(source1, 'skills', 'alpha'), { recursive: true });
        fs.writeFileSync(path.join(source1, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: d\n---\n');
        GIT(source1, 'init -q');
        GIT(source1, 'add -A');
        GIT(source1, 'commit -qm init');

        const { addRegistry } = require('../../../src/commands/registry/add');
        const first = await addRegistry(source1, 'baseline');
        expect(first.ok).toBe(true);

        // Second registry also has 'alpha' — should collide
        const source2 = path.join(tmpWork, 'src-alpha-2');
        fs.mkdirSync(path.join(source2, 'skills', 'alpha'), { recursive: true });
        fs.writeFileSync(path.join(source2, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: d\n---\n');
        GIT(source2, 'init -q');
        GIT(source2, 'add -A');
        GIT(source2, 'commit -qm init');

        jest.resetModules();
        const { addRegistry: addRegistry2 } = require('../../../src/commands/registry/add');
        const result = await addRegistry2(source2, 'personal');

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/collision/i);
        expect(result.error).toMatch(/alpha/);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig().map((r: { name: string }) => r.name)).toEqual(['baseline']);
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

    it.each(['', '..', 'bad..name', 'a/b', 'a\\b'])('rejects unsafe registry name %s without cloning or writing config', async (name) => {
        const source = makeSourceRepo(tmpWork, { skill: 'alpha' });
        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(source, name);

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Invalid registry name/);
        const { readRegistriesConfig } = require('../../../src/core/registries');
        expect(readRegistriesConfig()).toEqual([]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries', name))).toBe(false);
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

    it('reporta una declaracion de orquestador invalida sin abortar la instalacion', async () => {  // verifies R1.2
        // Registry local con layout valido y declaracion rota
        const src = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-src-'));
        fs.mkdirSync(path.join(src, 'skills/mi-proceso'), { recursive: true });
        fs.writeFileSync(path.join(src, 'skills/mi-proceso/SKILL.md'), '---\nname: mi-proceso\n---\nx');
        fs.writeFileSync(path.join(src, 'awm-registry.json'), JSON.stringify({ orchestrator: { name: 'roto' } }));
        GIT(src, 'init -q');
        GIT(src, 'add -A');
        GIT(src, 'commit -qm init');

        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(src, 'roto-reg');

        expect(result.ok).toBe(true);                       // la instalacion NO se aborta por esto
        expect(result.ok && result.orchestratorDiagnostics).toBeDefined();
        expect(result.ok && result.orchestratorDiagnostics!.join('\n')).toMatch(/appliesWhen/);
    });

    it('un registry sin declaracion se instala sin diagnosticos', async () => {                     // verifies R1.4
        const src = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-src-'));
        fs.mkdirSync(path.join(src, 'skills/otro'), { recursive: true });
        fs.writeFileSync(path.join(src, 'skills/otro/SKILL.md'), '---\nname: otro\n---\nx');
        GIT(src, 'init -q');
        GIT(src, 'add -A');
        GIT(src, 'commit -qm init');

        const { addRegistry } = require('../../../src/commands/registry/add');
        const result = await addRegistry(src, 'sin-decl');

        expect(result.ok).toBe(true);
        expect(result.ok && (result.orchestratorDiagnostics ?? [])).toEqual([]);
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

describe('registry add — CLI wiring prints orchestrator diagnostics', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-cli-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regadd-cli-work-'));
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

    // Task 2 added a `console.warn` loop after a successful `awm registry add` that
    // prints each orchestrator diagnostic (`result.orchestratorDiagnostics`) returned
    // by `addRegistry`. `addRegistry` itself is already covered above ("reporta una
    // declaracion de orquestador invalida sin abortar la instalacion"), but nothing
    // proved the CLI command actually surfaces those diagnostics to the user — this
    // drives the real commander-wired `registry add` action end-to-end (same pattern
    // as tests/commands/sensors/index.test.ts's `program.parseAsync`).
    it('prints each orchestrator diagnostic via console.warn after a successful add', async () => {
        const src = fs.mkdtempSync(path.join(tmpWork, 'awm-cli-src-'));
        fs.mkdirSync(path.join(src, 'skills/mi-proceso'), { recursive: true });
        fs.writeFileSync(path.join(src, 'skills/mi-proceso/SKILL.md'), '---\nname: mi-proceso\n---\nx');
        // Broken orchestrator declaration: missing appliesWhen/terminatesTo.
        fs.writeFileSync(path.join(src, 'awm-registry.json'), JSON.stringify({ orchestrator: { name: 'roto' } }));
        GIT(src, 'init -q');
        GIT(src, 'add -A');
        GIT(src, 'commit -qm init');

        const { Command } = require('commander');
        const { registerRegistryCommand } = require('../../../src/commands/registry/index');

        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const program = new Command();
            registerRegistryCommand(program);
            await program.parseAsync(['node', 'awm', 'registry', 'add', src, '--name', 'cli-roto', '--no-install']);

            expect(warnSpy).toHaveBeenCalled();
            const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
            expect(warned).toMatch(/appliesWhen/);
            expect(warned).toMatch(/terminatesTo/);

            const { readRegistriesConfig } = require('../../../src/core/registries');
            expect(readRegistriesConfig().map((r: { name: string }) => r.name)).toEqual(['cli-roto']);
        } finally {
            warnSpy.mockRestore();
            logSpy.mockRestore();
        }
    });
});
