import fs from 'fs';
import path from 'path';
import os from 'os';

function writeSkill(root: string, name: string) {
    const dir = path.join(root, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
}

function writeWorkflow(root: string, name: string) {
    fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, 'workflows', `${name}.md`), `---\ndescription: d\n---\n`);
}

function writeAgent(root: string, name: string) {
    fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'agents', `${name}.md`), `---\ndescription: d\n---\n`);
}

function writeManifest(root: string, overrides: string[]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify({ overrides }));
}

describe('discovery override resolution', () => {
    let tmp: string;
    let rootA: string;
    let rootB: string;
    let rootC: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-disc-ovr-'));
        rootA = path.join(tmp, 'a');
        rootB = path.join(tmp, 'b');
        rootC = path.join(tmp, 'c');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function load() {
        return require('../../src/core/discovery');
    }

    it('declared override: later root wins and records provenance', () => {
        writeSkill(rootA, 'brainstorming');
        writeSkill(rootB, 'brainstorming');
        writeManifest(rootB, ['brainstorming']);
        const { discoverSkills } = load();
        const out = discoverSkills([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootB, 'skills', 'brainstorming'));
        expect(out[0].overrode).toBe(path.join(rootA, 'skills', 'brainstorming'));
    });

    it('undeclared collision still throws naming both sources', () => {
        writeSkill(rootA, 'dup');
        writeSkill(rootB, 'dup');
        const { discoverSkills } = load();
        expect(() => discoverSkills([rootA, rootB])).toThrow(/dup/);
        expect(() => discoverSkills([rootA, rootB])).toThrow(new RegExp(rootA.replace(/[/\\]/g, '.')));
    });

    it('orphan override (no collision) is not an error', () => {
        writeSkill(rootB, 'only-here');
        writeManifest(rootB, ['renamed-upstream-skill']);
        const { discoverSkills } = load();
        const out = discoverSkills([rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].overrode).toBeUndefined();
    });

    it('chain: two registries both declaring the same name — last in order wins', () => {
        writeSkill(rootA, 'x');
        writeSkill(rootB, 'x');
        writeSkill(rootC, 'x');
        writeManifest(rootB, ['x']);
        writeManifest(rootC, ['x']);
        const { discoverSkills } = load();
        const out = discoverSkills([rootA, rootB, rootC]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootC, 'skills', 'x'));
        expect(out[0].overrode).toBe(path.join(rootB, 'skills', 'x'));
    });

    it('workflows: declared override wins, undeclared throws', () => {
        writeWorkflow(rootA, 'flow');
        writeWorkflow(rootB, 'flow');
        const { discoverWorkflows } = load();
        expect(() => discoverWorkflows([rootA, rootB])).toThrow(/flow/);
        writeManifest(rootB, ['flow']);
        jest.resetModules();
        const out = load().discoverWorkflows([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootB, 'workflows', 'flow.md'));
        expect(out[0].overrode).toBe(path.join(rootA, 'workflows', 'flow.md'));
    });

    it('agents: declared override wins, undeclared throws', () => {
        writeAgent(rootA, 'bot');
        writeAgent(rootB, 'bot');
        const { discoverAgents } = load();
        expect(() => discoverAgents([rootA, rootB])).toThrow(/bot/);
        writeManifest(rootB, ['bot']);
        jest.resetModules();
        const out = load().discoverAgents([rootA, rootB]);
        expect(out).toHaveLength(1);
        expect(out[0].path).toBe(path.join(rootB, 'agents', 'bot.md'));
        expect(out[0].overrode).toBe(path.join(rootA, 'agents', 'bot.md'));
    });
});
