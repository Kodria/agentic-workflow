import { spawn, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { isWindowsNative } from '../../core/paths';
import type { StructuredCommand } from './compatibility/types';

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

type SpawnInput = { executable: string; args: string[]; shell: boolean };

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
function validateOptions(opts: ExecOptions): void {
    if (!opts || typeof opts !== 'object' || typeof opts.cwd !== 'string' || opts.cwd.trim() === '' || !Number.isSafeInteger(opts.timeout) || opts.timeout <= 0) {
        throw new Error('exec options require a non-empty cwd and positive safe-integer timeout');
    }
    if (opts.maxBuffer !== undefined && (!Number.isSafeInteger(opts.maxBuffer) || opts.maxBuffer <= 0)) throw new Error('exec options maxBuffer must be a positive safe integer');
    if (opts.killGraceMs !== undefined && (!Number.isSafeInteger(opts.killGraceMs) || opts.killGraceMs < 0)) throw new Error('exec options killGraceMs must be a non-negative safe integer');
}

function collectSpawn(input: SpawnInput, opts: ExecOptions): Promise<ExecResult> {
    validateOptions(opts);
    const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

    return new Promise<ExecResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let overflowed = false;
        let settled = false;
        const timers: NodeJS.Timeout[] = [];

        const child = input.shell
            ? spawn(input.executable, {
                shell: true,
                cwd: opts.cwd,
                detached: !isWindowsNative(),
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            : spawn(input.executable, input.args, {
                shell: false,
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

function validateStructuredCommand(command: StructuredCommand): void {
    if (!command || typeof command !== 'object' || typeof command.executable !== 'string' || (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command.executable) && !path.isAbsolute(command.executable))) {
        throw new Error('structured command executable must be a safe executable name');
    }
    if (!Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string' || /[\0\r\n]/.test(arg))) {
        throw new Error('structured command args must be an array of single-line strings without NUL');
    }
    if (!['node-modules-bin', 'python-environment', 'path'].includes(command.resolution)) throw new Error('structured command resolution is unsupported');
}

function regularFile(candidate: string): boolean {
    try {
        const stat = fs.lstatSync(candidate);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch { return false; }
}

/** Find a real executable without a shell. Windows .cmd/.bat shims are deliberately
 * excluded: CreateProcess cannot execute them safely without cmd.exe. */
function resolveStructuredExecutable(command: StructuredCommand, cwd: string): string {
    const candidates: string[] = [];
    if (path.isAbsolute(command.executable)) candidates.push(command.executable);
    else if (command.resolution === 'node-modules-bin') candidates.push(path.join(cwd, 'node_modules', '.bin', command.executable));
    else if (command.resolution === 'python-environment') {
        candidates.push(path.join(cwd, '.venv', isWindowsNative() ? 'Scripts' : 'bin', command.executable));
        candidates.push(path.join(cwd, 'venv', isWindowsNative() ? 'Scripts' : 'bin', command.executable));
    } else {
        for (const entry of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(entry, command.executable));
    }
    if (!isWindowsNative()) return candidates.find(regularFile) ?? command.executable;
    const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.toLowerCase()).filter(ext => ext === '.exe' || ext === '.com');
    for (const candidate of candidates) {
        const lower = candidate.toLowerCase();
        if (lower.endsWith('.cmd') || lower.endsWith('.bat')) throw new Error('structured commands cannot execute Windows command wrappers');
        if (regularFile(candidate) && extensions.some(ext => lower.endsWith(ext))) return candidate;
        for (const extension of extensions) if (regularFile(candidate + extension)) return candidate + extension;
    }
    return command.executable;
}

/** Execute a v2 command as an executable plus literal argv; it never starts a shell. */
export function runStructuredCommand(command: StructuredCommand, opts: ExecOptions): Promise<ExecResult> {
    validateStructuredCommand(command);
    return collectSpawn({ executable: resolveStructuredExecutable(command, opts.cwd), args: command.args, shell: false }, opts);
}

/** Legacy sensor strings intentionally retain their documented shell semantics. */
export function runCommand(cmd: string, opts: ExecOptions): Promise<ExecResult> {
    if (typeof cmd !== 'string' || cmd.trim() === '' || /[\0\r\n]/.test(cmd)) throw new Error('runCommand: cmd must be a non-empty single-line legacy string without NUL');
    return collectSpawn({ executable: cmd, args: [], shell: true }, opts);
}
