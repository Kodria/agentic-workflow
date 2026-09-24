import { evaluateEventReceipt, validateEventReceipt } from '../../../src/core/model-policy/capabilities-v2';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const digestC = 'c'.repeat(64);
const selection = (id: string) => ({ selector: { kind: 'model', id }, effort: { kind: 'explicit', value: 'high' } });
const receipt = () => ({
    schema: 'routing-capabilities/v2',
    runtime: { target: 'codex', kind: 'native', version: '0.156.1', accountScopeDigest: digestA },
    binaryDigest: digestB, configDigest: digestC, recordedAt: '2026-09-23T00:00:00.000Z',
    claims: [
        { selection: selection('gpt-6-luna'), mappingDigest: digestA, eventDigest: digestB, source: 'codex-turn-context', observedAt: '2026-09-23T00:00:00.000Z', actualModel: 'unverified', tokenUsage: 'unknown' },
        { selection: selection('gpt-6-astra'), mappingDigest: digestB, eventDigest: digestC, source: 'codex-turn-context', observedAt: '2026-09-23T00:00:00.000Z', actualModel: 'unverified', tokenUsage: 'unknown' },
    ],
});

describe('event-scoped routing capabilities v2', () => {
    const scope = { runtime: receipt().runtime, binaryDigest: digestB, configDigest: digestC };
    const later = new Date('2026-09-24T01:00:00.000Z');

    it('keeps an unchanged native claim current after 25 hours without renewal', () => {
        expect(validateEventReceipt(receipt())).toMatchObject({ schema: 'routing-capabilities/v2' });
        expect(evaluateEventReceipt(receipt(), scope, selection('gpt-6-luna'), digestA, later)).toEqual({ state: 'current' });
    });

    it('invalidates only a changed selection mapping, not its neighbor', () => {
        expect(evaluateEventReceipt(receipt(), scope, selection('gpt-6-luna'), digestC, later)).toEqual({ state: 'drift', reason: 'POLICY_DRIFT' });
        expect(evaluateEventReceipt(receipt(), scope, selection('gpt-6-astra'), digestB, later)).toEqual({ state: 'current' });
    });

    it('fails closed on runtime, account, binary and config drift', () => {
        const value = receipt();
        expect(evaluateEventReceipt(value, { ...scope, runtime: { ...scope.runtime, version: '0.157.0' } }, selection('gpt-6-luna'), digestA, later)).toEqual({ state: 'drift', reason: 'RUNTIME_DRIFT' });
        expect(evaluateEventReceipt(value, { ...scope, runtime: { ...scope.runtime, accountScopeDigest: digestB } }, selection('gpt-6-luna'), digestA, later)).toEqual({ state: 'drift', reason: 'ACCOUNT_DRIFT' });
        expect(evaluateEventReceipt(value, { ...scope, binaryDigest: digestC }, selection('gpt-6-luna'), digestA, later)).toEqual({ state: 'drift', reason: 'RUNTIME_DRIFT' });
        expect(evaluateEventReceipt(value, { ...scope, configDigest: digestB }, selection('gpt-6-luna'), digestA, later)).toEqual({ state: 'drift', reason: 'CONFIG_DRIFT' });
    });

    it('rejects malformed proof, duplicate claims, future records and missing scope', () => {
        expect(() => validateEventReceipt({ ...receipt(), claims: [receipt().claims[0], receipt().claims[0]] })).toThrow(/duplicate/i);
        expect(() => validateEventReceipt({ ...receipt(), claims: [{ ...receipt().claims[0], eventDigest: 'pretend' }] })).toThrow(/digest/i);
        expect(evaluateEventReceipt({ ...receipt(), recordedAt: '2026-09-25T00:00:00.000Z' }, scope, selection('gpt-6-luna'), digestA, later)).toEqual({ state: 'drift', reason: 'FUTURE_EVIDENCE' });
        expect(() => evaluateEventReceipt(receipt(), { ...scope, configDigest: '' }, selection('gpt-6-luna'), digestA, later)).toThrow(/configDigest/i);
        expect(() => validateEventReceipt({ ...receipt(), runtime: { ...receipt().runtime, target: 'antigravity' }, claims: [{ ...receipt().claims[0], source: 'claude-assistant-transcript' }] })).toThrow(/provider|target/i);
    });
});
