import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverSkills } from '../../src/core/discovery';

describe('real skill parent races', () => {
    let fixture: string;
    let root: string;
    let skillDir: string;
    let skillFile: string;

    beforeEach(() => {
        fixture = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'skill-parent-race-'));
        root = path.join(fixture, 'registry');
        skillDir = path.join(root, 'skills', 'safe');
        skillFile = path.join(skillDir, 'SKILL.md');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(skillFile, '---\ndescription: Inside skill\n---\n');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(fixture, { recursive: true, force: true });
    });

    it('reads an unchanged skill through its descriptor', () => {
        expect(discoverSkills([root])).toEqual([
            { name: 'safe', path: skillDir, description: 'Inside skill' },
        ]);
    });

    describe.each(['root', 'skills', 'skill directory'])('%s substitution', (component) => {
        it.each(['symlink', 'directory'])('rejects a %s swapped after parent inspection before reading outside bytes', (replacement) => {
            const parent = component === 'root' ? root : component === 'skills' ? path.dirname(skillDir) : skillDir;
            const outside = path.join(fixture, 'outside');
            const outsideFile = path.join(outside, path.relative(parent, skillFile));
            fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
            fs.writeFileSync(outsideFile, '---\ndescription: Outside skill\n---\n');

            const lstat = fs.lstatSync;
            let swapped = false;
            // Keep real lstat results; only schedule a real rename/symlink at the race boundary.
            jest.spyOn(fs, 'lstatSync').mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
                const stat = lstat(...args);
                if (args[0] === parent && !swapped) {
                    swapped = true;
                    fs.renameSync(parent, path.join(fixture, 'original-parent'));
                    if (replacement === 'symlink') fs.symlinkSync(outside, parent, 'junction');
                    else fs.renameSync(outside, parent);
                }
                return stat;
            }) as typeof fs.lstatSync);
            const read = jest.spyOn(fs, 'readFileSync');

            expect(() => discoverSkills([root])).toThrow(/symbolic link|directory identity/i);
            expect(swapped).toBe(true);
            expect(read.mock.calls.filter(([file]) => typeof file === 'number'
                || String(file).startsWith(fixture + path.sep))).toEqual([]);
        });
    });

    it('rejects an observable parent symlink introduced after open and closes the descriptor without reading', () => {
        const open = fs.openSync;
        let descriptor: number | undefined;
        jest.spyOn(fs, 'openSync').mockImplementation((...args) => {
            descriptor = open(...args);
            const moved = path.join(fixture, 'original-parent');
            fs.renameSync(skillDir, moved);
            fs.symlinkSync(moved, skillDir, 'junction');
            return descriptor;
        });
        const read = jest.spyOn(fs, 'readFileSync');
        const close = jest.spyOn(fs, 'closeSync');

        expect(() => discoverSkills([root])).toThrow(/symbolic link/i);
        expect(read.mock.calls.filter(([file]) => typeof file === 'number'
            || String(file).startsWith(fixture + path.sep))).toEqual([]);
        expect(close).toHaveBeenCalledWith(descriptor);
    });
});
