import { resolveEventSelection, resolveEventWithFallback } from '../../../src/core/model-policy/resolve';
import { selectionPolicyDigest } from '../../../src/core/model-policy/selection-policy-digest';
import type { ApprovedPolicy } from '../../../src/core/model-policy/types';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const c = 'c'.repeat(64);
const selected = (id: string) => ({ selector: { kind: 'model' as const, id }, effort: { kind: 'explicit' as const, value: 'high' } });
const policy = (): ApprovedPolicy => ({ schema: 'approved-model-policy/v1', content: { schema: 'model-policy/v1', mappings: [{ target: 'codex', runtimeKind: 'native',
    profiles: { mechanical: selected('luna'), integration: selected('sol'), judgment: selected('astra') }, fullCapability: selected('astra'),
    degradation: { allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: true } }],
    implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] } },
    contentDigest: a, approval: { approvedAt: '2026-09-23T00:00:00.000Z', approvalId: 'owner' }, lineage: { previousDigest: null } });
const scope = () => ({ runtime: { target: 'codex' as const, kind: 'native', version: '0.156.1', accountScopeDigest: a }, binaryDigest: b, configDigest: c });
const receipt = () => ({ schema: 'routing-capabilities/v2', ...scope(), recordedAt: '2026-09-23T00:00:00.000Z', claims: ['luna', 'astra'].map(id => ({ selection: selected(id),
    mappingDigest: selectionPolicyDigest(policy().content.mappings[0], selected(id)), eventDigest: b, source: 'codex-turn-context',
    observedAt: '2026-09-22T23:59:00.000Z', actualModel: 'unverified', tokenUsage: 'unknown' })) });
const input = () => ({ role: 'implementer' as const, requestedProfile: 'mechanical' as const, policy: policy(), receipt: receipt(), scope: scope(), now: new Date('2026-09-24T01:00:00.000Z') });

describe('event-scoped routing resolution', () => {
    it('routes a proved selection after 25 hours but labels missing backend identity as degraded', () => {
        expect(resolveEventSelection(input())).toMatchObject({ state: 'resolved', selection: selected('luna'), outcome: 'degraded', unavailableEvidence: ['observedModelEvidence'] });
    });
    it('requires the full selection to be separately proved', () => {
        const value = input(); value.receipt.claims = value.receipt.claims.filter(item => item.selection.selector.id !== 'astra');
        expect(resolveEventSelection({ ...value, role: 'code-quality-reviewer' })).toMatchObject({ state: 'blocked', diagnostics: [{ code: 'ROUTING_SELECTION_UNENROLLED' }] });
    });
    it('blocks on account drift and when the owner did not permit missing backend identity', () => {
        expect(resolveEventSelection({ ...input(), scope: { ...scope(), runtime: { ...scope().runtime, accountScopeDigest: c } } })).toMatchObject({ state: 'blocked', diagnostics: [{ code: 'ROUTING_ACCOUNT_DRIFT' }] });
        const value = input(); value.policy.content.mappings[0].degradation.allowMissingObservedIdentity = false;
        expect(resolveEventSelection(value)).toMatchObject({ state: 'blocked' });
    });
    it('uses independently enrolled full capability when only the optimized selection is absent', () => {
        const value = input(); value.receipt.claims = value.receipt.claims.filter(item => item.selection.selector.id === 'astra');
        expect(resolveEventWithFallback(value)).toMatchObject({ state: 'resolved', selection: selected('astra'), effectiveProfile: 'full', outcome: 'degraded', fallbackReason: 'ROUTING_SELECTION_UNENROLLED' });
        const drift = { ...value, scope: { ...scope(), runtime: { ...scope().runtime, accountScopeDigest: c } } };
        expect(resolveEventWithFallback(drift)).toMatchObject({ state: 'blocked', diagnostics: [expect.objectContaining({ code: 'ROUTING_FALLBACK_UNAVAILABLE' })] });
    });
    it('trips a same-run circuit to full when a provider rejects an otherwise current optimized selection', () => {
        const value = input();
        expect(resolveEventSelection(value)).toMatchObject({ state: 'resolved', selection: selected('luna') });
        expect(resolveEventWithFallback({ ...value, circuitReason: 'PROVIDER_REJECTED' })).toMatchObject({ state: 'resolved', selection: selected('astra'), effectiveProfile: 'full', fallbackReason: 'PROVIDER_REJECTED' });
        value.receipt.claims = value.receipt.claims.filter(item => item.selection.selector.id !== 'astra');
        expect(resolveEventWithFallback({ ...value, circuitReason: 'PROVIDER_REJECTED' })).toMatchObject({ state: 'blocked', diagnostics: [{ code: 'ROUTING_FALLBACK_UNAVAILABLE' }] });
    });
    it('returns the certified Claude agent type and preserves it on full fallback', () => {
        const value = input();
        value.policy.content.mappings[0].target = 'claude-code';
        value.policy.content.mappings[0].profiles.mechanical = { selector: { kind: 'model', id: 'claude-haiku-4-5' }, effort: { kind: 'runtime-default' } };
        value.policy.content.mappings[0].fullCapability = { selector: { kind: 'model', id: 'claude-opus-4-7' }, effort: { kind: 'runtime-default' } };
        const claudeScope = { ...scope(), runtime: { ...scope().runtime, target: 'claude-code' as const } };
        const mapping = value.policy.content.mappings[0];
        const claims = [
            { selection: mapping.profiles.mechanical, nativeAgentType: 'awm-mechanical' },
            { selection: mapping.fullCapability, nativeAgentType: 'awm-full' },
        ].map(row => ({ ...row, mappingDigest: selectionPolicyDigest(mapping, row.selection), eventDigest: b,
            source: 'claude-assistant-transcript', observedAt: '2026-09-22T23:59:00.000Z',
            actualModel: { id: row.selection.selector.id, evidenceDigest: c }, tokenUsage: 'unknown' }));
        const routed = { ...value, receipt: { schema: 'routing-capabilities/v2', ...claudeScope, recordedAt: '2026-09-23T00:00:00.000Z', claims }, scope: claudeScope };
        expect(resolveEventSelection(routed)).toMatchObject({ state: 'resolved', nativeAgentType: 'awm-mechanical' });
        expect(resolveEventWithFallback({ ...routed, circuitReason: 'PROVIDER_REJECTED' })).toMatchObject({ state: 'resolved', nativeAgentType: 'awm-full', effectiveProfile: 'full' });
    });
});
