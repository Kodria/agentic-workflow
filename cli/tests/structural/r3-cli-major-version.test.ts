import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = path.resolve(__dirname, '../..');
const DIST_ENTRYPOINT = path.join(CLI_ROOT, 'dist', 'src', 'index.js');

function readJson(file: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(CLI_ROOT, file), 'utf8')) as Record<string, unknown>;
}

function runCompiledCli(...args: string[]): string {
    const result = spawnSync(process.execPath, [DIST_ENTRYPOINT, ...args], {
        cwd: CLI_ROOT,
        encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    return `${result.stdout}${result.stderr}`;
}

describe('R3 public major CLI release contract', () => {
    // #92: the bump wrote only package.json, so the lockfile trailed by one
    // version on EVERY release. This is the real invariant — package.json,
    // package-lock.json, and its root entry must always agree. A hardcoded
    // expected major (originally 8, from when this test was written) goes
    // stale on every legitimate `!:`/BREAKING major bump and was never the
    // actual contract, so it isn't asserted here.
    it('retains a consistent version across package metadata and the lockfile root', () => {
        const pkg = readJson('package.json');
        const lock = readJson('package-lock.json');
        const root = (lock.packages as Record<string, Record<string, unknown>>)[''];
        const version = pkg.version;

        expect(typeof version).toBe('string');
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(lock.version).toBe(version);
        expect(root.version).toBe(version);
    });

    it('exposes the package version from the compiled CLI while retaining its help banner', () => {
        expect(runCompiledCli('--version').trim()).toBe(readJson('package.json').version);
        expect(runCompiledCli('--help')).toContain('Usage: awm');
    });
});
