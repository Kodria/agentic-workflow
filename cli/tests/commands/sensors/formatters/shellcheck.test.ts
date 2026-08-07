import { parseShellcheckOutput } from '../../../../src/commands/sensors/formatters/shellcheck';

describe('parseShellcheckOutput', () => {
    it('parses an error-level finding (real captured output: unbalanced if/then)', () => {
        const raw = JSON.stringify([
            { file: 'syntaxerr.sh', line: 2, endLine: 2, column: 1, endColumn: 1, level: 'error', code: 1049, message: "Did you forget the 'then' for this 'if'?", fix: null },
        ]);
        const errors = parseShellcheckOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('syntaxerr.sh');
        expect(errors[0].line).toBe(2);
        expect(errors[0].column).toBe(1);
        expect(errors[0].rule).toBe('SC1049'); // shellcheck's own stable SC-prefix convention
        expect(errors[0].message).toMatch('SENSOR[lint]');
        expect(errors[0].message).toMatch('https://www.shellcheck.net/wiki/SC1049');
    });

    it('parses a warning-level finding (real captured output: unused variable)', () => {
        const raw = JSON.stringify([
            { file: 'bad.sh', line: 7, endLine: 7, column: 1, endColumn: 4, level: 'warning', code: 2034, message: 'FOO appears unused. Verify use (or export if used externally).', fix: null },
        ]);
        const errors = parseShellcheckOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].rule).toBe('SC2034');
    });

    // Deliberate choice, mirroring eslint.ts's `severity < 2` filter (which drops
    // eslint's "warn"): shellcheck's `info`/`style` levels are advisory — quoting
    // preferences, portability nits, not genuine breakage — and are excluded so
    // findings stay real problems rather than 100% of shellcheck's advisory noise.
    // Only `error`/`warning` are reported.
    it('excludes info- and style-level findings (real captured output: SC2086, SC2268)', () => {
        const raw = JSON.stringify([
            { file: 'bad.sh', line: 4, endLine: 4, column: 6, endColumn: 9, level: 'style', code: 2268, message: 'Avoid x-prefix in comparisons as it no longer serves a purpose.', fix: null },
            { file: 'bad.sh', line: 4, endLine: 4, column: 7, endColumn: 9, level: 'info', code: 2086, message: 'Double quote to prevent globbing and word splitting.', fix: null },
        ]);
        expect(parseShellcheckOutput(raw)).toEqual([]);
    });

    it('returns empty array for a clean run (real captured output: [])', () => {
        expect(parseShellcheckOutput('[]')).toEqual([]);
    });

    it('returns empty array for malformed JSON', () => {
        expect(parseShellcheckOutput('not json')).toEqual([]);
    });
});
