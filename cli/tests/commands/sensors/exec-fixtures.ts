import type { ExecResult } from '../../../src/commands/sensors/exec';

/**
 * Builders for the `ExecResult` shape that `runCommand` returns. Sensor tests
 * mock the exec boundary rather than `child_process` directly: `runCommand`
 * never throws, so a mocked run is a value, not an exception.
 */

const base = { stdout: '', stderr: '', code: null as number | null, signal: null as NodeJS.Signals | null, timedOut: false, overflowed: false, elapsedMs: 0 };

/** Clean run: exit 0. */
export const ok = (stdout = ''): ExecResult => ({ ...base, stdout, code: 0 });

/** Ran to completion with a non-zero exit code. */
export const exited = (code: number, stdout = '', stderr = ''): ExecResult => ({ ...base, stdout, stderr, code });

/** Cut short by the deadline. `stdout` is whatever it managed to print first. */
export const timedOut = (stdout = '', stderr = ''): ExecResult => ({ ...base, stdout, stderr, signal: 'SIGKILL', timedOut: true });

/** Cut short by the output cap. */
export const overflowed = (stdout = ''): ExecResult => ({ ...base, stdout, signal: 'SIGKILL', overflowed: true });

/** The shell itself never started. */
export const spawnFailed = (message = 'ENOENT'): ExecResult => ({ ...base, spawnError: Object.assign(new Error(message), { code: 'ENOENT' }) });
