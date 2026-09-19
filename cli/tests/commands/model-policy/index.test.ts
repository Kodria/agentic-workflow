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
    it('discloses the canonical digest through a read-only subcommand', async () => {
        const candidateDigest = jest.fn(() => ({ schema: 'model-policy/v1' as const, digest: 'b'.repeat(64) }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { candidateDigest });
        await program.parseAsync(['node', 'awm', 'model-policy', 'digest', '--file', 'policy.json', '--cwd', 'fixture-root', '--json']);
        expect(candidateDigest).toHaveBeenCalledWith({ file: 'policy.json', cwd: 'fixture-root' });
        expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual({ schema: 'model-policy/v1', digest: 'b'.repeat(64) });
    });
    it('takes no approval arguments on digest, so it cannot approve by accident', async () => {
        const candidateDigest = jest.fn(() => ({ schema: 'model-policy/v1' as const, digest: 'b'.repeat(64) }));
        const approvePolicy = jest.fn(); const approveCapabilities = jest.fn();
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { candidateDigest, approvePolicy: approvePolicy as never, approveCapabilities: approveCapabilities as never });
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'digest', '--file', 'policy.json', '--expected-digest', 'a'.repeat(64)])).rejects.toThrow();
        expect(approvePolicy).not.toHaveBeenCalled(); expect(approveCapabilities).not.toHaveBeenCalled();
    });
    it('rejects a missing or malformed --file on digest instead of digesting the flag', async () => {
        const candidateDigest = jest.fn(() => ({ schema: 'model-policy/v1' as const, digest: 'b'.repeat(64) }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { candidateDigest });
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'digest'])).rejects.toThrow();
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'digest', '--file', '--cwd'])).rejects.toThrow(/requires a non-empty value/);
        expect(candidateDigest).not.toHaveBeenCalled();
    });
    // This positive case is what the negative guard below could never establish.
    // While `capabilities approve` was registered as one command with a
    // positional `<approve>`, Commander handed the action (positional, options),
    // so `--file` read as undefined and EVERY invocation — well-formed ones
    // included — died on 'requires a non-empty value'. A suite that only
    // asserted that rejection was green against a command that could not
    // approve at all.
    it('reaches the capability approval with parsed options, not a positional', async () => {
        const approveCapabilities = jest.fn(() => ({ schema: 'routing-capabilities/v1' }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { approveCapabilities: approveCapabilities as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'capabilities', 'approve', '--file', 'receipt.json', '--expected-digest', 'a'.repeat(64), '--cwd', 'fixture-root', '--json']);
        expect(approveCapabilities).toHaveBeenCalledWith({ file: 'receipt.json', cwd: 'fixture-root', expectedDigest: 'a'.repeat(64), replaceDigest: undefined });
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'approved' });
    });
    it('rejects an unknown capabilities subcommand instead of treating it as an approval', async () => {
        const approveCapabilities = jest.fn();
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { approveCapabilities: approveCapabilities as never });
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'capabilities', 'revoke', '--file', 'receipt.json', '--expected-digest', 'a'.repeat(64)])).rejects.toThrow();
        expect(approveCapabilities).not.toHaveBeenCalled();
    });
    it('rejects an empty replacement digest for capability approval at the command boundary', async () => {
        const approveCapabilities = jest.fn();
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined }); registerModelPolicyCommand(program, { approveCapabilities: approveCapabilities as never });
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'capabilities', 'approve', '--file', 'receipt.json', '--expected-digest', 'a'.repeat(64), '--replace-digest', ''])).rejects.toThrow(/requires a non-empty value/);
        expect(approveCapabilities).not.toHaveBeenCalled();
    });
});
