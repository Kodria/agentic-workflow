import fs from 'fs';
import path from 'path';
import { Command } from 'commander';

jest.mock('@clack/prompts', () => ({ log: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock('picocolors', () => ({ green: (value: string) => value, yellow: (value: string) => value, red: (value: string) => value }));

import { registerSensorsCommand } from '../../src/commands/sensors';
import { parseSensorManifest } from '../../src/commands/sensors/compatibility/manifest';

const root = path.resolve(__dirname, '../../..');

function bootstrapHelp(): string {
    const program = new Command().name('awm');
    registerSensorsCommand(program);
    const sensors = program.commands.find(command => command.name() === 'sensors')!;
    return sensors.commands.find(command => command.name() === 'bootstrap')!.helpInformation();
}

describe('Publication B portable bootstrap contract', () => {
    it('exposes the exact explicit bootstrap syntax', () => {
        const help = bootstrapHelp();
        expect(help).toContain('--mode <mode>');
        expect(help).toContain('--reason <text>');
        expect(help).toContain('--dry-run');
    });

    it('documents schema v3, explicit migration, dry-run, and environment separation', () => {
        const reference = fs.readFileSync(path.join(root, 'docs/cli-reference.md'), 'utf8');
        expect(reference).toContain('awm sensors bootstrap [--mode project-sensors|native-gate|opt-out] [--reason <text>] [--dry-run]');
        expect(reference).toContain('schemaVersion: 3');
        expect(reference).toContain('never writes');
        expect(reference).toContain('each environment updates its own AWM installation separately');
    });

    it('keeps all documented v3 declarations free of machine registry paths', () => {
        const reference = fs.readFileSync(path.join(root, 'docs/cli-reference.md'), 'utf8');
        const examples = Array.from(reference.matchAll(/```json\s*\n([\s\S]*?)```/g), match => JSON.parse(match[1]));
        const v3 = examples.filter(example => example?.schemaVersion === 3);
        expect(v3.length).toBeGreaterThan(0);
        v3.forEach(example => {
            expect(() => parseSensorManifest(example, 'documented v3 declaration')).not.toThrow();
            expect(JSON.stringify(example)).not.toMatch(/registryRoot|[A-Za-z]:\\\\|\/(?:Users|home|srv)\//);
        });
    });
});
