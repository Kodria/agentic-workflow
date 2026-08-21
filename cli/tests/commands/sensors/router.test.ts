jest.mock('@clack/prompts', () => ({ log: { success: jest.fn(), info: jest.fn() } }));
jest.mock('picocolors', () => ({ green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s }));
jest.mock('../../../src/commands/sensors/run', () => ({ runSensors: jest.fn().mockReturnValue({ sensors: [], overall: 'pass' }) }));
jest.mock('../../../src/commands/sensors/init', () => ({ initSensors: jest.fn().mockReturnValue({ detection: { pack: 'js-ts', indicators: [] }, manifest: { sensors: {} }, configured: [] }) }));
jest.mock('../../../src/commands/sensors/status', () => ({ computeSensorStatus: jest.fn().mockReturnValue({ overall: 'READY', pack: 'js-ts', checks: {} }) }));
jest.mock('../../../src/commands/sensors/install', () => ({ installSensorHook: jest.fn().mockReturnValue({ status: 'installed' }) }));

import { Command } from 'commander';
import { registerSensorsCommand } from '../../../src/commands/sensors/index';

describe('registerSensorsCommand', () => {
    it('keeps existing sensor subcommands and adds coverage', () => {
        const program = new Command();
        registerSensorsCommand(program);
        const cmd = program.commands.find(c => c.name() === 'sensors');
        expect(cmd).toBeDefined();
        const subNames = cmd!.commands.map(c => c.name());
        expect(subNames).toContain('run');
        expect(subNames).toContain('init');
        expect(subNames).toContain('status');
        expect(subNames).toContain('install');
        expect(subNames).toContain('coverage');
    });

    it('renders READY without claiming sensor execution, HEALTHY, or project certification', async () => {
        const program = new Command();
        const output = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            registerSensorsCommand(program);
            await program.parseAsync(['node', 'awm', 'sensors', 'status']);
            const rendered = output.mock.calls.flat().join('\n');
            expect(rendered).toContain('READY');
            expect(rendered).not.toMatch(/HEALTHY|certif/i);
        } finally {
            output.mockRestore();
        }
    });
});
