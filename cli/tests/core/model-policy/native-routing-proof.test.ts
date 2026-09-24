import { signNativeRoutingProof, verifyNativeRoutingProof } from '../../../src/core/model-policy/native-routing-proof';
import { routingSelection } from '../../helpers/routing-approval';

const key = Buffer.alloc(32, 7);
const input = { attemptId: 'route-1', nativeAgentId: 'child-1', source: 'codex-turn-context' as const,
    eventDigest: 'a'.repeat(64), observedAt: '2026-09-23T12:00:02.000Z', selection: routingSelection('medium') };

describe('native routing proof', () => {
    it('binds a native event to one reserved attempt and child', () => {
        const proof = signNativeRoutingProof(input, key);
        expect(verifyNativeRoutingProof(proof, { attemptId: 'route-1', nativeAgentId: 'child-1',
            reservedAt: '2026-09-23T12:00:00.000Z', selection: input.selection }, key, new Date('2026-09-23T12:00:03.000Z'))).toBe(true);
        expect(verifyNativeRoutingProof(proof, { attemptId: 'route-2', nativeAgentId: 'child-1',
            reservedAt: '2026-09-23T12:00:00.000Z', selection: input.selection }, key, new Date('2026-09-23T12:00:03.000Z'))).toBe(false);
        expect(verifyNativeRoutingProof({ ...proof, selection: routingSelection('high') }, { attemptId: 'route-1', nativeAgentId: 'child-1',
            reservedAt: '2026-09-23T12:00:00.000Z', selection: input.selection }, key, new Date('2026-09-23T12:00:03.000Z'))).toBe(false);
    });
    it('rejects a setup event replayed as a daily dispatch', () => {
        const proof = signNativeRoutingProof(input, key);
        expect(verifyNativeRoutingProof(proof, { attemptId: 'route-1', nativeAgentId: 'child-1',
            reservedAt: '2026-09-23T12:00:03.000Z', selection: input.selection }, key, new Date('2026-09-23T12:00:04.000Z'))).toBe(false);
    });
    it('rejects a proof after its bounded observation window and protects a provider model claim', () => {
        const proof = signNativeRoutingProof({ ...input, source: 'claude-assistant-transcript', actualModel: 'claude-example-model' }, key);
        const expected = { attemptId: 'route-1', nativeAgentId: 'child-1', reservedAt: '2026-09-23T12:00:00.000Z', selection: input.selection };
        expect(verifyNativeRoutingProof(proof, expected, key, new Date('2026-09-23T12:00:03.000Z'))).toBe(true);
        expect(verifyNativeRoutingProof({ ...proof, actualModel: 'different' }, expected, key, new Date('2026-09-23T12:00:03.000Z'))).toBe(false);
        expect(verifyNativeRoutingProof(proof, expected, key, new Date('2026-09-23T12:16:03.000Z'))).toBe(false);
    });
});
