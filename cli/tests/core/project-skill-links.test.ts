// Project-scope skill symlinks had no maintenance path at all.
//
// The machinery exists and is exercised every `awm init` / `awm registry sync`:
// `classifySkillLinks` finds dangling symlinks, `repairSkillLinks` re-links the ones
// the registry can still serve and prunes the ones it cannot. But every entry point
// pointed it at `provider.skill.global` only. A dangling link under a PROJECT's
// `.claude/skills/` (registry re-cloned, skill renamed upstream, bundle removed from
// `.awm/profile.json`) was:
//
//   - never healed — `awm sync` installs what the profile declares and looks at
//     nothing else, so a link whose bundle was dropped is simply left behind;
//   - never pruned — it stays in the tree indefinitely, and the agent trips on it
//     when it tries to read the skill's SKILL.md;
//   - never reported — `awm doctor`'s `globalSkills` reads the global dir, so nothing
//     on any surface mentions it.
//
// For Copilot the gap is total, not partial: `skill.global` is null, so *every* skill
// it has is project-scope, and none of them had any integrity path whatsoever.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { classifySkillLinks, reconcileProjectSkillLinks } from '../../src/core/skill-integrity';
import { providerFor } from '../../src/providers';

describe('project-scope skill links get the same integrity path as global ones', () => {
    let registry: string;
    let projectRoot: string;
    const made: string[] = [];

    beforeEach(() => {
        registry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-projlink-reg-'));
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-projlink-proj-'));
        made.push(registry, projectRoot);
        fs.mkdirSync(path.join(registry, 'skills', 'alive'), { recursive: true });
        fs.writeFileSync(path.join(registry, 'skills', 'alive', 'SKILL.md'), '# alive\n');
    });

    afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

    /** The dir where `agent`'s project-scope skills live, with the links pre-created. */
    function localSkillsDir(agent: 'claude-code' | 'copilot', links: Record<string, string>): string {
        const dir = path.join(projectRoot, providerFor(agent).skill.local);
        fs.mkdirSync(dir, { recursive: true });
        for (const [name, target] of Object.entries(links)) fs.symlinkSync(target, path.join(dir, name));
        return dir;
    }

    it('classifies a dangling project link as repairable when the registry still has it', () => {
        const dir = localSkillsDir('claude-code', { alive: path.join(registry, 'gone', 'alive') });

        const out = classifySkillLinks(dir, [registry]);

        expect(out.repairable).toEqual(['alive']);
        expect(out.dead).toEqual([]);
    });

    it('classifies a dangling project link as dead when the registry no longer has it', () => {
        const dir = localSkillsDir('claude-code', { removed: path.join(registry, 'skills', 'removed') });

        const out = classifySkillLinks(dir, [registry]);

        expect(out.dead).toEqual(['removed']);
        expect(out.repairable).toEqual([]);
    });

    it('awm sync heals a project link the registry can still serve', () => {
        const dir = localSkillsDir('claude-code', { alive: path.join(registry, 'moved', 'alive') });

        const results = reconcileProjectSkillLinks(projectRoot, ['claude-code'], [registry]);

        expect(results.find(r => r.agent === 'claude-code')!.result.relinked).toEqual(['alive']);
        expect(fs.existsSync(path.join(dir, 'alive', 'SKILL.md'))).toBe(true);
    });

    it('prunes a project link nothing can serve any more', () => {
        const dir = localSkillsDir('claude-code', { removed: path.join(registry, 'skills', 'removed') });

        const results = reconcileProjectSkillLinks(projectRoot, ['claude-code'], [registry]);

        expect(results.find(r => r.agent === 'claude-code')!.result.pruned).toEqual(['removed']);
        expect(fs.existsSync(path.join(dir, 'removed'))).toBe(false);
        expect(fs.lstatSync(dir).isDirectory()).toBe(true);
    });

    it('covers Copilot, whose skills are ONLY ever project-scope', () => {
        expect(providerFor('copilot').skill.global).toBeNull(); // premise of this test
        const dir = localSkillsDir('copilot', { alive: path.join(registry, 'moved', 'alive') });

        const results = reconcileProjectSkillLinks(projectRoot, ['copilot'], [registry]);

        expect(results.find(r => r.agent === 'copilot')!.result.relinked).toEqual(['alive']);
        expect(fs.existsSync(path.join(dir, 'alive', 'SKILL.md'))).toBe(true);
    });

    it('leaves the user\'s own files alone — only dangling symlinks are touched', () => {
        const dir = localSkillsDir('claude-code', { alive: path.join(registry, 'skills', 'alive') });
        fs.mkdirSync(path.join(dir, 'hand-written'));
        fs.writeFileSync(path.join(dir, 'hand-written', 'SKILL.md'), '# mine\n');

        const results = reconcileProjectSkillLinks(projectRoot, ['claude-code'], [registry]);
        const r = results.find(x => x.agent === 'claude-code')!.result;

        expect(r.relinked).toEqual([]);
        expect(r.pruned).toEqual([]);
        expect(fs.readFileSync(path.join(dir, 'hand-written', 'SKILL.md'), 'utf-8')).toBe('# mine\n');
        expect(fs.existsSync(path.join(dir, 'alive'))).toBe(true);
    });

    it('skips agents whose project skills dir does not exist', () => {
        const results = reconcileProjectSkillLinks(projectRoot, ['claude-code', 'copilot'], [registry]);

        expect(results).toEqual([]);
    });
});

// Wiring, not just capability: I15's actual defect was that the healing primitive
// already existed and nothing called it for project scope. A green unit test of the
// primitive would have looked identical before and after. So assert the call.
describe('awm sync reaches the project-scope reconciliation', () => {
    let projectRoot: string;
    let home: string;
    let saved: { HOME?: string; AWM_HOME?: string };

    beforeEach(() => {
        jest.resetModules();
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-syncwire-home-'));
        saved = { HOME: process.env.HOME, AWM_HOME: process.env.AWM_HOME };
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        fs.mkdirSync(path.join(home, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(home, '.awm', 'preferences.json'),
            JSON.stringify({
                enabledAgents: ['claude-code'], defaultAgent: 'claude-code',
                installMethod: 'symlink', defaultScope: 'global',
            }),
        );
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-syncwire-proj-'));
        fs.mkdirSync(path.join(projectRoot, '.awm'), { recursive: true });
    });

    afterEach(() => {
        if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
        if (saved.AWM_HOME === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = saved.AWM_HOME;
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    const writeProfile = (extensions: string[]) =>
        fs.writeFileSync(path.join(projectRoot, '.awm', 'profile.json'), JSON.stringify({ extensions }));

    async function sync(spy: jest.Mock) {
        const { runSyncCore } = require('../../src/commands/sync');
        return runSyncCore({ cwd: projectRoot }, {
            syncRegistries: async () => [],
            verifyMinCliVersions: () => [],
            verifyProjectPins: async () => [],
            syncProfile: () => ({ installed: [], skipped: [], extensions: [] }),
            reconcileProjectSkillLinks: spy,
        });
    }

    it('reconciles project links on a normal sync', async () => {
        writeProfile(['demo']);
        const spy = jest.fn((_root: string, _agents: string[], _roots: string[]) => []);

        await sync(spy as never);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toBe(projectRoot);
        expect(spy.mock.calls[0][1]).toEqual(['claude-code']);
    });

    it('reconciles project links even when the profile has no extensions left', async () => {
        // The case that produces orphans in the first place: the extension that owned
        // them was removed. That path used to return early, touching nothing.
        writeProfile([]);
        const spy = jest.fn((_root: string, _agents: string[], _roots: string[]) => []);

        const out = await sync(spy as never);

        expect(out.code).toBe(0);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
