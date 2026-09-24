import { queryLocalClaudeScope } from '../../../src/core/model-policy/local-claude-scope';

describe('Claude local scope', () => {
    const key = Buffer.alloc(32, 2);
    const deps = {
        readRoutingHookStatus: () => ({ state: 'absent' as const }),
        readMachineKey: () => key,
        queryClaudeAuthStatus: async () => ({ provenance: 'claude-auth-status' as const, accountState: 'identified' as const,
            accountScopeDigest: 'a'.repeat(64), inferenceDispatched: false as const }),
        queryRuntimeExecutable: async () => ({ version: '2.1.0', binaryDigest: 'b'.repeat(64), inferenceDispatched: false as const }),
        readClaudeModelConfigDigest: () => 'c'.repeat(64),
    };
    it('assembles native account/runtime and local model config without inference', async () => {
        await expect(queryLocalClaudeScope('/tmp/project', 'native', deps)).resolves.toEqual({ state: 'current', scope: {
            runtime: { target: 'claude-code', kind: 'native', version: '2.1.0', accountScopeDigest: 'a'.repeat(64) },
            binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64),
        } });
    });
    it('fails closed without machine key or stable account identity', async () => {
        await expect(queryLocalClaudeScope('/tmp/project', 'native', { ...deps, readMachineKey: () => null })).resolves.toEqual({ state: 'unverified', reason: 'MACHINE_KEY_MISSING' });
        await expect(queryLocalClaudeScope('/tmp/project', 'native', { ...deps, queryClaudeAuthStatus: async () => ({
            provenance: 'claude-auth-status', accountState: 'unverified', accountScopeDigest: null, inferenceDispatched: false,
        }) })).resolves.toEqual({ state: 'unverified', reason: 'ACCOUNT_UNVERIFIED' });
    });
    it('blocks dispatch after a hook failure while allowing a real native stop to recover', async () => {
        const failed = { ...deps, readRoutingHookStatus: () => ({ state: 'failed' as const, failures: [{ phase: 'stop' as const, reasonCode: 'HOOK_TRANSCRIPT_UNVERIFIED', count: 1 }] }) };
        await expect(queryLocalClaudeScope('/tmp/project', 'native', failed)).resolves.toEqual({ state: 'unverified', reason: 'HOOK_CAPTURE_FAILED' });
        await expect(queryLocalClaudeScope('/tmp/project', 'native', { ...failed, requireHookHealthy: false })).resolves.toMatchObject({ state: 'current' });
    });
});
