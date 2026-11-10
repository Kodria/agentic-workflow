import path from 'path';
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
import {
    candidateResultsPaths,
    clearTestResultCandidates,
    resolveUsableArtifact,
    snapshotRegularFile,
    snapshotTestResultCandidates,
    TEST_RESULTS_MAX_BYTES,
    type ResultFileIdentity,
} from './test-results-artifact';
import type { PreparedSensorExecution, SensorError, SensorFailureKind, SensorResult } from './types';

// Re-export artifact helpers used by tests / callers (RF-1.2–1.11).
export {
    TEST_RESULTS_MAX_BYTES,
    candidateResultsPaths,
    clearTestResultCandidates,
    snapshotTestResultCandidates,
};
export type { ResultFileIdentity };

const MAX_BUFFER = 64 * 1024 * 1024;

export type InterpretResultOpts = {
    cwd?: string;
    /**
     * Pre-spawn identities keyed by relative candidate path; `null` means absent.
     * Required for file-first usability (RF-1.9 fail-closed): omit/undefined → no usable artifact.
     */
    priorIdentities?: Record<string, ResultFileIdentity | null>;
};

export type ExecutePreparedOpts = {
    readOnly?: boolean;
};

/** Exit-code sensors signal solely via process status — never invent per-file findings. */
function parseExitCodeOutput(_raw: string): SensorError[] {
    return [];
}

function truncateEvidence(raw: string, max = 200): string {
    return raw.length <= max ? raw : raw.slice(0, max);
}

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
            case 'exit-code': return parseExitCodeOutput;
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
    if (!['full', 'changed', 'slice'].includes(prepared.requestedScope) || !['full', 'changed', 'slice'].includes(prepared.effectiveScope)) throw new Error('prepared sensor scope is invalid');
    if (prepared.files !== undefined && (!Number.isSafeInteger(prepared.files) || prepared.files < 0)) throw new Error('prepared sensor files must be a non-negative safe integer');
    if (prepared.command !== undefined && (prepared.command.kind !== 'legacy' && prepared.command.kind !== 'structured')) throw new Error('prepared sensor command kind is invalid');
}

function scoped(result: SensorResult, prepared: PreparedSensorExecution): SensorResult {
    return {
        ...result,
        ...(prepared.effectiveScope === 'changed' || prepared.effectiveScope === 'slice'
            ? { scope: prepared.effectiveScope }
            : {}),
    };
}

function withFailureKind(result: Omit<SensorResult, 'execution'>, kind: SensorFailureKind): Omit<SensorResult, 'execution'> {
    return result.status === 'fail' ? { ...result, failureKind: kind } : result;
}

export function isTestFindingsSensor(prepared: PreparedSensorExecution): boolean {
    return prepared.formatter === 'test' || (prepared.formatter === undefined && prepared.name === 'test');
}

function syntheticTestExit(prepared: PreparedSensorExecution, code: number | null): Omit<SensorResult, 'execution'> {
    return withFailureKind(
        { name: prepared.name, status: 'fail', errors: [{ message: `SENSOR[${prepared.name}] failed (exit ${code})` }] },
        'exit-code',
    );
}

function interpretTestFindings(
    prepared: PreparedSensorExecution,
    raw: ExecResult,
    opts: InterpretResultOpts | undefined,
    withEvidence: (result: Omit<SensorResult, 'execution'>) => SensorResult,
): SensorResult {
    const cwd = opts?.cwd ?? process.cwd();
    const usable = resolveUsableArtifact(prepared, cwd, opts?.priorIdentities);

    if (raw.code === 0) {
        if (!usable || usable.parsed.findings.length === 0) {
            return withEvidence({ name: prepared.name, status: 'pass', errors: [] });
        }
        return withEvidence(withFailureKind(
            { name: prepared.name, status: 'fail', errors: usable.parsed.findings },
            'findings',
        ));
    }

    if (!usable) {
        return withEvidence(syntheticTestExit(prepared, raw.code));
    }
    if (usable.parsed.findings.length === 0) {
        return withEvidence(syntheticTestExit(prepared, raw.code));
    }
    if (!usable.parsed.explainsNonZeroExit) {
        return withEvidence(syntheticTestExit(prepared, raw.code));
    }
    return withEvidence(withFailureKind(
        { name: prepared.name, status: 'fail', errors: usable.parsed.findings },
        'findings',
    ));
}

/** Interpret one raw bounded process result without knowing its manifest format. */
export function interpretResult(
    prepared: PreparedSensorExecution,
    raw: ExecResult,
    opts?: InterpretResultOpts,
): SensorResult {
    validatePrepared(prepared);
    if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.elapsedMs) || raw.elapsedMs < 0) throw new Error('execution result requires a non-negative safe-integer elapsedMs');
    const execution = executionEvidence(prepared, raw.elapsedMs);
    const withEvidence = (result: Omit<SensorResult, 'execution'>): SensorResult => ({
        ...result,
        ...(prepared.certification ? { certification: prepared.certification } : {}),
        ...(prepared.effectiveScope === 'changed' || prepared.effectiveScope === 'slice'
            ? { scope: prepared.effectiveScope }
            : {}),
        execution,
    });
    const format = formatterFor(prepared.name, prepared.formatter);

    if (raw.spawnError) {
        return withEvidence(withFailureKind(
            { name: prepared.name, status: 'fail', errors: [{ message: `sensor could not be started: ${raw.spawnError.message}` }] },
            'missing-binary',
        ));
    }
    if (raw.timedOut || raw.overflowed) {
        const reason = raw.timedOut ? `timeout after ${prepared.timeoutMs}ms` : `output exceeded ${MAX_BUFFER} bytes`;
        const errors = format(raw.stdout + raw.stderr);
        if (errors.length > 0) {
            return withEvidence(withFailureKind(
                { name: prepared.name, status: 'fail', errors, incomplete: `${reason} — findings below are from partial output; the run did not finish` },
                'findings',
            ));
        }
        return withEvidence({ name: prepared.name, status: 'inconclusive', errors: [], skipReason: reason });
    }

    if (isTestFindingsSensor(prepared)) {
        return interpretTestFindings(prepared, raw, opts, withEvidence);
    }

    if (raw.code === 0) {
        if (format === parseGenericOutput || format === parseExitCodeOutput) {
            return withEvidence({ name: prepared.name, status: 'pass', errors: [] });
        }
        const errors = format(raw.stdout);
        if (errors.length === 0) return withEvidence({ name: prepared.name, status: 'pass', errors: [] });
        return withEvidence(withFailureKind({ name: prepared.name, status: 'fail', errors }, 'findings'));
    }

    const output = raw.stdout + raw.stderr;
    if (prepared.formatter === 'exit-code' || format === parseExitCodeOutput) {
        const combined = output.trim();
        const evidence = truncateEvidence(combined.length > 0 ? combined : `exit ${raw.code}`);
        return withEvidence(withFailureKind(
            { name: prepared.name, status: 'fail', errors: [{ message: evidence }] },
            'exit-code',
        ));
    }
    const errors = format(output);
    if (errors.length > 0) return withEvidence(withFailureKind({ name: prepared.name, status: 'fail', errors }, 'findings'));
    const lower = output.toLowerCase();
    const toolMissing = raw.code === 127
        || lower.includes('command not found')
        || lower.includes('is not recognized as an internal or external command')
        || lower.includes('enoent')
        || lower.includes('could not determine executable');
    if (toolMissing) {
        return withEvidence(withFailureKind(
            { name: prepared.name, status: 'fail', errors: [{ message: `sensor tool not available: ${truncateEvidence(output)}` }] },
            'missing-binary',
        ));
    }
    if (prepared.name === 'test') {
        return withEvidence(syntheticTestExit(prepared, raw.code));
    }
    return withEvidence({ name: prepared.name, status: 'inconclusive', errors: [], skipReason: `exit ${raw.code}: ${truncateEvidence(output)}` });
}

/** Execute a validated prepared command, or render its deliberate synthetic result. */
export async function executePrepared(
    prepared: PreparedSensorExecution,
    cwd = process.cwd(),
    opts?: ExecutePreparedOpts,
): Promise<SensorResult> {
    validatePrepared(prepared);
    if (prepared.syntheticStatus !== undefined || prepared.command === undefined) {
        const status = prepared.syntheticStatus ?? 'inconclusive';
        return scoped({
            name: prepared.name,
            status,
            errors: [],
            ...(prepared.syntheticReason ? { skipReason: prepared.syntheticReason } : {}),
            ...(prepared.certification ? { certification: prepared.certification } : {}),
            execution: executionEvidence(prepared, 0),
        }, prepared);
    }

    let priorIdentities: Record<string, ResultFileIdentity | null> | undefined;
    if (isTestFindingsSensor(prepared)) {
        const paths = candidateResultsPaths(prepared);
        priorIdentities = snapshotTestResultCandidates(cwd, paths);
        clearTestResultCandidates(cwd, paths, { readOnly: opts?.readOnly === true });
        // After clear: absent paths are "no prior" so a rewrite is always fresh even if
        // the filesystem reuses the same inode/mtime/size (RF-1.9).
        for (const rel of paths) {
            if (snapshotRegularFile(path.resolve(cwd, rel)) === null) {
                priorIdentities[rel] = null;
            }
        }
    }

    const options = { timeout: prepared.timeoutMs, cwd, maxBuffer: MAX_BUFFER };
    const raw = prepared.command.kind === 'legacy'
        ? await runCommand(prepared.command.value, options)
        : await runStructuredCommand(prepared.command.value, options);
    return interpretResult(prepared, raw, { cwd, priorIdentities });
}

/** Apply baseline suppression only to completed verdicts. */
export function applyBaseline(result: SensorResult, accepted: string[] | undefined): SensorResult {
    if (result.status === 'skipped' || result.status === 'inconclusive') return result;
    const { newErrors, suppressed } = partition(result.name, result.errors, accepted);
    if (suppressed === 0) return result;
    const status = newErrors.length > 0 ? 'fail' as const : 'pass' as const;
    const { failureKind: _drop, ...rest } = result;
    return {
        ...rest,
        errors: newErrors,
        status,
        // failureKind only applies to fail; a baseline-suppressed pass must not keep it (QA-4).
        ...(status === 'fail' && result.failureKind ? { failureKind: result.failureKind } : {}),
        newCount: newErrors.length,
        baselineCount: suppressed,
    };
}
