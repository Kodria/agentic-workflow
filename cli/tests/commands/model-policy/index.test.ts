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
});
