import { hasIssue148ReviewProvenance, type HistoricalReviewRecord } from '../../../src/core/migration/historical-provenance';

const spec: HistoricalReviewRecord = { ts: '2026-09-14T21:53:36.988Z', branch: 'codex/issue-148-awm-facts', phase: 'review', source_skill: 'requesting-code-review', polarity: 'win', signature: 'facts-command-placeholder-traversal', ref: 'cli/src/core/facts/contract.ts:75' };
const quality: HistoricalReviewRecord = { ...spec, ts: '2026-09-14T22:02:34.749Z', signature: 'facts-contract-json-and-literal-validation', ref: 'cli/src/core/facts/contract.ts:37' };

describe('audited issue148 native review provenance', () => {
    test('recovers only the exact already-existing audited events, not a new verdict', () => {
        expect(hasIssue148ReviewProvenance([spec, quality])).toBe(true);
    });
    test.each(['ts', 'branch', 'phase', 'source_skill', 'polarity', 'signature', 'ref'] as const)('does not borrow a different specification event (%s)', field => {
        expect(hasIssue148ReviewProvenance([{ ...spec, [field]: 'different' }, quality])).toBe(false);
    });
    test.each(['ts', 'branch', 'phase', 'source_skill', 'polarity', 'signature', 'ref'] as const)('does not borrow a different quality event (%s)', field => {
        expect(hasIssue148ReviewProvenance([spec, { ...quality, [field]: 'different' }])).toBe(false);
    });
    test('requires both distinct events and rejects later task-owned adverse evidence', () => {
        expect(hasIssue148ReviewProvenance([quality])).toBe(false);
        expect(hasIssue148ReviewProvenance([spec])).toBe(false);
        expect(hasIssue148ReviewProvenance([spec, quality, { ...quality, ts: '2026-09-15T00:00:00.000Z', polarity: 'finding' }])).toBe(false);
    });
    test('validates the public input shape', () => {
        expect(() => hasIssue148ReviewProvenance(null as any)).toThrow(/array/);
        expect(() => hasIssue148ReviewProvenance([null as any])).toThrow(/record/);
    });
});
