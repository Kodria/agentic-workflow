import { canonicalPolicyDigest } from '../../../src/core/model-policy/canonical';
import { validateApprovedPolicy, validatePolicyContent } from '../../../src/core/model-policy/validate';
import type { ApprovedPolicy, PolicyContent, Selection } from '../../../src/core/model-policy/types';

const selection = (id: string, effort = 'medium'): Selection => ({ selector: { kind: 'model', id }, effort: { kind: 'explicit', value: effort } });
const policy = (): PolicyContent => ({
    schema: 'model-policy/v1',
    mappings: [{ target: 'codex', runtimeKind: 'native', profiles: {
        mechanical: selection('gpt-5.6-luna'), integration: selection('gpt-5.6-terra'), judgment: selection('gpt-5.6-sol'),
    }, fullCapability: selection('gpt-5.6-sol', 'high'), degradation: {
        allowMissingModelOverride: false, allowMissingEffortOverride: false, allowMissingObservedIdentity: false,
    } }],
    implementationBudget: { maxAttempts: 3, escalation: ['mechanical', 'integration', 'judgment'], judgmentEfforts: ['medium', 'high'] },
});
const approvedPolicy = (): ApprovedPolicy => ({ schema: 'approved-model-policy/v1', content: policy(), contentDigest: 'a'.repeat(64), approval: { approvedAt: '2026-09-17T00:00:00.000Z', approvalId: 'approval-1' }, lineage: { previousDigest: null } });

describe('model policy validation and canonical digest', () => {
    it.each(['September 17, 2026 00:00:00 UTC', '2026-09-17', '2026-09-17T00:00:00.000+00:00', '2026-09-17T00:00:00.000Zx', '2026-02-30T00:00:00.000Z', '2026-09-17T00:00:00Z'])('rejects a noncanonical approval timestamp: %s', approvedAt => {
        const candidate = approvedPolicy(); candidate.approval.approvedAt = approvedAt;
        expect(() => validateApprovedPolicy(candidate)).toThrow(/approval\.approvedAt/);
    });
    it('validates the complete policy contract and gives reordered object keys the same digest', () => {
        const candidate = policy();
        const reordered = JSON.parse('{"implementationBudget":{"judgmentEfforts":["medium","high"],"escalation":["mechanical","integration","judgment"],"maxAttempts":3},"mappings":[{"fullCapability":{"effort":{"value":"high","kind":"explicit"},"selector":{"id":"gpt-5.6-sol","kind":"model"}},"degradation":{"allowMissingObservedIdentity":false,"allowMissingEffortOverride":false,"allowMissingModelOverride":false},"profiles":{"judgment":{"selector":{"kind":"model","id":"gpt-5.6-sol"},"effort":{"kind":"explicit","value":"medium"}},"integration":{"selector":{"kind":"model","id":"gpt-5.6-terra"},"effort":{"kind":"explicit","value":"medium"}},"mechanical":{"selector":{"kind":"model","id":"gpt-5.6-luna"},"effort":{"kind":"explicit","value":"medium"}}},"runtimeKind":"native","target":"codex"}],"schema":"model-policy/v1"}') as PolicyContent;
        expect(validatePolicyContent(candidate)).toEqual(candidate);
        expect(canonicalPolicyDigest(candidate)).toBe(canonicalPolicyDigest(reordered));
    });

    it('preserves array order in the digest', () => {
        const candidate = policy();
        const swapped = structuredClone(policy()) as any;
        const second = structuredClone(swapped.mappings[0]);
        second.target = 'claude-code';
        swapped.mappings.push(second);
        candidate.mappings.push(structuredClone(second));
        swapped.mappings.reverse();
        expect(canonicalPolicyDigest(candidate)).not.toBe(canonicalPolicyDigest(swapped));
    });

    it.each([
        ['unknown field', () => ({ ...policy(), unexpected: true })],
        ['partial profile map', () => { const value = policy(); delete (value.mappings[0].profiles as any).judgment; return value; }],
        ['duplicate target/runtime map', () => { const value = policy(); value.mappings.push(structuredClone(value.mappings[0])); return value; }],
        ['unsafe runtime kind', () => { const value = policy(); value.mappings[0].runtimeKind = '../native'; return value; }],
        ['unsafe model id control character', () => { const value = policy(); value.mappings[0].profiles.mechanical.selector.id = 'bad\nmodel'; return value; }],
    ])('rejects %s', (_name, make) => {
        expect(() => validatePolicyContent(make())).toThrow();
    });
});
