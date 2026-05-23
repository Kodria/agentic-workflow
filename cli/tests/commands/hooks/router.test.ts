import { Command } from 'commander';

// @clack/prompts ships as ESM; mock it so Jest (CommonJS mode) can load the router
jest.mock('@clack/prompts', () => ({
    confirm: jest.fn(),
    isCancel: jest.fn(),
}));

// Mock heavy dependencies that are not needed to verify command registration
jest.mock('../../../src/utils/config', () => ({
    getPreferences: jest.fn(() => ({ installMethod: 'symlink', defaultAgent: 'claude-code', defaultScope: 'global' })),
}));
jest.mock('../../../src/commands/hooks/install', () => ({ installHook: jest.fn() }));
jest.mock('../../../src/commands/hooks/uninstall', () => ({ uninstallHook: jest.fn() }));
jest.mock('../../../src/commands/hooks/status', () => ({ computeHookStatus: jest.fn() }));

describe('hooks command router', () => {
    it('registers install, uninstall, and status subcommands', () => {
        const program = new Command();
        const { registerHooksCommand } = require('../../../src/commands/hooks');
        registerHooksCommand(program);

        const hooks = program.commands.find((c: any) => c.name() === 'hooks');
        expect(hooks).toBeDefined();
        const subNames = hooks!.commands.map((c: any) => c.name());
        expect(subNames).toEqual(expect.arrayContaining(['install', 'uninstall', 'status']));
    });
});
