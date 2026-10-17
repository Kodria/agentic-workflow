import { isSafeMultiline, isSingleLine } from '../../../src/core/changes/validate-shape';

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
