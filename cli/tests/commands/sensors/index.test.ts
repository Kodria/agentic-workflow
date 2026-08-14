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
import { exitCodeFor, parsePositiveSafeInteger, registerSensorsCommand, RunOutputLike } from '../../../src/commands/sensors/index';

describe('exitCodeFor — sensor run verdict → exit code', () => {
    const base = (overall: RunOutputLike['overall']): RunOutputLike => ({ sensors: [], overall });
    it('pass → 0', () => expect(exitCodeFor(base('pass'))).toBe(0));
    it('skipped → 0', () => expect(exitCodeFor(base('skipped'))).toBe(0));
    it('not_certified → 0 (signal is in overall, not exit code)', () =>
        expect(exitCodeFor(base('not_certified'))).toBe(0));
    it('fail → 1', () => expect(exitCodeFor(base('fail'))).toBe(1));
});

describe('sensors coverage Commander wiring', () => {
    const report = { schemaVersion: 1 as const, pack: 'js-ts', registry: 'baseline', overall: 'gaps' as const,
        static: { status: 'gaps' as const, reason: null, classes: [] } };
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const processExit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

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
