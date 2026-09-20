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

function lintedFiles(): string[] {
    const raw = execFileSync('npx', ['eslint', '.', '--config', 'eslint.config.awm.mjs', '--format', 'json'], {
        cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return (JSON.parse(raw) as Array<{ filePath: string }>).map(entry => entry.filePath);
}

describe('the lint gate covers TypeScript (#171)', () => {
    jest.setTimeout(10 * 60_000);

    const files = lintedFiles();
    const typescript = files.filter(file => file.endsWith('.ts'));

    test('lints the TypeScript sources, not only the js/mjs tooling', () => {
        // The count is a floor, not a lock: adding sources must not fail this.
        expect(typescript.length).toBeGreaterThan(400);
        expect(typescript.some(file => file.includes(`${path.sep}src${path.sep}`))).toBe(true);
        expect(typescript.some(file => file.includes(`${path.sep}tests${path.sep}`))).toBe(true);
    });

    test('lints this very file, so the assertion cannot be vacuous', () => {
        expect(files).toContain(path.join(CLI_ROOT, 'tests', 'structural', 'lint-covers-typescript.test.ts'));
    });

    test('reports no unresolved rule references', () => {
        // Four stale `eslint-disable @typescript-eslint/no-var-requires`
        // comments survived precisely because .ts was never linted: eslint
        // errors on a rule it cannot resolve, and nobody ever saw it. A new one
        // must fail here rather than wait for the next person to turn the gate on.
        const raw = execFileSync('npx', ['eslint', '.', '--config', 'eslint.config.awm.mjs', '--format', 'json'], {
            cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        });
        const unresolved = (JSON.parse(raw) as Array<{ filePath: string; messages: Array<{ message: string }> }>)
            .flatMap(entry => entry.messages.filter(m => /Definition for rule .* was not found/.test(m.message))
                .map(m => `${entry.filePath}: ${m.message}`));
        expect(unresolved).toEqual([]);
    });
});
