import { parseSemgrepOutput } from '../../../../src/commands/sensors/formatters/semgrep';
import { parseGenericOutput } from '../../../../src/commands/sensors/formatters/generic';

const SAMPLE_SEMGREP = JSON.stringify({
    results: [
        { check_id: 'js.sql-injection', path: 'src/db.ts', start: { line: 15 }, extra: { message: 'SQL injection risk detected.' } }
    ]
});

describe('parseSemgrepOutput', () => {
    it('parses Semgrep JSON results', () => {
        const errors = parseSemgrepOutput(SAMPLE_SEMGREP);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/db.ts');
        expect(errors[0].line).toBe(15);
        expect(errors[0].rule).toBe('js.sql-injection');
        expect(errors[0].message).toMatch('SENSOR[security]');
        expect(errors[0].message).toMatch('Fix:');
    });

    it('returns empty array for malformed JSON', () => {
        expect(parseSemgrepOutput('bad json')).toEqual([]);
    });

    it('returns empty array when results is empty', () => {
        expect(parseSemgrepOutput(JSON.stringify({ results: [] }))).toEqual([]);
    });
});

describe('parseGenericOutput', () => {
    it('wraps raw output with SENSOR[raw] prefix', () => {
        const errors = parseGenericOutput('something went wrong');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch('SENSOR[raw]');
        expect(errors[0].message).toMatch('something went wrong');
    });

    it('returns empty array for empty output', () => {
        expect(parseGenericOutput('')).toEqual([]);
        expect(parseGenericOutput('   ')).toEqual([]);
    });
});
