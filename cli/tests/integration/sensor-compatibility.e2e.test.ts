import crypto from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSensorPack } from '../../src/commands/sensors/compatibility/contract';
import { discoverProjectEvidence } from '../../src/commands/sensors/compatibility/discovery';
import { runCompatibilityProbe } from '../../src/commands/sensors/compatibility/probe';
import { resolveSensorCompatibility } from '../../src/commands/sensors/compatibility/resolve';

const cliDir = path.resolve(__dirname, '../..');
const bin = path.join(cliDir, 'dist/src/index.js');
const fixtureRoot = path.join(cliDir, 'tests/fixtures/sensor-compatibility');
const projectFixture = path.join(fixtureRoot, 'project');
const registryFixture = path.join(fixtureRoot, 'registry');

type Fixture = { root: string; project: string; awmHome: string; registryRoot: string };

function hashTree(root: string): string {
    const hash = crypto.createHash('sha256');
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            hash.update(path.relative(root, file));
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) hash.update(fs.readFileSync(file));
        }
    };
    walk(root);
    return hash.digest('hex');
}

function createFixture(): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-r3-compatibility-'));
    const project = path.join(root, 'project');
    const awmHome = path.join(root, 'awm-home');
    const registryRoot = path.join(awmHome, 'registries', 'baseline');
    fs.cpSync(projectFixture, project, { recursive: true });
    fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
    fs.copyFileSync(path.join(project, 'eslint-tool-package.json'), path.join(project, 'node_modules', 'eslint', 'package.json'));
    fs.mkdirSync(path.dirname(registryRoot), { recursive: true });
    fs.cpSync(registryFixture, registryRoot, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'fixture' }]));
    return { root, project, awmHome, registryRoot };
}

function runCli(fixture: Fixture, ...args: string[]) {
    return spawnSync(process.execPath, [bin, 'sensors', ...args], {
        cwd: fixture.project,
        encoding: 'utf8',
        env: { ...process.env, AWM_HOME: fixture.awmHome, AWM_NO_UPDATE_CHECK: '1' },
    });
}

function json(result: ReturnType<typeof runCli>): any {
    expect(result.status).toBe(0);
    if (!(result.stdout ?? '').trim()) throw new Error(`coverage emitted no JSON: stderr=${result.stderr ?? ''}`);
    return JSON.parse(result.stdout ?? '');
}

beforeAll(() => {
    if (!fs.existsSync(bin)) throw new Error(`Compatibility E2E requires the compiled CLI at ${bin}; run npm run build before this test.`);
});

// This is a portable resolver *semantic* matrix: `platform` is injected into
// the resolver, so it proves the three path/selection branches but does not
// claim that this Linux process is a native macOS or Windows execution. Native
// binary coverage is exercised separately below and by the CI OS matrix.
test.each(['linux', 'darwin', 'win32'] as const)('keeps injected resolver semantics consistent on %s (R9.1)', async (platform) => {
    const fixture = createFixture();
    try {
        const source = JSON.parse(fs.readFileSync(path.join(fixture.registryRoot, 'sensor-packs', 'js-ts', 'pack.json'), 'utf8'));
        const parsed = parseSensorPack(source, 'fixture/pack.json');
        if (parsed.kind !== 'v2') throw new Error('fixture must be a v2 pack');
        const discovered = discoverProjectEvidence(fixture.project, parsed.pack, { platform: () => platform });
        const probe = await runCompatibilityProbe({ kind: 'version' }, { cwd: fixture.project, toolExecutable: 'eslint' }, async () => ({
            code: 0, signal: null, timedOut: false, overflowed: false, stdout: 'eslint v10.4.1', stderr: '',
        }));
        const result = resolveSensorCompatibility(parsed.pack.sensors.lint, { ...discovered, probe }, { pack: 'js-ts', sensor: 'lint' });
        expect(result).toMatchObject({ state: 'certified', variantId: 'eslint-10', toolVersion: '10.4.1' });
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('compiled binary dispatches coverage and emits parseable JSON on the native CI platform', () => {
    const fixture = createFixture();
    try {
        const report = json(runCli(fixture, 'coverage', '--json'));
        expect(report).toMatchObject({ schemaVersion: 2, static: expect.any(Object), empirical: expect.any(Object) });
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('legacy coverage stays unverified, init migrates explicitly, and version drift is visible (R7.2, R7.8)', () => {
    const fixture = createFixture();
    try {
        const before = [hashTree(fixture.project), hashTree(fixture.awmHome)];
        const legacy = json(runCli(fixture, 'coverage', '--json'));
        expect(legacy).toMatchObject({ schemaVersion: 2, static: { status: 'inconclusive' } });
        expect(legacy.static.classes).toEqual(expect.arrayContaining([expect.objectContaining({
            id: 'lint-errors', status: 'unverifiable', detectors: expect.arrayContaining([expect.objectContaining({ compatibility: expect.objectContaining({ state: 'compatible-unverified' }) })]),
        })]));
        expect([hashTree(fixture.project), hashTree(fixture.awmHome)]).toEqual(before);

        const migrated = runCli(fixture, 'init', '--registry-root', fixture.registryRoot, '--pack', 'js-ts', '--no-configure');
        expect(migrated.status).toBe(0);
        const manifest = JSON.parse(fs.readFileSync(path.join(fixture.project, '.awm', 'sensors.json'), 'utf8'));
        expect(manifest).toMatchObject({ schemaVersion: 2, pack: 'js-ts', sensors: { lint: { variantId: 'eslint-10' } } });

        const certified = json(runCli(fixture, 'coverage', '--json'));
        expect(certified.static.classes).toEqual(expect.arrayContaining([expect.objectContaining({
            id: 'lint-errors', status: 'covered', detectors: expect.arrayContaining([expect.objectContaining({ compatibility: expect.objectContaining({ state: 'certified' }) })]),
        })]));

        fs.writeFileSync(path.join(fixture.project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '11.0.0' }));
        const drift = json(runCli(fixture, 'coverage', '--json'));
        expect(drift).toMatchObject({ overall: 'inconclusive', static: { classes: [expect.objectContaining({
            id: 'lint-errors', status: 'unverifiable', detectors: expect.arrayContaining([expect.objectContaining({ compatibility: expect.objectContaining({ state: 'compatible-unverified' }) })]),
        })] } });
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});
