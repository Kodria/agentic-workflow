import fs from 'fs';
import os from 'os';
import path from 'path';
import { classifyGlobalSkills, repairGlobalSkills } from '../../src/core/skill-integrity';

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

        const result = classifyGlobalSkills(skillsDir, registryContentDir);
        expect(result.valid).toEqual(['alpha']);
        expect(result.repairable).toEqual(['beta']);
        expect(result.dead).toEqual(['gamma']);
    });

    it('returns empty arrays when the skills dir does not exist', () => {
        const result = classifyGlobalSkills('/nonexistent/dir', '/also/nonexistent');
        expect(result).toEqual({ valid: [], repairable: [], dead: [] });
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

        const r1 = repairGlobalSkills(skillsDir, registryContentDir);
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
        const r2 = repairGlobalSkills(skillsDir, registryContentDir);
        expect(r2.relinked).toEqual([]);
        expect(r2.pruned).toEqual([]);
    });
});
