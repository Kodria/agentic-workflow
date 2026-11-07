import fs from 'fs';
import os from 'os';
import path from 'path';
import { isFullSelection } from '../../../src/core/changes/receipt';

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

const { ok, timedOut, spawnFailed } = require('./exec-fixtures');

const SLICE_COMMAND = {
    executable: 'stryker-slice',
    resolution: 'node-modules-bin' as const,
    args: ['run', '--mutate', '{files}'],
    fileInput: { placeholder: '{files}' as const, extensions: ['.ts', '.tsx'] },
};

describe('runSensors --slice + sliceCommand (RF-1.1–1.4, RF-1.7–1.8, RF-E.2)', () => {
    let project: string;
    let home: string;
    const version = '10.0.0';

    function writeFixture(opts: { mutationSliceCommand?: typeof SLICE_COMMAND | false } = {}) {
        const includeSlice = opts.mutationSliceCommand !== false;
        const sliceCommand = opts.mutationSliceCommand === false
            ? undefined
            : (opts.mutationSliceCommand ?? SLICE_COMMAND);

        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-slice-cmd-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-slice-cmd-home-'));
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
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
        fs.writeFileSync(path.join(project, 'src', 'b.ts'), 'export const b = 1;\n');
        fs.writeFileSync(path.join(project, 'README.md'), '# fixture\n');

        const mutationVariant: Record<string, unknown> = {
            id: 'stryker', priority: 1, certifiedRange: '>=0',
            requirements: { tool: 'stryker', toolRange: '>=0', runtime: 'node', runtimeRange: '>=0' },
            assets: [], formatter: 'generic',
            probe: { kind: 'version' },
            command: { executable: 'stryker-full', resolution: 'node-modules-bin', args: ['run'] },
        };
        if (includeSlice && sliceCommand) mutationVariant.sliceCommand = sliceCommand;

        fs.writeFileSync(path.join(registry, 'pack.json'), JSON.stringify({
            schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
            coverage: {
                schemaVersion: 1,
                classes: {
                    lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix', command: 'awm sensors init' } },
                    mutation: { description: 'mutation', detectors: [{ sensor: 'mutation' }], remedy: { summary: 'fix', command: 'awm sensors init' } },
                    test: { description: 'test', detectors: [{ sensor: 'test' }], remedy: { summary: 'fix', command: 'awm sensors init' } },
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
                    }],
                },
                mutation: {
                    fast: false,
                    closureOnly: true,
                    applicability: { allFiles: ['package.json'] },
                    variants: [mutationVariant],
                },
                test: {
                    fast: false,
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'jest', priority: 1, certifiedRange: '>=0',
                        requirements: { tool: 'jest', toolRange: '>=0', runtime: 'node', runtimeRange: '>=0' },
                        assets: [], formatter: 'test',
                        probe: { kind: 'version' },
                        command: { executable: 'jest', resolution: 'node-modules-bin', args: ['--runInBand'] },
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
                    initializedCompatibility: compat('eslint-10', version, '>=10 <11'),
                },
                mutation: {
                    enabled: true, fast: false, variantId: 'stryker',
                    command: { executable: 'stale', resolution: 'node-modules-bin', args: ['run'] },
                    initializedCompatibility: compat('stryker', '1.0.0'),
                },
                test: {
                    enabled: true, fast: false, variantId: 'jest',
                    command: { executable: 'stale', resolution: 'node-modules-bin', args: ['--runInBand'] },
                    initializedCompatibility: compat('jest', '1.0.0'),
                },
            },
        }));
    }

    beforeEach(() => {
        jest.resetModules();
        mockRunStructuredCommand.mockReset();
        mockRunCommand.mockReset();
        mockChangedFiles.mockReset();
        mockChangedDeletedFiles.mockReset();
        mockChangedDeletedFiles.mockReturnValue({ files: [] });
        mockRunStructuredCommand.mockResolvedValue(ok());
        mockRunCommand.mockResolvedValue(ok());
        writeFixture();
    });

    afterEach(() => {
        delete process.env.HOME;
        delete process.env.AWM_HOME;
        if (project) fs.rmSync(project, { recursive: true, force: true });
        if (home) fs.rmSync(home, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');
    const byName = (out: { sensors: Array<{ name: string }> }) =>
        Object.fromEntries(out.sensors.map((s: { name: string }) => [s.name, s])) as Record<string, any>;
    const structuredArgs = (): any[] => mockRunStructuredCommand.mock.calls.map((c: unknown[]) => c[0]);

    it('bare --slice without --base and no sliceCommand keeps 9.22.x closureOnly skip (RF-1.8 / P1)', async () => {
        writeFixture({ mutationSliceCommand: false });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true });
        const sensors = byName(out);
        expect(sensors.mutation).toMatchObject({
            status: 'skipped',
            skipReason: expect.stringMatching(/closureOnly|slice/i),
        });
        expect(sensors.lint.status).toBe('pass');
        expect(sensors.test.status).toBe('pass');
        expect(out.overall).not.toMatch(/base/i);
        expect(JSON.stringify(out)).not.toMatch(/slice scope requires --base/i);
        expect(mockChangedFiles).not.toHaveBeenCalled();
    });

    it('closureOnly + sliceCommand + --slice without --base → that sensor non-pass; others still run (RF-1.4 / RF-1.8)', async () => {
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true });
        const sensors = byName(out);
        expect(sensors.mutation.status).not.toBe('pass');
        expect(sensors.mutation.status).not.toBe('skipped');
        expect(sensors.mutation.skipReason ?? JSON.stringify(sensors.mutation)).toMatch(/base/i);
        expect(sensors.lint.status).toBe('pass');
        expect(sensors.test.status).toBe('pass');
        expect(mockChangedFiles).not.toHaveBeenCalled();
        const mutationArgv = structuredArgs().filter((cmd: { executable?: string }) => cmd?.executable === 'stryker-slice');
        expect(mutationArgv).toHaveLength(0);
    });

    it('closureOnly without sliceCommand + --slice --base → synthetic skip mentions closureOnly (RF-1.2)', async () => {
        writeFixture({ mutationSliceCommand: false });
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'abc123' });
        const sensors = byName(out);
        expect(sensors.mutation).toMatchObject({
            status: 'skipped',
            skipReason: expect.stringMatching(/closureOnly/i),
        });
        // Live version probes may spawn `stryker-full --version`; the sensor body (`run`) must not.
        expect(structuredArgs().some((cmd: { executable?: string; args?: string[] }) =>
            cmd?.executable === 'stryker-full' && Array.isArray(cmd.args) && cmd.args.includes('run'))).toBe(false);
        expect(structuredArgs().some((cmd: { executable?: string }) => cmd?.executable === 'stryker-slice')).toBe(false);
    });

    it('closureOnly + sliceCommand + --slice --base with matching files executes slice argv (RF-1.1)', async () => {
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts', 'src/b.ts', 'README.md'] });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha' });
        const sensors = byName(out);
        expect(sensors.mutation.status).not.toBe('skipped');
        expect(sensors.mutation.status).toBe('pass');
        expect(mockChangedFiles).toHaveBeenCalledWith(project, 'slice-base-sha');
        const sliceCalls = structuredArgs().filter((cmd: { executable?: string }) => cmd?.executable === 'stryker-slice');
        expect(sliceCalls).toHaveLength(1);
        expect(sliceCalls[0].args).toEqual(['run', '--mutate', 'src/a.ts', 'src/b.ts']);
        expect(sliceCalls[0].args.join(' ')).not.toContain('{files}');
        expect(sensors.mutation.scope).toBe('slice');
        expect(sensors.mutation.execution?.requestedScope).toBe('slice');
        expect(sensors.mutation.execution?.effectiveScope).toBe('slice');
    });

    it('RF-1.8: --slice --base with a deleted matching file omits it from argv and notes scopeReason', async () => {
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        mockChangedDeletedFiles.mockReturnValue({ files: ['src/gone.ts'] });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha' });
        const sliceCalls = structuredArgs().filter((cmd: { executable?: string }) => cmd?.executable === 'stryker-slice');
        expect(sliceCalls).toHaveLength(1);
        expect(sliceCalls[0].args).toEqual(['run', '--mutate', 'src/a.ts']);
        expect(sliceCalls[0].args).not.toContain('src/gone.ts');
        expect(byName(out).mutation.execution?.scopeReason).toMatch(/omitted 1 deleted path\(s\) from argv/i);
    });

    it('full gate (no --slice) uses normal command, not sliceCommand (RF-1.3)', async () => {
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project });
        const sensors = byName(out);
        expect(sensors.mutation.status).toBe('pass');
        const executables = structuredArgs().map((cmd: { executable?: string }) => cmd?.executable);
        expect(executables).toContain('stryker-full');
        expect(executables).not.toContain('stryker-slice');
        expect(mockChangedFiles).not.toHaveBeenCalled();
    });

    it('empty after extension filter → skipped with empty-scope reason, not pass (RF-1.4)', async () => {
        mockChangedFiles.mockReturnValue({ files: ['README.md', 'docs/note.md'] });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha' });
        const sensors = byName(out);
        expect(sensors.mutation.status).toBe('skipped');
        expect(sensors.mutation.status).not.toBe('pass');
        expect(sensors.mutation.skipReason).toMatch(/empty|no .*files|scope/i);
        expect(structuredArgs().some((cmd: { executable?: string }) => cmd?.executable === 'stryker-slice')).toBe(false);
        // Empty alone must not fail the overall gate when other sensors pass.
        expect(out.overall).toBe('pass');
    });

    it('bad base ref when sliceCommand would run → that sensor non-pass (RF-1.4)', async () => {
        mockChangedFiles.mockReturnValue({ files: [], error: 'bad revision \'no-such-ref\'' });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'no-such-ref' });
        const sensors = byName(out);
        expect(sensors.mutation.status).not.toBe('pass');
        expect(sensors.mutation.status).not.toBe('skipped');
        expect(sensors.mutation.skipReason ?? JSON.stringify(sensors.mutation)).toMatch(/resolv|bad revision|scope/i);
        expect(sensors.lint.status).toBe('pass');
    });

    it('--slice remains non-full selection / no Change Record receipt (RF-1.7)', async () => {
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        expect(isFullSelection({ slice: true })).toBe(false);
        expect(isFullSelection({ slice: true, base: 'x' } as { slice: boolean })).toBe(false);
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha' });
        expect(isFullSelection({ slice: true })).toBe(false);
        // Receipts are gated on isFullSelection in the CLI action; slice runs must stay partial.
        expect(out.sensors.some((s: { status: string }) => s.status === 'pass')).toBe(true);
        const runsDir = path.join(project, '.awm', 'sensors', 'runs');
        expect(fs.existsSync(runsDir) ? fs.readdirSync(runsDir) : []).toEqual([]);
    });

    function cacheFiles(): string[] {
        const runs = path.join(project, '.awm', 'sensors', 'runs');
        return fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
    }

    function withMutationInputs(): void {
        const packPath = path.join(home, '.awm', 'registries', 'baseline', 'sensor-packs', 'js-ts', 'pack.json');
        const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
        pack.sensors.mutation.variants[0].inputs = ['src/**/*.ts'];
        fs.writeFileSync(packPath, JSON.stringify(pack));
        const manifestPath = path.join(project, '.awm', 'sensors.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.sensors.mutation.inputs = ['src/**/*.ts'];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        fs.mkdirSync(path.join(project, 'src'), { recursive: true });
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
    }

    it('timeout of sliceCommand is non-pass and writes zero cache files (RF-E.2)', async () => {
        withMutationInputs();
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        mockRunStructuredCommand.mockImplementation(async (cmd: { executable?: string }) => {
            if (cmd?.executable === 'stryker-slice') return timedOut();
            return ok();
        });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha', useCache: true });
        const sensors = byName(out);
        expect(sensors.mutation.status).not.toBe('pass');
        expect(sensors.mutation.skipReason ?? '').toMatch(/timeout/i);
        expect(cacheFiles()).toEqual([]);
    });

    it('crash/spawn failure of sliceCommand is non-pass and writes zero cache files (RF-E.2)', async () => {
        withMutationInputs();
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });
        mockRunStructuredCommand.mockImplementation(async (cmd: { executable?: string }) => {
            if (cmd?.executable === 'stryker-slice') return spawnFailed('ENOENT');
            return ok();
        });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha', useCache: true });
        const sensors = byName(out);
        expect(sensors.mutation.status).not.toBe('pass');
        expect(['fail', 'inconclusive']).toContain(sensors.mutation.status);
        expect(cacheFiles()).toEqual([]);
    });

    it('rejects combining --slice with --changed', async () => {
        const { runSensors } = load();
        await expect(runSensors({ cwd: project, slice: true, changed: true })).rejects.toThrow(/slice.*changed|changed.*slice/i);
    });

    it('drops paths outside packageRoot before fileInput expansion and surfaces drop diagnostics (A5)', async () => {
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts', '../escape.ts', '/etc/passwd'] });
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, base: 'slice-base-sha' });
        const sensors = byName(out);
        expect(sensors.mutation.status).toBe('pass');
        expect(sensors.mutation.scopeReason ?? JSON.stringify(sensors.mutation)).toMatch(/dropped \d+ path\(s\) outside packageRoot/i);
        const sliceCalls = structuredArgs().filter((cmd: { executable?: string }) => cmd?.executable === 'stryker-slice');
        expect(sliceCalls).toHaveLength(1);
        expect(sliceCalls[0].args).toEqual(['run', '--mutate', 'src/a.ts']);
        expect(sliceCalls[0].args.join(' ')).not.toContain('escape');
        expect(sliceCalls[0].args.join(' ')).not.toContain('passwd');
    });

    it('documents --base for slice when registering the CLI option', () => {
        const { Command } = require('commander');
        const { registerSensorsCommand } = require('../../../src/commands/sensors/index');
        const program = new Command();
        program.exitOverride();
        registerSensorsCommand(program);
        const run = program.commands.find((c: { name: () => string }) => c.name() === 'sensors')
            .commands.find((c: { name: () => string }) => c.name() === 'run');
        const base = run.options.find((o: { long?: string }) => o.long === '--base');
        expect(base.description).toMatch(/slice/i);
    });
});
