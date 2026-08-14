import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFile } from 'child_process';
import { runCommand, runStructuredCommand } from '../../../src/commands/sensors/exec';

jest.mock('child_process', () => ({
    spawn: jest.fn(),
    execFile: jest.fn(),
}));

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

/** Minimal stand-in for a ChildProcess: enough surface for exec.ts to drive. */
function fakeChild(pid = 4242) {
    const child: any = new EventEmitter();
    child.pid = pid;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = jest.fn();
    return child;
}

function restoreEnvironment(name: 'PATH' | 'PATHEXT', value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

describe('runCommand — win32', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        mockSpawn.mockReset();
        mockExecFile.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        jest.useRealTimers();
    });

    it('spawns with detached: false — win32 has no POSIX process groups to detach into', async () => {
        const child = fakeChild();
        mockSpawn.mockReturnValue(child);

        const pending = runCommand('echo hi', { timeout: 5000, cwd: process.cwd() });

        expect(mockSpawn).toHaveBeenCalledWith('echo hi', expect.objectContaining({ detached: false }));

        child.emit('close', 0, null);
        const r = await pending;
        expect(r.code).toBe(0);
    });

    it('resolves a PATHEXT executable and keeps structured argv shell-free', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-structured-win-'));
        const savedPath = process.env.PATH;
        const savedPathExt = process.env.PATHEXT;
        try {
            fs.writeFileSync(path.join(dir, 'tool.exe'), 'fixture');
            process.env.PATH = dir;
            process.env.PATHEXT = '.CMD;.EXE';
            const child = fakeChild();
            mockSpawn.mockReturnValue(child);
            const pending = runStructuredCommand({ executable: 'tool', resolution: 'path', args: ['literal;&'] }, { timeout: 5000, cwd: dir });
            expect(mockSpawn).toHaveBeenCalledWith(path.join(dir, 'tool.exe'), ['literal;&'], expect.objectContaining({ shell: false, detached: false }));
            child.emit('close', 0, null);
            await expect(pending).resolves.toMatchObject({ code: 0 });
            expect(() => runStructuredCommand({ executable: 'tool.cmd', resolution: 'path', args: ['--version'] }, { timeout: 5000, cwd: dir })).toThrow(/wrappers/);
        } finally {
            restoreEnvironment('PATH', savedPath);
            restoreEnvironment('PATHEXT', savedPathExt);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('uses the project node_modules executable instead of a same-named global command', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-local-bin-win-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-global-bin-win-'));
        const savedPath = process.env.PATH;
        const savedPathExt = process.env.PATHEXT;
        try {
            const localBin = path.join(dir, 'node_modules', '.bin');
            fs.mkdirSync(localBin, { recursive: true });
            fs.writeFileSync(path.join(localBin, 'tool.exe'), 'local');
            fs.writeFileSync(path.join(global, 'tool.exe'), 'global');
            process.env.PATH = global;
            process.env.PATHEXT = '.EXE';
            const child = fakeChild();
            mockSpawn.mockReturnValue(child);
            const pending = runStructuredCommand({ executable: 'tool', resolution: 'node-modules-bin', args: ['--version'] }, { timeout: 5000, cwd: dir });
            expect(mockSpawn).toHaveBeenCalledWith(path.join(localBin, 'tool.exe'), ['--version'], expect.objectContaining({ shell: false }));
            child.emit('close', 0, null);
            await expect(pending).resolves.toMatchObject({ code: 0 });
        } finally {
            restoreEnvironment('PATH', savedPath);
            restoreEnvironment('PATHEXT', savedPathExt);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(global, { recursive: true, force: true });
        }
    });

    it('rejects a missing local executable instead of falling back to a same-named global command', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-local-bin-missing-win-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-global-bin-missing-win-'));
        const savedPath = process.env.PATH;
        try {
            fs.writeFileSync(path.join(global, 'tool.exe'), 'global');
            process.env.PATH = global;
            mockSpawn.mockReturnValue(fakeChild());
            expect(() => runStructuredCommand({ executable: 'tool', resolution: 'node-modules-bin', args: ['--version'] }, { timeout: 5000, cwd: dir }))
                .toThrow(/node_modules.*not found locally/i);
            expect(mockSpawn).not.toHaveBeenCalled();
        } finally {
            restoreEnvironment('PATH', savedPath);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(global, { recursive: true, force: true });
        }
    });

    it('fails closed when PATHEXT contains no safe executable extension', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-structured-win-pathext-'));
        const savedPath = process.env.PATH;
        const savedPathExt = process.env.PATHEXT;
        try {
            fs.writeFileSync(path.join(dir, 'tool.cmd'), 'wrapper');
            process.env.PATH = dir;
            process.env.PATHEXT = '.CMD';

            expect(() => runStructuredCommand({ executable: 'tool', resolution: 'path', args: ['--version'] }, { timeout: 5000, cwd: dir }))
                .toThrow(/safe Windows executable|PATHEXT/i);
            expect(mockSpawn).not.toHaveBeenCalled();
        } finally {
            restoreEnvironment('PATH', savedPath);
            restoreEnvironment('PATHEXT', savedPathExt);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects a missing Python environment executable instead of falling back to a same-named global command', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-env-missing-win-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-env-global-win-'));
        const savedPath = process.env.PATH;
        try {
            fs.writeFileSync(path.join(global, 'semgrep.exe'), 'global');
            process.env.PATH = global;
            mockSpawn.mockReturnValue(fakeChild());
            expect(() => runStructuredCommand({ executable: 'semgrep', resolution: 'python-environment', args: ['--validate'] }, { timeout: 5000, cwd: dir }))
                .toThrow(/python.*environment.*local|contained/i);
            expect(mockSpawn).not.toHaveBeenCalled();
        } finally {
            restoreEnvironment('PATH', savedPath);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(global, { recursive: true, force: true });
        }
    });

    it('propagates cmd.exe\'s own exit code for a command that does not exist (1, not the POSIX 127)', async () => {
        // Mirrors exec.test.ts's POSIX "reports 127" case. cmd.exe has no
        // equivalent 127 convention — it reports 1 (sometimes 9009) for
        // "not recognized as an internal or external command" — and
        // runCommand does not remap it: whatever the shell's `close` event
        // carries is exactly what comes out on `r.code`.
        const child = fakeChild();
        mockSpawn.mockReturnValue(child);

        const pending = runCommand('awm-definitely-not-a-real-binary-xyz', { timeout: 5000, cwd: process.cwd() });

        child.emit('close', 1, null);
        const r = await pending;
        expect(r.code).toBe(1);
    });

    it('kills via `taskkill /pid <pid> /T /F` on timeout, never the POSIX process.kill(-pid) path', async () => {
        jest.useFakeTimers();
        const child = fakeChild(4242);
        mockSpawn.mockReturnValue(child);
        mockExecFile.mockImplementation(((...args: unknown[]) => {
            const cb = args[args.length - 1];
            if (typeof cb === 'function') cb(null, '', '');
            return {} as ReturnType<typeof execFile>;
        }) as typeof execFile);
        const posixKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true as never);

        const pending = runCommand('slow-command', {
            timeout: 1000,
            cwd: process.cwd(),
            killGraceMs: 500,
        });

        // Fire the deadline: cutShort() -> killTree(pid, 'SIGTERM').
        jest.advanceTimersByTime(1000);

        expect(mockExecFile).toHaveBeenCalledWith(
            'taskkill', ['/pid', '4242', '/T', '/F'], expect.any(Function),
        );
        // The win32 branch returns before ever reaching the POSIX fallback.
        expect(posixKillSpy).not.toHaveBeenCalled();

        // Escalation to SIGKILL, then the post-kill grace that resolves regardless.
        jest.advanceTimersByTime(500);
        expect(mockExecFile).toHaveBeenCalledWith(
            'taskkill', ['/pid', '4242', '/T', '/F'], expect.any(Function),
        );
        expect(mockExecFile).toHaveBeenCalledTimes(2);
        expect(posixKillSpy).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1000);
        const r = await pending;
        expect(r.timedOut).toBe(true);
        expect(r.signal).toBe('SIGKILL');

        posixKillSpy.mockRestore();
    });
});
