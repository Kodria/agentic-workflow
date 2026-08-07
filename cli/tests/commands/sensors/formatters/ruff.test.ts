import { parseRuffOutput } from '../../../../src/commands/sensors/formatters/ruff';

// Real `ruff check . --output-format json` output, captured against a fabricated
// fixture (unused import + unused local variable).
const SAMPLE = JSON.stringify([
    {
        cell: null,
        code: 'F401',
        end_location: { column: 10, row: 1 },
        filename: '/home/user/project/bad.py',
        fix: {
            applicability: 'safe',
            edits: [{ content: '', end_location: { column: 1, row: 2 }, location: { column: 1, row: 1 } }],
            message: 'Remove unused import: `os`',
        },
        location: { column: 8, row: 1 },
        message: '`os` imported but unused',
        noqa_row: 1,
        severity: 'error',
        url: 'https://docs.astral.sh/ruff/rules/unused-import',
    },
    {
        cell: null,
        code: 'F841',
        end_location: { column: 6, row: 4 },
        filename: '/home/user/project/bad.py',
        fix: {
            applicability: 'unsafe',
            edits: [{ content: '', end_location: { column: 1, row: 5 }, location: { column: 1, row: 4 } }],
            message: 'Remove assignment to unused variable `x`',
        },
        location: { column: 5, row: 4 },
        message: 'Local variable `x` is assigned to but never used',
        noqa_row: 4,
        severity: 'error',
        url: 'https://docs.astral.sh/ruff/rules/unused-variable',
    },
]);

describe('parseRuffOutput', () => {
    let cwdSpy: jest.SpyInstance;
    beforeEach(() => { cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/home/user/project'); });
    afterEach(() => { cwdSpy.mockRestore(); });

    it('parses ruff JSON output into SensorErrors', () => {
        const errors = parseRuffOutput(SAMPLE);
        expect(errors).toHaveLength(2);
        expect(errors[0].file).toBe('bad.py'); // relativized against cwd
        expect(errors[0].line).toBe(1);
        expect(errors[0].column).toBe(8);
        expect(errors[0].rule).toBe('F401');
        expect(errors[0].message).toMatch('SENSOR[lint]');
        expect(errors[0].message).toMatch('Fix:');
        expect(errors[1].rule).toBe('F841');
    });

    it('returns empty array for a clean run ([])', () => {
        expect(parseRuffOutput('[]')).toEqual([]);
    });

    it('returns empty array for malformed JSON', () => {
        expect(parseRuffOutput('not json')).toEqual([]);
    });
});
