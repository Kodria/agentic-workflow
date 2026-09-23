import { routingSetupGuidance } from '../../../src/core/model-policy/setup-readiness';
import type { EffectivePolicy } from '../../../src/core/model-policy/types';
import { capabilityReceiptPath } from '../../../src/core/model-policy/capabilities';
import fs from 'fs';
import os from 'os';
import path from 'path';

const approved: EffectivePolicy = {
    state: 'approved', provenance: 'user',
    policy: { schema: 'approved-model-policy/v1', contentDigest: 'a'.repeat(64), approval: { approvedAt: '2026-09-23T00:00:00.000Z', approvalId: 'test' }, lineage: { previousDigest: null },
        content: { schema: 'model-policy/v1', implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] }, mappings: [
            { target: 'codex', runtimeKind: 'native', profiles: {} as never, fullCapability: {} as never, degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } },
        ] } },
};

describe('routing setup guidance', () => {
    it('does not demand machine setup when routing policy is absent', () => {
        expect(routingSetupGuidance({ state: 'absent' })).toEqual([]);
    });
    it('names the exact provider and explicit discovery step without certifying the receipt', () => {
        expect(routingSetupGuidance(approved)).toEqual([
            { target: 'codex', runtimeKind: 'native', state: 'needs-evidence', command: 'awm model-policy discover --provider codex --json' },
        ]);
    });
    it('reports invalid policy instead of silently falling back to a machine default', () => {
        expect(routingSetupGuidance({ state: 'invalid', provenance: 'project', reason: 'bad digest' })).toEqual([
            { state: 'policy-invalid', reason: 'bad digest' },
        ]);
    });
    it('does not keep nudging when a valid local receipt exists; runtime matching remains a separate gate', () => {
        const previous = process.env.AWM_HOME;
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-routing-setup-'));
        process.env.AWM_HOME = root;
        try {
            const runtime = { target: 'codex' as const, kind: 'native', version: '1.0.0', accountScopeDigest: 'b'.repeat(64) };
            const destination = capabilityReceiptPath(runtime);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            const receipt = {
                schema: 'routing-capabilities/v1', runtime,
                recordedAt: '2026-09-23T19:00:00.000Z', expiresAt: '2026-09-24T19:00:00.000Z',
                capabilities: { artifactDelivery: 'unverified', interactiveExecution: 'unverified', unattendedController: 'unverified', nativeSubagents: 'unverified', modelOverride: 'unverified', effortOverride: 'unverified', observedModelEvidence: 'unverified', durableResume: 'unverified' },
                availableSelections: [{ selector: { kind: 'model', id: 'gpt-6-sol' }, effort: { kind: 'explicit', value: 'medium' } }],
                evidence: [], approval: { approvalId: 'test', snapshotDigest: 'a'.repeat(64) },
            };
            fs.writeFileSync(destination, JSON.stringify(receipt));
            expect(routingSetupGuidance(approved, new Date('2026-09-23T19:30:00.000Z'))).toHaveLength(1);
            receipt.capabilities.nativeSubagents = 'supported';
            receipt.capabilities.modelOverride = 'supported';
            receipt.capabilities.effortOverride = 'supported';
            receipt.capabilities.observedModelEvidence = 'supported';
            receipt.evidence = ['nativeSubagents', 'modelOverride', 'effortOverride', 'observedModelEvidence'].map(capability => ({ capability, kind: 'native-dispatch', receiptDigest: 'b'.repeat(64) })) as never;
            fs.writeFileSync(destination, JSON.stringify(receipt));
            expect(routingSetupGuidance(approved, new Date('2026-09-23T19:30:00.000Z'))).toEqual([]);
        } finally {
            if (previous === undefined) delete process.env.AWM_HOME;
            else process.env.AWM_HOME = previous;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
