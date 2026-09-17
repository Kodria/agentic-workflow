import { validateCapabilityReceipt } from '../../../src/core/model-policy/capabilities';

const digest = 'a'.repeat(64);
const receipt = () => ({
    schema: 'routing-capabilities/v1',
    runtime: { target: 'codex', kind: 'native', version: '1.0.0', accountScopeDigest: digest },
    recordedAt: '2026-09-17T00:00:00.000Z', expiresAt: '2026-09-18T00:00:00.000Z',
    capabilities: { artifactDelivery: 'unverified', interactiveExecution: 'supported', unattendedController: 'supported', nativeSubagents: 'unverified', modelOverride: 'supported', effortOverride: 'supported', observedModelEvidence: 'supported', durableResume: 'unverified' },
    availableSelections: [{ selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } }],
    runtimeDefaultSelection: { selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } },
    evidence: ['interactiveExecution', 'unattendedController', 'modelOverride', 'effortOverride', 'observedModelEvidence'].map(capability => ({ capability, kind: 'native-control', receiptDigest: digest })),
    approval: { approvalId: 'approval-1', snapshotDigest: digest },
});

describe('capability receipt validation', () => {
    it('accepts an exhaustive explicit native attestation', () => {
        expect(validateCapabilityReceipt(receipt())).toMatchObject({ runtime: { target: 'codex', kind: 'native' } });
    });
    it.each([
        ['renderer-only supported evidence', () => { const value = receipt(); value.evidence[0].kind = 'unsupported'; return value; }],
        ['expiry greater than 24 hours', () => { const value = receipt(); value.expiresAt = '2026-09-18T00:00:00.001Z'; return value; }],
        ['missing capability field', () => { const value = receipt(); delete (value.capabilities as any).effortOverride; return value; }],
    ])('rejects %s', (_name, make) => expect(() => validateCapabilityReceipt(make())).toThrow());
});
