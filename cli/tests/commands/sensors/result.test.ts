import { interpretResult } from '../../../src/commands/sensors/result';
import type { PreparedSensorExecution } from '../../../src/commands/sensors/types';
import { exited, ok } from './exec-fixtures';

function prepared(overrides: Partial<PreparedSensorExecution> = {}): PreparedSensorExecution {
    return {
        name: 'iac-format',
        formatter: 'exit-code',
        timeoutMs: 30_000,
        timeoutSource: 'project',
        requestedScope: 'full',
        effectiveScope: 'full',
        certification: 'project-declared',
        command: { kind: 'structured', value: { executable: 'node', resolution: 'path', args: ['check.js'] } },
        ...overrides,
    };
}

describe('interpretResult exit-code formatter (RF-2.4)', () => {
    it('maps exit 0 to pass with no per-file findings', () => {
        const result = interpretResult(prepared(), ok('all good\n'));
        expect(result).toMatchObject({
            name: 'iac-format',
            status: 'pass',
            errors: [],
            certification: 'project-declared',
        });
        expect(result.errors.every(error => error.file === undefined)).toBe(true);
    });

    it('maps non-zero exit to fail with truncated combined stdout/stderr evidence and no invented per-file findings', () => {
        const long = `${'x'.repeat(300)}\n`;
        const result = interpretResult(prepared(), exited(1, long, 'stderr-tail\n'));
        expect(result.status).toBe('fail');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.file).toBeUndefined();
        expect(result.errors[0]!.line).toBeUndefined();
        expect(result.errors[0]!.rule).toBeUndefined();
        expect(result.errors[0]!.message.length).toBeLessThanOrEqual(220);
        expect(result.errors[0]!.message).toMatch(/x{10,}|stderr-tail|exit 1/);
        expect(result.certification).toBe('project-declared');
    });
});
