import { parseTscOutput } from '../../../../src/commands/sensors/formatters/tsc';

describe('parseTscOutput', () => {
    it('parses a standard tsc error line', () => {
        const raw = "src/auth.ts(23,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.";
        const errors = parseTscOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/auth.ts');
        expect(errors[0].line).toBe(23);
        expect(errors[0].rule).toBe('TS2322');
        expect(errors[0].message).toMatch('SENSOR[typecheck]');
        expect(errors[0].message).toMatch('Fix:');
    });

    it('returns empty array for clean output', () => {
        expect(parseTscOutput('')).toEqual([]);
        expect(parseTscOutput('Found 0 errors.')).toEqual([]);
    });

    it('ignores malformed lines, parses valid ones', () => {
        const raw = 'some random text\nsrc/file.ts(1,1): error TS0000: Real error.';
        const errors = parseTscOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/file.ts');
    });
});
