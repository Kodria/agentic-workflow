import { spawn, execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
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
    /** Monotonic wall-clock duration from spawn attempt through settlement. */
    elapsedMs: number;
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

type SpawnInput = { executable: string; args: string[]; shell: boolean; environment?: { ESLINT_USE_FLAT_CONFIG: 'true' | 'false' } };

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;
/** After SIGKILL, resolve regardless. A sensor must never hang the gate. */
const POST_KILL_GRACE_MS = 1_000;
const PRLIMIT_PATHS = ['/usr/bin/prlimit', '/bin/prlimit'];

/** Decode a byte-bounded capture without allowing replacement characters to
 * expand it. Invalid input bytes become one-byte `?` markers. */
function decodeBoundedOutput(buffer: Buffer): string {
    const decoded = Buffer.allocUnsafe(buffer.length);
    let read = 0;
    let written = 0;
    const continuation = (index: number) => index < buffer.length && (buffer[index] & 0b1100_0000) === 0b1000_0000;
    while (read < buffer.length) {
        const first = buffer[read];
        let length = 1;
        if (first >= 0xc2 && first <= 0xdf && continuation(read + 1)) length = 2;
        else if (first >= 0xe0 && first <= 0xef && continuation(read + 1) && continuation(read + 2)
            && !(first === 0xe0 && buffer[read + 1] < 0xa0) && !(first === 0xed && buffer[read + 1] > 0x9f)) length = 3;
        else if (first >= 0xf0 && first <= 0xf4 && continuation(read + 1) && continuation(read + 2) && continuation(read + 3)
            && !(first === 0xf0 && buffer[read + 1] < 0x90) && !(first === 0xf4 && buffer[read + 1] > 0x8f)) length = 4;
        else if (first >= 0x80) decoded[written++] = 0x3f;
        if (length > 1 || first < 0x80) {
            buffer.copy(decoded, written, read, read + length);
            written += length;
        }
        read += length;
    }
    return decoded.subarray(0, written).toString('utf8');
}

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
        const startedAt = process.hrtime.bigint();
        let stdout = '';
        let stderr = '';
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let capturedBytes = 0;
        let timedOut = false;
        let overflowed = false;
        let settled = false;
        const timers: NodeJS.Timeout[] = [];

        const prlimit = !input.shell && process.platform === 'linux'
            ? PRLIMIT_PATHS.find(candidate => regularFile(candidate))
            : undefined;
        const streamMaxBuffer = maxBuffer;

        // Some structured Node CLIs call process.exit() after writing their
        // report. Node drops an asynchronous pipe write in that case, but a
        // regular file descriptor is flushed before exit. Keep the report on
        // disk only until settlement. Each channel is hard-capped at maxBuffer
        // while a shared decode budget caps the returned combined output.
        // Linux enforces the per-file cap before either child stream can grow
        // unbounded; polling alone can only discover excess after it happens.
        const captureDir = prlimit ? fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensor-output-')) : undefined;
        const stdoutPath = captureDir ? path.join(captureDir, 'stdout') : undefined;
        const stderrPath = captureDir ? path.join(captureDir, 'stderr') : undefined;
        const stdoutFd = stdoutPath ? fs.openSync(stdoutPath, 'w') : undefined;
        const stderrFd = stderrPath ? fs.openSync(stderrPath, 'w') : undefined;

        const readCaptured = (file: string, fd: number, budget: number): { output: string; bytes: number } => {
            fs.closeSync(fd);
            const size = fs.statSync(file).size;
            if (size >= streamMaxBuffer) overflowed = true;
            if (size > budget) overflowed = true;
            const bytes = Math.min(size, budget);
            const buffer = Buffer.allocUnsafe(bytes);
            if (buffer.length > 0) {
                const readFd = fs.openSync(file, 'r');
                try { fs.readSync(readFd, buffer, 0, buffer.length, 0); }
                finally { fs.closeSync(readFd); }
            }
            return { output: decodeBoundedOutput(buffer), bytes };
        };

        const captureSize = (file: string | undefined): number => {
            if (!file) return 0;
            try { return fs.statSync(file).size; } catch { return 0; }
        };

        const child = input.shell
            ? spawn(input.executable, {
                shell: true,
                cwd: opts.cwd,
                detached: !isWindowsNative(),
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            : spawn(prlimit ?? input.executable, prlimit
                ? [`--fsize=${streamMaxBuffer}`, '--', input.executable, ...input.args]
                : input.args, {
                shell: false,
                cwd: opts.cwd,
                detached: !isWindowsNative(),
                ...(input.environment ? { env: { ...process.env, ...input.environment } } : {}),
            // stdin closed: a sensor must never block waiting for input, and the
            // EOF also tells watch-mode-capable tools (vitest, jest) to run once.
            stdio: prlimit ? ['ignore', stdoutFd!, stderrFd!] : ['ignore', 'pipe', 'pipe'],
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
            if (stdoutPath && stderrPath && stdoutFd !== undefined && stderrFd !== undefined) {
                try {
                    const capturedStdout = readCaptured(stdoutPath, stdoutFd, maxBuffer);
                    stdout = capturedStdout.output;
                    stderr = readCaptured(stderrPath, stderrFd, maxBuffer - capturedStdout.bytes).output;
                } finally {
                    fs.rmSync(captureDir!, { recursive: true, force: true });
                }
            } else {
                stdout = decodeBoundedOutput(Buffer.concat(stdoutChunks));
                stderr = decodeBoundedOutput(Buffer.concat(stderrChunks));
            }
            const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
            resolve({ stdout, stderr, code: null, signal: null, timedOut, overflowed, elapsedMs, ...extra });
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
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const room = maxBuffer - capturedBytes;
            const kept = bytes.subarray(0, Math.max(0, room));
            if (kept.length > 0) (into === 'out' ? stdoutChunks : stderrChunks).push(kept);
            capturedBytes += kept.length;
            if (bytes.length > kept.length || capturedBytes >= maxBuffer) {
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

        if (stdoutPath || stderrPath) {
            const outputWatch = setInterval(() => {
                const stdoutSize = captureSize(stdoutPath);
                const stderrSize = captureSize(stderrPath);
                if (!overflowed && (stdoutSize >= streamMaxBuffer || stderrSize >= streamMaxBuffer || stdoutSize + stderrSize >= maxBuffer)) {
                    overflowed = true;
                    cutShort();
                }
            }, 25);
            outputWatch.unref?.();
            timers.push(outputWatch);
        }
        later(() => { timedOut = true; cutShort(); }, opts.timeout);
    });
}

function validateStructuredCommand(command: StructuredCommand): void {
    if (!command || typeof command !== 'object' || typeof command.executable !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command.executable)) {
        throw new Error('structured command executable must be a safe executable name');
    }
    const normalizedExecutable = command.executable.toLowerCase().replace(/\.exe$/, '');
    if (new Set(['sh', 'bash', 'cmd', 'powershell']).has(normalizedExecutable)) {
        throw new Error('structured command executable must not be a shell');
    }
    if (!Array.isArray(command.args) || command.args.length === 0) {
        throw new Error('structured command args must be a nonempty array');
    }
    for (const [index, arg] of command.args.entries()) {
        if (typeof arg !== 'string' || arg.trim() === '' || /[\0\r\n]/.test(arg)) {
            throw new Error(`structured command args[${index}] must be a nonempty single-line string without NUL`);
        }
        if (arg.includes('{files}') && arg !== '{files}') {
            throw new Error(`structured command args[${index}] must not embed {files}`);
        }
    }
    if (!['node-modules-bin', 'python-environment', 'path'].includes(command.resolution)) throw new Error('structured command resolution is unsupported');
    if (command.pythonEnvironmentRoot !== undefined && (command.resolution !== 'python-environment' || (command.pythonEnvironmentRoot !== '.venv' && command.pythonEnvironmentRoot !== 'venv'))) {
        throw new Error('structured command pythonEnvironmentRoot must name the selected .venv or venv Python environment');
    }
    if (command.resolution === 'python-environment' && command.pythonEnvironmentRoot === undefined) throw new Error('python environment command requires a discovery-bound contained local environment root');
    const packageManagers = new Set(['npm', 'pnpm', 'yarn', 'bun']);
    const normalizedPackageManager = typeof command.packageManager === 'string' ? command.packageManager.toLowerCase().replace(/\.exe$/, '') : undefined;
    if (packageManagers.has(normalizedExecutable) && normalizedPackageManager !== normalizedExecutable) throw new Error('structured command packageManager must explicitly match its executable');
    if (normalizedPackageManager !== undefined && !packageManagers.has(normalizedPackageManager)) throw new Error('structured command packageManager is unsupported');
    if (normalizedPackageManager !== undefined && normalizedPackageManager !== normalizedExecutable) throw new Error('structured command packageManager must explicitly match its executable');
    if (command.environment !== undefined) {
        const environment = command.environment as unknown;
        if (!environment || typeof environment !== 'object' || Array.isArray(environment) || Object.keys(environment).length !== 1 || !Object.prototype.hasOwnProperty.call(environment, 'ESLINT_USE_FLAT_CONFIG')) {
            throw new Error('structured command environment must be the exact allowlisted ESLINT_USE_FLAT_CONFIG=true or false mapping');
        }
        const flatConfig = (environment as { ESLINT_USE_FLAT_CONFIG?: unknown }).ESLINT_USE_FLAT_CONFIG;
        if (flatConfig !== 'true' && flatConfig !== 'false') throw new Error('structured command environment must be the exact allowlisted ESLINT_USE_FLAT_CONFIG=true or false mapping');
    }
    const fileArguments = command.args.filter(arg => arg === '{files}').length;
    if (command.fileInput === undefined) {
        if (fileArguments !== 0) throw new Error('structured command {files} argument requires fileInput');
        return;
    }
    const fileInput = command.fileInput as unknown;
    if (!fileInput || typeof fileInput !== 'object' || Array.isArray(fileInput) || Object.keys(fileInput).length !== 2 || !Object.prototype.hasOwnProperty.call(fileInput, 'placeholder') || !Object.prototype.hasOwnProperty.call(fileInput, 'extensions')) {
        throw new Error('structured command fileInput must contain only placeholder and extensions');
    }
    const { placeholder, extensions } = fileInput as { placeholder?: unknown; extensions?: unknown };
    if (placeholder !== '{files}') throw new Error('structured command fileInput.placeholder must be {files}');
    if (!Array.isArray(extensions) || extensions.length === 0 || extensions.some(extension => typeof extension !== 'string' || extension.trim() === '' || /[\0\r\n]/.test(extension) || !/^\.[A-Za-z0-9]+$/.test(extension))) {
        throw new Error('structured command fileInput.extensions must be a nonempty array of extensions');
    }
    if (fileArguments !== 1) throw new Error('structured command fileInput requires exactly one {files} argument');
}

function safeWindowsExecutableExtensions(): string[] {
    return (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map(ext => ext.toLowerCase())
        .filter(ext => ext === '.exe' || ext === '.com');
}

function regularFile(candidate: string): boolean {
    try {
        const stat = fs.lstatSync(candidate);
        return stat.isFile() && !stat.isSymbolicLink();
    } catch { return false; }
}

/** Resolve a Python environment executable only when every selected path
 * component is a non-symbolic-link local entry. A leaf-only lstat follows a
 * linked .venv/venv ancestor and can otherwise execute outside the project. */
function localPythonEnvironmentExecutable(cwd: string, environmentRoot: '.venv' | 'venv', executable: string): string | null {
    const parts = [environmentRoot, isWindowsNative() ? 'Scripts' : 'bin', executable];
    let candidate = cwd;
    try {
        for (const part of parts) {
            candidate = path.join(candidate, part);
            const stat = fs.lstatSync(candidate);
            if (stat.isSymbolicLink()) return null;
        }
        return fs.lstatSync(candidate).isFile() ? candidate : null;
    } catch { return null; }
}

function containedPath(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/** Resolve a local npm shim to its real regular-file target. npm commonly uses
 * symlinks in .bin on POSIX, so rejecting every symlink would reject valid local
 * installs. The real target must remain inside the project's node_modules. */
function localNodeModulesExecutable(candidate: string, modulesRoot: string): string | null {
    try {
        const shim = fs.lstatSync(candidate);
        if (!shim.isFile() && !shim.isSymbolicLink()) return null;
        const real = fs.realpathSync(candidate);
        const target = fs.statSync(real);
        return target.isFile() && containedPath(modulesRoot, real) ? real : null;
    } catch { return null; }
}

/** Find a real executable without a shell. Windows .cmd/.bat shims are deliberately
 * excluded: CreateProcess cannot execute them safely without cmd.exe. */
function resolveStructuredExecutable(command: StructuredCommand, cwd: string): string {
    if (command.resolution === 'node-modules-bin') {
        let modulesRoot: string;
        try {
            modulesRoot = fs.realpathSync(path.join(cwd, 'node_modules'));
            if (!fs.statSync(modulesRoot).isDirectory()) throw new Error();
        } catch { throw new Error('node_modules executable not found locally'); }
        const bin = path.join(modulesRoot, '.bin');
        if (!isWindowsNative()) {
            const local = localNodeModulesExecutable(path.join(bin, command.executable), modulesRoot);
            if (local) return local;
            throw new Error('node_modules executable is not a contained local file');
        }
        const extensions = safeWindowsExecutableExtensions();
        if (extensions.length === 0) throw new Error('PATHEXT contains no safe Windows executable extension for structured commands');
        const candidates = [path.join(bin, command.executable), ...extensions.map(extension => path.join(bin, command.executable + extension))];
        for (const candidate of candidates) {
            const lower = candidate.toLowerCase();
            if (lower.endsWith('.cmd') || lower.endsWith('.bat')) throw new Error('structured commands cannot execute Windows command wrappers');
            const local = localNodeModulesExecutable(candidate, modulesRoot);
            if (local && extensions.some(extension => local.toLowerCase().endsWith(extension))) return local;
        }
        throw new Error('node_modules executable is not a contained local file');
    }
    const candidates: string[] = [];
    if (command.resolution === 'python-environment') {
        if (path.isAbsolute(command.executable)) throw new Error('python environment executable must be a contained local name');
        if (!isWindowsNative()) {
            const local = localPythonEnvironmentExecutable(cwd, command.pythonEnvironmentRoot!, command.executable);
            if (local) return local;
            throw new Error('python environment executable is not a contained local regular file');
        }
        const extensions = safeWindowsExecutableExtensions();
        if (extensions.length === 0) throw new Error('PATHEXT contains no safe Windows executable extension for structured commands');
        for (const executable of [command.executable, ...extensions.map(extension => command.executable + extension)]) {
            const lower = executable.toLowerCase();
            if (lower.endsWith('.cmd') || lower.endsWith('.bat')) throw new Error('structured commands cannot execute Windows command wrappers');
            const local = localPythonEnvironmentExecutable(cwd, command.pythonEnvironmentRoot!, executable);
            if (local && extensions.some(extension => lower.endsWith(extension))) return local;
        }
        throw new Error('python environment executable is not a contained local regular file');
    } else if (path.isAbsolute(command.executable)) candidates.push(command.executable);
    else {
        for (const entry of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(entry, command.executable));
    }
    if (!isWindowsNative()) {
        const found = candidates.find(regularFile);
        if (found) return found;
        return command.executable;
    }
    const extensions = safeWindowsExecutableExtensions();
    if (extensions.length === 0) throw new Error('PATHEXT contains no safe Windows executable extension for structured commands');
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
    return collectSpawn({ executable: resolveStructuredExecutable(command, opts.cwd), args: command.args, shell: false, environment: command.environment }, opts);
}

/** Legacy sensor strings intentionally retain their documented shell semantics. */
export function runCommand(cmd: string, opts: ExecOptions): Promise<ExecResult> {
    if (typeof cmd !== 'string' || cmd.trim() === '' || /[\0\r\n]/.test(cmd)) throw new Error('runCommand: cmd must be a non-empty single-line legacy string without NUL');
    return collectSpawn({ executable: cmd, args: [], shell: true }, opts);
}
