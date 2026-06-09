import fs from 'fs';
import path from 'path';
import os from 'os';

function writeSkill(root: string, name: string) {
    const dir = path.join(root, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d-${name}\n---\n`);
}

function writeWorkflow(root: string, name: string) {
    const dir = path.join(root, 'workflows');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), `---\nname: ${name}\ndescription: w-${name}\n---\n`);
}

describe('discovery multi-root', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-disc-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        fs.mkdirSync(rootA, { recursive: true });
        fs.mkdirSync(rootB, { recursive: true });
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('merges skills from multiple roots, each keeping its absolute path', () => {
        writeSkill(rootA, 'alpha');
        writeSkill(rootB, 'beta');
        const { discoverSkills } = require('../../src/core/discovery');
        const skills = discoverSkills([rootA, rootB]);
        expect(skills.map((s: { name: string }) => s.name).sort()).toEqual(['alpha', 'beta']);
        expect(skills.find((s: { name: string }) => s.name === 'beta').path).toBe(path.join(rootB, 'skills', 'beta'));
    });

    it('throws an explicit error naming BOTH sources on skill name collision', () => {
        writeSkill(rootA, 'dup');
        writeSkill(rootB, 'dup');
        const { discoverSkills } = require('../../src/core/discovery');
        expect(() => discoverSkills([rootA, rootB])).toThrow(
            new RegExp(`dup.*${path.join(rootA, 'skills', 'dup').replace(/[/\\]/g, '.')}.*${path.join(rootB, 'skills', 'dup').replace(/[/\\]/g, '.')}`)
        );
    });

    it('merges workflows from multiple roots and detects collisions', () => {
        writeWorkflow(rootA, 'flow');
        const { discoverWorkflows } = require('../../src/core/discovery');
        expect(discoverWorkflows([rootA, rootB]).map((w: { name: string }) => w.name)).toEqual(['flow']);
        writeWorkflow(rootB, 'flow');
        jest.resetModules();
        const fresh = require('../../src/core/discovery');
        expect(() => fresh.discoverWorkflows([rootA, rootB])).toThrow(/collision/i);
    });

    it('skips roots without the artifact dir', () => {
        writeSkill(rootA, 'alpha');
        const { discoverSkills, discoverAgents } = require('../../src/core/discovery');
        expect(discoverSkills([rootA, rootB]).length).toBe(1);
        expect(discoverAgents([rootA, rootB])).toEqual([]);
    });
});
