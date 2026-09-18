import { Command } from 'commander';
import { registerModelPolicyCommand } from '../../../src/commands/model-policy';

const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

describe('model-policy command', () => {
    beforeEach(() => { jest.clearAllMocks(); process.exitCode = undefined; });
    afterAll(() => out.mockRestore());
    it('emits a read-only protocol contract as JSON', async () => {
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program);
        await program.parseAsync(['node', 'awm', 'model-policy', 'contract', '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({
            schema: 'routing-protocol/v1',
            supportedPlanSchemas: ['compact-slices/v1', 'compact-slices/v2'],
            implementerProfiles: ['mechanical', 'integration', 'judgment'],
            limits: { maxFileBytes: 262144 },
        });
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
    it('reports receipt provenance in status and rejects stale receipt state', async () => {
        const readCapabilities = jest.fn(() => ({ state: 'stale' as const, reason: 'expired' })); const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { readEffectivePolicy: () => ({ state: 'absent' }), readCapabilities });
        await program.parseAsync(['node', 'awm', 'model-policy', 'status', '--provider', 'codex', '--runtime-kind', 'native', '--runtime-version', '1.0.0', '--account-scope-digest', 'a'.repeat(64), '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ policy: { state: 'absent' }, capability: { state: 'stale' } }); expect(process.exitCode).toBe(2);
    });
    it('rejects an empty replacement digest for capability approval at the command boundary', async () => {
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { approveCapabilities: jest.fn() as any });
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'capabilities', 'approve', '--file', 'receipt.json', '--expected-digest', 'a'.repeat(64), '--replace-digest', ''])).rejects.toThrow(/requires a non-empty value/);
    });
});
