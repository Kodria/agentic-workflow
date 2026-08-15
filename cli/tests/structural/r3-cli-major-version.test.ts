import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = path.resolve(__dirname, '../..');
const DIST_ENTRYPOINT = path.join(CLI_ROOT, 'dist', 'src', 'index.js');
const R3_MAJOR_VERSION = 8;

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
    it('retains the R3 major version consistently in package metadata and the lockfile root', () => {
        const pkg = readJson('package.json');
        const lock = readJson('package-lock.json');
        const root = (lock.packages as Record<string, Record<string, unknown>>)[''];
        const version = pkg.version;

        expect(typeof version).toBe('string');
        expect(version).toMatch(new RegExp(`^${R3_MAJOR_VERSION}\\.`));
        expect(lock.version).toBe(version);
        expect(root.version).toBe(version);
    });

    it('exposes the package version from the compiled CLI while retaining its help banner', () => {
        expect(runCompiledCli('--version').trim()).toBe(readJson('package.json').version);
        expect(runCompiledCli('--help')).toContain('Usage: awm');
    });
});
