// Structural guard, in the vein of exec-invocation-explicit-stdio.test.ts: it does not
// test behaviour, it forbids the SHAPE that produced a whole family of bugs.
//
// "What filename does renderer R produce" existed in four places. Three agreed; the
// fourth — the one deciding whether a rendered artifact counted as installed — had
// never heard of `.mdc` or `.instructions.md`, so `awm add` re-installed the same
// Cursor/Copilot artifacts on every run and `awm doctor` called a healthy install
// absent. Each instance was individually reasonable; the class is what cost a release.
//
// `core/renderers/registry.ts` is now the single table. This test fails the moment a
// second one appears, whether by a new literal map or by a fresh `switch` over renderer
// ids somewhere that should have asked the table.
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', 'src');
const REGISTRY = path.join(SRC, 'core', 'renderers', 'registry.ts');

/** Every .ts file under src/, recursively. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** The file's lines with `//` comments and blank lines dropped — a renderer id named in
 *  prose (a doc comment explaining the bug) is not a second implementation of the table. */
function codeLines(file: string): { line: string; n: number }[] {
    const raw = fs.readFileSync(file, 'utf-8').split('\n');
    const out: { line: string; n: number }[] = [];
    let inBlockComment = false;
    raw.forEach((line, i) => {
        let l = line;
        if (inBlockComment) {
            const end = l.indexOf('*/');
            if (end === -1) return;
            inBlockComment = false;
            l = l.slice(end + 2);
        }
        const start = l.indexOf('/*');
        if (start !== -1) {
            inBlockComment = l.indexOf('*/', start) === -1;
            l = l.slice(0, start) + (inBlockComment ? '' : l.slice(l.indexOf('*/', start) + 2));
        }
        const lineComment = l.indexOf('//');
        if (lineComment !== -1) l = l.slice(0, lineComment);
        if (l.trim()) out.push({ line: l, n: i + 1 });
    });
    return out;
}

/** The extensions the renderer table owns. A literal here, outside the table, IS the bug. */
const RENDERED_EXTENSIONS = ['.toml', '.mdc', '.instructions.md'];

describe('the renderer table is the only renderer table', () => {
    const files = sourceFiles(SRC).filter((f) => f !== REGISTRY);

    it('no other source file maps a renderer id to a file extension', () => {
        const offenders: string[] = [];
        for (const file of files) {
            for (const { line, n } of codeLines(file)) {
                // A renderer-to-extension mapping looks like an id and an extension on
                // the same line of code. That is exactly the shape of every copy that
                // drifted, and nothing legitimate needs to write both at once now that
                // `rendererExtension`/`renderedFilename` exist.
                const namesRenderer = /'(codex-agent-toml|cursor-mdc|copilot-instructions)'/.test(line);
                const namesExtension = RENDERED_EXTENSIONS.some((e) => line.includes(`'${e}'`) || line.includes(`"${e}"`));
                if (namesRenderer && namesExtension) {
                    offenders.push(`${path.relative(SRC, file)}:${n}: ${line.trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('the table itself still covers every declared renderer', () => {
        // The guard above is only worth anything if the one surviving table is complete:
        // a renderer added to `RendererId` but not to the table would make the guard
        // push every caller toward a lookup that has no answer.
        const { RENDERER_IDS } = require('../../src/providers');
        const { rendererExtension } = require('../../src/core/renderers/registry');
        for (const id of RENDERER_IDS) {
            // `null` (the `link` renderer, which keeps the name as-is) is an ANSWER;
            // `undefined` is the table not knowing about the renderer at all.
            expect(rendererExtension(id)).not.toBeUndefined();
        }
    });
});
