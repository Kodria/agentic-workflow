/** Historical role recovery is deliberately restricted to independently audited
 * native T1 review events. source_skill names a skill, not its caller's role.
 * Audit locators and reviewed commits: docs/plans/2026-09-16-r1-release-evidence.md.
 * This helper cannot certify completion: the collector also checks original
 * plan bytes, branch, immutable Git checkpoint and current task-owned files. */
export interface HistoricalReviewRecord {
    ts?: string; branch: string; phase: string; source_skill: string;
    polarity: string; signature: string; ref: string;
}

export function hasIssue148ReviewProvenance(entries: readonly HistoricalReviewRecord[]): boolean {
    if (!Array.isArray(entries)) throw new Error('historical review records must be an array');
    const fields = ['ts', 'branch', 'phase', 'source_skill', 'polarity', 'signature', 'ref'] as const;
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || fields.some(field => field !== 'ts' && typeof entry[field] !== 'string') || (entry.ts !== undefined && typeof entry.ts !== 'string')) throw new Error('historical review record is invalid');
    }
    const shared = { branch: 'codex/issue-148-awm-facts', phase: 'review', source_skill: 'requesting-code-review', polarity: 'win' };
    const spec = { ...shared, ts: '2026-09-14T21:53:36.988Z', signature: 'facts-command-placeholder-traversal', ref: 'cli/src/core/facts/contract.ts:75' };
    const quality = { ...shared, ts: '2026-09-14T22:02:34.749Z', signature: 'facts-contract-json-and-literal-validation', ref: 'cli/src/core/facts/contract.ts:37' };
    const exact = (expected: HistoricalReviewRecord) => entries.some(entry => fields.every(field => entry[field] === expected[field]));
    const laterAdverse = entries.some(entry => entry.branch === shared.branch && entry.polarity === 'finding' && typeof entry.ts === 'string' && entry.ts > quality.ts && /^cli\/(?:src\/core\/(?:facts\/(?:types|contract)\.ts|registries\.ts)|tests\/core\/(?:facts\/contract\.test\.ts|registry-manifest\.test\.ts))(?::\d+(?::\d+)?)?$/.test(entry.ref));
    return exact(spec) && exact(quality) && !laterAdverse;
}
