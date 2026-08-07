import { spawn, execFile } from 'child_process';
import { isWindowsNative } from '../../core/paths';

/** Outcome of a sensor command. Never throws — every failure mode is a field. */
export type ExecResult = {
    stdout: string;
    stderr: string;
    /** Exit code, or null when the process was killed by a signal or never started. */
    code: number | null;
    signal: NodeJS.Signals | null;
    /** The deadline fired and the process group was killed. */
    timedOut: boolean;
    /** Collected output hit `maxBuffer`; the process group was killed. */
    overflowed: boolean;
    /** The shell itself could not be spawned (bad cwd, no shell). */
    spawnError?: NodeJS.ErrnoException;
};

export type ExecOptions = {
    timeout: number;
    cwd: string;
    maxBuffer?: number;
    /** SIGTERM → SIGKILL grace for the process group. */
    killGraceMs?: number;
};

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;
/** After SIGKILL, resolve regardless. A sensor must never hang the gate. */
const POST_KILL_GRACE_MS = 1_000;

/**
 * Kill an entire process tree, not just its root.
 *
 * This is the reason `execSync` had to go. `execSync(cmd, { timeout })` spawns
 * `/bin/sh -c cmd` and, on the deadline, SIGTERMs *that shell only*. A sensor
 * command is almost always a wrapper (`npx tsc --noEmit`, `npm test`), so the
 * tool doing the actual work is a grandchild: it survives, gets reparented to
 * init, and keeps burning CPU. Every timeout then leaves a full tsc/eslint
 * running, which makes the next run slower, which makes it time out too. The
 * leak compounds — a repo that was fine at 200 files becomes ungateable at 2000
 * for reasons that have nothing to do with its size.
 *
 * `detached: true` puts the child in its own process group (pgid === pid) so a
 * negative-pid kill reaches every descendant at once.
 */
function killTree(pid: number, signal: NodeJS.Signals): void {
    if (isWindowsNative()) {
        // Windows has no process groups in the POSIX sense; taskkill /T walks the tree.
        try { execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => { /* best effort */ }); } catch { /* ignore */ }
        return;
    }
    try {
        process.kill(-pid, signal);   // negative pid → the whole group
    } catch {
        // Group already gone (normal race with a process exiting on its own),
        // or we never became a group leader. Fall back to the direct child.
        try { process.kill(pid, signal); } catch { /* already dead */ }
    }
}

/**
 * Run a shell command to completion, a deadline, or an output cap — whichever
 * comes first — and always return what was collected.
 *
 * Two guarantees `execSync` could not give:
 *  1. Cutting a run short kills the whole process tree (see `killTree`).
 *  2. Output produced before the cut is returned, not discarded. A timeout that
 *     throws away 60s of eslint output costs double: the wall clock, and then
 *     the re-run the caller has to do to learn anything at all.
 */
export function runCommand(cmd: string, opts: ExecOptions): Promise<ExecResult> {
    const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

    return new Promise<ExecResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let overflowed = false;
        let settled = false;
        const timers: NodeJS.Timeout[] = [];

        const child = spawn(cmd, {
            shell: true,
            cwd: opts.cwd,
            detached: !isWindowsNative(),
            // stdin closed: a sensor must never block waiting for input, and the
            // EOF also tells watch-mode-capable tools (vitest, jest) to run once.
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const later = (fn: () => void, ms: number) => {
            const t = setTimeout(fn, ms);
            t.unref?.();
            timers.push(t);
            return t;
        };

        const finish = (extra: Partial<ExecResult>) => {
            if (settled) return;
            settled = true;
            timers.forEach(clearTimeout);
            resolve({ stdout, stderr, code: null, signal: null, timedOut, overflowed, ...extra });
        };

        /** Cut the run short: kill the tree, escalate, and never hang waiting for it. */
        const cutShort = () => {
            if (settled || child.pid === undefined) return;
            const pid = child.pid;
            killTree(pid, 'SIGTERM');
            later(() => killTree(pid, 'SIGKILL'), killGraceMs);
            // If `close` still has not fired after the escalation, stop waiting.
            // Whatever is holding the pipe open is no longer our problem to block on.
            later(() => { child.unref(); finish({ signal: 'SIGKILL' }); }, killGraceMs + POST_KILL_GRACE_MS);
        };

        const collect = (into: 'out' | 'err') => (chunk: Buffer | string) => {
            if (settled || overflowed) return;
            const text = String(chunk);
            const current = into === 'out' ? stdout : stderr;
            const room = maxBuffer - current.length;
            const next = current + (text.length > room ? text.slice(0, room) : text);
            if (into === 'out') stdout = next; else stderr = next;
            if (next.length >= maxBuffer) {
                overflowed = true;
                cutShort();
            }
        };

        child.stdout?.on('data', collect('out'));
        child.stderr?.on('data', collect('err'));
        child.stdout?.on('error', () => { /* pipe torn down by our own kill */ });
        child.stderr?.on('error', () => { /* pipe torn down by our own kill */ });

        child.on('error', (err: NodeJS.ErrnoException) => finish({ spawnError: err }));
        child.on('close', (code, signal) => finish({ code, signal }));

        later(() => { timedOut = true; cutShort(); }, opts.timeout);
    });
}
