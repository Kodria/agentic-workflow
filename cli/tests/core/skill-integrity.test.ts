import fs from 'fs';
import os from 'os';
import path from 'path';
import { classifyGlobalSkills, repairGlobalSkills } from '../../src/core/skill-integrity';

describe('skill-integrity multi-root', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-integrity-'));
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('repairGlobalSkills re-links a dangling symlink to the FIRST root that has the skill', () => {
        const skillsDir = path.join(tmp, 'installed');
        const rootA = path.join(tmp, 'base');
        const rootB = path.join(tmp, 'personal');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.mkdirSync(path.join(rootB, 'skills', 'mine'), { recursive: true });
        fs.writeFileSync(path.join(rootB, 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n');
        // dangling symlink: points to a deleted target
        fs.symlinkSync(path.join(tmp, 'gone', 'mine'), path.join(skillsDir, 'mine'), 'dir');

        const { repairGlobalSkills: repair } = require('../../src/core/skill-integrity');
        const r = repair(skillsDir, [rootA, rootB]);

        expect(r.relinked).toEqual(['mine']);
        expect(fs.realpathSync(path.join(skillsDir, 'mine'))).toBe(fs.realpathSync(path.join(rootB, 'skills', 'mine')));
    });

    it('classifyGlobalSkills marks dead when NO root has the skill', () => {
        const skillsDir = path.join(tmp, 'installed');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.symlinkSync(path.join(tmp, 'gone', 'nope'), path.join(skillsDir, 'nope'), 'dir');

        const { classifyGlobalSkills: classify } = require('../../src/core/skill-integrity');
        const c = classify(skillsDir, [path.join(tmp, 'base')]);

        expect(c.dead).toEqual(['nope']);
    });
});

function setup(): { skillsDir: string; registryContentDir: string } {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-integrity-'));
    const skillsDir = path.join(tmp, 'claude-skills');
    const registryContentDir = path.join(tmp, 'registry');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(path.join(registryContentDir, 'skills'), { recursive: true });
    return { skillsDir, registryContentDir };
}

function makeRegistrySkill(registryContentDir: string, name: string): string {
    const dir = path.join(registryContentDir, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
    return dir;
}

describe('classifyGlobalSkills', () => {
    it('classifies valid / repairable / dead', () => {
        const { skillsDir, registryContentDir } = setup();

        // valid: symlink a una skill que existe en el registry
        const okTarget = makeRegistrySkill(registryContentDir, 'alpha');
        fs.symlinkSync(okTarget, path.join(skillsDir, 'alpha'), 'dir');

        // repairable: symlink colgante, pero la skill SÍ existe en el registry
        makeRegistrySkill(registryContentDir, 'beta');
        fs.symlinkSync(path.join('/nonexistent/old-root/beta'), path.join(skillsDir, 'beta'), 'dir');

        // dead: symlink colgante y la skill NO existe en el registry
        fs.symlinkSync(path.join('/nonexistent/old-root/gamma'), path.join(skillsDir, 'gamma'), 'dir');

        const result = classifyGlobalSkills(skillsDir, [registryContentDir]);
        expect(result.valid).toEqual(['alpha']);
        expect(result.repairable).toEqual(['beta']);
        expect(result.dead).toEqual(['gamma']);
    });

    it('returns empty arrays when the skills dir does not exist', () => {
        const result = classifyGlobalSkills('/nonexistent/dir', ['/also/nonexistent']);
        expect(result).toEqual({ valid: [], repairable: [], dead: [] });
    });
});

describe('reconcileAllSkillLinks (#4 — awm update, all providers)', () => {
    it('repairs every provider dir that exists and skips absent ones', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        const prevHome = process.env.HOME;
        process.env.HOME = home;
        try {
            jest.resetModules();
            const { reconcileAllSkillLinks } = require('../../src/core/skill-integrity');

            // OpenCode dir exists with a dead orphan; Claude dir does NOT exist.
            const ocSkills = path.join(home, '.agents/skills');
            fs.mkdirSync(ocSkills, { recursive: true });
            fs.symlinkSync(path.join(home, 'no-such-target'), path.join(ocSkills, 'ghost'), 'dir');

            const res = reconcileAllSkillLinks([path.join(home, 'no-registry')]);
            const oc = res.find((r: any) => r.agent === 'opencode');
            const cc = res.find((r: any) => r.agent === 'claude-code');
            expect(oc).toBeTruthy();
            expect(oc.result.pruned).toContain('ghost');
            expect(cc).toBeFalsy(); // claude dir absent → not in results
        } finally {
            process.env.HOME = prevHome;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('repairGlobalSkills', () => {
    it('re-links repairable to cli-source and prunes dead; valid untouched; idempotent', () => {
        const { skillsDir, registryContentDir } = setup();

        const okTarget = makeRegistrySkill(registryContentDir, 'alpha');
        fs.symlinkSync(okTarget, path.join(skillsDir, 'alpha'), 'dir');
        makeRegistrySkill(registryContentDir, 'beta');
        fs.symlinkSync(path.join('/nonexistent/old-root/beta'), path.join(skillsDir, 'beta'), 'dir');
        fs.symlinkSync(path.join('/nonexistent/old-root/gamma'), path.join(skillsDir, 'gamma'), 'dir');

        const r1 = repairGlobalSkills(skillsDir, [registryContentDir]);
        expect(r1.relinked).toEqual(['beta']);
        expect(r1.pruned).toEqual(['gamma']);

        // beta ahora apunta a cli-source y resuelve
        expect(fs.existsSync(path.join(skillsDir, 'beta'))).toBe(true);
        expect(fs.realpathSync(path.join(skillsDir, 'beta')))
            .toBe(fs.realpathSync(path.join(registryContentDir, 'skills', 'beta')));
        // gamma podado
        expect(fs.existsSync(path.join(skillsDir, 'gamma'))).toBe(false);
        // alpha intacto
        expect(fs.existsSync(path.join(skillsDir, 'alpha'))).toBe(true);

        // idempotente: segunda corrida no cambia nada
        const r2 = repairGlobalSkills(skillsDir, [registryContentDir]);
        expect(r2.relinked).toEqual([]);
        expect(r2.pruned).toEqual([]);
    });
});
