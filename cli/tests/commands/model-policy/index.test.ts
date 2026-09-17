import { Command } from 'commander';
import { registerModelPolicyCommand } from '../../../src/commands/model-policy';

const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

describe('model-policy command', () => {
    beforeEach(() => { jest.clearAllMocks(); process.exitCode = undefined; });
    afterAll(() => out.mockRestore());
    it('emits a read-only protocol contract as JSON', async () => {
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program);
        await program.parseAsync(['node', 'awm', 'model-policy', 'contract', '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ schema: 'routing-protocol/v1', supportedPlanSchemas: ['compact-slices/v1'], limits: { maxFileBytes: 262144 } });
    });
    it('rejects missing values instead of silently accepting an incomplete approval', async () => {
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program);
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'approve', '--file', '--scope', 'user', '--expected-digest', 'a'.repeat(64)])).rejects.toThrow();
    });
    it('accepts and validates --cwd on contract, and resolves status through it', async () => {
        const readEffectivePolicy = jest.fn(() => ({ state: 'absent' as const }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { readEffectivePolicy });
        await program.parseAsync(['node', 'awm', 'model-policy', 'contract', '--cwd', 'fixture-root', '--json']);
        await program.parseAsync(['node', 'awm', 'model-policy', 'status', '--provider', 'codex', '--runtime-kind', 'native', '--runtime-version', '1.0.0', '--account-scope-digest', 'a'.repeat(64), '--cwd', 'fixture-root', '--json']);
        expect(readEffectivePolicy).toHaveBeenCalledWith('fixture-root');
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'contract', '--cwd', '--json'])).rejects.toThrow();
    });
});
