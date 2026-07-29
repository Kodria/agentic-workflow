import { normalizeTokens, affinity, normalizeRef, clusterEntries } from '../../../src/core/ledger/cluster';
import type { LedgerEntry } from '../../../src/core/ledger/types';

describe('normalizeTokens', () => {
    test('lowercases and splits slugs on non-alphanumeric boundaries', () => {  // verifies R1.6
        expect([...normalizeTokens('Validator-Skips_Agents.References')].sort())
            .toEqual(['agents', 'references', 'skips', 'validator']);
    });

    test('drops tokens shorter than two characters', () => {  // verifies R1.6
        expect([...normalizeTokens('a b ok x')].sort()).toEqual(['ok']);
    });

    test('drops stopwords so they cannot inflate affinity', () => {  // verifies R1.6
        expect([...normalizeTokens('the gate walks only the skills')].sort())
            .toEqual(['gate', 'skills', 'walks']);
    });

    test('merges tokens across every text it is given', () => {  // verifies R1.6
        expect([...normalizeTokens('gate-walks', 'skills dir')].sort())
            .toEqual(['dir', 'gate', 'skills', 'walks']);
    });
});

describe('affinity', () => {
    test('is the overlap coefficient, so a contained short set scores 1', () => {  // verifies R1.6
        const short = normalizeTokens('validator gate');
        const long = normalizeTokens('validator gate walks the skills directory only');
        expect(affinity(short, long)).toBe(1);
    });

    test('is 0 for disjoint sets', () => {  // verifies R1.6
        expect(affinity(normalizeTokens('alpha slug'), normalizeTokens('beta timeout'))).toBe(0);
    });

    test('is 0 when either side is empty', () => {  // verifies R1.6
        expect(affinity(new Set<string>(), normalizeTokens('alpha'))).toBe(0);
    });
});

describe('normalizeRef', () => {
    test('strips the line number and keeps the file locus', () => {  // verifies R1.7
        expect(normalizeRef('scripts/validate-portability.mjs:41')).toBe('scripts/validate-portability.mjs');
    });

    test('accepts a bare filename with an extension', () => {  // verifies R1.7
        expect(normalizeRef('split.ts:12')).toBe('split.ts');
    });

    test('rejects a non-file ref: a whole PR is not a defect locus', () => {  // verifies R1.7
        expect(normalizeRef('PR #16')).toBeNull();
    });

    test('rejects a URL, whose pre-colon portion carries no locus', () => {  // verifies R1.7
        expect(normalizeRef('https://github.com/Kodria/agentic-workflow/pull/15')).toBeNull();
    });

    test('returns null for a missing ref', () => {  // verifies R1.7
        expect(normalizeRef(undefined)).toBeNull();
    });
});

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        ts: '2026-07-25T00:00:00.000Z',
        branch: 'feat-x',
        phase: 'post-qa',
        source_skill: 'post-implementation-qa',
        polarity: 'finding',
        class: 'logica',
        signature: 'some-finding',
        severity: 'important',
        desc: 'something is wrong',
        ref: 'src/some.ts:1',
        ...over,
    };
}

describe('clusterEntries — exact signature floor', () => {
    test('groups identical signatures and honours min', () => {  // verifies R1.1
        const clusters = clusterEntries([
            entry({ signature: 'dup', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }),
            entry({ signature: 'dup', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }),
            entry({ signature: 'solo', desc: 'beta timeout on retry', ref: 'src/b.ts:9' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ signature: 'dup', count: 2, kind: 'exact' });
    });

    test('unions identical signatures even across unrelated files and descriptions', () => {  // verifies R1.1
        const clusters = clusterEntries([
            entry({ signature: 'same-slug', desc: 'alpha slug mismatch', ref: 'src/a.ts:1' }),
            entry({ signature: 'same-slug', desc: 'beta timeout on retry', ref: 'src/b.ts:9' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].count).toBe(2);
    });

    test('unions identical signatures regardless of polarity, as before', () => {  // verifies R1.1
        const clusters = clusterEntries([
            entry({ signature: 'same-slug', polarity: 'finding' }),
            entry({ signature: 'same-slug', polarity: 'win' }),
        ], 2);
        expect(clusters).toHaveLength(1);
    });
});

describe('clusterEntries — convergence on a shared file', () => {
    // El caso real del 2026-07-25: tres lentes aisladas, tres slugs distintos,
    // un solo defecto (el gate de portabilidad recorría solo skills/).
    const threeLenses = () => [
        entry({
            signature: 'validator-skips-agents-references',
            desc: 'the portability validator never walks agents/ references',
            ref: 'scripts/validate-portability.mjs:41',
            source_skill: 'fidelity-lens',
        }),
        entry({
            signature: 'validator-scope-skills-only',
            desc: 'validator scope covers skills only, missing sibling trees',
            ref: 'scripts/validate-portability.mjs:41',
            source_skill: 'logic-lens',
        }),
        entry({
            signature: 'gate-walks-skills-only',
            desc: 'the gate walks skills and nothing else',
            ref: 'scripts/validate-portability.mjs:58',
            source_skill: 'robustness-lens',
        }),
    ];

    test('clusters three independent lenses on one defect', () => {  // verifies R1.2
        const clusters = clusterEntries(threeLenses(), 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].count).toBe(3);
    });

    test('labels the cluster convergent and lists every distinct signature', () => {  // verifies R1.5
        const clusters = clusterEntries(threeLenses(), 2);
        expect(clusters[0].kind).toBe('convergent');
        expect(clusters[0].signatures).toEqual([
            'gate-walks-skills-only',
            'validator-scope-skills-only',
            'validator-skips-agents-references',
        ]);
    });

    test('does NOT merge two unrelated defects that happen to share a file', () => {  // verifies R1.2
        const clusters = clusterEntries([
            entry({
                signature: 'gate-walks-skills-only',
                desc: 'the gate walks skills and nothing else',
                ref: 'scripts/validate-portability.mjs:58',
            }),
            entry({
                signature: 'exit-code-swallowed',
                desc: 'process exits zero after a failed assertion',
                ref: 'scripts/validate-portability.mjs:58',
            }),
        ], 2);
        expect(clusters).toEqual([]);
    });

    test('does NOT merge a win with a finding on the strength of a shared file', () => {  // verifies R1.4
        const clusters = clusterEntries([
            entry({ signature: 'gate-walks-skills-only', desc: 'the gate walks skills only', ref: 'a.mjs:1', polarity: 'finding' }),
            entry({ signature: 'gate-walks-skills-fix', desc: 'the gate walks skills only, now fixed', ref: 'a.mjs:1', polarity: 'win' }),
        ], 2);
        expect(clusters).toEqual([]);
    });

    test('a non-file ref contributes no clustering signal', () => {  // verifies R1.7
        const clusters = clusterEntries([
            entry({ signature: 'alpha-defect', desc: 'alpha slug mismatch', ref: 'PR #16' }),
            entry({ signature: 'beta-defect', desc: 'beta timeout on retry', ref: 'PR #16' }),
        ], 2);
        expect(clusters).toEqual([]);
    });
});

describe('clusterEntries — lexical convergence without a shared file', () => {
    test('clusters near-identical wording across different files', () => {  // verifies R1.3
        const clusters = clusterEntries([
            entry({ signature: 'vacuous-test-asserts-nothing', desc: 'test asserts nothing meaningful', ref: 'tests/a.test.ts:3' }),
            entry({ signature: 'vacuous-test-asserts-nothing-either', desc: 'test asserts nothing meaningful', ref: 'tests/b.test.ts:7' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].kind).toBe('convergent');
    });

    test('leaves weakly-related findings on different files apart', () => {  // verifies R1.3
        const clusters = clusterEntries([
            entry({ signature: 'validator-scope-skills-only', desc: 'validator scope covers skills', ref: 'src/a.ts:1' }),
            entry({ signature: 'gate-walks-skills-only', desc: 'the gate walks skills', ref: 'src/b.ts:1' }),
        ], 2);
        expect(clusters).toEqual([]);
    });

    test('merges A and C transitively through B, though A and C alone would not cluster', () => {  // verifies R1.9 (regression guard on union-find transitivity)
        const chain = [
            entry({ signature: 'aaa-marker', desc: 'alpha beta gamma delta', ref: 'src/a.ts:1' }),
            entry({ signature: 'bbb-marker', desc: 'beta gamma delta epsilon', ref: 'src/b.ts:1' }),
            entry({ signature: 'ccc-marker', desc: 'gamma delta epsilon zeta', ref: 'src/c.ts:1' }),
        ];
        const clusters = clusterEntries(chain, 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({ count: 3, kind: 'convergent' });
        expect(clusters[0].signatures).toEqual(['aaa-marker', 'bbb-marker', 'ccc-marker']);

        // Control: without the bridging entry, A and C do not satisfy the
        // threshold on their own (affinity 0.5 < LEXICAL_AFFINITY_MIN 0.6) —
        // proving the merge above genuinely relies on transitive closure
        // through B, not a coincidence of the threshold being lenient.
        const withoutBridge = clusterEntries([chain[0], chain[2]], 2);
        expect(withoutBridge).toEqual([]);
    });
});

describe('clusterEntries — representative and ordering', () => {
    test('representative signature is the most frequent one', () => {  // verifies R1.8
        const clusters = clusterEntries([
            entry({ signature: 'zeta-frequent', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
            entry({ signature: 'zeta-frequent', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
            entry({ signature: 'alpha-rare', desc: 'gate walks skills only, second lens', ref: 'a.mjs:1' }),
        ], 2);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].signature).toBe('zeta-frequent');
        expect(clusters[0].count).toBe(3);
    });

    test('ties on frequency resolve to the lexicographically first signature', () => {  // verifies R1.8
        const clusters = clusterEntries([
            entry({ signature: 'zeta-lens', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
            entry({ signature: 'alpha-lens', desc: 'gate walks skills only', ref: 'a.mjs:1' }),
        ], 2);
        expect(clusters[0].signature).toBe('alpha-lens');
    });

    test('sorts by count desc, then convergent before exact, then signature asc', () => {  // verifies R1.9
        const clusters = clusterEntries([
            // convergent cluster of 2 on one file
            entry({ signature: 'mid-one', desc: 'gate walks skills only', ref: 'mid.mjs:1' }),
            entry({ signature: 'mid-two', desc: 'gate walks skills only, other lens', ref: 'mid.mjs:1' }),
            // exact cluster of 2, unrelated
            entry({ signature: 'exact-dup', desc: 'alpha slug mismatch', ref: 'exact.ts:1' }),
            entry({ signature: 'exact-dup', desc: 'alpha slug mismatch', ref: 'exact.ts:1' }),
            // exact cluster of 3, unrelated — highest count wins regardless of kind
            entry({ signature: 'top-dup', desc: 'beta timeout on retry', ref: 'top.ts:1' }),
            entry({ signature: 'top-dup', desc: 'beta timeout on retry', ref: 'top.ts:1' }),
            entry({ signature: 'top-dup', desc: 'beta timeout on retry', ref: 'top.ts:1' }),
        ], 2);
        expect(clusters.map((c) => [c.signature, c.count, c.kind])).toEqual([
            ['top-dup', 3, 'exact'],
            ['mid-one', 2, 'convergent'],
            ['exact-dup', 2, 'exact'],
        ]);
    });

    test('an empty ledger yields no clusters', () => {  // verifies R1.1
        expect(clusterEntries([], 2)).toEqual([]);
    });

    test('min <= 0 still returns every group, including size-1 groups', () => {
        const solo = entry({ signature: 'lonely', desc: 'nobody else mentions this', ref: 'z.ts:1' });
        expect(clusterEntries([solo], 0)).toEqual([
            { signature: 'lonely', count: 1, kind: 'exact', signatures: ['lonely'], entries: [solo] },
        ]);
        expect(clusterEntries([solo], -5)).toEqual(clusterEntries([solo], 0));
    });
});
