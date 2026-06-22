import path from 'path';
import { parseEslintOutput } from '../../../src/commands/sensors/formatters/eslint';

describe('parseEslintOutput — relative path normalization', () => {
  it('produces a cwd-relative path using the OS separator', () => {
    const cwd = process.cwd();
    const abs = path.join(cwd, 'src', 'foo.ts');
    const raw = JSON.stringify([
      { filePath: abs, messages: [{ ruleId: 'no-eval', severity: 2, message: 'no eval', line: 3, column: 1 }] },
    ]);
    const errors = parseEslintOutput(raw);
    expect(errors).toHaveLength(1);
    const first = errors[0];
    if (!first) throw new Error('Expected at least one error');
    // path.join('src','foo.ts') uses the OS separator; on POSIX this is 'src/foo.ts'
    expect(first.file).toBe(path.join('src', 'foo.ts'));
    const file = first.file ?? '';
    expect(file.startsWith(path.sep)).toBe(false); // genuinely relative
  });

  it('preserves the absolute path for files outside cwd', () => {
    const abs = '/some/other/project/file.ts';
    const raw = JSON.stringify([
      { filePath: abs, messages: [{ ruleId: 'no-eval', severity: 2, message: 'no eval', line: 1, column: 1 }] },
    ]);
    const errors = parseEslintOutput(raw);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.file).toBe(abs); // absolute path preserved, no traversal strings
  });
});
