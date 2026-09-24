import { observeNativeRoutingChild } from '../../../src/core/model-policy/native-routing-observe';
import { queryLocalEventScope } from '../../../src/core/model-policy/local-event-scope';
import { readMachineKey } from '../../../src/core/model-policy/machine-key';
import { queryCodexChildThreadObservation } from '../../../src/core/model-policy/native-codex';
import { publishCodexObservation, readStoredEventReceipt } from '../../../src/core/model-policy/event-store';
import { readEffectivePolicy } from '../../../src/core/model-policy/store';
import { selectionPolicyDigest } from '../../../src/core/model-policy/selection-policy-digest';
import { routingApproval, routingEnvelope } from '../../helpers/routing-approval';
import type { RoutingAttempt } from '../../../src/core/journal/types';
import type { EventReceipt } from '../../../src/core/model-policy/capabilities-v2';
import { verifyNativeRoutingProof } from '../../../src/core/model-policy/native-routing-proof';

jest.mock('../../../src/core/model-policy/local-event-scope');
jest.mock('../../../src/core/model-policy/machine-key');
jest.mock('../../../src/core/model-policy/native-codex');
jest.mock('../../../src/core/model-policy/event-store');
jest.mock('../../../src/core/model-policy/store');

const key = Buffer.alloc(32, 9);
const now = new Date('2026-09-23T12:00:03.000Z');
const reservedAt = '2026-09-23T12:00:00.000Z';
const observedAt = '2026-09-23T12:00:02.000Z';
const scope = { runtime: routingEnvelope.runtime, binaryDigest: 'b'.repeat(64), configDigest: 'c'.repeat(64) };

function attempt(): RoutingAttempt {
    return { schema: 'routing-attempt/v1', id: 'route-1', obligationId: 'o1', lineageId: 'l1', attempt: 1,
        envelope: routingEnvelope, envelopeDigest: 'e'.repeat(64), fingerprint: 'f'.repeat(64), state: 'reserved',
        nativeEvidenceRequired: true, reservedAt };
}

beforeEach(() => {
    jest.clearAllMocks();
    const approved = routingApproval();
    jest.mocked(readEffectivePolicy).mockReturnValue({ state: 'approved', provenance: 'project', policy: approved.policy });
    jest.mocked(readMachineKey).mockReturnValue(key);
    jest.mocked(queryLocalEventScope).mockResolvedValue({ state: 'current', scope });
    const receipt: EventReceipt = { schema: 'routing-capabilities/v2', ...scope, recordedAt: observedAt,
        claims: [{ selection: routingEnvelope.resolved,
            mappingDigest: selectionPolicyDigest(approved.policy.content.mappings[0], routingEnvelope.resolved),
            eventDigest: 'a'.repeat(64), source: 'codex-turn-context', observedAt,
            actualModel: 'unverified', tokenUsage: 'unknown' }] };
    jest.mocked(readStoredEventReceipt).mockReturnValue({ state: 'present', receipt });
    jest.mocked(queryCodexChildThreadObservation).mockResolvedValue({ provenance: 'codex-app-server-thread-read',
        parentThreadId: 'parent-1', childThreadId: 'child-1', turnId: 'turn-1', nativeDispatchVerified: true,
        configuredSelection: routingEnvelope.resolved, acceptedSelectionVerified: true,
        childRuntimeVersion: routingEnvelope.runtime.version, observedAt,
        actualModelVerified: false, tokenUsage: 'unknown' });
});

describe('normal-work native routing observation', () => {
    it('reconciles a completed Codex child and renews only its matching claim', async () => {
        const proof = await observeNativeRoutingChild({ attempt: attempt(), nativeAgentId: 'child-1', parentThreadId: 'parent-1',
            cwd: '/tmp/awm-native-observe-test', now, consumedEventDigests: [] });
        expect(verifyNativeRoutingProof(proof, { attemptId: 'route-1', nativeAgentId: 'child-1',
            reservedAt, selection: routingEnvelope.resolved }, key, now)).toBe(true);
        expect(publishCodexObservation).toHaveBeenCalledWith(expect.objectContaining({ expectedSelection: routingEnvelope.resolved }));
    });
    it('rejects a setup turn preceding reservation without renewing its claim', async () => {
        jest.mocked(queryCodexChildThreadObservation).mockResolvedValueOnce({ ...await queryCodexChildThreadObservation({ command: 'codex', args: [], timeoutMs: 1, parentThreadId: 'parent-1', childThreadId: 'child-1' }),
            observedAt: '2026-09-23T11:59:59.000Z' });
        await expect(observeNativeRoutingChild({ attempt: attempt(), nativeAgentId: 'child-1', parentThreadId: 'parent-1',
            cwd: '/tmp/awm-native-observe-test', now, consumedEventDigests: [] })).rejects.toThrow(/predates reservation/);
        expect(publishCodexObservation).not.toHaveBeenCalled();
    });
});
