import { resolveSelection } from '../../../src/core/model-policy/resolve';
import type { ApprovedPolicy, CapabilityReceipt } from '../../../src/core/model-policy/types';

const sha = 'a'.repeat(64);
const selection = (id: string, value: string) => ({ selector: { kind: 'model' as const, id }, effort: { kind: 'explicit' as const, value } });
const policy = (): ApprovedPolicy => ({ schema: 'approved-model-policy/v1', content: { schema: 'model-policy/v1', mappings: [{ target: 'codex', runtimeKind: 'native', profiles: { mechanical: selection('mechanical', 'low'), integration: selection('integration', 'medium'), judgment: selection('judgment', 'medium') }, fullCapability: selection('full', 'high'), degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false } }], implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } }, contentDigest: sha, approval: { approvedAt: '2026-09-17T00:00:00.000Z', approvalId: 'approval-1' }, lineage: { previousDigest: null } });
const capabilities = (): CapabilityReceipt => ({ schema: 'routing-capabilities/v1', runtime: { target: 'codex', kind: 'native', version: '1.0.0', accountScopeDigest: sha }, recordedAt: '2026-09-17T00:00:00.000Z', expiresAt: '2026-09-18T00:00:00.000Z', capabilities: { artifactDelivery: 'unverified', interactiveExecution: 'supported', unattendedController: 'supported', nativeSubagents: 'unverified', modelOverride: 'supported', effortOverride: 'supported', observedModelEvidence: 'supported', durableResume: 'unverified' }, availableSelections: [selection('mechanical', 'low'), selection('integration', 'medium'), selection('judgment', 'medium'), selection('full', 'high')], evidence: (['interactiveExecution', 'unattendedController', 'modelOverride', 'effortOverride', 'observedModelEvidence'] as const).map(capability => ({ capability, kind: 'native-control' as const, receiptDigest: sha })), approval: { approvalId: 'approval-1', snapshotDigest: sha } });
const input = () => ({ role: 'implementer' as const, requestedProfile: 'mechanical' as const, policy: policy(), capabilities: capabilities(), runtime: capabilities().runtime, now: new Date('2026-09-17T12:00:00.000Z') });

describe('resolveSelection', () => {
    it.each(['specification-reviewer', 'code-quality-reviewer', 'final-reviewer', 'architecture', 'track-a-qa', 'track-b-qa', 'controller', 'documentation', 'retro', 'finishing'] as const)('routes %s to full capability independently of requested profile', role => {
        const result = resolveSelection({ ...input(), role, requestedProfile: 'mechanical' });
        expect(result.state).toBe('resolved');
        if (result.state === 'resolved') expect(result.selection).toEqual(selection('full', 'high'));
    });
    it('blocks a receipt whose runtime account differs even when selections match', () => {
        const value = input(); value.runtime = { ...value.runtime, accountScopeDigest: 'b'.repeat(64) };
        expect(resolveSelection(value)).toMatchObject({ state: 'blocked', diagnostics: [{ code: 'ROUTING_CAPABILITY_RUNTIME_MISMATCH' }] });
    });
    it('blocks an unavailable approved selection instead of silently substituting', () => {
        const value = input(); value.capabilities.availableSelections = [selection('full', 'high')];
        expect(resolveSelection(value)).toMatchObject({ state: 'blocked', diagnostics: [{ code: 'ROUTING_SELECTION_UNAVAILABLE' }] });
    });
    it('degrades only to an attested matching full default when a missing override is approved', () => {
        const value = input(); value.policy.content.mappings[0].degradation.allowMissingModelOverride = true; value.capabilities.capabilities.modelOverride = 'unsupported'; value.capabilities.runtimeDefaultSelection = selection('full', 'high');
        expect(resolveSelection(value)).toMatchObject({ state: 'resolved', outcome: 'degraded', selection: selection('full', 'high') });
    });
    it('blocks missing override where its full default is not actually attested', () => {
        const value = input(); value.policy.content.mappings[0].degradation.allowMissingModelOverride = true; value.capabilities.capabilities.modelOverride = 'unsupported';
        expect(resolveSelection(value)).toMatchObject({ state: 'blocked', diagnostics: [{ code: 'ROUTING_MODEL_OVERRIDE_UNAVAILABLE' }] });
    });
});
