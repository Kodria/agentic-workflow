import fs from 'fs';
import os from 'os';
import path from 'path';
import { capabilityReceiptPath, readCapabilities, validateCapabilityReceipt } from '../../../src/core/model-policy/capabilities';
import type { CapabilityReceipt } from '../../../src/core/model-policy/types';

const digest = 'a'.repeat(64);
const receipt = (): CapabilityReceipt => ({
    schema: 'routing-capabilities/v1',
    runtime: { target: 'codex', kind: 'native', version: '1.0.0', accountScopeDigest: digest },
    recordedAt: '2026-09-17T00:00:00.000Z', expiresAt: '2026-09-18T00:00:00.000Z',
    capabilities: { artifactDelivery: 'unverified', interactiveExecution: 'supported', unattendedController: 'supported', nativeSubagents: 'unverified', modelOverride: 'supported', effortOverride: 'supported', observedModelEvidence: 'supported', durableResume: 'unverified' },
    availableSelections: [{ selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } }],
    runtimeDefaultSelection: { selector: { kind: 'model', id: 'full' }, effort: { kind: 'explicit', value: 'high' } },
    evidence: (['interactiveExecution', 'unattendedController', 'modelOverride', 'effortOverride', 'observedModelEvidence'] as const).map(capability => ({ capability, kind: 'native-control' as const, receiptDigest: digest })),
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
    it('reads absent capability state without creating operator storage', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-receipt-')); const prior = process.env.AWM_HOME; process.env.AWM_HOME = path.join(root, 'operator');
        try { expect(readCapabilities(receipt().runtime, new Date('2026-09-17T12:00:00.000Z'))).toEqual({ state: 'absent' }); expect(fs.existsSync(process.env.AWM_HOME!)).toBe(false); }
        finally { if (prior === undefined) delete process.env.AWM_HOME; else process.env.AWM_HOME = prior; fs.rmSync(root, { recursive: true, force: true }); }
    });
    it('uses only a validated target and runtime kind in its persistence path', () => {
        expect(capabilityReceiptPath(receipt().runtime)).toMatch(/routing-capabilities[\\/]codex[\\/]native\.json$/);
        expect(() => capabilityReceiptPath({ ...receipt().runtime, kind: '../native' } as any)).toThrow();
    });
});
