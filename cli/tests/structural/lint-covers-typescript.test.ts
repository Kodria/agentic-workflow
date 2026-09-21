import { execFileSync } from 'child_process';
import fs from 'fs';
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

interface LintResult { filePath: string; messages: Array<{ message: string; severity?: number; ruleId?: string | null }> }

/** One eslint run for the whole suite. Invoked through node against eslint's own
 *  js entrypoint rather than `npx`: on Windows `npx` resolves to `npx.cmd`, and
 *  `execFileSync` cannot execute a `.cmd` without a shell — the exact trap this
 *  repo already documents in tests/integration/published-doctor-evidence.e2e.test.ts,
 *  and the one this test hit on both Windows legs of its first CI run. Going
 *  through `process.execPath` needs no shell, so no argument escaping either. */
function lint(target = '.'): LintResult[] {
    const args = [
        path.join(CLI_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
        target, '--config', 'eslint.config.awm.mjs', '--format', 'json',
    ];
    try {
        const raw = execFileSync(process.execPath, args, { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        return JSON.parse(raw) as LintResult[];
    } catch (error) {
        // eslint exits non-zero when it reports an error, and the JSON report is
        // still on stdout. A probe that EXPECTS a finding must read it, not die.
        const stdout = (error as { stdout?: string }).stdout;
        if (typeof stdout !== 'string' || stdout.trim() === '') throw error;
        return JSON.parse(stdout) as LintResult[];
    }
}

/** Lint one throwaway `.ts` file inside the repo, so the real config's `.ts`
 *  block applies to it, and report what the gate said about it. */
function probe(body: string): Array<{ severity?: number; ruleId?: string | null; message: string }> {
    const directory = fs.mkdtempSync(path.join(CLI_ROOT, 'tests', '.lint-probe-'));
    const file = path.join(directory, 'probe.ts');
    try {
        fs.writeFileSync(file, body);
        const results = lint(path.relative(CLI_ROOT, file).split(path.sep).join('/'));
        return results.flatMap(entry => entry.messages);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
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

    // The gate examining TypeScript is worth nothing if it cannot fail on it.
    // #171 left the rule at 'warn' with a backlog behind it; these assert the
    // gate now BLOCKS, and that the tree it blocks on is clean.
    test('the tree it lints is clean, with nothing left to report', () => {
        const findings = results.flatMap(entry => entry.messages.map(m => `${entry.filePath}: ${m.ruleId ?? 'directive'} ${m.message}`));
        expect(findings).toEqual([]);
    });

    test('an unused variable in TypeScript is an error, not a warning', () => {
        const messages = probe('const neverUsed = 1;\nexport const used = 2;\n');
        const unused = messages.filter(m => m.ruleId === '@typescript-eslint/no-unused-vars');
        expect(unused).toHaveLength(1);
        expect(unused[0].severity).toBe(2);
        expect(unused[0].message).toContain('neverUsed');
    });

    test('an underscore-prefixed unused binding stays deliberate and unreported', () => {
        expect(probe('const _deliberatelyUnused = 1;\nexport const used = 2;\n')).toEqual([]);
    });

    // The reason the rule had to become the TypeScript-aware one rather than the
    // base rule: eslint's own `no-unused-vars` does not understand type
    // annotations, so it flagged every parameter NAME inside a function TYPE.
    // That was 195 of the 259 findings #171 exposed. Renaming those to `_x` would
    // have made the types less readable to silence noise.
    test('parameter names inside a function type are not reported as unused', () => {
        const messages = probe('export type Fingerprint = (argv: string[], paths: string[], cwd: string) => string | null;\n');
        expect(messages).toEqual([]);
    });

    test('a caught error that is never inspected is reported too', () => {
        const messages = probe('export function f(value: number): number {\n    try { return value; } catch (error) { return 0; }\n}\n');
        const unused = messages.filter(m => m.ruleId === '@typescript-eslint/no-unused-vars');
        expect(unused).toHaveLength(1);
        expect(unused[0].severity).toBe(2);
        expect(unused[0].message).toContain('error');
    });
});
