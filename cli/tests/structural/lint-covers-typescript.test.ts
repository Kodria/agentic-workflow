import { execFileSync } from 'child_process';
import path from 'path';

// #171: the lint gate linted 14 files — all js/mjs — and exited 0 on a
// TypeScript CLI. `eslint.config.awm.mjs` imports a project config that does
// not exist, swallows the failure, and its remaining objects declare no
// `files`, so eslint's default universe (js/mjs/cjs) left every .ts out.
//
// The gate was green for months and the `lint` sensor certified on it, which
// `plan admit --verify-sensors` then consumes as the unattended handoff gate.
//
// This asserts on the SET OF FILES LINTED, never on the exit code. An exit-code
// assertion is exactly what let this survive: a lint that examines nothing
// exits 0.

const CLI_ROOT = path.resolve(__dirname, '../..');

interface LintResult { filePath: string; messages: Array<{ message: string }> }

/** One eslint run for the whole suite. Invoked through node against eslint's own
 *  js entrypoint rather than `npx`: on Windows `npx` resolves to `npx.cmd`, and
 *  `execFileSync` cannot execute a `.cmd` without a shell — the exact trap this
 *  repo already documents in tests/integration/published-doctor-evidence.e2e.test.ts,
 *  and the one this test hit on both Windows legs of its first CI run. Going
 *  through `process.execPath` needs no shell, so no argument escaping either. */
function lint(): LintResult[] {
    const raw = execFileSync(process.execPath, [
        path.join(CLI_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
        '.', '--config', 'eslint.config.awm.mjs', '--format', 'json',
    ], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(raw) as LintResult[];
}

describe('the lint gate covers TypeScript (#171)', () => {
    jest.setTimeout(10 * 60_000);

    const results = lint();
    const files = results.map(entry => entry.filePath);
    const typescript = files.filter(file => file.endsWith('.ts'));

    test('lints the TypeScript sources, not only the js/mjs tooling', () => {
        // A floor, not a lock: adding sources must not fail this.
        expect(typescript.length).toBeGreaterThan(400);
        expect(typescript.some(file => file.includes(`${path.sep}src${path.sep}`))).toBe(true);
        expect(typescript.some(file => file.includes(`${path.sep}tests${path.sep}`))).toBe(true);
    });

    test('lints this very file, so the assertion cannot be vacuous', () => {
        expect(files).toContain(path.join(CLI_ROOT, 'tests', 'structural', 'lint-covers-typescript.test.ts'));
    });

    test('reports no unresolved rule references', () => {
        // Four stale `eslint-disable @typescript-eslint/no-var-requires` comments
        // survived precisely because .ts was never linted: eslint errors on a rule
        // it cannot resolve, and nobody ever saw it. A new one must fail here
        // rather than wait for the next person to turn the gate on.
        const unresolved = results.flatMap(entry =>
            entry.messages.filter(m => /Definition for rule .* was not found/.test(m.message))
                .map(m => `${entry.filePath}: ${m.message}`));
        expect(unresolved).toEqual([]);
    });
});
