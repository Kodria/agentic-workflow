import { LEDGER_RESOLVE_KIND, parseLedgerEntry, parseLedgerResolveRecord } from '../../../src/core/ledger/types';

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ts: '2026-06-06T00:00:00.000Z',
        branch: 'feat-x',
        phase: 'review',
        source_skill: 'requesting-code-review',
        polarity: 'finding',
        class: 'proceso',
        signature: 'style-nit',
        severity: 'minor',
        desc: 'prefer early return',
        ...over,
    };
}

describe('ledger deferred/resolved parse (RF-4.7)', () => {
    test('accepts a new entry with stable id string', () => {
        const parsed = parseLedgerEntry(base({ id: '20260606T000000-abc123' }), 'line 1');
        expect(parsed).toMatchObject({ ok: true, entry: { id: '20260606T000000-abc123' } });
    });

    test('rejects a non-string id', () => {
        const parsed = parseLedgerEntry(base({ id: 42 }), 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-fields' });
    });

    test('rejects an empty id string', () => {
        const parsed = parseLedgerEntry(base({ id: '' }), 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-fields' });
    });

    test('legacy entry without id / deferred / resolved still parses', () => {
        const parsed = parseLedgerEntry(base(), 'line 1');
        expect(parsed).toMatchObject({
            ok: true,
            entry: { signature: 'style-nit', id: undefined, deferred: undefined, resolved: undefined },
        });
    });

    test('accepts optional deferred with at + reason round-ceiling', () => {
        const parsed = parseLedgerEntry(base({
            id: 'id-1',
            deferred: { at: '2026-06-06T01:00:00.000Z', reason: 'round-ceiling' },
        }), 'line 1');
        expect(parsed).toMatchObject({
            ok: true,
            entry: {
                id: 'id-1',
                deferred: { at: '2026-06-06T01:00:00.000Z', reason: 'round-ceiling' },
            },
        });
    });

    test('accepts deferred reason re-review-defer', () => {
        const parsed = parseLedgerEntry(base({
            id: 'id-2',
            deferred: { at: '2026-06-06T01:00:00.000Z', reason: 're-review-defer' },
        }), 'line 1');
        expect(parsed).toMatchObject({
            ok: true,
            entry: { deferred: { reason: 're-review-defer' } },
        });
    });

    test('rejects deferred with unknown reason', () => {
        const parsed = parseLedgerEntry(base({
            id: 'id-3',
            deferred: { at: '2026-06-06T01:00:00.000Z', reason: 'owner-whim' },
        }), 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-deferred' });
    });

    test('rejects deferred that is not an object', () => {
        const parsed = parseLedgerEntry(base({ id: 'id-4', deferred: 'round-ceiling' }), 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-deferred' });
    });

    test('accepts optional resolved with at + how fixed|accepted', () => {
        for (const how of ['fixed', 'accepted'] as const) {
            const parsed = parseLedgerEntry(base({
                id: 'id-5',
                deferred: { at: '2026-06-06T01:00:00.000Z', reason: 'round-ceiling' },
                resolved: { at: '2026-06-06T02:00:00.000Z', how },
            }), 'line 1');
            expect(parsed).toMatchObject({ ok: true, entry: { resolved: { how } } });
        }
    });

    test('rejects bad resolved.how', () => {
        const parsed = parseLedgerEntry(base({
            id: 'id-6',
            deferred: { at: '2026-06-06T01:00:00.000Z', reason: 'round-ceiling' },
            resolved: { at: '2026-06-06T02:00:00.000Z', how: 'yolo' },
        }), 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-resolved' });
    });

    test('rejects resolved that is not an object', () => {
        const parsed = parseLedgerEntry(base({ id: 'id-7', resolved: true }), 'line 1');
        expect(parsed).toMatchObject({ ok: false, reason: 'invalid-resolved' });
    });

    test('parseLedgerResolveRecord accepts append-only resolve lines', () => {
        const parsed = parseLedgerResolveRecord({
            kind: LEDGER_RESOLVE_KIND,
            id: 'id-1',
            resolved: { at: '2026-06-06T02:00:00.000Z', how: 'fixed' },
        });
        expect(parsed).toMatchObject({
            ok: true,
            record: { kind: LEDGER_RESOLVE_KIND, id: 'id-1', resolved: { how: 'fixed' } },
        });
    });

    test('parseLedgerResolveRecord rejects bad how and non-resolve objects', () => {
        expect(parseLedgerResolveRecord(base({ id: 'entry' }))).toMatchObject({ ok: false, reason: 'not-resolve' });
        expect(parseLedgerResolveRecord({
            kind: LEDGER_RESOLVE_KIND,
            id: 'id-1',
            resolved: { at: '2026-06-06T02:00:00.000Z', how: 'yolo' },
        })).toMatchObject({ ok: false, reason: 'invalid-resolve' });
    });
});
