jest.mock('@clack/prompts', () => ({ log: { success: jest.fn(), info: jest.fn() } }));
jest.mock('picocolors', () => ({ green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s }));
jest.mock('../../../src/commands/sensors/run', () => ({ runSensors: jest.fn().mockReturnValue({ sensors: [], overall: 'pass' }) }));
jest.mock('../../../src/commands/sensors/init', () => ({ initSensors: jest.fn().mockReturnValue({ detection: { pack: 'js-ts', indicators: [] }, manifest: { sensors: {} }, configured: [] }) }));
jest.mock('../../../src/commands/sensors/status', () => ({ computeSensorStatus: jest.fn().mockReturnValue({ overall: 'HEALTHY', pack: 'js-ts', checks: {} }) }));
jest.mock('../../../src/commands/sensors/install', () => ({ installSensorHook: jest.fn().mockReturnValue({ status: 'installed' }) }));

import { Command } from 'commander';
import { registerSensorsCommand } from '../../../src/commands/sensors/index';

describe('registerSensorsCommand', () => {
    it('registers sensors command with 4 subcommands', () => {
        const program = new Command();
        registerSensorsCommand(program);
        const cmd = program.commands.find(c => c.name() === 'sensors');
        expect(cmd).toBeDefined();
        const subNames = cmd!.commands.map(c => c.name());
        expect(subNames).toContain('run');
        expect(subNames).toContain('init');
        expect(subNames).toContain('status');
        expect(subNames).toContain('install');
    });
});
