import fs from 'fs';
import path from 'path';
import os from 'os';

function writeSkill(root: string, name: string) {
    const dir = path.join(root, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
}

describe('registry override status', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('classifies declared overrides as active or without effect', () => {
        const base = path.join(tmp, 'base');
        const team = path.join(tmp, 'team');
        writeSkill(base, 'brainstorming');
        writeSkill(team, 'brainstorming');
        writeSkill(team, 'team-only');
        fs.writeFileSync(
            path.join(team, 'awm-registry.json'),
            JSON.stringify({ overrides: ['brainstorming', 'ghost-skill'] })
        );
        const { overrideStatus } = require('../../../src/commands/registry/status');
        const status = overrideStatus(team, [base]);
        expect(status).toEqual([
            { name: 'brainstorming', active: true },
            { name: 'ghost-skill', active: false },
        ]);
    });

    it('returns empty for a registry without manifest', () => {
        const team = path.join(tmp, 'team');
        writeSkill(team, 'x');
        const { overrideStatus } = require('../../../src/commands/registry/status');
        expect(overrideStatus(team, [])).toEqual([]);
    });
});
