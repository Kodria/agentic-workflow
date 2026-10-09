import { executePrepared, interpretResult } from '../../../src/commands/sensors/result';
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
    });

    it('maps non-zero exit to fail with truncated combined stdout/stderr evidence and no invented per-file findings', () => {
        const long = `${'x'.repeat(300)}\n`;
        const result = interpretResult(prepared(), exited(1, long, 'stderr-tail\n'));
        expect(result.status).toBe('fail');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.file).toBeUndefined();
        expect(result.errors[0]!.line).toBeUndefined();
        expect(result.errors[0]!.rule).toBeUndefined();
        // Combined = stdout+stderr; truncateEvidence caps at 200 — must be truncated
        // stdout-first content, not a loose "exit 1" / stderr-only fallback.
        expect(result.errors[0]!.message.length).toBeLessThanOrEqual(200);
        expect(result.errors[0]!.message).toMatch(/^x{10,}/);
        expect(result.errors[0]!.message).not.toMatch(/exit 1/);
        expect(result.certification).toBe('project-declared');
    });

    it('maps non-zero exit with empty stdout/stderr to fail evidence that includes exit N', () => {
        const result = interpretResult(prepared(), exited(7, '', ''));
        expect(result.status).toBe('fail');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]!.file).toBeUndefined();
        expect(result.errors[0]!.message).toMatch(/exit 7/);
    });
});

describe('executePrepared synthetic provenance (RF-2.2)', () => {
    it('includes certification on synthetic/disabled results the same way interpretResult does', async () => {
        const result = await executePrepared(prepared({
            command: undefined,
            syntheticStatus: 'skipped',
            syntheticReason: 'disabled',
            certification: 'project-declared',
        }));
        expect(result).toMatchObject({
            name: 'iac-format',
            status: 'skipped',
            skipReason: 'disabled',
            certification: 'project-declared',
        });
    });
});
