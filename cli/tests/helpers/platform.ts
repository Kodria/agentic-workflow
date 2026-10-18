import fs from 'fs';
import os from 'os';
import path from 'path';

/** `test` where symlinks and POSIX modes exist; reported as skipped (not as passed) on Windows. */
export const posixOnly: typeof test = process.platform === 'win32' ? (test.skip as typeof test) : test;

/** True when this process can create a symlink (Windows needs the privilege or developer mode). */
export const canCreateSymlinks: boolean = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-symlink-probe-'));
    try {
        fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, 'link'));
        return true;
    } catch {
        return false;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})();

/** `test` that needs to create symlinks; reported as skipped (not as passed) where it cannot. */
export const symlinkTest: typeof test = canCreateSymlinks ? test : (test.skip as typeof test);
