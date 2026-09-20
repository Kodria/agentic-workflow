import fs from 'fs';
import os from 'os';
import path from 'path';
import { computeSensorStatus } from '../../../src/commands/sensors/status';
import { preflight } from '../../../src/commands/preflight/checks';

// #172. `checks` only ever covered what the manifest declares, so a pack sensor
// that applies to this project and could not be initialized was simply absent —
// indistinguishable from one the pack never applied. These tests hold the gap
// visible and attributable in every `awm sensors status`, not only in the output
// of the `init` that skipped it.
//
// Isolated HOME/AWM_HOME per test: nothing here may read or write the real
// `~/.awm`, which belongs to the installer.
const ESLINT_VARIANT = {
    id: 'eslint-10',
    priority: 100,
    requirements: { tool: 'eslint', toolRange: '>=10.0.0 <12.0.0', runtime: 'node', runtimeRange: '>=20.0.0' },
    certifiedRange: '>=10.0.0 <11.0.0',
    command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
    assets: [],
    formatter: 'eslint',
    probe: { kind: 'config-present' },
};
const SEMGREP_VARIANT = {
    id: 'semgrep-js-ts',
    priority: 10,
    requirements: { tool: 'semgrep', toolRange: '>=1.0.0', runtime: 'node', runtimeRange: '>=20.0.0' },
    certifiedRange: '>=1.0.0',
    command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml'] },
    assets: [],
    formatter: 'semgrep',
    probe: { kind: 'version' },
};

function packJson(sensors: Record<string, unknown>) {
    const detector = Object.keys(sensors)[0];
    return JSON.stringify({
        schemaVersion: 2, name: 'js-ts', description: '#172 fixture', detects: ['package.json'], sensors,
        coverage: {
            schemaVersion: 1,
            classes: { 'lint-errors': { description: 'Findings', detectors: [{ sensor: detector }], remedy: { summary: 'Configure', command: 'awm sensors init --pack js-ts' } } },
        },
    });
}

function lintEntry() {
    return {
        enabled: true, variantId: 'eslint-10',
        command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
        initializedCompatibility: { state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10', toolVersion: '10.4.1', runtimeVersion: '24.0.0', certifiedRange: '>=10.0.0 <11.0.0', evidence: [] },
    };
}
function semgrepEntry() {
    return {
        enabled: true, variantId: 'semgrep-js-ts',
        command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml'] },
        initializedCompatibility: { state: 'compatible-unverified', reason: 'operational-range-and-probe', variantId: 'semgrep-js-ts', toolVersion: '1.173.0', runtimeVersion: '24.0.0', certifiedRange: '>=1.0.0', evidence: [] },
    };
}

describe('sensor status for a partially initialized pack', () => {
    let root: string;
    let project: string;
    let pathDir: string;
    let previous: { home?: string; awmHome?: string; path?: string };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-172-'));
        project = path.join(root, 'project');
        pathDir = path.join(root, 'bin');
        const registry = path.join(root, 'awm-home', 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.mkdirSync(registry, { recursive: true });
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        fs.mkdirSync(pathDir, { recursive: true });
        fs.writeFileSync(path.join(root, 'awm-home', 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'fixture' }]));
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture-172', private: true }));
        fs.writeFileSync(path.join(project, 'eslint.config.mjs'), 'export default [];\n');
        fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '10.4.1' }));
        fs.mkdirSync(path.join(project, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', '.bin', 'eslint'), '');
        fs.writeFileSync(path.join(registry, 'pack.json'), packJson({
            lint: { applicability: { allFiles: ['package.json'] }, variants: [ESLINT_VARIANT] },
            security: { applicability: { allFiles: ['package.json'] }, variants: [SEMGREP_VARIANT] },
        }));
        previous = { home: process.env.HOME, awmHome: process.env.AWM_HOME, path: process.env.PATH };
        process.env.HOME = path.join(root, 'operator-home');
        process.env.AWM_HOME = path.join(root, 'awm-home');
        process.env.PATH = pathDir;
    });

    afterEach(() => {
        for (const [key, value] of [['HOME', previous.home], ['AWM_HOME', previous.awmHome], ['PATH', previous.path]] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    function writeManifest(sensors: Record<string, unknown>) {
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', source: { registry: 'baseline' }, sensors,
        }));
    }

    function installOnPath(tool: string) {
        const file = path.join(pathDir, tool);
        fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(file, 0o755);
    }

    it('names the applicable sensor that has no manifest entry, with its live reason', async () => {
        writeManifest({ lint: lintEntry() });

        const status = await computeSensorStatus(project);

        expect(Object.keys(status.checks)).toEqual(['lint']);
        expect(status.uninitialized).toEqual({ security: { state: 'missing-tool', reason: 'tool-not-found' } });
    });

    it('does not let an uninitialized sensor change the verdict, which stays a gate-policy decision', async () => {
        writeManifest({ lint: lintEntry() });
        const status = await computeSensorStatus(project);
        expect(status.overall).toBe('READY');
    });

    it('omits the field when every applicable pack sensor has an entry', async () => {
        installOnPath('semgrep');
        writeManifest({ lint: lintEntry(), security: semgrepEntry() });
        const status = await computeSensorStatus(project);
        expect(status.uninitialized).toBeUndefined();
    });

    it('reports a not-applicable pack sensor as neither a check nor a gap', async () => {
        const registry = path.join(root, 'awm-home', 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.writeFileSync(path.join(registry, 'pack.json'), packJson({
            lint: { applicability: { allFiles: ['package.json'] }, variants: [ESLINT_VARIANT] },
            security: { applicability: { allFiles: ['never-present.toml'] }, variants: [SEMGREP_VARIANT] },
        }));
        writeManifest({ lint: lintEntry() });

        const status = await computeSensorStatus(project);

        expect(status.uninitialized).toBeUndefined();
        expect(status.checks).not.toHaveProperty('security');
    });

    it('preflight names the gap and still passes the manifest check, so one missing tool is not a dead end', async () => {
        fs.mkdirSync(path.join(project, '.git'));
        writeManifest({ lint: lintEntry() });

        const report = await preflight(project);
        const manifest = report.checks.find(check => check.id === 'manifest');

        expect(manifest).toMatchObject({ ok: true });
        expect(manifest?.detail).toContain('1 applicable sensor(s) not initialized: security');
    });

    // `discoverProjectEvidence` is called here without `pathToolVersion` because
    // status never executes, so a `resolution: 'path'` tool is invisible to it.
    // Calling that "drift" asserts something this command did not measure.
    it('does not claim drift for a PATH tool it cannot observe, and defers to the PATH check', async () => {
        installOnPath('semgrep');
        fs.writeFileSync(path.join(project, '.semgrep.awm.yml'), 'rules: []\n');
        writeManifest({ security: semgrepEntry() });

        const status = await computeSensorStatus(project);

        expect(status.checks.security).toEqual({ ok: true, detail: 'semgrep' });
        expect(status.overall).toBe('READY');
    });

    it('still fails a PATH sensor whose executable is genuinely absent from PATH', async () => {
        writeManifest({ security: semgrepEntry() });

        const status = await computeSensorStatus(project);

        expect(status.checks.security.ok).toBe(false);
        expect(status.checks.security.detail).toMatch(/semgrep not found in PATH/);
    });

    it('still reports real drift when the live resolution selects a different variant', async () => {
        const registry = path.join(root, 'awm-home', 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.writeFileSync(path.join(registry, 'pack.json'), packJson({
            lint: { applicability: { allFiles: ['package.json'] }, variants: [{ ...ESLINT_VARIANT, id: 'eslint-10-flat' }] },
        }));
        writeManifest({ lint: lintEntry() });

        const status = await computeSensorStatus(project);

        expect(status.checks.lint.ok).toBe(false);
        expect(status.checks.lint.detail).toMatch(/compatibility drift: initialized eslint-10, resolved eslint-10-flat/);
    });
});
