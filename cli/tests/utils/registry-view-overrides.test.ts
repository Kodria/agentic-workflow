import fs from 'fs';
import path from 'path';
import os from 'os';

describe('registry-view override markers', () => {
    let tmpHome: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-view-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('packageDetailLines marks an overridden skill with its registry name', () => {
        const { REGISTRIES_DIR } = require('../../src/core/registries');
        const { buildPackageView, packageDetailLines } = require('../../src/utils/registry-view');
        const teamSkillPath = path.join(REGISTRIES_DIR, 'team-acme', 'skills', 'brainstorming');
        const view = buildPackageView(
            [{ name: 'brainstorming', path: teamSkillPath, description: 'd', overrode: '/old/path' }],
            [], [], []
        );
        const lines = packageDetailLines(view[0]).join('\n');
        expect(lines).toContain('brainstorming');
        expect(lines).toContain('← team-acme (override)');
    });

    it('non-overridden artifacts carry no marker', () => {
        const { buildPackageView, packageDetailLines } = require('../../src/utils/registry-view');
        const view = buildPackageView(
            [{ name: 'plain', path: '/any/skills/plain', description: 'd' }],
            [], [], []
        );
        expect(packageDetailLines(view[0]).join('\n')).not.toContain('override');
    });
});
