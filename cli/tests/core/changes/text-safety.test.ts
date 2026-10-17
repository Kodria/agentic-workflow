import { MAX_MESSAGE, clipMessage, esc, escapeText, isSafeMultiline, isSingleLine, sliceNoSplit } from '../../../src/core/changes/text-safety';

const LINE_BREAKS = ['\r', '\n', '\u0085', ' ', ' '];

describe('isSingleLine', () => {
    test.each(['', 'plain', 'with spaces', 'ñandú', '😀', 'a/b:c'])('accepts %j', (t) => {
        expect(isSingleLine(t)).toBe(true);
    });
    test.each([...LINE_BREAKS, '\t', '\u0000', '\u001b', '\u007f', '\u0080', '\u009f'])('rejects a string containing %j', (c) => {
        expect(isSingleLine(`a${c}b`)).toBe(false);
    });
    test.each([undefined, null, 1, {}, []])('rejects the non-string %j', (v) => {
        expect(isSingleLine(v)).toBe(false);
    });
});

describe('isSafeMultiline', () => {
    test('accepts newline, tab, U+2028 and plain text', () => {
        expect(isSafeMultiline('line 1\n\tline 2 x')).toBe(true);
    });
    test.each(['\r', '\u0085', '\u0000', '\u001b', '\u007f', '\u0080', '\u009f'])('rejects a string containing %j', (c) => {
        expect(isSafeMultiline(`a${c}b`)).toBe(false);
    });
    test.each([undefined, null, 1, {}, []])('rejects the non-string %j', (v) => {
        expect(isSafeMultiline(v)).toBe(false);
    });
});

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('sliceNoSplit', () => {
    test('returns short text unchanged', () => {
        expect(sliceNoSplit('abc', 3)).toBe('abc');
        expect(sliceNoSplit('', 3)).toBe('');
    });
    test('cuts at the given number of UTF-16 units', () => {
        expect(sliceNoSplit('abcdef', 4)).toBe('abcd');
    });
    test('drops a trailing high surrogate instead of splitting the pair', () => {
        expect(sliceNoSplit('ab😀cd', 3)).toBe('ab');
        expect(sliceNoSplit('ab😀cd', 4)).toBe('ab😀');
        expect(sliceNoSplit('😀😀', 1)).toBe('');
    });
});

describe('escapeText', () => {
    test('JSON-escapes quotes, backslashes and controls', () => {
        expect(escapeText('a"b\\c\nd\x1b')).toBe('a\\"b\\\\c\\nd\\u001b');
    });
    test('escapes the line breaks JSON leaves alone', () => {
        expect(escapeText('\u0085\u2028\u2029')).toBe('\\u0085\\u2028\\u2029');
    });
    test('escapes lone surrogates', () => {
        expect(escapeText('\ud800')).not.toMatch(LONE);
    });
    test('does not clip', () => {
        expect(escapeText('x'.repeat(1000))).toHaveLength(1000);
    });
});

describe('esc', () => {
    test('leaves ordinary short text unchanged', () => {
        expect(esc('status')).toBe('status');
    });
    test('clips to 80 code points with an ellipsis', () => {
        expect(esc('y'.repeat(81))).toBe(`${'y'.repeat(80)}…`);
    });
    test('bounds the escaped length and never splits a surrogate pair', () => {
        for (let pad = 0; pad < 4; pad++) {
            const out = esc(`${'\u0001'.repeat(39)}${'a'.repeat(pad)}😀bbbb`);
            expect(out.length).toBeLessThanOrEqual(241);
            expect(out).not.toMatch(LONE);
            expect(out).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
        }
    });
});

describe('clipMessage', () => {
    test('leaves messages up to the limit unchanged', () => {
        expect(clipMessage('x'.repeat(MAX_MESSAGE))).toBe('x'.repeat(MAX_MESSAGE));
    });
    test('clips to the limit including the ellipsis', () => {
        const out = clipMessage('x'.repeat(MAX_MESSAGE + 50));
        expect(out).toHaveLength(MAX_MESSAGE);
        expect(out.endsWith('…')).toBe(true);
    });
    test('never splits a surrogate pair', () => {
        for (const pad of ['', 'x']) {
            const out = clipMessage(`${pad}${'😀'.repeat(300)}`);
            expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
            expect(out).not.toMatch(LONE);
        }
    });
});
