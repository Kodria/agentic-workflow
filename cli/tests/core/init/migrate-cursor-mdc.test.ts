import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrateCursorMdcSkills } from '../../../src/core/init/migrate-cursor-mdc';
import { writeArtifactState, type ManagedArtifactRecord } from '../../../src/core/artifact-state';

describe('migrateCursorMdcSkills (Plan B R8/R8.1)', () => {
    let tmpHome: string;
    let tmpProject: string;
    let stateFile: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-mdc-home-'));
        tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-mdc-proj-'));
        stateFile = path.join(tmpHome, '.awm/state/artifacts.json');
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpProject, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function record(over: Partial<ManagedArtifactRecord> & Pick<ManagedArtifactRecord, 'name' | 'targetPath' | 'renderer'>): ManagedArtifactRecord {
        return {
            type: 'skill',
            scope: 'global',
            sourcePath: '/registry/skills/' + over.name,
            owners: ['cursor'],
            ...over,
        };
    }

    it('removes only recorded cursor-mdc skills under rules dirs; keeps awm.mdc and unrecorded files', () => {
        const rules = path.join(tmpHome, '.cursor/rules');
        fs.mkdirSync(rules, { recursive: true });
        const foo = path.join(rules, 'foo.mdc');
        const awm = path.join(rules, 'awm.mdc');
        const custom = path.join(rules, 'custom.mdc');
        fs.writeFileSync(foo, '---\nalwaysApply: false\n---\nfoo\n');
        fs.writeFileSync(awm, '---\nalwaysApply: true\n---\nguidance\n');
        fs.writeFileSync(custom, '---\nalwaysApply: false\n---\ncustom\n');

        writeArtifactState([
            record({ name: 'foo', targetPath: foo, renderer: 'cursor-mdc' }),
            record({ name: 'awm', targetPath: awm, renderer: 'cursor-mdc' }),
            record({
                name: 'linked',
                targetPath: path.join(tmpHome, '.agents/skills/linked'),
                renderer: 'link',
            }),
        ], stateFile);

        const result = migrateCursorMdcSkills({ projectRoot: tmpProject, stateFile });
        expect(result.removed).toEqual([foo]);
        expect(fs.existsSync(foo)).toBe(false);
        expect(fs.existsSync(awm)).toBe(true);
        expect(fs.existsSync(custom)).toBe(true);

        const remaining = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as ManagedArtifactRecord[];
        expect(remaining.map((r) => r.name).sort()).toEqual(['awm', 'linked']);
    });
});
