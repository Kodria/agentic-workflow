import { parseEslintOutput } from '../../../../src/commands/sensors/formatters/eslint';

const SAMPLE = JSON.stringify([
    {
        filePath: '/home/user/project/src/index.ts',
        messages: [
            { ruleId: 'no-unused-vars', severity: 2, message: "'x' is assigned a value but never used.", line: 42, column: 5 },
            { ruleId: 'no-console', severity: 1, message: 'Unexpected console statement.', line: 10, column: 1 }
        ]
    }
]);

describe('parseEslintOutput', () => {
    let cwdSpy: jest.SpyInstance;
    beforeEach(() => { cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/home/user/project'); });
    afterEach(() => { cwdSpy.mockRestore(); });

    it('parses ESLint JSON and filters severity-1 warnings', () => {
        const errors = parseEslintOutput(SAMPLE);
        expect(errors).toHaveLength(1);
        expect(errors[0].rule).toBe('no-unused-vars');
        expect(errors[0].line).toBe(42);
        expect(errors[0].message).toMatch('SENSOR[lint]');
        expect(errors[0].message).toMatch('Fix:');
    });

    it('returns empty array for malformed JSON', () => {
        expect(parseEslintOutput('not json')).toEqual([]);
    });

    it('returns empty array when all messages are warnings', () => {
        const warnings = JSON.stringify([{ filePath: '/p/f.ts', messages: [{ ruleId: 'r', severity: 1, message: 'w', line: 1, column: 1 }] }]);
        expect(parseEslintOutput(warnings)).toEqual([]);
    });
});
