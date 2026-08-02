// Structural regression guard for the recurring class of bug found across
// R1's durable-controller work (harness-retro, 2026-08-01 — r1-durable-controller
// plan, Task 20 + post-implementation-qa): execFileSync/spawn/spawnSync calls
// with no explicit `stdio` option inherit Node's default `inheritStderr`
// relay, which pipes the SUBPROCESS's stderr onto the CALLING process's own
// stderr fd. When that fd is a destroyed/broken pipe (a detached wrapper
// whose parent already tore down its own pipes, a supervisor whose stdout
// went away), the relay itself raises an async EPIPE with no listener,
// which Node re-throws — silently crashing the caller before it can finish
// its work.
//
// The bug recurred FIVE separate times in the same session even after the
// first fix landed: spawnStructured's own detached-child spawn, then 4 more
// bare execFileSync('git'/'ps'/'pgrep', ...) call sites in DIFFERENT files
// (process.ts, lock.ts, job/index.ts, watch/index.ts, fingerprint.ts) plus a
// bonus spawnSync('zip', ...) in pack.ts — because each fix was scoped to
// the one call site a reviewer happened to be looking at, not the whole
// class. This test exercises the whole class in one pass: every
// execFileSync/spawn/spawnSync call site anywhere under cli/src must pass an
// explicit `stdio` option (or the shared `EXEC_STDIO` constant) — so a
// future call site added without one fails immediately instead of waiting
// for the next EPIPE crash to be noticed.

import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(__dirname, '../../src');
const CALLEE_NAMES = ['execFileSync', 'spawnSync', 'spawn'];

function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listTsFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

// Strips comments before scanning: JSDoc/inline comments in this codebase
// routinely reference "spawn (...)" or "execFileSync(...)" in prose (e.g.
// process.ts's own EPIPE-hardening comment), which would otherwise register
// as phantom call sites. Naive block/line-comment stripping, not a full TS
// parser — sufficient for a structural guard, and a false positive here
// fails loud rather than silently missing a real site. The `[^:]` guard on
// `//` avoids treating a `https://` URL in a string as a line comment.
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Extracts the paren-balanced argument text of every call to one of
// CALLEE_NAMES in `source` — e.g. "execFileSync('git', [...], {...})" -> the
// text between the outer parens. Balanced-paren scanning (not a single-line
// regex) is required because real call sites in this repo span multiple
// lines (e.g. process.ts's pgrep call).
function extractCalls(rawSource: string): { callee: string; args: string }[] {
    const source = stripComments(rawSource);
    const calls: { callee: string; args: string }[] = [];
    const calleeRe = new RegExp(`\\b(${CALLEE_NAMES.join('|')})\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = calleeRe.exec(source)) !== null) {
        const start = m.index + m[0].length; // just after the opening '('
        let depth = 1;
        let i = start;
        while (i < source.length && depth > 0) {
            if (source[i] === '(') depth++;
            else if (source[i] === ')') depth--;
            i++;
        }
        calls.push({ callee: m[1], args: source.slice(start, i - 1) });
    }
    return calls;
}

describe('execFileSync/spawn/spawnSync invocations — explicit stdio required (structural)', () => {
    it('every call site under cli/src passes an explicit stdio option, never relying on Node defaults', () => {
        const violations: string[] = [];
        for (const file of listTsFiles(SRC_ROOT)) {
            const source = fs.readFileSync(file, 'utf8');
            for (const call of extractCalls(source)) {
                const hasExplicitStdio = /\bstdio\s*:/.test(call.args) || /\bEXEC_STDIO\b/.test(call.args);
                if (!hasExplicitStdio) {
                    violations.push(`${path.relative(SRC_ROOT, file)}: ${call.callee}(...) has no explicit stdio option`);
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
