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
    it('discovers the Codex catalog explicitly without approving capabilities', async () => {
        const queryCodexModelCatalog = jest.fn(async () => ({ provenance: 'native-catalog' as const, selections: [], nativeDispatchVerified: false as const, actualModelVerified: false as const }));
        const approveCapabilities = jest.fn();
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { queryCodexModelCatalog, approveCapabilities: approveCapabilities as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'discover', '--provider', 'codex', '--json']);
        expect(queryCodexModelCatalog).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'catalog-only', nativeDispatchVerified: false, actualModelVerified: false });
        expect(approveCapabilities).not.toHaveBeenCalled();
    });
    it('reports missing machine selections from the approved Codex policy without certifying dispatch', async () => {
        const available = { selector: { kind: 'model' as const, id: 'gpt-6-sol' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const missing = { selector: { kind: 'model' as const, id: 'gpt-6-luna' }, effort: { kind: 'explicit' as const, value: 'low' } };
        const queryCodexModelCatalog = jest.fn(async () => ({ provenance: 'native-catalog' as const, selections: [available], nativeDispatchVerified: false as const, actualModelVerified: false as const }));
        const readEffectivePolicy = jest.fn(() => ({ state: 'approved' as const, policy: { content: { mappings: [{ target: 'codex', runtimeKind: 'native', profiles: { mechanical: missing, integration: available, judgment: available }, fullCapability: available }] } } }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { queryCodexModelCatalog, readEffectivePolicy: readEffectivePolicy as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'discover', '--provider', 'codex', '--cwd', 'fixture-root', '--json']);
        expect(readEffectivePolicy).toHaveBeenCalledWith('fixture-root');
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'catalog-only', policyCoverage: { state: 'missing', missing: [missing] }, nativeDispatchVerified: false, actualModelVerified: false });
        expect(process.exitCode).toBe(2);
    });
    it('reports catalog coverage but still refuses to claim native dispatch or backend identity', async () => {
        const selection = { selector: { kind: 'model' as const, id: 'gpt-6-sol' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const queryCodexModelCatalog = jest.fn(async () => ({ provenance: 'native-catalog' as const, selections: [selection], nativeDispatchVerified: false as const, actualModelVerified: false as const }));
        const readEffectivePolicy = jest.fn(() => ({ state: 'approved' as const, policy: { content: { mappings: [{ target: 'codex', runtimeKind: 'native', profiles: { mechanical: selection, integration: selection, judgment: selection }, fullCapability: selection }] } } }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { queryCodexModelCatalog, readEffectivePolicy: readEffectivePolicy as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'discover', '--provider', 'codex', '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'catalog-only', policyCoverage: { state: 'complete', missing: [] }, nativeDispatchVerified: false, actualModelVerified: false });
    });
    it('does not silently treat Claude as Codex during native discovery', async () => {
        const queryCodexModelCatalog = jest.fn();
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { queryCodexModelCatalog });
        await program.parseAsync(['node', 'awm', 'model-policy', 'discover', '--provider', 'claude-code', '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'unverified', provider: 'claude-code' });
        expect(queryCodexModelCatalog).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(2);
    });
    it('reports every Codex selection and the full fallback as unverified without dispatch', async () => {
        const cheap = { selector: { kind: 'model' as const, id: 'gpt-6-sol' }, effort: { kind: 'explicit' as const, value: 'low' } };
        const full = { selector: { kind: 'model' as const, id: 'gpt-6-astra' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const queryCodexModelCatalog = jest.fn(async () => ({ provenance: 'native-catalog' as const, selections: [cheap, full], nativeDispatchVerified: false as const, actualModelVerified: false as const }));
        const queryCodexMachineFacts = jest.fn(async () => ({ provenance: 'codex-app-server-config-account' as const, configDigest: 'c'.repeat(64), accountState: 'identified' as const, accountScopeDigest: 'a'.repeat(64), inferenceDispatched: false as const }));
        const queryRuntimeExecutable = jest.fn(async () => ({ version: '0.156.0', binaryDigest: 'b'.repeat(64), inferenceDispatched: false as const }));
        const ensureMachineKey = jest.fn(() => Buffer.alloc(32, 7));
        const readEffectivePolicy = jest.fn(() => ({ state: 'approved' as const, policy: { content: { mappings: [{ target: 'codex', runtimeKind: 'native', profiles: { mechanical: cheap, integration: cheap, judgment: full }, fullCapability: full, degradation: { allowMissingObservedIdentity: false } }] } } }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { queryCodexModelCatalog, queryCodexMachineFacts, queryRuntimeExecutable, ensureMachineKey, readEffectivePolicy: readEffectivePolicy as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'setup', '--provider', 'codex', '--json']);
        const report = JSON.parse(String(out.mock.calls[0][0]));
        expect(report).toMatchObject({ state: 'setup-pending', provider: 'codex', inferenceDispatched: false, tokenUsage: 'unknown', nativeDispatchVerified: false, actualModelVerified: false,
            machine: { runtimeVersion: '0.156.0', binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64), accountState: 'identified', accountScopeDigest: 'a'.repeat(64) } });
        expect(report.selections).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'mechanical', catalogAvailable: true, dispatch: 'untested' }),
            expect.objectContaining({ role: 'fullCapability', catalogAvailable: true, dispatch: 'untested' }),
        ]));
        expect(report.policyAction).toMatch(/allowMissingObservedIdentity/);
        expect(queryCodexModelCatalog).toHaveBeenCalledTimes(1);
        expect(queryCodexMachineFacts).toHaveBeenCalledTimes(1);
        expect(queryRuntimeExecutable).toHaveBeenCalledTimes(1);
        expect(ensureMachineKey).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBe(2);
    });
    it('never runs inference merely because setup was requested', async () => {
        const queryCodexModelCatalog = jest.fn();
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { queryCodexModelCatalog });
        await expect(program.parseAsync(['node', 'awm', 'model-policy', 'setup', '--provider', 'codex', '--allow-inference'])).rejects.toThrow(/unknown option/i);
        expect(queryCodexModelCatalog).not.toHaveBeenCalled();
    });
    it('captures only an approved Codex selection from an existing native child, with local scope', async () => {
        const selected = { selector: { kind: 'model' as const, id: 'gpt-6-luna' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const mapping = { target: 'codex', runtimeKind: 'native', profiles: { mechanical: selected, integration: selected, judgment: selected }, fullCapability: selected,
            degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: true } };
        const queryCodexChildThreadObservation = jest.fn(async () => ({ configuredSelection: selected, childRuntimeVersion: '0.156.1', observedAt: '2026-09-23T01:00:00.000Z' }));
        const publishCodexObservation = jest.fn(() => ({ schema: 'routing-capabilities/v2', claims: [{ selection: selected }] }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { readEffectivePolicy: (() => ({ state: 'approved', policy: { content: { mappings: [mapping] } } })) as never,
            queryCodexChildThreadObservation: queryCodexChildThreadObservation as never, publishCodexObservation: publishCodexObservation as never,
            queryCodexMachineFacts: (async () => ({ configDigest: 'c'.repeat(64), accountScopeDigest: 'a'.repeat(64), accountState: 'identified' })) as never,
            queryRuntimeExecutable: (async () => ({ version: '0.156.1', binaryDigest: 'b'.repeat(64) })) as never,
            ensureMachineKey: (() => Buffer.alloc(32, 7)) as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'capture', '--provider', 'codex', '--runtime-kind', 'native', '--parent-thread-id', 'parent-1', '--child-thread-id', 'child-1', '--json']);
        expect(queryCodexChildThreadObservation).toHaveBeenCalledWith(expect.objectContaining({ parentThreadId: 'parent-1', childThreadId: 'child-1' }));
        expect(publishCodexObservation).toHaveBeenCalledWith(expect.objectContaining({ expectedSelection: selected,
            scope: { runtime: { target: 'codex', kind: 'native', version: '0.156.1', accountScopeDigest: 'a'.repeat(64) }, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) } }));
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'captured', actualModelVerified: false, tokenUsage: 'unknown' });
    });
    it('reports a matching event-scoped enrollment as ready after 25 hours without refreshing it', async () => {
        const selected = { selector: { kind: 'model' as const, id: 'gpt-6-luna' }, effort: { kind: 'explicit' as const, value: 'high' } };
        const mapping = { target: 'codex', runtimeKind: 'native', profiles: { mechanical: selected, integration: selected, judgment: selected }, fullCapability: selected,
            degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: true } };
        const { createHash } = await import('crypto');
        const mappingDigest = createHash('sha256').update(JSON.stringify({ target: mapping.target, runtimeKind: mapping.runtimeKind, selection: selected })).digest('hex');
        const receipt = { schema: 'routing-capabilities/v2', runtime: { target: 'codex', kind: 'native', version: '0.156.1', accountScopeDigest: 'a'.repeat(64) },
            binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64), recordedAt: '2026-09-22T01:00:00.000Z', claims: [{ selection: selected, mappingDigest,
                eventDigest: 'e'.repeat(64), source: 'codex-turn-context', observedAt: '2026-09-22T00:59:00.000Z', actualModel: 'unverified', tokenUsage: 'unknown' }] };
        const readStoredEventReceipt = jest.fn(() => ({ state: 'present' as const, receipt }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { readEffectivePolicy: (() => ({ state: 'approved', policy: { content: { mappings: [mapping] } } })) as never,
            readStoredEventReceipt: readStoredEventReceipt as never,
            queryCodexModelCatalog: (async () => ({ selections: [selected] })) as never,
            queryCodexMachineFacts: (async () => ({ configDigest: 'c'.repeat(64), accountScopeDigest: 'a'.repeat(64), accountState: 'identified' })) as never,
            queryRuntimeExecutable: (async () => ({ version: '0.156.1', binaryDigest: 'b'.repeat(64) })) as never,
            ensureMachineKey: (() => Buffer.alloc(32, 7)) as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'setup', '--provider', 'codex', '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'ready-operational', selections: expect.arrayContaining([expect.objectContaining({ dispatch: 'verified', acceptedSelection: 'verified', actualModel: 'untested' })]) });
        expect(readStoredEventReceipt).toHaveBeenCalledTimes(1);
        expect(process.exitCode).toBeUndefined();
    });
    it('discovers Claude version and account without claiming a model or dispatch', async () => {
        const selected = { selector: { kind: 'model' as const, id: 'claude-sonnet-4-6' }, effort: { kind: 'runtime-default' as const } };
        const mapping = { target: 'claude-code', runtimeKind: 'native', profiles: { mechanical: selected, integration: selected, judgment: selected }, fullCapability: selected,
            degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } };
        const queryClaudeAuthStatus = jest.fn(async () => ({ accountState: 'identified' as const, accountScopeDigest: 'a'.repeat(64), inferenceDispatched: false as const }));
        const queryRuntimeExecutable = jest.fn(async () => ({ version: '2.1.263', binaryDigest: 'b'.repeat(64), inferenceDispatched: false as const }));
        const program = new Command(); program.exitOverride(); program.configureOutput({ writeErr: () => undefined });
        registerModelPolicyCommand(program, { readEffectivePolicy: (() => ({ state: 'approved', policy: { content: { mappings: [mapping] } } })) as never,
            queryClaudeAuthStatus: queryClaudeAuthStatus as never, queryRuntimeExecutable: queryRuntimeExecutable as never,
            readClaudeModelConfigDigest: (() => 'c'.repeat(64)) as never,
            ensureMachineKey: (() => Buffer.alloc(32, 7)) as never });
        await program.parseAsync(['node', 'awm', 'model-policy', 'setup', '--provider', 'claude-code', '--json']);
        expect(JSON.parse(String(out.mock.calls[0][0]))).toMatchObject({ state: 'setup-pending', provider: 'claude-code', machine: { runtimeVersion: '2.1.263', accountState: 'identified', configState: 'local-fingerprint' },
            nativeDispatchVerified: false, actualModelVerified: false, inferenceDispatched: false });
        expect(queryClaudeAuthStatus).toHaveBeenCalledTimes(1);
    });
});
