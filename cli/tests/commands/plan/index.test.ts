import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import type { PlanValidationReport } from '../../../src/core/plan/types';
import { exitCodeFor, formatReport, registerPlanCommand } from '../../../src/commands/plan';

const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

const valid: PlanValidationReport = {
    state: 'valid', schema: 'compact-slices/v1', manifest: {
        schema: 'compact-slices/v1', planId: 'r4-plan', requirements: ['R4-VAL-1', 'R4-VAL-4'],
        sources: [{ id: 'SRC-1', path: 'AGENTS.md', locator: '# AGENTS.md', fact: 'maintenance context' }],
        commands: [
            { id: 'CMD-1', program: 'npm', args: ['test'], covers: ['R4-VAL-1', 'R4-VAL-4'] },
            { id: 'CMD-2', program: 'npm', args: ['run', 'build'], covers: [] },
        ], slices: [{
            id: 'S1', title: 'Implement', requirements: ['R4-VAL-1', 'R4-VAL-4'], dependsOn: [],
            sectionAnchor: '## S1', sources: ['SRC-1'], redCommands: ['CMD-1'], greenCommands: ['CMD-1'],
            reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: ['stop on failure'],
        }], closureCommands: ['CMD-2'],
    },
};
const invalid: Extract<PlanValidationReport, { state: 'invalid' }> = {
    state: 'invalid', diagnostics: [{ code: 'PLAN_MARKERS', message: 'compact markers must occur once in order' }],
};
const unsupported: Extract<PlanValidationReport, { state: 'unsupported' }> = {
    state: 'unsupported', schema: 'compact-slices/v2', diagnostics: [{ code: 'PLAN_UNSUPPORTED_SCHEMA', message: 'unsupported compact plan schema; update the CLI' }],
};
const migration: Extract<PlanValidationReport, { state: 'migration-required' }> = { state: 'migration-required', reason: 'unmarked-plan' };

function commandFor(report: PlanValidationReport, calls: Array<[string, string]> = []): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
    registerPlanCommand(program, {
        validatePlanFile: (planPath: string, cwd: string) => {
            calls.push([planPath, cwd]);
            return report;
        },
    });
    return program;
}

describe('plan validate Commander wiring', () => {
    const previousExitCode = process.exitCode;

    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    afterAll(() => {
        stdoutWrite.mockRestore();
        process.exitCode = previousExitCode;
    });

    it('emits deterministic human output for a valid compact plan', async () => {
        await commandFor(valid).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md']);

        expect(String(stdoutWrite.mock.calls[0][0])).toBe(
            'Plan validation: valid "plans/r4.md" (compact-slices/v1; 1 slices; 2 requirements; complete ownership)\n',
        );
        expect(process.exitCode).toBe(0);
    });

    it('emits one stable JSON object without an update banner', async () => {
        await commandFor(valid).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--json']);

        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toEqual({
            state: 'valid', path: 'plans/r4.md', schema: 'compact-slices/v1', planId: 'r4-plan',
            requirements: 2, sources: 1, commands: 2, slices: 1, completeOwnership: true,
        });
        expect(String(stdoutWrite.mock.calls[0][0])).not.toContain('update');
    });

    it('emits deterministic migration-only human guidance and exit 2', async () => {
        await commandFor(migration).parseAsync(['node', 'awm', 'plan', 'validate', 'legacy.md']);

        expect(String(stdoutWrite.mock.calls[0][0])).toBe(
            'Plan validation: migration-required "legacy.md" (unmarked-plan)\nMigrate this plan to compact-slices/v1 before execution.\n',
        );
        expect(String(stdoutWrite.mock.calls[0][0])).not.toMatch(/full-quality|alternate|legacy path/i);
        expect(process.exitCode).toBe(2);
    });

    it('writes one stable migration JSON object before assigning exit 2', async () => {
        const observedExitCodes: unknown[] = [];
        stdoutWrite.mockImplementation(() => { observedExitCodes.push(process.exitCode); return true; });

        await commandFor(migration).parseAsync(['node', 'awm', 'plan', 'validate', 'legacy.md', '--json']);

        const output = String(stdoutWrite.mock.calls[0][0]);
        expect(output).toBe('{"state":"migration-required","path":"legacy.md","reason":"unmarked-plan"}\n');
        expect(JSON.parse(output)).toEqual({ state: 'migration-required', path: 'legacy.md', reason: 'unmarked-plan' });
        expect(output).not.toMatch(/full-quality|alternate|legacy path/i);
        expect(observedExitCodes).toEqual([undefined]);
        expect(process.exitCode).toBe(2);
    });

    it.each(['human', 'json'])('rejects a malformed injected migration report in %s mode before output', async (mode) => {
        const malformed = { state: 'migration-required' } as unknown as PlanValidationReport;
        const args = ['node', 'awm', 'plan', 'validate', 'unmarked.md', ...(mode === 'json' ? ['--json'] : [])];

        await expect(commandFor(malformed).parseAsync(args)).rejects.toThrow('plan validator returned an invalid migration reason');
        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('enforces migration-only output and exit 2 through the compiled CLI without mutating an unmarked plan', () => {
        const repoRoot = path.resolve(__dirname, '../../../..');
        const compiled = path.join(repoRoot, 'cli', 'dist', 'src', 'index.js');
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-unmarked-e2e-'));
        const plan = path.join(fixtureRoot, 'unmarked.md');
        const isolatedHome = path.join(fixtureRoot, 'home');
        fs.mkdirSync(isolatedHome);
        fs.writeFileSync(plan, '# Unmarked plan\n');
        const before = fs.readFileSync(plan);
        const environment = { ...process.env, HOME: isolatedHome, AWM_HOME: path.join(isolatedHome, '.awm') };
        try {
            expect(fs.existsSync(compiled)).toBe(true);
            const human = spawnSync(process.execPath, [compiled, 'plan', 'validate', 'unmarked.md', '--cwd', fixtureRoot], {
                cwd: repoRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            });
            const json = spawnSync(process.execPath, [compiled, 'plan', 'validate', 'unmarked.md', '--cwd', fixtureRoot, '--json'], {
                cwd: repoRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            });

            expect(human.status).toBe(2);
            expect(human.stdout).toBe('Plan validation: migration-required "unmarked.md" (unmarked-plan)\nMigrate this plan to compact-slices/v1 before execution.\n');
            expect(json.status).toBe(2);
            expect(JSON.parse(json.stdout)).toEqual({ state: 'migration-required', path: 'unmarked.md', reason: 'unmarked-plan' });
            expect(human.stdout + json.stdout).not.toMatch(/full-quality|alternate|legacy path/i);
            expect(fs.readFileSync(plan).equals(before)).toBe(true);
        } finally {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    it.each([
        ['invalid', invalid],
        ['unsupported', unsupported],
    ] as const)('writes complete %s diagnostics before assigning semantic exit 2', async (state, report) => {
        const observedExitCodes: unknown[] = [];
        stdoutWrite.mockImplementation(() => {
            observedExitCodes.push(process.exitCode);
            return true;
        });

        await commandFor(report).parseAsync(['node', 'awm', 'plan', 'validate', 'broken.md', '--json']);

        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toMatchObject({ state, path: 'broken.md', diagnostics: report.diagnostics });
        expect(observedExitCodes).toEqual([undefined]);
        expect(process.exitCode).toBe(2);
    });

    it('passes an explicit cwd only to validation while retaining the original path text in output', async () => {
        const calls: Array<[string, string]> = [];
        await commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--cwd', 'fixture-root']);

        expect(calls).toEqual([['plans/r4.md', 'fixture-root']]);
        expect(String(stdoutWrite.mock.calls[0][0])).toContain('"plans/r4.md"');
    });

    it('rejects missing paths, extra arguments, and missing --cwd values before validation', async () => {
        const calls: Array<[string, string]> = [];
        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate'])).rejects.toThrow();
        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'one.md', 'two.md'])).rejects.toThrow();
        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'one.md', '--cwd', '--json'])).rejects.toThrow();
        expect(calls).toEqual([]);
    });

    it.each(['plans/escape\u001b.md', 'plans/tab\t.md'])('rejects control characters in the public plan path %j', async (planPath) => {
        const calls: Array<[string, string]> = [];

        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', planPath])).rejects.toThrow('plan path must be a non-empty path without control characters');
        expect(calls).toEqual([]);
    });

    it.each(['fixture\u001b-root', 'fixture\troot'])('rejects control characters in the public --cwd value %j', async (cwd) => {
        const calls: Array<[string, string]> = [];

        await expect(commandFor(valid, calls).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--cwd', cwd])).rejects.toThrow('--cwd must be a non-empty path without control characters');
        expect(calls).toEqual([]);
    });

    it('does not emit terminal control characters in unsupported human output', () => {
        const report: PlanValidationReport = {
            state: 'unsupported', schema: 'compact-slices/v2\u001b[2J',
            diagnostics: [{ code: 'PLAN\tSCHEMA', message: 'unsafe\u001b[31m diagnostic', field: 'schema\r' }],
        };

        const output = formatReport(report, 'plans/unsafe\u001b.md');
        expect(output.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
        expect(output).toContain('compact-slices/v2\\u001b[2J');
    });

    it('suppresses the passive update notification only for root-program JSON validation', () => {
        const awmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-update-'));
        const repoRoot = path.resolve(__dirname, '../../../..');
        const indexPath = path.join(repoRoot, 'cli', 'src', 'index.ts');
        const registerPath = require.resolve('ts-node/register');
        fs.writeFileSync(path.join(awmHome, 'update-check.json'), JSON.stringify({ lastCheck: Date.now(), latest: '999.0.0' }));

        try {
            const result = spawnSync(process.execPath, ['-r', registerPath, indexPath, 'plan', 'validate', 'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md', '--cwd', repoRoot, '--json'], {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, AWM_HOME: awmHome, TS_NODE_PROJECT: path.join(repoRoot, 'cli', 'tsconfig.json') },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            expect(result.status).toBe(0);
            expect(() => JSON.parse(result.stdout)).not.toThrow();
            expect(JSON.parse(result.stdout)).toMatchObject({ state: 'valid', path: 'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md' });
            expect(result.stderr).toBe('');

            const humanResult = spawnSync(process.execPath, ['-r', registerPath, indexPath, 'plan', 'validate', 'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md', '--cwd', repoRoot], {
                cwd: repoRoot,
                encoding: 'utf8',
                env: { ...process.env, AWM_HOME: awmHome, TS_NODE_PROJECT: path.join(repoRoot, 'cli', 'tsconfig.json') },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            expect(humanResult.status).toBe(0);
            expect(humanResult.stderr).toContain('awm v999.0.0 available');
        } finally {
            fs.rmSync(awmHome, { recursive: true, force: true });
        }
    });
});

describe('plan validation public boundaries', () => {
    it.each([
        ['valid', valid, 0],
        ['migration-required', migration, 2],
        ['invalid', { state: 'invalid', diagnostics: [] } as PlanValidationReport, 2],
        ['unsupported', { state: 'unsupported', schema: 'compact-slices/v2', diagnostics: [] } as PlanValidationReport, 2],
    ])('maps %s reports to exit %i', (_state, report, code) => {
        expect(exitCodeFor(report)).toBe(code);
    });

    it('fails loudly rather than returning exit 0 for an injected valid state without a manifest', () => {
        const malformed = { state: 'valid' } as unknown as PlanValidationReport;
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
        expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
    });

    it('rejects a valid report missing the required closureCommands collection', () => {
        const malformed = { ...valid, manifest: { ...valid.manifest, closureCommands: undefined } } as unknown as PlanValidationReport;
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
    });

    it.each(['requirements', 'sources', 'commands', 'slices', 'closureCommands'] as const)(
        'rejects a null %s entry before claiming complete ownership or exit 0', (collection) => {
            const malformed = {
                ...valid, manifest: { ...valid.manifest, [collection]: [null] },
            } as unknown as PlanValidationReport;
            expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
            expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
        },
    );

    it.each(['human', 'json'])('rejects a null manifest slice before %s output or exit 0', async (mode) => {
        const malformed = {
            ...valid, manifest: { ...valid.manifest, slices: [null] },
        } as unknown as PlanValidationReport;
        const args = ['node', 'awm', 'plan', 'validate', 'plan.md', ...(mode === 'json' ? ['--json'] : [])];
        await expect(commandFor(malformed).parseAsync(args)).rejects.toThrow('plan validator returned an invalid valid report');
        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
    });

    it('rejects an unowned requirement before claiming complete ownership or exit 0', () => {
        const malformed = { ...valid, manifest: { ...valid.manifest, requirements: [...valid.manifest.requirements, 'R4-VAL-5'] } };
        expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
    });

    it('rejects a requirement owned by two slices', () => {
        const malformed = {
            ...valid, manifest: { ...valid.manifest, slices: [...valid.manifest.slices, {
                ...valid.manifest.slices[0], id: 'S2', requirements: ['R4-VAL-1'],
            }] },
        };
        expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
    });

    it.each(['requirements', 'sources', 'commands', 'slices', 'closureCommands'] as const)(
        'rejects an empty %s collection in an injected valid report', (collection) => {
            const malformed = {
                ...valid, manifest: { ...valid.manifest, [collection]: [] },
            } as unknown as PlanValidationReport;
            expect(() => formatReport(malformed, 'plan.md')).toThrow('plan validator returned an invalid valid report');
            expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid valid report');
        },
    );

    it('fails loudly for a migration state without its required reason at the public exit boundary', () => {
        const malformed = { state: 'migration-required' } as unknown as PlanValidationReport;
        expect(() => exitCodeFor(malformed)).toThrow('plan validator returned an invalid migration reason');
    });

    it('fails loudly for an invalid validator dependency', () => {
        expect(() => registerPlanCommand(new Command(), {} as never)).toThrow('validatePlanFile must be a function');
    });
});
