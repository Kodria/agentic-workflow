jest.mock('@clack/prompts', () => ({ log: { success: jest.fn(), info: jest.fn(), error: jest.fn() } }));
jest.mock('picocolors', () => ({ green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s }));
jest.mock('../../../src/commands/sensors/run', () => ({ runSensors: jest.fn() }));
jest.mock('../../../src/commands/sensors/init', () => ({ initSensors: jest.fn() }));
jest.mock('../../../src/commands/sensors/status', () => ({ computeSensorStatus: jest.fn() }));
jest.mock('../../../src/commands/sensors/install', () => ({ installSensorHook: jest.fn() }));
jest.mock('../../../src/commands/sensors/baseline', () => ({ buildBaseline: jest.fn(), writeBaseline: jest.fn() }));
jest.mock('../../../src/core/registries', () => ({ capabilityRoot: jest.fn(() => '/mock/registry') }));
jest.mock('../../../src/commands/sensors/coverage', () => ({ runCoverage: jest.fn() }));
jest.mock('../../../src/commands/sensors/coverage/render', () => ({ renderCoverageHuman: jest.fn(), renderCoverageJson: jest.fn() }));

import { Command } from 'commander';
import { log } from '@clack/prompts';
import { runCoverage } from '../../../src/commands/sensors/coverage';
import { renderCoverageHuman, renderCoverageJson } from '../../../src/commands/sensors/coverage/render';
import { parsePositiveSafeInteger, registerSensorsCommand } from '../../../src/commands/sensors/index';
import { exitCodeForVerdict } from '../../../src/commands/sensors/verdict';

const processExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

describe('exitCodeForVerdict — sensor run verdict → exit code', () => {
    it.each([
        ['pass', 0],
        ['fail', 1],
        ['skipped', 1],
        ['not_certified', 1],
    ] as const)('%s → %i', (overall, code) => {
        expect(exitCodeForVerdict(overall)).toBe(code);
    });
});

describe('sensors run Commander wiring', () => {
    const originalExitCode = process.exitCode;

    beforeEach(() => {
        jest.clearAllMocks();
        process.exitCode = undefined;
    });

    afterAll(() => {
        process.exitCode = originalExitCode;
    });

    const programWithSensors = (): Command => {
        const program = new Command();
        program.exitOverride();
        registerSensorsCommand(program);
        return program;
    };

    it.each([
        ['pass', 0],
        ['fail', 1],
        ['skipped', 1],
        ['not_certified', 1],
    ] as const)('writes full %s JSON before assigning exit code %i without process.exit', async (overall, code) => {
        (require('../../../src/commands/sensors/run').runSensors as jest.Mock).mockResolvedValue({ sensors: [], overall });
        const calls: string[] = [];
        stdoutWrite.mockImplementation(() => {
            calls.push(`stdout:${process.exitCode ?? 0}`);
            return true;
        });

        await programWithSensors().parseAsync(['node', 'awm', 'sensors', 'run']);

        expect(JSON.parse(String(stdoutWrite.mock.calls[0][0]))).toEqual({ sensors: [], overall });
        expect(calls).toEqual(['stdout:0']);
        expect(process.exitCode).toBe(code);
        expect(processExit).not.toHaveBeenCalled();
    });
});

describe('sensors coverage Commander wiring', () => {
    const report = { schemaVersion: 1 as const, pack: 'js-ts', registry: 'baseline', overall: 'gaps' as const,
        static: { status: 'gaps' as const, reason: null, classes: [] } };

    beforeEach(() => {
        jest.clearAllMocks();
        (runCoverage as jest.Mock).mockReturnValue(report);
        (renderCoverageHuman as jest.Mock).mockReturnValue('human\n');
        (renderCoverageJson as jest.Mock).mockReturnValue('json\n');
    });

    afterAll(() => {
        stdoutWrite.mockRestore();
        processExit.mockRestore();
    });

    const programWithSensors = (): Command => {
        const program = new Command();
        program.exitOverride();
        registerSensorsCommand(program);
        return program;
    };

    it('registers sensors coverage with --json and emits human output by default (R2.8)', async () => {
        const program = programWithSensors();
        const sensors = program.commands.find((command) => command.name() === 'sensors')!;
        const coverage = sensors.commands.find((command) => command.name() === 'coverage')!;
        expect(coverage.options.some((option) => option.long === '--json')).toBe(true);
        await program.parseAsync(['node', 'awm', 'sensors', 'coverage']);
        expect(renderCoverageHuman).toHaveBeenCalledWith(report);
        expect(stdoutWrite).toHaveBeenCalledWith('human\n');
    });

    it.each(['0', '-1', '1.5', '2x', 'Infinity', 'NaN', '9007199254740992'])('Commander rejects unsafe --min %s before coverage I/O (R5.5)', async (value) => {
        await expect(programWithSensors().parseAsync(['node', 'awm', 'sensors', 'coverage', '--min', value])).rejects.toThrow('--min must be a positive safe integer');
        expect(runCoverage).not.toHaveBeenCalled();
    });

    it('passes --min as a positive integer to coverage', async () => {
        await programWithSensors().parseAsync(['node', 'awm', 'sensors', 'coverage', '--min', '3']);
        expect(runCoverage).toHaveBeenCalledWith(process.cwd(), {}, { min: 3 });
    });

    it('emits JSON for --json and does not exit for gaps or inconclusive (R2.9)', async () => {
        for (const overall of ['gaps', 'inconclusive'] as const) {
            (runCoverage as jest.Mock).mockReturnValue({ ...report, overall, static: { ...report.static, status: overall } });
            await programWithSensors().parseAsync(['node', 'awm', 'sensors', 'coverage', '--json']);
        }
        expect(renderCoverageJson).toHaveBeenCalledTimes(2);
        expect(processExit).not.toHaveBeenCalled();
    });

    it('prints an actionable contract error and exits 1 (R2.7)', async () => {
        (runCoverage as jest.Mock).mockImplementation(() => { throw new Error('Invalid coverage contract at pack.json: schemaVersion expected 1'); });
        await programWithSensors().parseAsync(['node', 'awm', 'sensors', 'coverage']);
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('schemaVersion'));
        expect(processExit).toHaveBeenCalledWith(1);
    });
});
