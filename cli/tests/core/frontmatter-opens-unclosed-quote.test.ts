import { opensUnclosedQuote } from '../../src/core/frontmatter';

describe('opensUnclosedQuote', () => {
    it.each([
        ['"a"', false],
        ["'it''s'", false],
        ['"a \\"b\\""', false],
        ['"hola', true],
        ["'hola # x", true],
        ['"abc\\"', true],
        ['plain', false],
        ['  "x"  ', false],
        ["''", false],
    ])('%s → %s', (value, expected) => {
        expect(opensUnclosedQuote(value)).toBe(expected);
    });
});
