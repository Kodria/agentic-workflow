import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    fingerprint,
    needsTestBaselineRefresh,
    shouldAdviseTestBaselineRefresh,
    TEST_BASELINE_REFRESH_DETAIL,
    writeBaseline,
} from '../../../src/commands/sensors/baseline';
import { computeSensorStatus } from '../../../src/commands/sensors/status';

/**
 * RF-3.1 — re-baseline advisory when the accepted `test` baseline is empty or
 * only the synthetic exit-code fingerprint (maskNumbers → exit 1 ≡ exit 2).
 */
describe('needsTestBaselineRefresh (RF-3.1)', () => {
    it('is true for undefined or empty accepted entries', () => {
        expect(needsTestBaselineRefresh(undefined)).toBe(true);
        expect(needsTestBaselineRefresh([])).toBe(true);
    });

    it('is true when the only accepted fingerprint is the synthetic exit-code shape', () => {
        const synthetic = fingerprint('test', { message: 'SENSOR[test] failed (exit 1)' });
        expect(needsTestBaselineRefresh([synthetic])).toBe(true);
    });

    it('treats exit 1 and exit 2 synthetic fingerprints as identical (H4)', () => {
        const exit1 = fingerprint('test', { message: 'SENSOR[test] failed (exit 1)' });
        const exit2 = fingerprint('test', { message: 'SENSOR[test] failed (exit 2)' });
        expect(exit1).toBe(exit2);
        expect(needsTestBaselineRefresh([exit2])).toBe(true);
    });

    it('is false when the baseline holds only a ruled finding fingerprint', () => {
        const ruled = fingerprint('test', {
            file: 'src/math.test.ts',
            rule: 'math adds',
            message: 'Expected 3 to be 4',
        });
        expect(needsTestBaselineRefresh([ruled])).toBe(false);
    });

    it('is false when synthetic and ruled fingerprints coexist (kill-RED)', () => {
        const synthetic = fingerprint('test', { message: 'SENSOR[test] failed (exit 1)' });
        const ruled = fingerprint('test', {
            file: 'src/math.test.ts',
            rule: 'math adds',
            message: 'Expected 3 to be 4',
        });
        expect(needsTestBaselineRefresh([synthetic, ruled])).toBe(false);
    });
});

describe('shouldAdviseTestBaselineRefresh emit helper (RF-3.1)', () => {
    it('is true for run/baseline paths when test is selected and refresh is needed', () => {
        expect(shouldAdviseTestBaselineRefresh([{ name: 'test' }], undefined)).toBe(true);
        expect(shouldAdviseTestBaselineRefresh([{ name: 'test' }], [])).toBe(true);
    });

    it('is false when test is absent from the selected sensors', () => {
        expect(shouldAdviseTestBaselineRefresh([{ name: 'lint' }], [])).toBe(false);
    });

    it('is false when ruled findings are already baselined', () => {
        const ruled = fingerprint('test', {
            file: 'src/math.test.ts',
            rule: 'math adds',
            message: 'Expected 3 to be 4',
        });
        expect(shouldAdviseTestBaselineRefresh([{ name: 'test' }], [ruled])).toBe(false);
    });
});

describe('test baseline refresh advisory emit path (RF-3.1)', () => {
    let tmpDir: string;
    let previousHome: string | undefined;
    let home: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-test-baseline-adv-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-test-baseline-adv-home-'));
        previousHome = process.env.AWM_HOME;
        process.env.AWM_HOME = home;
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([]));
        fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'node_modules', '.bin', 'jest'), '');
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
            command: { executable: 'jest', resolution: 'node-modules-bin', args: ['--json'] },
            formatter: 'test',
            inputs: ['**/*.test.ts'],
            ...extra,
        };
    }

    it('emits a non-blocking status warning when test is configured and baseline is empty', async () => {
        writeOnlyProject({ test: projectSensor() });

        const result = await computeSensorStatus(tmpDir);

        expect(result.overall).toBe('READY');
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensor: 'test',
                kind: 'test-baseline-refresh',
                detail: expect.stringMatching(/awm sensors baseline/i),
            }),
        ]));
        const advisory = result.warnings!.find((w) => w.kind === 'test-baseline-refresh');
        expect(advisory?.detail).toMatch(/results artifact/i);
        expect(advisory?.detail).toBe(TEST_BASELINE_REFRESH_DETAIL);
    });

    it('emits a non-blocking warning when baseline holds only the synthetic fingerprint', async () => {
        writeOnlyProject({ test: projectSensor() });
        writeBaseline(tmpDir, {
            test: [fingerprint('test', { message: 'SENSOR[test] failed (exit 1)' })],
        });

        const result = await computeSensorStatus(tmpDir);

        expect(result.overall).toBe('READY');
        expect(result.warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensor: 'test',
                kind: 'test-baseline-refresh',
                detail: expect.stringMatching(/awm sensors baseline/i),
            }),
        ]));
        const advisory = result.warnings!.find((w) => w.kind === 'test-baseline-refresh');
        expect(advisory?.detail).toMatch(/results artifact/i);
        expect(advisory?.detail).toBe(TEST_BASELINE_REFRESH_DETAIL);
    });

    it('does not emit the advisory when test is configured but enabled:false', async () => {
        writeOnlyProject({ test: projectSensor({ enabled: false }) });
        writeBaseline(tmpDir, { test: [] });

        const result = await computeSensorStatus(tmpDir);

        expect(result.warnings ?? []).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensor: 'test',
                kind: 'test-baseline-refresh',
            }),
        ]));
    });

    it('does not emit the advisory when the test sensor is absent', async () => {
        writeOnlyProject({
            lint: {
                source: 'project',
                enabled: true,
                command: { executable: 'jest', resolution: 'node-modules-bin', args: ['.'] },
                formatter: 'exit-code',
                inputs: ['**/*.ts'],
            },
        });
        writeBaseline(tmpDir, { test: [] });

        const result = await computeSensorStatus(tmpDir);

        expect(result.warnings ?? []).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ sensor: 'test' }),
        ]));
    });

    it('does not emit the advisory when ruled findings are already baselined', async () => {
        writeOnlyProject({ test: projectSensor() });
        writeBaseline(tmpDir, {
            test: [fingerprint('test', {
                file: 'src/math.test.ts',
                rule: 'math adds',
                message: 'Expected 3 to be 4',
            })],
        });

        const result = await computeSensorStatus(tmpDir);

        expect(result.warnings ?? []).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensor: 'test',
                kind: 'test-baseline-refresh',
            }),
        ]));
    });

    it('prints the advisory in human status output without exiting non-zero when READY', async () => {
        writeOnlyProject({ test: projectSensor() });
        const previousCwd = process.cwd();
        process.chdir(tmpDir);
        try {
            const { Command } = require('commander');
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
                expect(rendered).toMatch(/test/);
                expect(rendered).toMatch(/awm sensors baseline/i);
                expect(rendered).toMatch(/results artifact/i);
                expect(exitSpy).not.toHaveBeenCalled();
            } finally {
                output.mockRestore();
                exitSpy.mockRestore();
            }
        } finally {
            process.chdir(previousCwd);
        }
    });
});
