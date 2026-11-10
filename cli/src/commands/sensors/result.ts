import fs from 'fs';
import path from 'path';
import { runCommand, runStructuredCommand, type ExecResult } from './exec';
import { partition } from './baseline';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';
import { parseTestOutput } from './formatters/test';
import { parseJestJson } from './formatters/test-jest';
import { parseJunitXml } from './formatters/test-junit';
import type { TestParseResult } from './formatters/test-identity';
import { parseMypyOutput } from './formatters/mypy';
import { parseRuffOutput } from './formatters/ruff';
import { parseShellcheckOutput } from './formatters/shellcheck';
import { DEFAULT_EXCLUSION_NAMES } from './read-only-observation';
import type { PreparedSensorExecution, SensorError, SensorFailureKind, SensorResult } from './types';

const MAX_BUFFER = 64 * 1024 * 1024;

/** Max bytes for a structured test-results artifact (RF-1.3). */
export const TEST_RESULTS_MAX_BYTES = 16 * 1024 * 1024;

const DEFAULT_RESULTS_FILES = [
    'coverage/awm-test-results.json',
    'coverage/awm-test-results.xml',
] as const;

export type ResultFileIdentity = {
    mtimeMs: number;
    size: number;
    ino?: number;
};

export type InterpretResultOpts = {
    cwd?: string;
    /** Pre-spawn identities keyed by relative candidate path; `null` means absent. */
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

/** Candidate relative paths for the test-results artifact (RF-1.2). */
export function candidateResultsPaths(prepared: PreparedSensorExecution): string[] {
    if (typeof prepared.resultsFile === 'string' && prepared.resultsFile.length > 0) {
        return [prepared.resultsFile];
    }
    return [...DEFAULT_RESULTS_FILES];
}

function pathContained(rootReal: string, candidateReal: string): boolean {
    const rel = path.relative(rootReal, candidateReal);
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function snapshotRegularFile(abs: string): ResultFileIdentity | null {
    try {
        const st = fs.lstatSync(abs);
        if (!st.isFile() || st.isSymbolicLink()) return null;
        return { mtimeMs: st.mtimeMs, size: st.size, ino: Number(st.ino) };
    } catch {
        return null;
    }
}

function identityChanged(prior: ResultFileIdentity | null | undefined, next: ResultFileIdentity): boolean {
    if (prior == null) return true;
    if (prior.mtimeMs !== next.mtimeMs) return true;
    if (prior.size !== next.size) return true;
    if (prior.ino !== undefined && next.ino !== undefined && prior.ino !== next.ino) return true;
    return false;
}

function exclusionAllowsUnlink(rel: string): boolean {
    const segments = rel.split(/[/\\]/).filter(Boolean);
    return segments.some((seg) => (DEFAULT_EXCLUSION_NAMES as readonly string[]).includes(seg));
}

/**
 * Contained pre-clear of candidate result files (RF-1.9 / RF-1.11).
 * Never unlinks a symlink leaf; refuses when the parent realpath escapes cwd.
 * Under readOnly, only unlinks when a path segment is in DEFAULT_EXCLUSION_NAMES.
 */
export function clearTestResultCandidates(
    cwd: string,
    paths: string[],
    opts?: { readOnly?: boolean },
): void {
    let rootReal: string;
    try {
        rootReal = fs.realpathSync(cwd);
    } catch {
        return;
    }
    for (const rel of paths) {
        if (opts?.readOnly && !exclusionAllowsUnlink(rel)) continue;
        const abs = path.resolve(cwd, rel);
        const parent = path.dirname(abs);
        let parentReal: string;
        try {
            parentReal = fs.realpathSync(parent);
        } catch {
            continue;
        }
        if (!pathContained(rootReal, parentReal)) continue;
        try {
            const st = fs.lstatSync(abs);
            if (st.isSymbolicLink()) continue;
            if (!st.isFile()) continue;
            fs.unlinkSync(abs);
        } catch {
            // Best-effort; identity snapshot remains authoritative for freshness.
        }
    }
}

export function snapshotTestResultCandidates(
    cwd: string,
    paths: string[],
): Record<string, ResultFileIdentity | null> {
    const out: Record<string, ResultFileIdentity | null> = {};
    for (const rel of paths) {
        out[rel] = snapshotRegularFile(path.resolve(cwd, rel));
    }
    return out;
}

function readContainedUtf8(cwd: string, rel: string): string | null {
    const abs = path.resolve(cwd, rel);
    let rootReal: string;
    try {
        rootReal = fs.realpathSync(cwd);
    } catch {
        return null;
    }
    let leafStat: fs.Stats;
    try {
        leafStat = fs.lstatSync(abs);
    } catch {
        return null;
    }
    if (!leafStat.isFile() || leafStat.isSymbolicLink()) return null;
    if (leafStat.size > TEST_RESULTS_MAX_BYTES) return null;
    let real: string;
    try {
        real = fs.realpathSync(abs);
    } catch {
        return null;
    }
    if (!pathContained(rootReal, real)) return null;
    // Refuse if any intermediate symlink made realpath leave a non-regular chain
    // already covered by leaf lstat; also re-check real path is still regular.
    try {
        const realStat = fs.lstatSync(real);
        if (!realStat.isFile() || realStat.isSymbolicLink()) return null;
        if (realStat.size > TEST_RESULTS_MAX_BYTES) return null;
    } catch {
        return null;
    }
    let buf: Buffer;
    try {
        buf = fs.readFileSync(real);
    } catch {
        return null;
    }
    if (buf.byteLength > TEST_RESULTS_MAX_BYTES) return null;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
        return null;
    }
}

function parseSucceeded(parsed: TestParseResult): boolean {
    // S1 parsers return explainsNonZeroExit:true for valid empty runs; false for malformed.
    return parsed.findings.length > 0 || parsed.explainsNonZeroExit;
}

function parseResultsContent(rel: string, content: string, cwd: string): TestParseResult | null {
    const lower = rel.toLowerCase();
    let parsed: TestParseResult;
    if (lower.endsWith('.json')) parsed = parseJestJson(content, cwd);
    else if (lower.endsWith('.xml')) parsed = parseJunitXml(content, cwd);
    else return null;
    return parseSucceeded(parsed) ? parsed : null;
}

type UsableArtifact = {
    rel: string;
    parsed: TestParseResult;
};

function resolveUsableArtifact(
    prepared: PreparedSensorExecution,
    cwd: string,
    priorIdentities?: Record<string, ResultFileIdentity | null>,
): UsableArtifact | null {
    for (const rel of candidateResultsPaths(prepared)) {
        const abs = path.resolve(cwd, rel);
        const next = snapshotRegularFile(abs);
        if (!next) continue;
        const prior = priorIdentities ? priorIdentities[rel] : null;
        // When priorIdentities is provided, require freshness. When absent (direct
        // interpretResult call without executePrepared), treat existing regular file
        // as a candidate (no prior snapshot ⇒ usable per RF-1.9).
        if (priorIdentities && !identityChanged(prior, next)) continue;
        const content = readContainedUtf8(cwd, rel);
        if (content === null) continue;
        const parsed = parseResultsContent(rel, content, cwd);
        if (!parsed) continue;
        return { rel, parsed };
    }
    return null;
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

    // Non-zero exit
    if (!usable) {
        return withEvidence(syntheticTestExit(prepared, raw.code));
    }
    if (usable.parsed.findings.length === 0) {
        return withEvidence(syntheticTestExit(prepared, raw.code));
    }
    if (!usable.parsed.explainsNonZeroExit) {
        // RF-1.10: unexplained → authoritative exit-code (baseline cannot pass via findings).
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
