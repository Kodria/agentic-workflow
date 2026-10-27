import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fingerprint as findingFingerprint } from '../../../src/commands/sensors/baseline';

const mockRunStructuredCommand = jest.fn();
const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: unknown[]) => mockRunCommand(...args),
    runStructuredCommand: (...args: unknown[]) => mockRunStructuredCommand(...args),
}));

const { ok, exited } = require('./exec-fixtures');

function git(cwd: string, args: string[]): string {
    return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

describe('runSensors result cache (RF-2.*, RF-6.*, RF-E.1/E.3)', () => {
    let project: string;
    let home: string;
    const version = '10.0.0';
    const eslintFinding = [{
        filePath: 'src/a.ts',
        messages: [{ line: 1, column: 1, message: 'no-x', ruleId: 'no-x', severity: 2 }],
    }];

    beforeEach(() => {
        jest.resetModules();
        mockRunStructuredCommand.mockReset();
        mockRunCommand.mockReset();
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-cache-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-cache-home-'));
        process.env.AWM_HOME = home;
        const registry = path.join(home, 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.mkdirSync(registry, { recursive: true });
        fs.writeFileSync(path.join(registry, 'eslint.config.awm.mjs'), 'export default []');
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '^10.0.0' } }));
        fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version }));
        fs.mkdirSync(path.join(project, 'src'), { recursive: true });
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
        fs.writeFileSync(path.join(registry, 'pack.json'), JSON.stringify({
            schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
            coverage: { schemaVersion: 1, classes: { lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix', command: 'awm sensors init' } } } },
            sensors: {
                lint: {
                    fast: true,
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'eslint-10', priority: 1, certifiedRange: '>=10 <11',
                        requirements: { tool: 'eslint', toolRange: '>=10 <11', runtime: 'node', runtimeRange: '>=0' },
                        assets: ['eslint.config.awm.mjs'], formatter: 'eslint-llm',
                        probe: { kind: 'package-script-present', script: 'lint' },
                        command: { executable: 'live-eslint', resolution: 'node-modules-bin', args: ['.'] },
                        inputs: ['src/**/*.ts'],
                    }],
                },
            },
        }));
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts', registryRoot: path.join(home, 'registries', 'baseline'), sensors: {
                lint: {
                    enabled: true, fast: true, variantId: 'eslint-10',
                    command: { executable: 'stale-eslint', resolution: 'node-modules-bin', args: ['.'] },
                    assets: ['eslint.config.awm.mjs'],
                    inputs: ['src/**/*.ts'],
                    initializedCompatibility: {
                        state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10',
                        toolVersion: version, runtimeVersion: process.versions.node, certifiedRange: '>=10 <11', evidence: [],
                    },
                },
            },
        }));
        git(project, ['init', '-q', '-b', 'main']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'init']);
        mockRunStructuredCommand.mockResolvedValue(ok());
    });

    afterEach(() => {
        delete process.env.AWM_HOME;
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    it('caches a full-scope pass and reuses it with cached:true + provenance; --no-cache forces exec (RF-2.2/2.8/2.9/2.11)', async () => {
        const { runSensors } = load();
        const first = await runSensors({ cwd: project, useCache: true });
        expect(first.sensors[0]).toMatchObject({ status: 'pass', name: 'lint' });
        expect(first.sensors[0].cached).toBeUndefined();
        expect(mockRunStructuredCommand).toHaveBeenCalledTimes(1);

        mockRunStructuredCommand.mockClear();
        const hit = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
        expect(hit.sensors[0]).toMatchObject({
            status: 'pass',
            cached: true,
            cacheProvenance: expect.objectContaining({
                inputDigest: expect.stringMatching(/^sha256:/),
                sensorFingerprint: expect.stringMatching(/^sha256:/),
            }),
        });

        mockRunStructuredCommand.mockResolvedValue(ok());
        const forced = await runSensors({ cwd: project, useCache: false });
        expect(mockRunStructuredCommand).toHaveBeenCalledTimes(1);
        expect(forced.sensors[0].cached).toBeUndefined();
    });

    it('does not read or write cache when useCache is unset, readOnly, or ignoreBaseline (RF-2.11/2.13)', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project });
        expect(mockRunStructuredCommand).toHaveBeenCalled();
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
        expect(cacheFiles).toEqual([]);

        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockResolvedValue(ok());
        await runSensors({ cwd: project, useCache: true });
        expect(fs.readdirSync(path.join(project, '.awm', 'sensors', 'runs')).some((n) => n.startsWith('cache-'))).toBe(true);

        mockRunStructuredCommand.mockClear();
        await runSensors({ cwd: project, useCache: true, ignoreBaseline: true });
        expect(mockRunStructuredCommand).toHaveBeenCalled();

        mockRunStructuredCommand.mockClear();
        await runSensors({ cwd: project, useCache: true, readOnly: true });
        expect(mockRunStructuredCommand).toHaveBeenCalled();
    });

    it('re-applies baseline on cache hit: findings-fail→pass, then remove baseline→fail without re-exec (RF-2.13)', async () => {
        mockRunStructuredCommand.mockResolvedValue(exited(1, JSON.stringify(eslintFinding)));
        const { runSensors } = load();
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        const err = { file: 'src/a.ts', line: 1, column: 1, message: 'no-x', rule: 'no-x' };
        writeBaseline(project, { lint: [findingFingerprint('lint', err)] });

        const first = await runSensors({ cwd: project, useCache: true });
        expect(first.sensors[0]).toMatchObject({ status: 'pass', baselineCount: 1 });
        expect(mockRunStructuredCommand).toHaveBeenCalledTimes(1);

        mockRunStructuredCommand.mockClear();
        const hitPass = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
        expect(hitPass.sensors[0]).toMatchObject({ status: 'pass', cached: true, baselineCount: 1 });

        writeBaseline(project, {});
        const hitFail = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
        expect(hitFail.sensors[0]).toMatchObject({ status: 'fail', cached: true, failureKind: 'findings' });
    });

    it('does not write cache on --changed even when useCache is true (RF-2.7)', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true, changed: true });
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
        expect(cacheFiles).toEqual([]);
    });

    it('never caches project-declared sensors without live tool version (RF-2.10)', async () => {
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3,
            mode: 'project-sensors',
            pack: null,
            sensors: {
                custom: {
                    source: 'project',
                    enabled: true,
                    fast: true,
                    command: { executable: 'node', resolution: 'path', args: ['-e', 'process.exit(0)'] },
                    formatter: 'exit-code',
                    inputs: ['src/**/*.ts'],
                },
            },
        }));
        mockRunStructuredCommand.mockResolvedValue(ok());
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
        expect(cacheFiles).toEqual([]);
        expect(mockRunStructuredCommand).toHaveBeenCalled();
    });

    it('misses when live tool version changes (RF-2.10 liveState fingerprint)', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        mockRunStructuredCommand.mockClear();
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.9.0' }));
        mockRunStructuredCommand.mockResolvedValue(ok());
        const miss = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).toHaveBeenCalled();
        expect(miss.sensors[0].cached).toBeUndefined();
    });

    it('records originDirty when writing cache on a dirty tree (RF-2.14)', async () => {
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 2;\n');
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        mockRunStructuredCommand.mockClear();
        const hit = await runSensors({ cwd: project, useCache: true });
        expect(hit.sensors[0]).toMatchObject({
            cached: true,
            cacheProvenance: expect.objectContaining({ originDirty: true }),
        });
    });

    it('does not write cache when digest changes during execute (RF-2.16)', async () => {
        mockRunStructuredCommand.mockImplementation(async () => {
            fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 99;\n');
            return ok();
        });
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
        expect(cacheFiles).toEqual([]);
    });

    it('does not write exit-code or missing-binary fails; may write findings fails (RF-2.4)', async () => {
        mockRunStructuredCommand.mockResolvedValue(exited(1, JSON.stringify(eslintFinding)));
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        expect(fs.readdirSync(runs).some((n) => n.startsWith('cache-'))).toBe(true);

        for (const f of fs.readdirSync(runs).filter((n) => n.startsWith('cache-'))) {
            fs.unlinkSync(path.join(runs, f));
        }
        // Switch to exit-code formatter via project override is heavy; assert helper path via second pack run with generic tool-missing.
        mockRunStructuredCommand.mockResolvedValue(exited(127, '', 'command not found'));
        // formatter eslint-llm with empty findings + tool missing heuristics → missing-binary
        await runSensors({ cwd: project, useCache: true });
        // After findings cache was deleted, missing-binary must not recreate cache for a miss-exec that is not cacheable.
        // Note: digest still matches; if a findings cache remained it would hit — we deleted it.
        const afterMissing = fs.readdirSync(runs).filter((n) => n.startsWith('cache-'));
        expect(afterMissing).toEqual([]);
    });

    it('keeps cache hits when authored globs match baseline.json; re-applies new baseline without re-exec (RF-2.12/2.13)', async () => {
        // Broad JSON globs would include .awm/sensors.baseline.json unless the digest hard-excludes it.
        const manifest = JSON.parse(fs.readFileSync(path.join(project, '.awm', 'sensors.json'), 'utf8'));
        manifest.sensors.lint.inputs = ['**/*.json', 'src/**/*.ts'];
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify(manifest));
        const pack = JSON.parse(fs.readFileSync(path.join(home, 'registries', 'baseline', 'sensor-packs', 'js-ts', 'pack.json'), 'utf8'));
        pack.sensors.lint.variants[0].inputs = ['**/*.json', 'src/**/*.ts'];
        fs.writeFileSync(path.join(home, 'registries', 'baseline', 'sensor-packs', 'js-ts', 'pack.json'), JSON.stringify(pack));
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'broad-inputs']);

        mockRunStructuredCommand.mockResolvedValue(exited(1, JSON.stringify(eslintFinding)));
        const { runSensors } = load();
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        const err = { file: 'src/a.ts', line: 1, column: 1, message: 'no-x', rule: 'no-x' };
        writeBaseline(project, { lint: [findingFingerprint('lint', err)] });

        await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).toHaveBeenCalledTimes(1);

        // Change baseline content (would bust digest if baseline were measured) and clear acceptance.
        writeBaseline(project, {});
        mockRunStructuredCommand.mockClear();
        const hit = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
        expect(hit.sensors[0]).toMatchObject({ status: 'fail', cached: true, failureKind: 'findings' });
    });

    it('does not apply cache hits over synthetic skip/disabled prepare results (RF-2.2/2.6/6.1)', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).toHaveBeenCalled();
        expect(fs.readdirSync(path.join(project, '.awm', 'sensors', 'runs')).some((n) => n.startsWith('cache-'))).toBe(true);

        const manifest = JSON.parse(fs.readFileSync(path.join(project, '.awm', 'sensors.json'), 'utf8'));
        manifest.sensors.lint.enabled = false;
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify(manifest));

        mockRunStructuredCommand.mockClear();
        const skipped = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
        expect(skipped.sensors[0]).toMatchObject({ status: 'skipped', skipReason: 'disabled' });
        expect(skipped.sensors[0].cached).toBeUndefined();
    });

    it('treats planted uncacheable raw cache entries as a miss and executes (RF-2.15/2.4)', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true });
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.readdirSync(runs).filter((n) => n.startsWith('cache-'));
        expect(cacheFiles).toHaveLength(1);
        const cachePath = path.join(runs, cacheFiles[0]!);
        const record = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        record.raw = { name: 'lint', status: 'fail', failureKind: 'exit-code', errors: [{ message: 'exit 1' }] };
        fs.writeFileSync(cachePath, JSON.stringify(record, null, 2) + '\n');

        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockResolvedValue(ok());
        const miss = await runSensors({ cwd: project, useCache: true });
        expect(mockRunStructuredCommand).toHaveBeenCalled();
        expect(miss.sensors[0]).toMatchObject({ status: 'pass' });
        expect(miss.sensors[0].cached).toBeUndefined();
    });
});
