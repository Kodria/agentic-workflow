import fs from 'fs';
import path from 'path';

type EnvironmentRoot = '.venv' | 'venv';
type Options = { executable?: boolean };

/** Creates contained Semgrep metadata and the host-appropriate virtualenv executable. */
export function createSemgrepVenvFixture(root: string, targetPlatform: NodeJS.Platform = process.platform, environmentRoot: EnvironmentRoot = '.venv', options: Options = {}): void {
    if (typeof root !== 'string' || root.trim() === '') throw new Error('fixture root must be a non-empty path');
    const windows = targetPlatform === 'win32';
    const sitePackages = windows
        ? [environmentRoot, 'Lib', 'site-packages']
        : [environmentRoot, 'lib', 'python3.12', 'site-packages'];
    const metadata = path.join(root, ...sitePackages, 'semgrep-1.91.0.dist-info');
    fs.mkdirSync(metadata, { recursive: true });
    fs.writeFileSync(path.join(root, environmentRoot, 'pyvenv.cfg'), 'version = 3.12.4\n');
    fs.writeFileSync(path.join(metadata, 'METADATA'), 'Name: semgrep\nVersion: 1.91.0\n');
    if (options.executable === false) return;

    const executable = path.join(root, environmentRoot, windows ? 'Scripts' : 'bin', windows ? 'semgrep.exe' : 'semgrep');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    if (windows) fs.copyFileSync(process.execPath, executable);
    else fs.writeFileSync(executable, '#!/bin/sh\necho local-semgrep\n', { mode: 0o755 });
}
