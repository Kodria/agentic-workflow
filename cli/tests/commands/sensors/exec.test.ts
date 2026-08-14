import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCommand, runStructuredCommand } from '../../../src/commands/sensors/exec';

const onPosix = process.platform !== 'win32' ? describe : describe.skip;
const itPosix = process.platform !== 'win32' ? it : it.skip;

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
    it('passes structured metacharacters literally without a shell', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-exec-argv-'));
        const marker = path.join(dir, 'must-not-exist');
        try {
            const literal = `;touch ${marker}`;
            const received = path.join(dir, 'received');
            const result = await runStructuredCommand({
                executable: process.execPath,
                resolution: 'path',
                args: ['-e', "require('fs').writeFileSync(process.argv[1], process.argv[2])", received, literal],
            }, { timeout: 5000, cwd: dir });
            expect(result.code).toBe(0);
            expect(fs.readFileSync(received, 'utf8')).toBe(literal);
            expect(fs.existsSync(marker)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('returns stdout and code 0 for a clean command', async () => {
        const r = await runCommand('echo hello', { timeout: 5000, cwd: process.cwd() });
        expect(r.code).toBe(0);
        expect(r.stdout.trim()).toBe('hello');
        expect(r.timedOut).toBe(false);
        expect(r.overflowed).toBe(false);
    });

    itPosix('captures stderr and a non-zero exit code without throwing', async () => {
        // Portable by construction: `node -e "..."` is invoked identically by
        // `spawn(cmd, {shell:true})` on both `/bin/sh -c` (POSIX) and
        // `cmd.exe /d /s /c` (win32) — the shell only tokenizes the outer
        // double-quoted argument, and node's own -e parsing is platform-
        // independent from there. A previous version of this test used
        // POSIX-only shell syntax (`;` as a separator, `1>&2` redirect
        // ordering) that cmd.exe does not support: `;` isn't a command
        // separator there, so the whole string became literal arguments to
        // `echo` and `exit 3` never ran as its own command — the run
        // "succeeded" with code 0 instead of 3 on windows-latest CI.
        const r = await runCommand('printf oops >&2; exit 3', { timeout: 5000, cwd: process.cwd() });
        expect(r.code).toBe(3);
        expect(r.stderr).toMatch(/oops/);
        expect(r.timedOut).toBe(false);
    });

    itPosix('reports 127 for a command that does not exist', async () => {
        // 127 is the POSIX shell's own "command not found" convention (`/bin/sh
        // -c`), not something this codebase computes — runCommand just relays
        // whatever the shell's `close` event reports. cmd.exe has no such
        // convention (it reports 1 for "not recognized..."), so this is
        // POSIX-only; see exec-windows.test.ts for the win32 equivalent.
        const r = await runCommand('awm-definitely-not-a-real-binary-xyz', { timeout: 5000, cwd: process.cwd() });
        expect(r.code).toBe(127);
    });
});

onPosix('runCommand — output cap', () => {
    it('stops at maxBuffer, flags overflow, and keeps what it read', async () => {
        // 200 lines of ~50 bytes each, capped at 1KB. A `for i in $(seq ...); do
        // ... done` POSIX shell loop silently no-ops under cmd.exe (win32's
        // spawn(cmd, {shell:true}) target) instead of erroring — cmd.exe has
        // no `$(...)`/`do...done` syntax, so the whole string is passed through
        // largely inert and stdout never reaches the cap (regression: this test
        // isn't POSIX-scoped, so it ran for-real on windows-latest CI and
        // r.overflowed came back false). A `node -e` one-liner is invoked
        // identically by both shells (same portability reasoning as the
        // exit-code test above).
        const r = await runCommand("yes 'line-padding-padding-padding-padding'", { timeout: 10_000, cwd: process.cwd(), maxBuffer: 1024 });
        expect(r.overflowed).toBe(true);
        expect(r.stdout.length).toBeLessThanOrEqual(1024);
        // The point of the cap change: what was read is still usable, not discarded.
        expect(r.stdout).toMatch(/line-padding/);
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

onPosix('runStructuredCommand — local node_modules binaries', () => {
    it('follows an npm-style contained shim but rejects one escaping node_modules', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-local-bin-symlink-'));
        const modules = path.join(dir, 'node_modules');
        const bin = path.join(modules, '.bin');
        const contained = path.join(modules, 'tool', 'bin', 'tool');
        const outside = path.join(dir, 'outside-tool');
        try {
            fs.mkdirSync(path.dirname(contained), { recursive: true });
            fs.writeFileSync(contained, '#!/bin/sh\necho contained\n', { mode: 0o755 });
            fs.writeFileSync(outside, '#!/bin/sh\necho outside\n', { mode: 0o755 });
            fs.mkdirSync(bin, { recursive: true });
            fs.symlinkSync('../tool/bin/tool', path.join(bin, 'tool'));

            await expect(runStructuredCommand({ executable: 'tool', resolution: 'node-modules-bin', args: [] }, { timeout: 5000, cwd: dir }))
                .resolves.toMatchObject({ code: 0, stdout: 'contained\n' });

            fs.unlinkSync(path.join(bin, 'tool'));
            fs.symlinkSync(outside, path.join(bin, 'tool'));
            expect(() => runStructuredCommand({ executable: 'tool', resolution: 'node-modules-bin', args: [] }, { timeout: 5000, cwd: dir }))
                .toThrow(/node_modules.*contain|local/i);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

onPosix('runStructuredCommand — Python environments', () => {
    it('rejects a missing project Python executable instead of falling back to PATH', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-env-missing-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-env-global-'));
        const savedPath = process.env.PATH;
        try {
            fs.writeFileSync(path.join(global, 'semgrep'), '#!/bin/sh\necho global\n', { mode: 0o755 });
            process.env.PATH = global;

            expect(() => runStructuredCommand({ executable: 'semgrep', resolution: 'python-environment', args: ['--validate'] }, { timeout: 5000, cwd: dir }))
                .toThrow(/python.*environment.*local|contained/i);
        } finally {
            process.env.PATH = savedPath;
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(global, { recursive: true, force: true });
        }
    });
});
