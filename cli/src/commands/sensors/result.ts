import { runCommand, runStructuredCommand, type ExecResult } from './exec';
import { partition } from './baseline';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';
import { parseTestOutput } from './formatters/test';
import { parseMypyOutput } from './formatters/mypy';
import { parseRuffOutput } from './formatters/ruff';
import { parseShellcheckOutput } from './formatters/shellcheck';
import type { PreparedSensorExecution, SensorError, SensorResult } from './types';

const MAX_BUFFER = 64 * 1024 * 1024;

function formatterFor(name: string, formatter?: string): (raw: string) => SensorError[] {
    if (formatter !== undefined) {
        switch (formatter) {
            case 'tsc': return parseTscOutput;
            case 'eslint-llm': return parseEslintOutput;
            case 'semgrep': return parseSemgrepOutput;
            case 'test': return parseTestOutput;
            case 'mypy': return parseMypyOutput;
            case 'ruff': return parseRuffOutput;
            case 'shellcheck': return parseShellcheckOutput;
            case 'generic': return parseGenericOutput;
            default: return parseGenericOutput;
        }
    }
    if (name === 'typecheck') return parseTscOutput;
    if (name === 'lint') return parseEslintOutput;
    if (name === 'security') return parseSemgrepOutput;
    if (name === 'test') return parseTestOutput;
    return parseGenericOutput;
}

function executionEvidence(prepared: PreparedSensorExecution, elapsedMs: number): NonNullable<SensorResult['execution']> {
    return {
        timeoutMs: prepared.timeoutMs,
        timeoutSource: prepared.timeoutSource,
        elapsedMs,
        requestedScope: prepared.requestedScope,
        effectiveScope: prepared.effectiveScope,
        ...(prepared.files !== undefined ? { files: prepared.files } : {}),
        ...(prepared.scopeReason ? { scopeReason: prepared.scopeReason } : {}),
    };
}

function validatePrepared(prepared: PreparedSensorExecution): void {
    if (!prepared || typeof prepared !== 'object' || typeof prepared.name !== 'string' || prepared.name === '') throw new Error('prepared sensor requires a nonempty name');
    if (!Number.isSafeInteger(prepared.timeoutMs) || prepared.timeoutMs <= 0) throw new Error('prepared sensor timeoutMs must be a positive safe integer');
    if (!['project', 'pack', 'fallback'].includes(prepared.timeoutSource)) throw new Error('prepared sensor timeoutSource is invalid');
    if (!['full', 'changed'].includes(prepared.requestedScope) || !['full', 'changed'].includes(prepared.effectiveScope)) throw new Error('prepared sensor scope is invalid');
    if (prepared.files !== undefined && (!Number.isSafeInteger(prepared.files) || prepared.files < 0)) throw new Error('prepared sensor files must be a non-negative safe integer');
    if (prepared.command !== undefined && (prepared.command.kind !== 'legacy' && prepared.command.kind !== 'structured')) throw new Error('prepared sensor command kind is invalid');
}

function scoped(result: SensorResult, prepared: PreparedSensorExecution): SensorResult {
    return {
        ...result,
        ...(prepared.effectiveScope === 'changed' ? { scope: 'changed' as const } : {}),
    };
}

/** Interpret one raw bounded process result without knowing its manifest format. */
export function interpretResult(prepared: PreparedSensorExecution, raw: ExecResult): SensorResult {
    validatePrepared(prepared);
    if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.elapsedMs) || raw.elapsedMs < 0) throw new Error('execution result requires a non-negative safe-integer elapsedMs');
    const execution = executionEvidence(prepared, raw.elapsedMs);
    const withEvidence = (result: Omit<SensorResult, 'execution'>): SensorResult => ({
        ...result,
        ...(prepared.effectiveScope === 'changed' ? { scope: 'changed' as const } : {}),
        execution,
    });
    const format = formatterFor(prepared.name, prepared.formatter);

    if (raw.spawnError) return withEvidence({ name: prepared.name, status: 'fail', errors: [{ message: `sensor could not be started: ${raw.spawnError.message}` }] });
    if (raw.timedOut || raw.overflowed) {
        const reason = raw.timedOut ? `timeout after ${prepared.timeoutMs}ms` : `output exceeded ${MAX_BUFFER} bytes`;
        const errors = format(raw.stdout + raw.stderr);
        if (errors.length > 0) return withEvidence({ name: prepared.name, status: 'fail', errors, incomplete: `${reason} — findings below are from partial output; the run did not finish` });
        return withEvidence({ name: prepared.name, status: 'inconclusive', errors: [], skipReason: reason });
    }
    if (raw.code === 0) {
        const errors = format(raw.stdout);
        return withEvidence({ name: prepared.name, status: errors.length ? 'fail' : 'pass', errors });
    }

    const output = raw.stdout + raw.stderr;
    const errors = format(output);
    if (errors.length > 0) return withEvidence({ name: prepared.name, status: 'fail', errors });
    const lower = output.toLowerCase();
    const toolMissing = raw.code === 127
        || lower.includes('command not found')
        || lower.includes('is not recognized as an internal or external command')
        || lower.includes('enoent')
        || lower.includes('could not determine executable');
    if (toolMissing) return withEvidence({ name: prepared.name, status: 'fail', errors: [{ message: `sensor tool not available: ${output.slice(0, 200)}` }] });
    if (prepared.name === 'test') return withEvidence({ name: prepared.name, status: 'fail', errors: [{ message: `SENSOR[${prepared.name}] failed (exit ${raw.code})` }] });
    return withEvidence({ name: prepared.name, status: 'inconclusive', errors: [], skipReason: `exit ${raw.code}: ${output.slice(0, 200)}` });
}

/** Execute a validated prepared command, or render its deliberate synthetic result. */
export async function executePrepared(prepared: PreparedSensorExecution, cwd = process.cwd()): Promise<SensorResult> {
    validatePrepared(prepared);
    if (prepared.syntheticStatus !== undefined || prepared.command === undefined) {
        const status = prepared.syntheticStatus ?? 'inconclusive';
        return scoped({
            name: prepared.name,
            status,
            errors: [],
            ...(prepared.syntheticReason ? { skipReason: prepared.syntheticReason } : {}),
            execution: executionEvidence(prepared, 0),
        }, prepared);
    }
    const options = { timeout: prepared.timeoutMs, cwd, maxBuffer: MAX_BUFFER };
    const raw = prepared.command.kind === 'legacy'
        ? await runCommand(prepared.command.value, options)
        : await runStructuredCommand(prepared.command.value, options);
    return interpretResult(prepared, raw);
}

/** Apply baseline suppression only to completed verdicts. */
export function applyBaseline(result: SensorResult, accepted: string[] | undefined): SensorResult {
    if (result.status === 'skipped' || result.status === 'inconclusive') return result;
    const { newErrors, suppressed } = partition(result.name, result.errors, accepted);
    if (suppressed === 0) return result;
    return { ...result, errors: newErrors, status: newErrors.length > 0 ? 'fail' : 'pass', newCount: newErrors.length, baselineCount: suppressed };
}
