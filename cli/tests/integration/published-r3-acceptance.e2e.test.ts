import crypto from 'crypto';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const publishedCliRoot = process.env.AWM_PUBLISHED_CLI_ROOT;
const publishedRegistryRoot = process.env.AWM_PUBLISHED_REGISTRY_ROOT;
// This gate is pinned to the npm release that contains the native ESLint
// configuration selection fix merged for R3.
const expectedVersion = process.env.AWM_PUBLISHED_CLI_VERSION ?? '8.1.2';
const enabled = Boolean(publishedCliRoot && publishedRegistryRoot);
const acceptance = enabled ? describe : describe.skip;

type Fixture = { root: string; project: string; awmHome: string };

function hashTree(root: string): string {
    const hash = crypto.createHash('sha256');
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const item = path.join(directory, entry.name);
            hash.update(path.relative(root, item));
            if (entry.isDirectory()) walk(item);
            else if (entry.isFile()) hash.update(fs.readFileSync(item));
        }
    };
    walk(root);
    return hash.digest('hex');
}

function createFixture(kind: 'new' | 'legacy' | 'future'): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-published-r3-'));
    const project = path.join(root, 'project');
    const awmHome = path.join(root, 'awm-home');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(path.join(awmHome, 'registries'), { recursive: true });
    fs.cpSync(publishedRegistryRoot!, path.join(awmHome, 'registries', 'baseline'), { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'published-acceptance' }]));
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: `published-${kind}`, version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } }));
    if (kind === 'legacy') {
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts', sensors: { lint: { enabled: false, fast: true } },
        }));
    }
    if (kind === 'future') {
        fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '11.0.0' }));
    }
    return { root, project, awmHome };
}

function command(fixture: Fixture, ...args: string[]): SpawnSyncReturns<string> {
    const bin = path.join(publishedCliRoot!, 'dist', 'src', 'index.js');
    return spawnSync(process.execPath, [bin, ...args], {
        cwd: fixture.project,
        encoding: 'utf8',
        env: { ...process.env, AWM_HOME: fixture.awmHome, AWM_NO_UPDATE_CHECK: '1' },
    });
}

function json(result: SpawnSyncReturns<string>): Record<string, unknown> {
    if (result.stdout.trim() === '') throw new Error(`expected JSON output; status=${result.status}; stderr=${result.stderr}`);
    return JSON.parse(result.stdout) as Record<string, unknown>;
}

acceptance('published R3 acceptance', () => {
    beforeAll(() => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(publishedCliRoot!, 'package.json'), 'utf8')) as { version?: string };
        expect(packageJson.version).toBe(expectedVersion);
        expect(fs.existsSync(path.join(publishedCliRoot!, 'dist', 'src', 'index.js'))).toBe(true);
        expect(fs.existsSync(path.join(publishedRegistryRoot!, 'sensor-packs', 'js-ts', 'pack.json'))).toBe(true);
    });

    test.each(['new', 'legacy', 'future'] as const)('uses the npm-installed CLI for the %s compatibility case', (kind) => {
        const fixture = createFixture(kind);
        try {
            if (kind !== 'legacy') {
                const init = command(fixture, 'sensors', 'init', '--registry-root', publishedRegistryRoot!, '--pack', 'js-ts', '--no-configure');
                expect(init.status).toBe(0);
            }

            const beforeReadOnly = hashTree(fixture.project);
            const status = command(fixture, 'sensors', 'status');
            expect([0, 1]).toContain(status.status);
            const preflight = command(fixture, 'preflight', '--json');
            expect([0, 1]).toContain(preflight.status);
            expect(json(preflight)).toHaveProperty('status');
            const run = command(fixture, 'sensors', 'run', '--fast');
            expect([0, 1]).toContain(run.status);
            expect(json(run)).toHaveProperty('overall');
            const coverage = command(fixture, 'sensors', 'coverage', '--json', '--min', '2');
            if (process.platform === 'win32') {
                expect(coverage.status).toBe(1);
                expect(`${coverage.stdout}${coverage.stderr}`).toContain('platform cannot guarantee no symlink dereference');
            } else {
                expect(coverage.status).toBe(0);
                expect(json(coverage)).toHaveProperty('schemaVersion', 2);
            }
            expect(hashTree(fixture.project)).toBe(beforeReadOnly);

            command(fixture, 'ledger', 'add', '--branch', 'published-acceptance', '--polarity', 'finding', '--class', 'seguridad', '--signature', 'published-r3-finding', '--severity', 'important', '--desc', 'sanitized acceptance finding', '--defect-class', 'hardcoded-secrets');
            const beforeArchive = command(fixture, 'sensors', 'coverage', '--json', '--min', '2');
            expect(beforeArchive.status).toBe(process.platform === 'win32' ? 1 : 0);
            const archived = command(fixture, 'ledger', 'archive', '--branch', 'published-acceptance');
            expect(archived.status).toBe(0);
            expect(json(archived)).toMatchObject({ archived: true, branch: 'published-acceptance' });
            expect(fs.existsSync(path.join(fixture.project, '.awm', 'ledger', 'published-acceptance.jsonl'))).toBe(false);
            expect(fs.readdirSync(path.join(fixture.project, '.awm', 'ledger', 'archive'))).toHaveLength(1);
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    });
});
