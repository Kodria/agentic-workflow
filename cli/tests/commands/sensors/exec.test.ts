import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCommand } from '../../../src/commands/sensors/exec';

const onPosix = process.platform !== 'win32' ? describe : describe.skip;

/** Poll until `fn()` is true or the budget runs out. Avoids fixed sleeps. */
async function until(fn: () => boolean, budgetMs = 4000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise(r => setTimeout(r, 25));
    }
    return fn();
}

describe('runCommand — exit codes and output', () => {
    it('returns stdout and code 0 for a clean command', async () => {
        const r = await runCommand('echo hello', { timeout: 5000, cwd: process.cwd() });
        expect(r.code).toBe(0);
        expect(r.stdout.trim()).toBe('hello');
        expect(r.timedOut).toBe(false);
        expect(r.overflowed).toBe(false);
    });

    it('captures stderr and a non-zero exit code without throwing', async () => {
        const r = await runCommand('echo oops 1>&2; exit 3', { timeout: 5000, cwd: process.cwd() });
        expect(r.code).toBe(3);
        expect(r.stderr).toMatch(/oops/);
        expect(r.timedOut).toBe(false);
    });

    it('reports 127 for a command that does not exist', async () => {
        const r = await runCommand('awm-definitely-not-a-real-binary-xyz', { timeout: 5000, cwd: process.cwd() });
        expect(r.code).toBe(127);
    });
});

describe('runCommand — output cap', () => {
    it('stops at maxBuffer, flags overflow, and keeps what it read', async () => {
        // 200 lines of ~50 bytes each, capped at 1KB.
        const r = await runCommand(`for i in $(seq 1 200); do echo "line-$i-padding-padding-padding-padding"; done`, {
            timeout: 10_000, cwd: process.cwd(), maxBuffer: 1024,
        });
        expect(r.overflowed).toBe(true);
        expect(r.stdout.length).toBeLessThanOrEqual(1024);
        // The point of the cap change: what was read is still usable, not discarded.
        expect(r.stdout).toMatch(/line-1-/);
    });
});

onPosix('runCommand — timeout', () => {
    it('flags the timeout and returns the output produced before the deadline', async () => {
        const r = await runCommand('echo partial-finding; sleep 30', { timeout: 700, cwd: process.cwd() });
        expect(r.timedOut).toBe(true);
        // This is the whole point of dropping execSync: 700ms of work is not thrown away.
        expect(r.stdout).toMatch(/partial-finding/);
    });

    it('kills the grandchild process, not just the shell it spawned', async () => {
        // Models `npx tsc --noEmit`: the sensor command is a wrapper that spawns the
        // real tool. execSync SIGTERMs only the shell it started, leaving the tool
        // running and reparented to init — the leak that compounds across retries.
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-exec-group-'));
        const beat = path.join(dir, 'beat');
        const worker = path.join(dir, 'worker.js');
        fs.writeFileSync(worker, `
            const fs = require('fs');
            setInterval(() => fs.writeFileSync(${JSON.stringify(beat)}, String(Date.now())), 30);
            setTimeout(() => {}, 60000);
        `);

        try {
            const r = await runCommand(`sh -c "node ${worker} & wait"`, { timeout: 800, cwd: dir });
            expect(r.timedOut).toBe(true);

            // The worker must have been alive before the kill, or the test proves nothing.
            expect(await until(() => fs.existsSync(beat))).toBe(true);

            const atKill = fs.readFileSync(beat, 'utf-8');
            const stillBeating = await until(() => fs.readFileSync(beat, 'utf-8') !== atKill, 1000);
            expect(stillBeating).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 15_000);
});

describe('runCommand — spawn failure', () => {
    it('surfaces a spawn error instead of hanging', async () => {
        const r = await runCommand('echo hi', { timeout: 5000, cwd: path.join(os.tmpdir(), 'awm-no-such-dir-xyz') });
        expect(r.spawnError).toBeDefined();
        expect(r.code).not.toBe(0);
    });
});
