// cli/tests/core/registries-sync.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t -c tag.gpgSign=false ${cmd}`, { cwd, stdio: 'pipe' });

/** Creates a git source repo with a skill, returns its path (serves as local remote). */
function makeSourceRepo(base: string, skillName: string): string {
    const dir = path.join(base, `src-${skillName}`);
    fs.mkdirSync(path.join(dir, 'skills', skillName), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'skills', skillName, 'SKILL.md'),
        `---\nname: ${skillName}\ndescription: test skill\n---\n# ${skillName}\n`
    );
    GIT(dir, 'init -q');
    GIT(dir, 'add -A');
    GIT(dir, 'commit -qm init');
    return dir;
}

describe('syncRegistries (git fixtures locales)', () => {
    let tmpHome: string;
    let tmpWork: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regsync-home-'));
        tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-regsync-work-'));
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

    it('re-clones a configured registry missing on disk', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);

        const results = await m.syncRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned', version: 'HEAD' }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'))).toBe(true);
    });

    it('pulls an existing clone and reports non-fatal errors per registry', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        m.writeRegistriesConfig([
            { name: 'personal', remote: source },
            { name: 'broken', remote: path.join(tmpWork, 'does-not-exist') },
        ]);
        await m.syncRegistries(); // first pass: clones 'personal', fails 'broken'

        // advance the remote
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v2');

        const results = await m.syncRegistries();

        expect(results[0]).toEqual({ name: 'personal', action: 'pulled', version: 'HEAD' });
        expect(results[1].name).toBe('broken');
        expect(results[1].action).toBe('error');
        const synced = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(synced).toContain('v2');
    });

    it('registry con tags queda en el último tag y reporta la versión', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        // commit post-tag: HEAD va más allá del release
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: unreleased\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm unreleased');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);

        const results = await m.syncRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned', version: 'v1.0.0' }]);
        const synced = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(synced).toContain('test skill'); // contenido del tag, no del HEAD
    });

    it('F2 regression: clone fresco limpiado si pin inexistente falla post-clone', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', pins: { personal: '9.9.9' } })
        );

        const results = await m.syncRegistries();

        expect(results[0].action).toBe('error');
        // El dir no debe quedar en disco tras el fallo
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/personal'))).toBe(false);
    });

    it('pin por nombre en preferences gana sobre el último tag', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v2');
        GIT(source, 'tag v1.1.0');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', pins: { personal: '1.0.0' } })
        );

        const results = await m.syncRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned', version: 'v1.0.0' }]);
    });

    it('baseline sembrado se sincroniza por el mismo loop que cualquier registry', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        process.env.AWM_BASE_REMOTE = source;
        m.seedBaselineRegistry();
        delete process.env.AWM_BASE_REMOTE;

        const results = await m.syncRegistries();

        expect(results).toEqual([{ name: 'baseline', action: 'recloned', version: 'v1.0.0' }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/baseline/skills/alpha/SKILL.md'))).toBe(true);
    });

    it('verifyMinCliVersions reporta registries que exigen CLI más nuevo', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        fs.writeFileSync(path.join(source, 'awm-registry.json'), JSON.stringify({ minCliVersion: '99.0.0' }));
        GIT(source, 'add -A'); GIT(source, 'commit -qm manifest');
        m.writeRegistriesConfig([{ name: 'exigente', remote: source }]);
        await m.syncRegistries();

        const failures = m.verifyMinCliVersions();
        expect(failures).toEqual([{ name: 'exigente', min: '99.0.0' }]);
    });

    it('verifyMinCliVersions ignora registries sin campo o ausentes en disco', () => {
        const m = require('../../src/core/registries');
        m.writeRegistriesConfig([{ name: 'fantasma', remote: '/no/existe' }]);
        expect(m.verifyMinCliVersions()).toEqual([]);
    });

    it('transición tag→tag: clone existente en v1.0.0 avanza a v1.1.0 tras nuevo release', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);
        // primera sync: queda en v1.0.0
        const r1 = await m.syncRegistries();
        expect(r1).toEqual([{ name: 'personal', action: 'recloned', version: 'v1.0.0' }]);

        // nueva release en el remote
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v1.1.0');
        GIT(source, 'tag v1.1.0');

        // segunda sync: avanza al nuevo tag
        const r2 = await m.syncRegistries();
        expect(r2).toEqual([{ name: 'personal', action: 'pulled', version: 'v1.1.0' }]);
        const content = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(content).toContain('v2');
    });

    it('rollback tag→tag: clone en v1.1.0 retrocede a v1.0.0 al establecer pin', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v1.1.0');
        GIT(source, 'tag v1.1.0');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);

        // primera sync sin pin: queda en v1.1.0
        const r1 = await m.syncRegistries();
        expect(r1).toEqual([{ name: 'personal', action: 'recloned', version: 'v1.1.0' }]);

        // establece pin a la versión anterior
        const awmDir = path.join(tmpHome, '.awm');
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', pins: { personal: '1.0.0' } })
        );

        // segunda sync con pin: retrocede a v1.0.0
        const r2 = await m.syncRegistries();
        expect(r2).toEqual([{ name: 'personal', action: 'pulled', version: 'v1.0.0' }]);
        const content = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(content).toContain('test skill'); // contenido original del tag v1.0.0
    });

    it('canal dev: preferences.channel=dev sigue HEAD y recibe commits nuevos', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        GIT(source, 'tag v1.0.0');
        m.writeRegistriesConfig([{ name: 'personal', remote: source }]);
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude', installMethod: 'symlink', defaultScope: 'local', channel: 'dev' })
        );

        // primera sync en canal dev: queda en HEAD (no en el tag)
        const r1 = await m.syncRegistries();
        expect(r1).toEqual([{ name: 'personal', action: 'recloned', version: 'HEAD' }]);

        // nuevo commit en el remote (post-tag, no release)
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: head-2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm head-2');

        // segunda sync: recibe el nuevo commit
        const r2 = await m.syncRegistries();
        expect(r2).toEqual([{ name: 'personal', action: 'pulled', version: 'HEAD' }]);
        const content = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(content).toContain('head-2');
    });
});
