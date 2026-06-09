// cli/tests/core/registries-sync.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

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

describe('syncAdditionalRegistries (git fixtures locales)', () => {
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

        const results = await m.syncAdditionalRegistries();

        expect(results).toEqual([{ name: 'personal', action: 'recloned' }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'))).toBe(true);
    });

    it('pulls an existing clone and reports non-fatal errors per registry', async () => {
        const m = require('../../src/core/registries');
        const source = makeSourceRepo(tmpWork, 'alpha');
        m.writeRegistriesConfig([
            { name: 'personal', remote: source },
            { name: 'broken', remote: path.join(tmpWork, 'does-not-exist') },
        ]);
        await m.syncAdditionalRegistries(); // first pass: clones 'personal', fails 'broken'

        // advance the remote
        fs.writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: v2\n---\n');
        GIT(source, 'add -A');
        GIT(source, 'commit -qm v2');

        const results = await m.syncAdditionalRegistries();

        expect(results[0]).toEqual({ name: 'personal', action: 'pulled' });
        expect(results[1].name).toBe('broken');
        expect(results[1].action).toBe('error');
        const synced = fs.readFileSync(path.join(tmpHome, '.awm/registries/personal/skills/alpha/SKILL.md'), 'utf-8');
        expect(synced).toContain('v2');
    });
});
