import { normalizeTokens, affinity, normalizeRef } from '../../../src/core/ledger/cluster';

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
