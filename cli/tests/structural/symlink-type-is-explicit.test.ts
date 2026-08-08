// Structural guard, same family as exec-invocation-explicit-stdio.test.ts.
//
// `fs.symlinkSync(target, dest)` with no third argument creates a DIRECTORY symlink on
// Windows when the target is a directory, and that needs SeCreateSymbolicLinkPrivilege
// — denied by default on unprivileged accounts, including GitHub Actions'
// windows-latest runner. The same omission has been fixed one site at a time, more
// than once, each fix landing where the bug was reported and nowhere else:
// `executor.ts` learned `'junction'`, and `skill-integrity.ts` did not, for a whole
// release — its comment still says "este sitio nunca recibio el fix".
//
// So the rule is about the CALL, not about any one call site: every `fs.symlinkSync`
// either passes an explicit type argument, or is wrapped in a `try` whose `catch`
// falls back to a copy. Those are the only two ways this survives Windows, and one of
// them has to be visible at the call.
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** True when `lines[i]` sits inside a try block whose catch copies instead. Deliberately
 *  shallow — it looks a few lines ahead for the catch, which is what every real fallback
 *  in this codebase looks like. A cleverer arrangement that defeats it should be written
 *  with an explicit type argument instead. */
function hasCopyFallback(lines: string[], i: number): boolean {
    const window = lines.slice(Math.max(0, i - 3), i + 8).join('\n');
    return /\btry\b/.test(window) && /catch\b/.test(window) && /copyFileSync|cpSync/.test(window);
}

describe('every symlink creation survives Windows on purpose', () => {
    it('passes an explicit type argument or falls back to a copy', () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const lines = fs.readFileSync(file, 'utf-8').split('\n');
            lines.forEach((line, i) => {
                if (!/\bfs\.symlinkSync\s*\(/.test(line)) return;
                // Three arguments — the third is the type ('junction' | 'dir' | 'file').
                const explicitType = /symlinkSync\s*\([^)]*,[^)]*,\s*[^)]+\)/.test(line) ||
                    /'junction'|'dir'|'file'/.test(lines.slice(i, i + 3).join('\n'));
                if (explicitType || hasCopyFallback(lines, i)) return;
                offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(offenders).toEqual([]);
    });

    it('the guard actually rejects a bare two-argument call', () => {
        // Without this, a guard whose regex silently stopped matching would read as a
        // clean bill of health forever — the failure mode of every structural test.
        const bare = ['fs.symlinkSync(source, dest);'];
        const explicit = ["fs.symlinkSync(source, dest, 'junction');"];
        const wrapped = ['try {', 'fs.symlinkSync(source, dest);', '} catch {', 'fs.copyFileSync(source, dest);', '}'];

        const rejects = (lines: string[], i: number) =>
            !/symlinkSync\s*\([^)]*,[^)]*,\s*[^)]+\)/.test(lines[i]) &&
            !/'junction'|'dir'|'file'/.test(lines.slice(i, i + 3).join('\n')) &&
            !hasCopyFallback(lines, i);

        expect(rejects(bare, 0)).toBe(true);
        expect(rejects(explicit, 0)).toBe(false);
        expect(rejects(wrapped, 1)).toBe(false);
    });
});
