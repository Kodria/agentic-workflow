import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { changedFiles, applyChangedCmd, filterByExtension } from '../../../src/commands/sensors/changed';

/** A throwaway repo. Real git, not a mock: the whole value of this module is that its
 *  understanding of "changed" matches git's, which a mock would define into existence. */
function repo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-changed-'));
    const run = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'test']);
    fs.writeFileSync(path.join(dir, 'base.ts'), 'export const a = 1;\n');
    run(['add', 'base.ts']);
    run(['commit', '-qm', 'base']);
    return dir;
}

describe('changedFiles', () => {
    const dirs: string[] = [];
    const make = () => { const d = repo(); dirs.push(d); return d; };
    afterAll(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

    it('sees unstaged, staged and untracked files, not just committed ones', () => {
        // The gate runs mid-work, before anything is committed. A committed-only diff
        // would scope the run to a stale set and certify files nobody is editing —
        // exactly the files least likely to be broken right now.
        const dir = make();
        fs.appendFileSync(path.join(dir, 'base.ts'), 'export const b = 2;\n');   // unstaged
        fs.writeFileSync(path.join(dir, 'staged.ts'), 'export const c = 3;\n');
        execFileSync('git', ['add', 'staged.ts'], { cwd: dir, stdio: 'ignore' }); // staged
        fs.writeFileSync(path.join(dir, 'untracked.ts'), 'export const d = 4;\n'); // untracked

        expect(changedFiles(dir).files).toEqual(['base.ts', 'staged.ts', 'untracked.ts']);
    });

    it('excludes gitignored files so build output never enters the scope', () => {
        const dir = make();
        fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');
        fs.mkdirSync(path.join(dir, 'dist'));
        fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), 'noise');

        expect(changedFiles(dir).files).not.toContain('dist/bundle.js');
    });

    it('omits deleted files — a sensor cannot read a path that is gone', () => {
        const dir = make();
        fs.rmSync(path.join(dir, 'base.ts'));

        expect(changedFiles(dir).files).not.toContain('base.ts');
    });

    it('compares against the merge base, not the branch tip', () => {
        // Guards the case where the branch is merely BEHIND its base. Diffing against
        // the tip would report every file the base moved on as "changed by this
        // branch", scoping the run to files this branch never touched.
        const dir = make();
        const run = (args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
        run(['checkout', '-qb', 'feature']);
        fs.writeFileSync(path.join(dir, 'mine.ts'), 'export const mine = 1;\n');
        run(['add', 'mine.ts']);
        run(['commit', '-qm', 'mine']);

        // main moves on independently, so `feature` is behind it.
        run(['checkout', '-q', 'master']);
        fs.writeFileSync(path.join(dir, 'theirs.ts'), 'export const theirs = 1;\n');
        run(['add', 'theirs.ts']);
        run(['commit', '-qm', 'theirs']);
        run(['checkout', '-q', 'feature']);

        const files = changedFiles(dir, 'master').files;
        expect(files).toContain('mine.ts');
        expect(files).not.toContain('theirs.ts');
    });

    it('reports an error instead of an empty scope when git cannot answer', () => {
        // An empty file list and a failed lookup are the same value structurally but
        // opposite in meaning: one says "nothing to check", the other "I do not know".
        // Collapsing them would silently scope a run to zero files and report clean.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-nogit-'));
        dirs.push(dir);

        const res = changedFiles(dir);
        expect(res.error).toBeDefined();
        expect(res.files).toEqual([]);
    });
});

describe('applyChangedCmd', () => {
    // shellQuote (changed.ts) branches on isWindowsNative(), which reads real
    // process.platform. These assertions exercise the POSIX single-quote branch —
    // pin the platform so the expectations are deterministic on windows-latest CI too,
    // instead of silently asserting whatever the CI runner's real OS happens to be.
    // The win32 double-quote branch is covered separately in changed-windows.test.ts.
    // Pattern: AGENTS.md "stub-process-platform".
    const originalPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('substitutes the file list into the template', () => {
        expect(applyChangedCmd('eslint --format json {files}', ['a.ts', 'b.ts']))
            .toBe(`eslint --format json 'a.ts' 'b.ts'`);
    });

    it('quotes paths so a space cannot split one argument into two', () => {
        expect(applyChangedCmd('eslint {files}', ['my dir/a.ts']))
            .toBe(`eslint 'my dir/a.ts'`);
    });

    it("escapes a single quote in a path instead of ending the quoting", () => {
        // Without the '\'' form the rest of the filename would be read as shell syntax.
        expect(applyChangedCmd('eslint {files}', ["it's.ts"]))
            .toBe(`eslint 'it'\\''s.ts'`);
    });

    it('handles a filename with both a space and an embedded quote together', () => {
        expect(applyChangedCmd('eslint {files}', ["my dir/it's.ts"]))
            .toBe(`eslint 'my dir/it'\\''s.ts'`);
    });
});

describe('filterByExtension', () => {
    it('drops files the sensor cannot be handed', () => {
        // Editing a README must not turn the lint gate red: eslint given a .md fails
        // rather than skipping it.
        expect(filterByExtension(['src/a.ts', 'README.md', 'logo.png'], ['.ts']))
            .toEqual(['src/a.ts']);
    });

    it('matches extensions case-insensitively', () => {
        // Windows and macOS checkouts carry .TS. A case-sensitive match would drop them
        // from the scope silently — the sensor would report clean over files it never saw.
        expect(filterByExtension(['src/A.TS'], ['.ts'])).toEqual(['src/A.TS']);
    });

    it('passes everything through when the sensor declares no filter', () => {
        const files = ['a.ts', 'b.md'];
        expect(filterByExtension(files, undefined)).toEqual(files);
        expect(filterByExtension(files, [])).toEqual(files);
    });
});
