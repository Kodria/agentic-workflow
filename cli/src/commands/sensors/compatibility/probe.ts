import { runStructuredCommand, type ExecOptions, type ExecResult } from '../exec';
import type { CompatibilityProbe, StructuredCommand } from './types';

export type ProbeStatus = 'matched' | 'not-matched' | 'unverifiable';
export type ProbeResult = { status: ProbeStatus; reason: string };
export type ProbeEvidence = { cwd: string; toolExecutable?: string; toolResolution?: StructuredCommand['resolution']; pythonEnvironmentRoot?: StructuredCommand['pythonEnvironmentRoot']; environment?: StructuredCommand['environment']; configFiles?: string[]; scripts?: string[] };
export type ProbeExecutor = (command: StructuredCommand, options: ExecOptions) => Promise<ExecResult>;
const KINDS = new Set<CompatibilityProbe>(['version', 'eslint-print-config', 'typescript-show-config', 'semgrep-validate', 'package-script-present', 'config-present']);

function commandFor(kind: CompatibilityProbe, evidence: ProbeEvidence): StructuredCommand | null {
    const executable = evidence.toolExecutable ?? (kind.startsWith('typescript') ? 'tsc' : kind.startsWith('eslint') ? 'eslint' : kind.startsWith('semgrep') ? 'semgrep' : 'node');
    // Probe an executable through the same bounded resolver as its variant's
    // eventual execution. Falling back preserves legacy probe-only kinds.
    const resolution = executable === 'node'
        ? 'path'
        : evidence.toolResolution ?? (kind === 'semgrep-validate'
            ? 'python-environment'
            : 'node-modules-bin');
    if (kind === 'package-script-present') return null;
    if (kind === 'config-present') return null;
    const command = {
        executable,
        resolution,
        ...(resolution === 'python-environment' && evidence.pythonEnvironmentRoot ? { pythonEnvironmentRoot: evidence.pythonEnvironmentRoot } : {}),
        ...(evidence.environment ? { environment: evidence.environment } : {}),
    };
    if (kind === 'version') return { ...command, args: ['--version'] };
    if (kind === 'eslint-print-config') return { ...command, args: ['--print-config', evidence.configFiles?.[0] ?? 'package.json'] };
    if (kind === 'typescript-show-config') return { ...command, args: ['--showConfig'] };
    return { ...command, args: ['--validate'] };
}

/** Executes only the closed probe enum. Raw output is intentionally discarded. */
export async function runCompatibilityProbe(probe: { kind: CompatibilityProbe }, evidence: ProbeEvidence, executor: ProbeExecutor = runStructuredCommand): Promise<ProbeResult> {
    if (!probe || typeof probe !== 'object' || !KINDS.has(probe.kind)) throw new Error('compatibility probe kind must be allowed');
    if (!evidence || typeof evidence.cwd !== 'string' || evidence.cwd.trim() === '') throw new Error('probe evidence requires cwd');
    if (probe.kind === 'package-script-present') return { status: (evidence.scripts?.length ?? 0) > 0 ? 'matched' : 'not-matched', reason: 'package-script' };
    if (probe.kind === 'config-present') return { status: (evidence.configFiles?.length ?? 0) > 0 ? 'matched' : 'not-matched', reason: 'config-file' };
    try {
        const result = await executor(commandFor(probe.kind, evidence)!, { cwd: evidence.cwd, timeout: 5_000, maxBuffer: 64 * 1024 });
        if (result.timedOut || result.overflowed || result.spawnError) return { status: 'unverifiable', reason: result.timedOut ? 'probe-timeout' : result.overflowed ? 'probe-output-limit' : 'probe-spawn-error' };
        return result.code === 0 ? { status: 'matched', reason: 'probe-exit-zero' } : { status: 'not-matched', reason: 'probe-exit-nonzero' };
    } catch { return { status: 'unverifiable', reason: 'probe-exception' }; }
}
