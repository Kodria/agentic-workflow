import { parseMypyOutput } from '../../../../src/commands/sensors/formatters/mypy';

describe('parseMypyOutput', () => {
    it('parses a single mypy error line (real captured output)', () => {
        const raw = 'bad.py:6: error: Incompatible return value type (got "int", expected "str")  [return-value]\n'
            + 'Found 1 error in 1 file (checked 1 source file)';
        const errors = parseMypyOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('bad.py');
        expect(errors[0].line).toBe(6);
        expect(errors[0].rule).toBe('return-value');
        expect(errors[0].message).toMatch('SENSOR[typecheck]');
        expect(errors[0].message).toMatch('Fix:');
        expect(errors[0].column).toBeUndefined(); // plain mypy output has no column
    });

    it('parses multiple error lines and ignores the trailing summary', () => {
        const raw = 'multi.py:2: error: Incompatible return value type (got "int", expected "str")  [return-value]\n'
            + 'multi.py:5: error: Incompatible return value type (got "str", expected "int")  [return-value]\n'
            + 'multi.py:7: error: Incompatible types in assignment (expression has type "str", variable has type "int")  [assignment]\n'
            + 'Found 3 errors in 1 file (checked 1 source file)';
        const errors = parseMypyOutput(raw);
        expect(errors).toHaveLength(3);
        expect(errors.map(e => e.line)).toEqual([2, 5, 7]);
        expect(errors[2].rule).toBe('assignment');
    });

    it('excludes `note:` lines — only `error:` lines are findings', () => {
        // Real captured output: `reveal_type()` prints a note line ahead of the actual
        // error, and an incompatible override reports without a trailing summary change.
        const raw = 'notetest.py:2: note: Revealed type is "builtins.int"\n'
            + 'notetest.py:10: error: Return type "str" of "foo" incompatible with return type "int" in supertype "A"  [override]\n'
            + 'Found 1 error in 1 file (checked 1 source file)';
        const errors = parseMypyOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].line).toBe(10);
        expect(errors[0].rule).toBe('override');
    });

    it('handles an error line with no trailing [code] bracket', () => {
        const raw = 'foo.py:3: error: some mypy error kinds omit the bracketed code';
        const errors = parseMypyOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].rule).toBeUndefined();
        expect(errors[0].message).toContain('n/a');
    });

    it('returns empty array for a clean run (real captured success line)', () => {
        expect(parseMypyOutput('Success: no issues found in 1 source file')).toEqual([]);
        expect(parseMypyOutput('')).toEqual([]);
    });
});
