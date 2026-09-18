// Structural guard, same family as symlink-type-is-explicit.test.ts.
//
// fsync-ing a DIRECTORY file descriptor is a POSIX-only capability. On Windows
// `fs.openSync(dir, 'r')` succeeds and the following `fs.fsyncSync(fd)` always
// fails with EPERM — libuv's mapping of `FlushFileBuffers` on a directory
// handle, which Win32 rejects categorically. That is not a durability failure
// (NTFS journals the rename itself); the mechanism simply does not exist there.
//
// `atomic-file.fsyncDirSync` is where that decision lives, and it is deliberately
// narrow: degrade ONLY on win32 + EPERM at the fsync, keep throwing everywhere
// else. Re-implementing the open/fsync/close sequence inline re-creates the gap
// without the exception, and it fails on Windows and nowhere else — invisible to
// every local run, and behind CI's `--bail` it costs one full matrix round to
// surface. That is exactly how `tests/core/model-policy/store.test.ts` broke the
// Windows legs of the matrix while all four POSIX legs stayed green.
//
// So the rule is about the CALL, not about any one call site: a directory fd may
// be flushed only through `fsyncDirSync`. This scans `tests` as well as `src` —
// the regression that motivated it lived in a test double, and a guard that only
// watched `src` would have reported a clean bill of health.
import fs from 'fs';
import path from 'path';

const CLI = path.join(__dirname, '..', '..');
const ROOTS = ['src', 'tests'] as const;
/** The single source of the policy: the one file allowed to flush a directory fd. */
const SINGLE_SOURCE = path.join('src', 'core', 'atomic-file.ts');
/** This guard itself, which must quote the forbidden shape to describe and test it. */
const THIS_GUARD = path.join('tests', 'structural', 'directory-fsync-is-single-source.test.ts');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** True when `lines[i]` opens something that reads as a directory. Deliberately
 *  shallow — it recognises the shapes this codebase actually writes. Something
 *  cleverer that defeats it should be calling `fsyncDirSync` instead. */
function opensADirectory(line: string): boolean {
    const open = /\bfs\.openSync\s*\(\s*([^,]+),/.exec(line);
    if (!open) return false;
    const target = open[1];
    return /\bpath\.dirname\s*\(|\bdirname\s*\(/.test(target) || /\b(dir|Dir|root|Root)\b|Dir\b/.test(target);
}

/** True when the fd opened at `lines[i]` is flushed within the next few lines. */
function flushedNearby(lines: string[], i: number): boolean {
    return /\bfsyncSync\s*\(/.test(lines.slice(i, i + 4).join('\n'));
}

describe('directory fsync has exactly one implementation', () => {
    it('no file outside atomic-file.ts opens a directory and flushes it inline', () => {
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const file of sourceFiles(path.join(CLI, root))) {
                const relative = path.relative(CLI, file);
                if (relative === SINGLE_SOURCE || relative === THIS_GUARD) continue;
                const lines = fs.readFileSync(file, 'utf-8').split('\n');
                lines.forEach((line, i) => {
                    if (!opensADirectory(line) || !flushedNearby(lines, i)) return;
                    offenders.push(`${relative}:${i + 1}: ${line.trim()}`);
                });
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the guard actually rejects the shape that broke the Windows matrix', () => {
        // Without this, a guard whose regex silently stopped matching would read as
        // a clean bill of health forever — the failure mode of every structural test.
        const rejects = (lines: string[], i: number) => opensADirectory(lines[i]) && flushedNearby(lines, i);

        // Verbatim shape of the store.test.ts regression this guard exists to stop.
        const regression = [
            'fs.renameSync(temporary, file);',
            "const parent = fs.openSync(path.dirname(file), 'r');",
            'try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }',
        ];
        expect(rejects(regression, 1)).toBe(true);

        // The sanctioned replacement carries no directory open at all.
        expect(regression.map((_, i) => i).some(i => rejects(['fsyncDirSync(path.dirname(file));'], 0))).toBe(false);

        // Flushing a FILE descriptor stays legal — that is a real, portable fsync.
        const fileFlush = ["const fd = fs.openSync(temporary, 'wx', 0o600);", 'fs.fsyncSync(fd);'];
        expect(rejects(fileFlush, 0)).toBe(false);

        // Opening a directory without flushing it (readdir-style handles) stays legal.
        const openOnly = ["const parent = fs.openSync(path.dirname(file), 'r');", 'fs.closeSync(parent);'];
        expect(rejects(openOnly, 0)).toBe(false);
    });
});
