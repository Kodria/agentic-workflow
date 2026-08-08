import path from 'path';
import { parseRuffOutput } from '../../../../src/commands/sensors/formatters/ruff';

// The formatter relativizes an absolute `filename` against `process.cwd()`
// using `path.sep`/`path.relative` (platform-native separators — see
// src/commands/sensors/formatters/ruff.ts). A hardcoded POSIX-style path here
// (`/home/user/project/bad.py`) never starts with the mocked cwd + `path.sep`
// on win32 (`\`), so the relativization silently no-ops and the full path
// passes through unchanged — the exact windows-latest CI failure this fixture
// used to reproduce. Building both the mocked cwd and the sample paths from
// `path.sep` keeps the fixture platform-correct without changing behavior on
// POSIX (path.join(path.sep, 'home', 'user', 'project') === '/home/user/project').
const PROJECT_ROOT = path.join(path.sep, 'home', 'user', 'project');
const BAD_PY = path.join(PROJECT_ROOT, 'bad.py');
const A_PY = path.join(PROJECT_ROOT, 'a.py');

// Real `ruff check . --output-format json` output, captured against a fabricated
// fixture (unused import + unused local variable).
const SAMPLE = JSON.stringify([
    {
        cell: null,
        code: 'F401',
        end_location: { column: 10, row: 1 },
        filename: BAD_PY,
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
        filename: BAD_PY,
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
    beforeEach(() => { cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(PROJECT_ROOT); });
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

    // Regression for Finding 2: valid JSON that isn't the expected shape (object, null,
    // number) must not throw when iterated — `JSON.parse` succeeding is not the same as
    // the result being an array.
    it.each([['{}'], ['null'], ['42'], ['"a string"']])('returns empty array for valid-but-non-array JSON: %s', (raw) => {
        expect(() => parseRuffOutput(raw)).not.toThrow();
        expect(parseRuffOutput(raw)).toEqual([]);
    });

    it('skips a null array element instead of crashing', () => {
        expect(() => parseRuffOutput('[null]')).not.toThrow();
        expect(parseRuffOutput('[null]')).toEqual([]);
    });

    it('skips an element with a null/missing location instead of crashing on .row/.column', () => {
        const raw = JSON.stringify([
            { code: 'F401', filename: A_PY, location: null, message: 'x' },
        ]);
        expect(() => parseRuffOutput(raw)).not.toThrow();
        expect(parseRuffOutput(raw)).toEqual([]);
    });

    it('skips a malformed element but still returns valid elements from the same array', () => {
        const raw = JSON.stringify([
            null,
            { code: 'F401', filename: A_PY, location: null, message: 'bad' },
            {
                code: 'F841', filename: BAD_PY,
                location: { column: 5, row: 4 }, message: 'Local variable `x` is assigned to but never used',
            },
        ]);
        const errors = parseRuffOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].rule).toBe('F841');
    });
});
