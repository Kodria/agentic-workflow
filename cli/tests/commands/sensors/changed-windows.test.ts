import { applyChangedCmd, changedScopeError } from '../../../src/commands/sensors/changed';

describe('applyChangedCmd — Windows quoting', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('double-quotes paths on win32 instead of POSIX single-quoting', () => {
        // `runCommand` spawns this string with `shell: true`, which is cmd.exe on
        // win32. cmd.exe does not treat single quotes as quoting syntax — it would
        // split `'my dir/a.ts'` into two garbage arguments on the space. Double
        // quotes are the form cmd.exe actually honors.
        expect(applyChangedCmd('eslint {files}', ['my dir/a.ts']))
            .toBe(`eslint "my dir/a.ts"`);
    });

    it('escapes an embedded double quote with a preceding backslash', () => {
        expect(applyChangedCmd('eslint {files}', ['weird"name.ts']))
            .toBe(`eslint "weird\\"name.ts"`);
    });

    it('handles a filename with both a space and an embedded quote together', () => {
        expect(applyChangedCmd('eslint {files}', ['my dir/it"s.ts']))
            .toBe(`eslint "my dir/it\\"s.ts"`);
    });

    it('doubles a lone trailing backslash so the closing quote is not escaped away', () => {
        // Bug 1 (correctness): a filename ending in a single `\` (e.g. a scoped path
        // like `report\`), naively closed with `..."report\""`, puts an ODD number of
        // backslashes (1) directly before the closing `"`. Per the documented
        // CommandLineToArgvW rule (learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments),
        // an odd backslash run before a `"` consumes the backslashes in pairs (0
        // literal here) and the last one escapes the quote into a literal character —
        // so the wrapper never closes and the argument is corrupted/unterminated.
        //
        // The correct output doubles the trailing run to an EVEN count (2) before the
        // closing quote: even backslashes before a `"` collapse to half as many
        // literal backslashes (1) and the `"` is read as a real delimiter, closing the
        // wrapper cleanly and recovering exactly the original single trailing `\`.
        expect(applyChangedCmd('eslint {files}', ['report\\']))
            .toBe(`eslint "report\\\\"`);
    });

    it('refuses unsafe filenames for legacy shell interpolation', () => {
        expect(changedScopeError({ files: ['src/a&b.ts'] })).toMatch(/cmd\.exe metacharacter/);
    });
});
