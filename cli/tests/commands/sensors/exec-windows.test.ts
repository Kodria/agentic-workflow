import { EventEmitter } from 'events';
import { spawn, execFile } from 'child_process';
import { runCommand } from '../../../src/commands/sensors/exec';

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

describe('runCommand — win32', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        mockSpawn.mockReset();
        mockExecFile.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
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
