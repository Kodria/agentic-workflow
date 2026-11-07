import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
    cacheFileName,
    computeSensorFingerprint,
    digestSortedSlicePaths,
} from '../../../src/commands/sensors/result-cache';

const mockRunStructuredCommand = jest.fn();
const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: unknown[]) => mockRunCommand(...args),
    runStructuredCommand: (...args: unknown[]) => mockRunStructuredCommand(...args),
}));

const mockChangedFiles = jest.fn();
const mockChangedDeletedFiles = jest.fn();
jest.mock('../../../src/commands/sensors/changed', () => {
    const actual = jest.requireActual('../../../src/commands/sensors/changed');
    return {
        ...actual,
        changedFiles: (...args: unknown[]) => mockChangedFiles(...args),
        changedDeletedFiles: (...args: unknown[]) => mockChangedDeletedFiles(...args),
    };
});

const { ok } = require('./exec-fixtures');

const SLICE_COMMAND = {
    executable: 'stryker-slice',
    resolution: 'node-modules-bin' as const,
    args: ['run', '--mutate', '{files}'],
    fileInput: { placeholder: '{files}' as const, extensions: ['.ts', '.tsx'] },
};

const FULL_COMMAND = {
    executable: 'stryker-full',
    resolution: 'node-modules-bin' as const,
    args: ['run'],
};

const INPUTS = ['src/**/*.ts', 'tests/**/*.ts'];

function git(cwd: string, args: string[]): string {
    return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

describe('runSensors scoped vs full cache isolation (RF-2.1, RF-2.2, RF-2.3, RF-2.5, RF-2.6)', () => {
    let project: string;
    let home: string;
    const version = '10.0.0';
    const ENV_KEYS = ['HOME', 'AWM_HOME'] as const;
    const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

    function writeFixture() {
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-slice-cache-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-slice-cache-home-'));
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
        const registry = path.join(process.env.AWM_HOME, 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.mkdirSync(registry, { recursive: true });
        fs.writeFileSync(path.join(registry, 'eslint.config.awm.mjs'), 'export default []');
        fs.writeFileSync(path.join(process.env.AWM_HOME, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '^10.0.0' } }));
        fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version }));
        for (const tool of ['stryker', 'jest']) {
            fs.mkdirSync(path.join(project, 'node_modules', tool), { recursive: true });
            fs.writeFileSync(path.join(project, 'node_modules', tool, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        }
        fs.mkdirSync(path.join(project, 'src'), { recursive: true });
        fs.mkdirSync(path.join(project, 'tests'), { recursive: true });
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
        fs.writeFileSync(path.join(project, 'tests', 'a.test.ts'), 'export const t = 1;\n');

        fs.writeFileSync(path.join(registry, 'pack.json'), JSON.stringify({
            schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
            coverage: {
                schemaVersion: 1,
                classes: {
                    lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix', command: 'awm sensors init' } },
                    mutation: { description: 'mutation', detectors: [{ sensor: 'mutation' }], remedy: { summary: 'fix', command: 'awm sensors init' } },
                },
            },
            sensors: {
                lint: {
                    fast: true,
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'eslint-10', priority: 1, certifiedRange: '>=10 <11',
                        requirements: { tool: 'eslint', toolRange: '>=10 <11', runtime: 'node', runtimeRange: '>=0' },
                        assets: ['eslint.config.awm.mjs'], formatter: 'generic',
                        probe: { kind: 'package-script-present', script: 'lint' },
                        command: { executable: 'live-eslint', resolution: 'node-modules-bin', args: ['.'] },
                        inputs: ['src/**/*.ts'],
                    }],
                },
                mutation: {
                    fast: false,
                    closureOnly: true,
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'stryker', priority: 1, certifiedRange: '>=0',
                        requirements: { tool: 'stryker', toolRange: '>=0', runtime: 'node', runtimeRange: '>=0' },
                        assets: [], formatter: 'generic',
                        probe: { kind: 'version' },
                        command: FULL_COMMAND,
                        sliceCommand: SLICE_COMMAND,
                        inputs: INPUTS,
                    }],
                },
            },
        }));

        const compat = (variantId: string, toolVersion: string, certifiedRange = '>=0') => ({
            state: 'certified',
            reason: 'range-and-probe',
            variantId,
            toolVersion,
            runtimeVersion: process.versions.node,
            certifiedRange,
            evidence: [],
        });
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts', registryRoot: path.join(home, '.awm', 'registries', 'baseline'), sensors: {
                lint: {
                    enabled: true, fast: true, variantId: 'eslint-10',
                    command: { executable: 'stale', resolution: 'node-modules-bin', args: ['.'] },
                    assets: ['eslint.config.awm.mjs'],
                    inputs: ['src/**/*.ts'],
                    initializedCompatibility: compat('eslint-10', version, '>=10 <11'),
                },
                mutation: {
                    enabled: true, fast: false, variantId: 'stryker',
                    command: { executable: 'stale', resolution: 'node-modules-bin', args: ['run'] },
                    inputs: INPUTS,
                    initializedCompatibility: compat('stryker', '1.0.0'),
                },
            },
        }));
        git(project, ['init', '-q', '-b', 'main']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'init']);
    }

    beforeEach(() => {
        jest.resetModules();
        mockRunStructuredCommand.mockReset();
        mockRunCommand.mockReset();
        mockChangedFiles.mockReset();
        mockChangedDeletedFiles.mockReset();
        mockRunStructuredCommand.mockResolvedValue(ok());
        mockRunCommand.mockResolvedValue(ok());
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        mockChangedDeletedFiles.mockReturnValue({ files: [] });
        for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
        writeFixture();
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (savedEnv[key] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[key];
        }
        if (project) fs.rmSync(project, { recursive: true, force: true });
        if (home) fs.rmSync(home, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');
    const byName = (out: { sensors: Array<{ name: string }> }) =>
        Object.fromEntries(out.sensors.map((s: { name: string }) => [s.name, s])) as Record<string, any>;
    const cacheFiles = () => {
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        return fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
    };
    /** Count real sensor executes; ignore compatibility `--version` probes. */
    const mutationExecCount = () => mockRunStructuredCommand.mock.calls.filter(
        (c: unknown[]) => {
            const cmd = c[0] as { executable?: string; args?: string[] };
            if (cmd?.executable !== 'stryker-slice' && cmd?.executable !== 'stryker-full') return false;
            if (Array.isArray(cmd.args) && cmd.args.length === 1 && cmd.args[0] === '--version') return false;
            return true;
        },
    ).length;

    it('RF-2.1/2.2: second identical --slice --base run hits scoped cache (cached:true)', async () => {
        const { runSensors } = load();
        const first = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(byName(first).mutation).toMatchObject({ status: 'pass' });
        expect(byName(first).mutation.cached).toBeUndefined();
        expect(mutationExecCount()).toBe(1);

        mockRunStructuredCommand.mockClear();
        const second = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(mutationExecCount()).toBe(0);
        expect(byName(second).mutation).toMatchObject({
            status: 'pass',
            cached: true,
            cacheProvenance: expect.objectContaining({
                inputDigest: expect.stringMatching(/^sha256:/),
                sensorFingerprint: expect.stringMatching(/^sha256:/),
            }),
        });
        expect(second.overall).toBe('pass');
    });

    it('RF-1.8/A6: scoped cache hit still exposes scope + files + scopeReason drop diagnostics', async () => {
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts', '../escape.ts', '/etc/passwd'] });
        const { runSensors } = load();
        const first = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        const cold = byName(first).mutation;
        expect(cold).toMatchObject({
            status: 'pass',
            scope: 'slice',
            execution: expect.objectContaining({
                files: 1,
                scopeReason: expect.stringMatching(/dropped \d+ path\(s\) outside packageRoot/i),
                requestedScope: 'slice',
                effectiveScope: 'slice',
            }),
        });
        expect(cold.cached).toBeUndefined();
        expect(mutationExecCount()).toBe(1);

        mockRunStructuredCommand.mockClear();
        const second = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(mutationExecCount()).toBe(0);
        const hit = byName(second).mutation;
        expect(hit).toMatchObject({
            status: 'pass',
            cached: true,
            scope: 'slice',
            execution: expect.objectContaining({
                files: 1,
                scopeReason: expect.stringMatching(/dropped \d+ path\(s\) outside packageRoot/i),
                requestedScope: 'slice',
                effectiveScope: 'slice',
            }),
        });
    });

    it('RF-2.1: changing only a test file under inputs forces scoped miss', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(mutationExecCount()).toBe(1);

        mockRunStructuredCommand.mockClear();
        const hit = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(byName(hit).mutation).toMatchObject({ status: 'pass', cached: true });
        expect(mutationExecCount()).toBe(0);

        fs.writeFileSync(path.join(project, 'tests', 'a.test.ts'), 'export const t = 99;\n');
        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockResolvedValue(ok());
        const miss = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(mutationExecCount()).toBe(1);
        expect(byName(miss).mutation.cached).toBeUndefined();
        expect(byName(miss).mutation.status).toBe('pass');
    });

    it('A5: changing content of a slice file outside inputs forces scoped miss', async () => {
        // Narrow inputs so src/a.ts is in slice argv but NOT in inputs digests.
        const sensorsPath = path.join(project, '.awm', 'sensors.json');
        const manifest = JSON.parse(fs.readFileSync(sensorsPath, 'utf8'));
        manifest.sensors.mutation.inputs = ['tests/**/*.ts'];
        fs.writeFileSync(sensorsPath, JSON.stringify(manifest));
        const packPath = path.join(home, '.awm', 'registries', 'baseline', 'sensor-packs', 'js-ts', 'pack.json');
        const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
        pack.sensors.mutation.variants[0].inputs = ['tests/**/*.ts'];
        fs.writeFileSync(packPath, JSON.stringify(pack));
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'narrow-inputs']);

        const { runSensors } = load();
        await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(mutationExecCount()).toBe(1);
        mockRunStructuredCommand.mockClear();
        const hit = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(byName(hit).mutation).toMatchObject({ status: 'pass', cached: true });
        expect(mutationExecCount()).toBe(0);

        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 42;\n');
        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockResolvedValue(ok());
        const miss = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(mutationExecCount()).toBe(1);
        expect(byName(miss).mutation.cached).toBeUndefined();
    });

    it('RF-2.2: scoped fingerprint includes mode/sliceCommand/paths; dropping them collapses keys (mutation RED)', () => {
        const slicePathsDigest = digestSortedSlicePaths(['src/a.ts']);
        const otherPathsDigest = digestSortedSlicePaths(['src/b.ts']);
        expect(slicePathsDigest).not.toEqual(otherPathsDigest);
        const live = {
            variantId: 'stryker',
            cliVersion: '9.99.0-test',
            inputs: INPUTS,
            toolVersion: '1.0.0',
            runtimeVersion: process.versions.node,
        };
        const fullFp = computeSensorFingerprint({
            ...live,
            command: FULL_COMMAND,
        });
        const scopedFp = computeSensorFingerprint({
            ...live,
            command: FULL_COMMAND,
            cacheMode: 'slice',
            sliceCommand: SLICE_COMMAND,
            slicePathsDigest,
        });
        const scopedFpOtherPaths = computeSensorFingerprint({
            ...live,
            command: FULL_COMMAND,
            cacheMode: 'slice',
            sliceCommand: SLICE_COMMAND,
            slicePathsDigest: otherPathsDigest,
        });
        expect(scopedFp).not.toBeNull();
        expect(fullFp).not.toBeNull();
        expect(scopedFp).not.toEqual(fullFp);
        expect(scopedFp).not.toEqual(scopedFpOtherPaths);

        // Mutation: omit mode + slice fields → key collapses toward a non-scoped shape.
        const collapsed = computeSensorFingerprint({
            ...live,
            command: FULL_COMMAND,
        });
        expect(collapsed).toEqual(fullFp);
        expect(collapsed).not.toEqual(scopedFp);

        const fullKey = cacheFileName({
            sensorId: 'mutation',
            projectKey: 'proj',
            sensorFingerprint: fullFp!,
            inputDigest: 'sha256:' + 'b'.repeat(64),
        });
        const scopedKey = cacheFileName({
            sensorId: 'mutation',
            projectKey: 'proj',
            sensorFingerprint: scopedFp!,
            inputDigest: 'sha256:' + 'b'.repeat(64),
        });
        expect(scopedKey).not.toEqual(fullKey);
    });

    it('RF-2.2: after scoped pass, full gate never reports a hit sourced from the scoped entry', async () => {
        const { runSensors } = load();
        const slice1 = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(byName(slice1).mutation.status).toBe('pass');
        const sliceFp = byName(slice1).mutation.measurement?.sensorFingerprint
            ?? byName(slice1).mutation.cacheProvenance?.sensorFingerprint;

        mockRunStructuredCommand.mockClear();
        const slice2 = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(byName(slice2).mutation).toMatchObject({ cached: true });
        const scopedHitFp = byName(slice2).mutation.cacheProvenance.sensorFingerprint;

        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockResolvedValue(ok());
        const full = await runSensors({ cwd: project, useCache: true });
        const mutation = byName(full).mutation;
        expect(mutation.cached).toBeUndefined();
        expect(mutationExecCount()).toBeGreaterThanOrEqual(1);
        expect(structuredMutationExe()).toContain('stryker-full');
        const fullFp = mutation.measurement?.sensorFingerprint;
        expect(fullFp).toEqual(expect.stringMatching(/^sha256:/));
        expect(fullFp).not.toEqual(scopedHitFp);
        if (sliceFp) expect(fullFp).not.toEqual(sliceFp);
    });

    function structuredMutationExe(): string[] {
        return mockRunStructuredCommand.mock.calls
            .map((c: unknown[]) => c[0] as { executable?: string; args?: string[] })
            .filter((cmd) => {
                if (typeof cmd?.executable !== 'string' || !cmd.executable.startsWith('stryker-')) return false;
                if (Array.isArray(cmd.args) && cmd.args.length === 1 && cmd.args[0] === '--version') return false;
                return true;
            })
            .map((cmd) => cmd.executable as string);
    }

    it('RF-2.3: full-gate with unchanged inputs still hits full cache (#236 regression)', async () => {
        const { runSensors } = load();
        const first = await runSensors({ cwd: project, useCache: true });
        expect(byName(first).mutation).toMatchObject({ status: 'pass' });
        expect(byName(first).mutation.cached).toBeUndefined();
        expect(mutationExecCount()).toBe(1);
        expect(cacheFiles().length).toBeGreaterThan(0);

        mockRunStructuredCommand.mockClear();
        const hit = await runSensors({ cwd: project, useCache: true });
        expect(byName(hit).mutation).toMatchObject({
            status: 'pass',
            cached: true,
            cacheProvenance: expect.objectContaining({
                sensorFingerprint: expect.stringMatching(/^sha256:/),
            }),
        });
        expect(byName(hit).lint).toMatchObject({ status: 'pass', cached: true });
        expect(mutationExecCount()).toBe(0);
    });

    it('RF-2.6: --changed still does not write full cache', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, useCache: true, changed: true });
        expect(cacheFiles()).toEqual([]);
    });

    it('RF-2.5: overall pass requires every selected sensor executed or valid same-mode cache hit', async () => {
        const { runSensors } = load();
        const { timedOut } = require('./exec-fixtures');
        const first = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(first.overall).toBe('pass');
        for (const s of first.sensors) {
            expect(['pass', 'skipped']).toContain(s.status);
            if (s.status === 'pass') expect(s.cached).toBeUndefined();
        }

        mockRunStructuredCommand.mockClear();
        const second = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(second.overall).toBe('pass');
        const mutation = byName(second).mutation;
        expect(mutation).toMatchObject({ status: 'pass', cached: true });
        // Killing assert: overall pass ⇒ every non-skipped sensor is pass (same-mode hit or exec).
        for (const s of second.sensors) {
            if (s.status === 'skipped') continue;
            expect(s.status).toBe('pass');
        }

        // Kill false overall-pass: a timed-out slice sensor must demote overall.
        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockImplementation(async (cmd: { executable?: string; args?: string[] }) => {
            if (cmd?.executable === 'stryker-slice' && !(Array.isArray(cmd.args) && cmd.args[0] === '--version')) {
                return timedOut();
            }
            return ok();
        });
        // Force miss by changing inputs so the prior scoped hit cannot greenwash a timeout.
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 2;\n');
        const failed = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        const failedMutation = byName(failed).mutation;
        expect(failedMutation.status).not.toBe('pass');
        expect(failedMutation.cached).toBeUndefined();
        expect(failed.overall).not.toBe('pass');
        // A subsequent identical timeout must not suddenly report overall pass via cache.
        mockRunStructuredCommand.mockClear();
        mockRunStructuredCommand.mockImplementation(async (cmd: { executable?: string; args?: string[] }) => {
            if (cmd?.executable === 'stryker-slice' && !(Array.isArray(cmd.args) && cmd.args[0] === '--version')) {
                return timedOut();
            }
            return ok();
        });
        const again = await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true });
        expect(byName(again).mutation.status).not.toBe('pass');
        expect(byName(again).mutation.cached).toBeUndefined();
        expect(again.overall).not.toBe('pass');
    });

    it('readOnly / useCache:false / ignoreBaseline: no scoped or full cache IO', async () => {
        const { runSensors } = load();
        await runSensors({ cwd: project, slice: true, base: 'slice-base' });
        expect(cacheFiles()).toEqual([]);

        mockRunStructuredCommand.mockClear();
        await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true, readOnly: true });
        expect(cacheFiles()).toEqual([]);

        mockRunStructuredCommand.mockClear();
        await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: true, ignoreBaseline: true });
        expect(cacheFiles()).toEqual([]);

        mockRunStructuredCommand.mockClear();
        await runSensors({ cwd: project, slice: true, base: 'slice-base', useCache: false });
        expect(cacheFiles()).toEqual([]);
    });
});
