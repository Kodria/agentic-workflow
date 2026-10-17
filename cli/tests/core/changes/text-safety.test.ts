import { MAX_MESSAGE, NON_STRING, cleanText, clipMessage, esc, escapeText, isCanonicalIso, isHttpsUrl, isObj, isSafeMultiline, isSafeRelativePath, isSingleLine, isWellFormed, sliceNoSplit } from '../../../src/core/changes/text-safety';

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

describe('every export tolerates non-string text without throwing', () => {
    const nonStrings: Array<[string, unknown]> = [['undefined', undefined], ['null', null], ['42', 42], ['{}', {}], ['[]', []], ['a Buffer', Buffer.from('x')], ['NaN', NaN]];
    test.each(nonStrings)('esc, escapeText, cleanText and clipMessage map %s to the placeholder', (_label, value) => {
        expect(() => esc(value as string)).not.toThrow();
        expect(esc(value as string)).toBe(NON_STRING);
        expect(escapeText(value as string)).toBe(NON_STRING);
        expect(cleanText(value as string)).toBe(NON_STRING);
        expect(clipMessage(value as string)).toBe(NON_STRING);
    });
    test.each(nonStrings)('sliceNoSplit returns an empty string for text %s', (_label, value) => {
        expect(() => sliceNoSplit(value as string, 5)).not.toThrow();
        expect(sliceNoSplit(value as string, 5)).toBe('');
    });
    test.each(nonStrings)('isSingleLine and isSafeMultiline are false for %s', (_label, value) => {
        expect(isSingleLine(value)).toBe(false);
        expect(isSafeMultiline(value)).toBe(false);
    });
    test('the placeholder is itself single-line text', () => {
        expect(isSingleLine(NON_STRING)).toBe(true);
    });
});

describe('sliceNoSplit with a bad limit never throws and never over-returns', () => {
    test.each([['NaN', NaN], ['-1', -1], ['-Infinity', -Infinity], ['Infinity', Infinity], ['0', 0], ['0.9', 0.9], ['undefined', undefined], ['null', null], ['a string', '3']])('maxUnits %s yields an empty string', (_label, limit) => {
        expect(() => sliceNoSplit('abc', limit as number)).not.toThrow();
        expect(sliceNoSplit('abc', limit as number)).toBe('');
    });
    test('a fractional limit is floored', () => {
        expect(sliceNoSplit('abcdef', 2.9)).toBe('ab');
    });
    test('a whole-number limit is unchanged', () => {
        expect(sliceNoSplit('abcdef', 6)).toBe('abcdef');
        expect(sliceNoSplit('abcdef', 100)).toBe('abcdef');
    });
});

describe('isSafeRelativePath', () => {
    test.each(['a', 'a/b', 'docs/changes', '.awm/journal', 'src/file name.ts', 'ñandú/x', '.hidden/..dots', 'a'.repeat(1024)])('accepts %j', (p) => {
        expect(isSafeRelativePath(p)).toBe(true);
    });
    test.each([
        ['empty', ''], ['dot', '.'], ['dot-dot', '..'], ['parent segment', '../a'], ['inner parent', 'a/../b'], ['dot segment', 'a/./b'], ['empty segment', 'a//b'],
        ['trailing slash', 'a/'], ['absolute', '/a'], ['drive letter', 'C:/a'], ['drive letter, no slash', 'C:a'], ['backslash', 'a\\b'],
        ['leading space', ' a'], ['trailing space', 'a '], ['leading tab', '\ta'], ['newline', 'a\nb'], ['carriage return', 'a\rb'], ['NUL', 'a\u0000b'],
        ['ESC', 'a\u001bb'], ['DEL', 'a\u007fb'], ['C1 control', 'a\u0085b'], ['line separator', 'a\u2028b'], ['paragraph separator', 'a\u2029b'],
        ['over-length', 'a'.repeat(1025)], ['trailing no-break space', 'a\u00a0'],
    ])('rejects %s', (_label, p) => {
        expect(isSafeRelativePath(p)).toBe(false);
    });
    test.each([[undefined], [null], [7], [{}], [['a']], [true]])('rejects the non-string %p without throwing', (p) => {
        expect(isSafeRelativePath(p)).toBe(false);
    });
});

describe('isObj', () => {
    test.each([[{}], [{ a: 1 }], [Object.create(null)]])('accepts the object %j', (v) => {
        expect(isObj(v)).toBe(true);
    });
    test.each([[null], [undefined], [[]], [[1]], ['x'], [1], [true]])('rejects %j', (v) => {
        expect(isObj(v)).toBe(false);
    });
});

describe('isWellFormed', () => {
    test.each(['', 'plain', 'ñandú', '😀'])('accepts %j', (t) => {
        expect(isWellFormed(t)).toBe(true);
    });
    test.each(['a\ud800b', '\udc00', 'a\ud83d'])('rejects a lone surrogate in %j', (t) => {
        expect(isWellFormed(t)).toBe(false);
    });
    test.each([[undefined], [null], [1]])('rejects the non-string %p', (v) => {
        expect(isWellFormed(v as never)).toBe(false);
    });
});

describe('isHttpsUrl', () => {
    const lenient = { allowCredentials: true };
    const strict = { allowCredentials: false, maxLength: 2048 };
    test.each(['https://github.com/o/r/issues/1', 'https://example.com', 'https://example.com:8443/a?b=c#d', 'https://[::1]/x'])('accepts %j in both modes', (u) => {
        expect(isHttpsUrl(u, lenient)).toBe(true);
        expect(isHttpsUrl(u, strict)).toBe(true);
    });
    test.each([
        ['http', 'http://example.com'], ['other scheme', 'javascript:alert(1)'], ['upper-case scheme', 'HTTPS://example.com'], ['no authority', 'https://'],
        ['empty host before a path', 'https:///a'], ['query first', 'https://?a'], ['whitespace', 'https://example.com/a b'], ['a line break', 'https://example.com/a\nb'],
        ['a backslash first', 'https://\\example.com'], ['an at-sign first', 'https://@example.com'], ['plain text', 'not a url'], ['empty', ''],
    ])('rejects %s in both modes', (_name, u) => {
        expect(isHttpsUrl(u, lenient)).toBe(false);
        expect(isHttpsUrl(u, strict)).toBe(false);
    });
    test('credentials are accepted only when allowed', () => {
        expect(isHttpsUrl('https://user:pw@example.com/1', lenient)).toBe(true);
        expect(isHttpsUrl('https://user:pw@example.com/1', strict)).toBe(false);
        expect(isHttpsUrl('https://user@example.com/1', strict)).toBe(false);
    });
    test('the length limit applies only when given', () => {
        const long = `https://example.com/${'a'.repeat(3000)}`;
        expect(isHttpsUrl(long, lenient)).toBe(true);
        expect(isHttpsUrl(long, strict)).toBe(false);
        expect(isHttpsUrl(`https://example.com/${'a'.repeat(2048 - 20)}`, strict)).toBe(true);
    });
    test.each([[undefined], [null], [1], [{}]])('rejects the non-string %p without throwing', (v) => {
        expect(isHttpsUrl(v, lenient)).toBe(false);
    });
});

describe('isCanonicalIso', () => {
    test.each(['2026-10-17T12:00:00.000Z', '1970-01-01T00:00:00.000Z', '2024-02-29T23:59:59.999Z'])('accepts %j', (v) => {
        expect(isCanonicalIso(v)).toBe(true);
    });
    test.each([
        ['a date only', '2026-10-17'], ['no milliseconds', '2026-10-17T12:00:00Z'], ['an offset', '2026-10-17T12:00:00.000+00:00'], ['lower-case z', '2026-10-17T12:00:00.000z'],
        ['an impossible day', '2026-02-30T00:00:00.000Z'], ['padding', ' 2026-10-17T12:00:00.000Z'], ['text', 'yesterday'], ['empty', ''],
    ])('rejects %s', (_n, v) => {
        expect(isCanonicalIso(v)).toBe(false);
    });
    test.each([[undefined], [null], [0], [{}], [new Date(0)], [Symbol('x')], [{ toString: () => { throw new Error('boom'); } }], [{ toString: () => '2026-10-17T12:00:00.000Z' }]])('rejects the non-string %p without throwing', (v) => {
        expect(isCanonicalIso(v)).toBe(false);
    });
});
