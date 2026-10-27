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

const { ok } = require('./exec-fixtures');

describe('runSensors --slice and isFullSelection (RF-2.6, RF-5.10)', () => {
    let project: string;
    let home: string;
    const version = '10.0.0';

    beforeEach(() => {
        jest.resetModules();
        mockRunStructuredCommand.mockReset();
        mockRunCommand.mockReset();
        mockRunStructuredCommand.mockResolvedValue(ok());
        mockRunCommand.mockResolvedValue(ok());
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-slice-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-slice-home-'));
        process.env.AWM_HOME = home;
        const registry = path.join(home, 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.mkdirSync(registry, { recursive: true });
        fs.writeFileSync(path.join(registry, 'eslint.config.awm.mjs'), 'export default []');
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '^10.0.0' } }));
        fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version }));
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
                    variants: [{
                        id: 'stryker', priority: 1, certifiedRange: '>=0',
                        requirements: { tool: 'stryker', toolRange: '>=0', runtime: 'node', runtimeRange: '>=0' },
                        assets: [], formatter: 'generic',
                        probe: { kind: 'version' },
                        command: { executable: 'stryker', resolution: 'node-modules-bin', args: ['run'] },
                    }],
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
        // Install fake tool versions so mutation/test resolve as compatible-unverified or certified.
        for (const tool of ['stryker', 'jest']) {
            fs.mkdirSync(path.join(project, 'node_modules', tool), { recursive: true });
            fs.writeFileSync(path.join(project, 'node_modules', tool, 'package.json'), JSON.stringify({ version: '1.0.0' }));
        }
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        const compat = (variantId: string, toolVersion: string, certifiedRange = '>=0') => ({
            state: 'certified',
            reason: 'range-and-probe',
            variantId,
            toolVersion,
            runtimeVersion: process.versions.node,
            certifiedRange,
            evidence: [],
        });
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts', registryRoot: path.join(home, 'registries', 'baseline'), sensors: {
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
    });

    afterEach(() => {
        delete process.env.AWM_HOME;
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    it('isFullSelection({slice:true}) === false (RF-5.10)', () => {
        expect(isFullSelection({ slice: true })).toBe(false);
        expect(isFullSelection({ slice: true, all: true })).toBe(false);
        expect(isFullSelection({ slice: true, fast: true })).toBe(false);
        expect(isFullSelection({})).toBe(true);
    });

    it('skips closureOnly sensors with an explicit skipped reason (RF-5.10)', async () => {
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true });
        const byName = Object.fromEntries(out.sensors.map((s: { name: string; status: string; skipReason?: string }) => [s.name, s]));
        expect(Object.keys(byName).sort()).toEqual(['lint', 'mutation', 'test']);
        expect(byName.mutation).toMatchObject({ status: 'skipped', skipReason: expect.stringMatching(/closureOnly|slice/i) });
        expect(byName.lint.status).toBe('pass');
        expect(byName.test.status).toBe('pass');
        // Live probes may spawn tools; the slice contract is selection, not probe silence.
        expect(byName.mutation.skipReason).toMatch(/closureOnly|slice/i);
    });

    it('rejects --slice with --all and --slice with --slow (RF-2.6)', async () => {
        const { runSensors } = load();
        await expect(runSensors({ cwd: project, slice: true, all: true })).rejects.toThrow(/slice/i);
        await expect(runSensors({ cwd: project, slice: true, slow: true })).rejects.toThrow(/slice/i);
    });

    it('--slice --fast is the intersection: fast and not closureOnly (RF-2.6)', async () => {
        const { runSensors } = load();
        const out = await runSensors({ cwd: project, slice: true, fast: true });
        const names = out.sensors.map((s: { name: string; status: string }) => `${s.name}:${s.status}`);
        expect(names).toContain('lint:pass');
        expect(out.sensors.find((s: { name: string }) => s.name === 'test')).toBeUndefined();
        // mutation is not fast, so filtered by --fast before/with slice — either absent or not executed.
        const mutation = out.sensors.find((s: { name: string }) => s.name === 'mutation');
        if (mutation) expect(mutation.status).toBe('skipped');
        expect(out.sensors.every((s: { name: string }) => s.name === 'lint' || s.name === 'mutation')).toBe(true);
    });

    it('wires --slice and --no-cache on the sensors run CLI action (RF-2.9/2.11)', () => {
        const { Command } = require('commander');
        const { registerSensorsCommand } = require('../../../src/commands/sensors/index');
        const program = new Command();
        program.exitOverride();
        registerSensorsCommand(program);
        const run = program.commands.find((c: { name: () => string }) => c.name() === 'sensors')
            .commands.find((c: { name: () => string }) => c.name() === 'run');
        const opts = run.options.map((o: { long?: string; short?: string }) => o.long).filter(Boolean);
        expect(opts).toEqual(expect.arrayContaining(['--slice', '--no-cache']));
    });
});
