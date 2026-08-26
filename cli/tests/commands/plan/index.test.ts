import { Command } from 'commander';
import type { PlanValidationReport } from '../../../src/core/plan/types';
import { exitCodeFor, registerPlanCommand } from '../../../src/commands/plan';

const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

const valid: PlanValidationReport = {
    state: 'valid', schema: 'compact-slices/v1', manifest: {
        schema: 'compact-slices/v1', planId: 'r4-plan', requirements: ['R4-VAL-1', 'R4-VAL-4'],
        sources: [], commands: [], slices: [], closureCommands: [],
    },
};
const invalid: Extract<PlanValidationReport, { state: 'invalid' }> = {
    state: 'invalid', diagnostics: [{ code: 'PLAN_MARKERS', message: 'compact markers must occur once in order' }],
};
const unsupported: Extract<PlanValidationReport, { state: 'unsupported' }> = {
    state: 'unsupported', schema: 'compact-slices/v2', diagnostics: [{ code: 'PLAN_UNSUPPORTED_SCHEMA', message: 'unsupported compact plan schema; update the CLI' }],
};

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
            'Plan validation: valid "plans/r4.md" (compact-slices/v1; 0 slices; 2 requirements; complete ownership)\n',
        );
        expect(process.exitCode).toBe(0);
    });

    it('emits one stable JSON object without an update banner', async () => {
        await commandFor(valid).parseAsync(['node', 'awm', 'plan', 'validate', 'plans/r4.md', '--json']);

        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toEqual({
            state: 'valid', path: 'plans/r4.md', schema: 'compact-slices/v1', planId: 'r4-plan',
            requirements: 2, sources: 0, commands: 0, slices: 0, completeOwnership: true,
        });
        expect(String(stdoutWrite.mock.calls[0][0])).not.toContain('update');
    });

    it('keeps a legacy plan on the existing full-quality path with exit 0', async () => {
        await commandFor({ state: 'legacy' }).parseAsync(['node', 'awm', 'plan', 'validate', 'legacy.md']);

        expect(String(stdoutWrite.mock.calls[0][0])).toBe(
            'Plan validation: legacy "legacy.md" — existing full-quality path applies; compact optimization was not requested.\n',
        );
        expect(process.exitCode).toBe(0);
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
});

describe('plan validation public boundaries', () => {
    it.each([
        ['valid', valid, 0],
        ['legacy', { state: 'legacy' } as PlanValidationReport, 0],
        ['invalid', { state: 'invalid', diagnostics: [] } as PlanValidationReport, 2],
        ['unsupported', { state: 'unsupported', schema: 'compact-slices/v2', diagnostics: [] } as PlanValidationReport, 2],
    ])('maps %s reports to exit %i', (_state, report, code) => {
        expect(exitCodeFor(report)).toBe(code);
    });

    it('fails loudly for an invalid validator dependency', () => {
        expect(() => registerPlanCommand(new Command(), {} as never)).toThrow('validatePlanFile must be a function');
    });
});
