// Structural guards for two defect classes that recurred through the Change Record cycle (#217,
// harness-retro 2026-10-17; see the branch ledger signatures `s3-cq-dirty-duplicates-gitstate`,
// `git-dir-env-not-scrubbed` and `silent-return-instead-of-skip`):
//
// 1. Every git child of the change-record code runs through `execGit`/`runGit`/`gitState`
//    (core/changes/git-env.ts), which scrubs inherited GIT_* location/pathspec variables, closes
//    stdin, bounds time and output and sets GIT_NO_LAZY_FETCH. A bare `execFileSync('git', ...)`
//    in these directories silently loses all of that, and reviewers found such leaks four times.
// 2. A test that returns early on Windows is reported as PASSED by the 3-platform release gate.
//    Every suite under cli/tests uses a visible skip instead: `posixOnly`, or `symlinkTest` when the
//    test only needs symlinks (cli/tests/helpers/platform.ts).
//
// The detectors are exercised on inline samples below, so each guard demonstrably fires.

import fs from 'fs';
import path from 'path';

const CLI_ROOT = path.join(__dirname, '../..');

function tsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...tsFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

// Naive comment stripping, as in exec-invocation-explicit-stdio.test.ts: a false positive fails loud.
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const BARE_GIT_SPAWN = /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*['"`]git['"`]/;
const SILENT_WIN32_RETURN = /\bif\s*\(\s*(?:process\.platform\s*===\s*['"]win32['"]|win32|isWindows)\s*\)\s*(?:\{\s*)?return\b/;

export function bareGitSpawns(source: string): boolean {
    return BARE_GIT_SPAWN.test(stripComments(source));
}

export function silentWin32Returns(source: string): boolean {
    return SILENT_WIN32_RETURN.test(stripComments(source));
}

describe('change-record conventions (structural)', () => {
    test('the detectors fire on the offending shapes and not on the sanctioned ones', () => {
        expect(bareGitSpawns("execFileSync('git', ['status'])")).toBe(true);
        expect(bareGitSpawns('spawnSync("git", args, opts)')).toBe(true);
        expect(bareGitSpawns("runGit(root, ['status'])")).toBe(false);
        expect(bareGitSpawns("// execFileSync('git', [])\nexecGit(root, [])")).toBe(false);
        expect(silentWin32Returns("if (process.platform === 'win32') return;")).toBe(true);
        expect(silentWin32Returns('if (win32) { return; }')).toBe(true);
        expect(silentWin32Returns('posixOnly(() => { /* body */ });')).toBe(false);
        expect(silentWin32Returns("// if (process.platform === 'win32') return;")).toBe(false);
    });

    test('git is spawned only by git-env.ts under core/changes and the change commands', () => {
        const dirs = ['src/core/changes', 'src/commands/change', 'src/commands/changes'].map(d => path.join(CLI_ROOT, d));
        const allowed = path.join(CLI_ROOT, 'src/core/changes/git-env.ts');
        const offenders = dirs
            .flatMap(tsFiles)
            .filter(file => file !== allowed)
            .filter(file => bareGitSpawns(fs.readFileSync(file, 'utf8')))
            .map(file => path.relative(CLI_ROOT, file));
        expect(offenders).toEqual([]);
    });

    test('no test under cli/tests returns early on Windows instead of skipping visibly', () => {
        // This file is excluded: its detector samples are offending shapes on purpose.
        const offenders = tsFiles(path.join(CLI_ROOT, 'tests'))
            .filter(file => file !== __filename)
            .filter(file => silentWin32Returns(fs.readFileSync(file, 'utf8')))
            .map(file => path.relative(CLI_ROOT, file));
        expect(offenders).toEqual([]);
    });
});
