import { LINEAR_TIME_BOUND_MS, bad } from './helpers';
import { NOW, UNSAFE } from './list-fixtures';
import { cleanLine, parsePr, parseSince } from '../../../src/core/changes/list-parse';

// Repo-free tests of the pure parsing of `awm changes list`: nothing here starts git.

describe('parseSince (R5.2)', () => {
    test.each([
        ['24h', '2026-10-16T12:00:00.000Z'],
        ['7d', '2026-10-10T12:00:00.000Z'],
        ['1h', '2026-10-17T11:00:00.000Z'],
        ['3650d', '2016-10-19T12:00:00.000Z'],
        ['87600h', '2016-10-19T12:00:00.000Z'],
        ['3651d', '2016-10-18T12:00:00.000Z'],
        ['87601h', '2016-10-19T11:00:00.000Z'],
        ['99999d', '1753-01-02T12:00:00.000Z'],
        ['12345h', '2025-05-21T03:00:00.000Z'],
        ['2026-10-01', '2026-10-01T00:00:00.000Z'],
        ['2026-02-28', '2026-02-28T00:00:00.000Z'],
        ['2028-02-29', '2028-02-29T00:00:00.000Z'],
    ])('accepts %s', (value, iso) => {
        expect(parseSince(value, NOW)?.toISOString()).toBe(iso);
    });
    test.each(['', '0h', '0d', '00d', '-1h', '+1h', '1.5h', '24', 'h', '24x', '24H', '24 h', ' 24h', '24h ', '24h\n', '1234567890h', '1234567890d', '0000000000h', '999999999d',
        '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '2026-10-1', '2026-10-01T00:00:00Z', '2026-10-01 ', 'soon', 'now', '\u0661\u0662h', '1e3h', '0x10h',
        ])('rejects %j', (value) => {
        expect(parseSince(value, NOW)).toBeNull();
    });
    test('a count of 9 digits is valid while the resulting instant is a valid date', () => {
        expect(parseSince('999999999h', NOW)).toBeInstanceOf(Date);
        expect(parseSince('100000000d', NOW)).toBeInstanceOf(Date);
        expect(parseSince('999999999d', NOW)).toBeNull();
    });
    test('rejects a very long text without scanning it more than once', () => {
        const start = Date.now();
        expect(parseSince(`${'9'.repeat(1_000_000)}h`, NOW)).toBeNull();
        expect(parseSince('x'.repeat(1_000_000), NOW)).toBeNull();
        expect(Date.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
    });
    test.each([undefined, null, 24, {}, [], true])('rejects the non-string %j without throwing', (value) => {
        expect(parseSince(bad(value), NOW)).toBeNull();
    });
    test.each([undefined, null, 'x', 5, new Date(Number.NaN), {}])('rejects the unusable clock %j', (clock) => {
        expect(parseSince('24h', bad(clock))).toBeNull();
    });
});

describe('parsePr (R5.5)', () => {
    test.each([
        ['feat: x', null],
        ['feat: x (#12) more', null],
        ['feat: (#12) x', null],
        ['feat: x (#)', null],
        ['feat: x (#1a)', null],
        ['feat: x (# 12)', null],
        ['feat: x (#-5)', null],
        ['feat: x #12', null],
        ['feat: x (#12', null],
        ['feat: x (#99999999999999999999)', null],
        ['feat: x (#9007199254740993)', null],
        ['feat: x (#9007199254740991)', 9007199254740991],
        ['feat: x (#123)', 123],
        ['feat: x (#007)', 7],
        ['feat: x (#12)   ', 12],
        ['feat: x (#12)\t\r\n', 12],
        ['feat: x (#1) (#2)', 2],
        ['(#3)', 3],
        ['(#)', null],
        ['', null],
    ])('the PR of %j is %j', (subject, pr) => {
        expect(parsePr(subject)).toBe(pr);
    });
    test.each([undefined, null, 5, {}, []])('the non-string %j is null, not a throw', (value) => {
        expect(parsePr(bad(value))).toBeNull();
    });
    test('a very long run of digits or of blanks after (# is parsed in linear time', () => {
        const start = Date.now();
        expect(parsePr(`feat: x (#${'9'.repeat(1_000_000)}`)).toBeNull();
        expect(parsePr(`feat: y (#${' '.repeat(1_000_000)}1)`)).toBeNull();
        expect(parsePr(`feat: z ${'(#'.repeat(500_000)})`)).toBeNull();
        expect(parsePr(`${' '.repeat(1_000_000)}`)).toBeNull();
        expect(Date.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
    });
});

describe('cleanLine', () => {
    test.each([undefined, null, 5, {}])('the non-string %j is a placeholder, not a throw', (value) => {
        expect(cleanLine(bad(value), 10)).toBe('<non-string>');
    });
    test('a clean line within the limit is returned as it is', () => {
        expect(cleanLine('fix: a', 10)).toBe('fix: a');
        expect(cleanLine('1234567890', 10)).toBe('1234567890');
    });
    test('a line one unit over the limit is cut and ends with an ellipsis, within the limit', () => {
        expect(cleanLine('12345678901', 10)).toBe('123456789\u2026');
    });
    test('control characters and line breaks are escaped', () => {
        const out = cleanLine('a\u001b[31m\nb\u2028c\u0085d\u007fe', 100);
        expect(out).toBe('a\\u001b[31m\\u000ab\\u2028c\\u0085d\\u007fe');
        expect(out).not.toMatch(UNSAFE);
    });
    test('bidi marks are escaped', () => {
        expect(cleanLine('a\u202eb\u2066c', 100)).toBe('a\\u202eb\\u2066c');
    });
    test('the escapes count against the limit: the result never exceeds it', () => {
        const out = cleanLine('\u001b'.repeat(50), 20);
        expect(out.length).toBe(20);
        expect(out.endsWith('\u2026')).toBe(true);
    });
    test('a surrogate pair is never split by the cut', () => {
        const out = cleanLine(`${'x'.repeat(8)}\u{1F600}\u{1F600}`, 9);
        expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
        expect(out.length).toBeLessThanOrEqual(9);
    });
    test('a very long text is cut in linear time', () => {
        const start = Date.now();
        expect(cleanLine('\u001b'.repeat(5_000_000), 1024).length).toBe(1024);
        expect(Date.now() - start).toBeLessThan(LINEAR_TIME_BOUND_MS);
    });
});
