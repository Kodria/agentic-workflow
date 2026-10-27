import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeSensorStatus } from '../../../src/commands/sensors/status';

/**
 * RF-3.4 — status surfaces a non-blocking warning when a configured enabled
 * sensor lacks effective `inputs` (not cacheable). Warnings must not degrade
 * `overall`, and opt-out / native-gate must stay silent.
 */
describe('computeSensorStatus inputs warnings (RF-3.4)', () => {
    let tmpDir: string;
    let previousHome: string | undefined;
    let home: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-inputs-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-inputs-home-'));
        previousHome = process.env.AWM_HOME;
        process.env.AWM_HOME = home;
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([]));
        fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'node_modules', '.bin', 'eslint'), '');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
    });

    afterEach(() => {
        if (previousHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = previousHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    });

    function writeOnlyProject(sensors: Record<string, unknown>): void {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3,
            mode: 'project-sensors',
            sensors,
        }));
    }

    function projectSensor(extra: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            source: 'project',
            enabled: true,
            command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
            formatter: 'exit-code',
            ...extra,
        };
    }

    it('warns when an enabled sensor lacks effective inputs (not cacheable)', async () => {
        writeOnlyProject({ custom: projectSensor() });

        const result = await computeSensorStatus(tmpDir);

        expect(result.overall).toBe('READY');
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensor: 'custom',
                detail: expect.stringMatching(/not cacheable|no effective inputs|lacks inputs/i),
            }),
        ]));
    });

    it('does not warn when effective inputs are present', async () => {
        writeOnlyProject({ custom: projectSensor({ inputs: ['**/*.ts'] }) });

        const result = await computeSensorStatus(tmpDir);

        expect(result.overall).toBe('READY');
        expect(result.warnings ?? []).toEqual([]);
    });

    it('does not warn for disabled sensors that lack inputs', async () => {
        writeOnlyProject({ custom: projectSensor({ enabled: false }) });

        const result = await computeSensorStatus(tmpDir);

        expect(result.warnings ?? []).toEqual([]);
        expect(result.checks.custom).toMatchObject({ ok: true, detail: expect.stringMatching(/disabled/i) });
    });

    it.each([
        ['native-gate', 'CI is authoritative.'],
        ['opt-out', 'No local gate.'],
    ] as const)('emits no spurious warnings for v3 %s', async (mode, reason) => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3, mode, reason,
        }));

        const result = await computeSensorStatus(tmpDir);

        expect(result.mode).toBe(mode);
        expect(result.warnings ?? []).toEqual([]);
    });

    it('uses pack-variant inputs as effective inputs (no warning when only the pack declares them)', async () => {
        const registry = path.join(home, 'registries', 'baseline');
        fs.mkdirSync(path.join(registry, 'sensor-packs', 'js-ts'), { recursive: true });
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([
            { name: 'baseline', remote: 'https://example.test/baseline.git' },
        ]));
        fs.writeFileSync(path.join(registry, 'sensor-packs', 'js-ts', 'pack.json'), JSON.stringify({
            schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
            coverage: {
                schemaVersion: 1,
                classes: {
                    lint: {
                        description: 'lint',
                        detectors: [{ sensor: 'lint' }],
                        remedy: { summary: 'fix', command: 'awm sensors init' },
                    },
                },
            },
            sensors: {
                lint: {
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'eslint-10', priority: 10, certifiedRange: '>=10 <11',
                        requirements: {
                            tool: 'eslint', toolRange: '>=10 <11',
                            runtime: 'node', runtimeRange: '>=0',
                        },
                        assets: [], formatter: 'eslint-llm',
                        probe: { kind: 'package-script-present', script: 'lint' },
                        command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                        inputs: ['src/**/*.ts'],
                    }],
                },
            },
        }));
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            scripts: { lint: 'eslint .' },
            devDependencies: { eslint: '^10.0.0' },
        }));
        fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'node_modules', 'eslint', 'package.json'),
            JSON.stringify({ version: '10.0.0' }),
        );
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts',
            sensors: {
                lint: {
                    enabled: true, variantId: 'eslint-10',
                    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                    assets: [],
                    initializedCompatibility: {
                        state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10',
                        toolVersion: '10.0.0', runtimeVersion: process.versions.node,
                        certifiedRange: '>=10 <11', evidence: [],
                    },
                },
            },
        }));

        const result = await computeSensorStatus(tmpDir);

        expect(result.checks.lint).toMatchObject({ ok: true });
        expect(result.warnings ?? []).toEqual([]);
    });

    it('warns for pack-bound enabled sensors when neither project nor pack variant provides inputs', async () => {
        const registry = path.join(home, 'registries', 'baseline');
        fs.mkdirSync(path.join(registry, 'sensor-packs', 'js-ts'), { recursive: true });
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([
            { name: 'baseline', remote: 'https://example.test/baseline.git' },
        ]));
        fs.writeFileSync(path.join(registry, 'sensor-packs', 'js-ts', 'pack.json'), JSON.stringify({
            schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
            coverage: {
                schemaVersion: 1,
                classes: {
                    lint: {
                        description: 'lint',
                        detectors: [{ sensor: 'lint' }],
                        remedy: { summary: 'fix', command: 'awm sensors init' },
                    },
                },
            },
            sensors: {
                lint: {
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'eslint-10', priority: 10, certifiedRange: '>=10 <11',
                        requirements: {
                            tool: 'eslint', toolRange: '>=10 <11',
                            runtime: 'node', runtimeRange: '>=0',
                        },
                        assets: [], formatter: 'eslint-llm',
                        probe: { kind: 'package-script-present', script: 'lint' },
                        command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                    }],
                },
            },
        }));
        fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
            scripts: { lint: 'eslint .' },
            devDependencies: { eslint: '^10.0.0' },
        }));
        fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpDir, 'node_modules', 'eslint', 'package.json'),
            JSON.stringify({ version: '10.0.0' }),
        );
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts',
            sensors: {
                lint: {
                    enabled: true, variantId: 'eslint-10',
                    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                    assets: [],
                    initializedCompatibility: {
                        state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10',
                        toolVersion: '10.0.0', runtimeVersion: process.versions.node,
                        certifiedRange: '>=10 <11', evidence: [],
                    },
                },
            },
        }));

        const result = await computeSensorStatus(tmpDir);

        expect(result.overall).toBe('READY');
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensor: 'lint',
                detail: expect.stringMatching(/not cacheable|no effective inputs|lacks inputs/i),
            }),
        ]));
    });
});

describe('awm sensors status CLI renders inputs warnings (RF-3.4)', () => {
    let tmpDir: string;
    let previousHome: string | undefined;
    let home: string;
    let previousCwd: string;

    beforeEach(() => {
        previousCwd = process.cwd();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-inputs-cli-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-inputs-cli-home-'));
        previousHome = process.env.AWM_HOME;
        process.env.AWM_HOME = home;
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([]));
        fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'node_modules', '.bin', 'eslint'), '');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3,
            mode: 'project-sensors',
            sensors: {
                custom: {
                    source: 'project',
                    enabled: true,
                    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                    formatter: 'exit-code',
                },
            },
        }));
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(previousCwd);
        if (previousHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = previousHome;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('prints warning text in human-readable status output without failing READY', async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Command } = require('commander');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerSensorsCommand } = require('../../../src/commands/sensors/index');
        const program = new Command();
        program.exitOverride();
        registerSensorsCommand(program);

        const output = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        try {
            await program.parseAsync(['node', 'awm', 'sensors', 'status']);
            const rendered = output.mock.calls.flat().join('\n');
            expect(rendered).toMatch(/READY/);
            expect(rendered).toMatch(/custom/);
            expect(rendered).toMatch(/not cacheable|no effective inputs|lacks inputs/i);
            expect(exitSpy).not.toHaveBeenCalled();
        } finally {
            output.mockRestore();
            exitSpy.mockRestore();
        }
    });
});
