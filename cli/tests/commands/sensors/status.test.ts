import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeSensorStatus } from '../../../src/commands/sensors/status';
import { preflight } from '../../../src/commands/preflight/checks';
import { runSensors } from '../../../src/commands/sensors/run';

// `resolveOnPath` resuelve PATH en proceso (ya no invoca un shell — ver
// core/paths.ts). Por eso estos tests controlan un PATH aislado en vez de
// mockear `execSync`: ademas de reflejar el mecanismo real, los vuelve
// deterministas, que antes no lo eran (el caso "binario ausente" pasaba solo
// en maquinas donde ese binario realmente no estuviera instalado).

describe('computeSensorStatus', () => {
    let tmpDir: string;
    let pathDir: string;
    let originalPath: string | undefined;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
        pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-path-'));
        originalPath = process.env.PATH;
        process.env.PATH = pathDir;   // PATH vacio salvo lo que cada test instale
    });
    afterEach(() => {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(pathDir, { recursive: true, force: true });
    });

    /** Instala un binario ejecutable real en el PATH aislado del test. */
    function installOnPath(tool: string) {
        const p = path.join(pathDir, tool);
        fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(p, 0o755);
    }

    it('returns NOT_CONFIGURED when .awm/sensors.json missing', async () => {
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('NOT_CONFIGURED');
        expect(result.pack).toBeNull();
    });

    // Helper: simulate a tool installed locally (node_modules/.bin/<tool>)
    function installLocalBin(tool: string) {
        const binDir = path.join(tmpDir, 'node_modules', '.bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(binDir, tool), '');
    }

    it('keeps an operational legacy manifest DEGRADED even when its npx tool is installed locally', async () => {
        installLocalBin('tsc');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { typecheck: { cmd: 'npx tsc --noEmit', fast: true } }
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.pack).toBe('js-ts');
        expect(result.checks.typecheck.ok).toBe(true);
    });

    it('marks an npx sensor DEGRADED when the tool is NOT installed locally (npx would fetch a remote package)', async () => {
        // No node_modules/.bin/depcruise → status must NOT report ✔ just because npx exists.
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { depcheck: { cmd: 'npx depcruise --config .dep-cruiser.awm.js app', fast: false } }
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.depcheck.ok).toBe(false);
        expect(result.checks.depcheck.detail).toMatch(/not installed locally/i);
    });

    it('marks a sensor DEGRADED when its --config file is missing', async () => {
        installLocalBin('eslint');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { lint: { cmd: 'npx eslint . --config eslint.config.awm.mjs --format json', fast: true } }
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.checks.lint.ok).toBe(false);
        expect(result.checks.lint.detail).toMatch(/missing config/i);
    });

    it('is HEALTHY when the npx tool is installed and the --config file exists', async () => {
        installLocalBin('eslint');
        fs.writeFileSync(path.join(tmpDir, 'eslint.config.awm.mjs'), 'export default []');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { lint: { cmd: 'npx eslint . --config eslint.config.awm.mjs --format json', fast: true } }
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.checks.lint.ok).toBe(true);
    });

    it('returns DEGRADED when a binary is missing', async () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { security: { cmd: 'semgrep --json .', fast: false } }
        }));
        // PATH aislado y vacio => semgrep no resuelve.
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.security.ok).toBe(false);
    });

    describe('on POSIX', () => {
        const originalPlatform = process.platform;

        beforeEach(() => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
        });

        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        });

        it('resuelve un binario instalado recorriendo PATH, sin invocar un shell', async () => {
            fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
                pack: 'js-ts',
                sensors: { security: { cmd: 'semgrep --json .', fast: false } }
            }));

            installOnPath('semgrep');

            const result = await computeSensorStatus(tmpDir);
            expect(result.overall).toBe('DEGRADED');
            expect(result.checks.security.ok).toBe(true);
        });
    });

    it('is DEGRADED (never HEALTHY) when the manifest has zero sensor entries', async () => {
        // `Object.values({}).every(...)` is vacuously true — guard against reading an
        // empty manifest (the honest floor when the registry had no pack.json for the
        // detected stack) as a clean run that found nothing wrong.
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'python',
            sensors: {},
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.pack).toBe('python');
    });

    it('degrades gracefully (never throws) when sensors is null in a hand-edited manifest', async () => {
        // Regression for Finding 3: `checkManifest` (preflight) already guards
        // `manifest.sensors ?? {}` — computeSensorStatus needs the same guard, or a
        // corrupted/hand-edited manifest with `"sensors": null` crashes
        // `Object.entries(null)`.
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'python',
            sensors: null,
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.pack).toBe('python');
        expect(result.checks).toEqual({});
    });

    it('marks disabled sensors as ok', async () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { mutation: { enabled: false } }
        }));
        const result = await computeSensorStatus(tmpDir);
        expect(result.checks.mutation.ok).toBe(true);
        expect(result.checks.mutation.detail).toBe('disabled');
    });

    it('does not trust the initialized v2 variant after local tool drift', async () => {
        // The manifest records ESLint 9 at init time, but local evidence is now ESLint
        // 10. Status must resolve the installed pack again, not certify the stale
        // initializedCompatibility record.
        const previousHome = process.env.AWM_HOME;
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-home-'));
        try {
            process.env.AWM_HOME = home;
            const registry = path.join(home, 'registries', 'baseline');
            fs.mkdirSync(path.join(registry, 'sensor-packs', 'js-ts'), { recursive: true });
            fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
            const variant = (id: string, range: string) => ({
                id, priority: 10, certifiedRange: range,
                requirements: { tool: 'eslint', toolRange: range, runtime: 'node', runtimeRange: '>=0.0.0' },
                assets: ['eslint.config.awm.mjs'], formatter: 'eslint-llm', probe: { kind: 'config-present' },
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
            });
            fs.writeFileSync(path.join(registry, 'sensor-packs', 'js-ts', 'pack.json'), JSON.stringify({
                schemaVersion: 2, name: 'js-ts', description: 'test', detects: ['package.json'], coverage: { schemaVersion: 1, classes: { lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix lint', command: 'awm sensors init --pack js-ts' } } } },
                sensors: { lint: { applicability: { allFiles: ['package.json'] }, variants: [variant('eslint-9', '>=9.0.0 <10.0.0'), variant('eslint-10', '>=10.0.0 <11.0.0')] } },
            }));
            fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
            fs.mkdirSync(path.join(tmpDir, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version: '10.0.0' }));
            fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
                schemaVersion: 2, pack: 'js-ts', sensors: { lint: {
                    enabled: true, variantId: 'eslint-9', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                    initializedCompatibility: { state: 'certified', reason: 'range-and-probe', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: process.versions.node, certifiedRange: '>=9.0.0 <10.0.0', evidence: [] },
                } },
            }));

            const result = await computeSensorStatus(tmpDir);
            expect(result.overall).toBe('DEGRADED');
            expect(result.checks.lint).toMatchObject({ ok: false, detail: expect.stringContaining('variant-drift') });
            fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# test\n');
            const gate = await preflight(tmpDir);
            expect(gate.status).toBe('degraded');
            expect(gate.checks.find(check => check.id === 'tools')).toMatchObject({ ok: false, detail: expect.stringContaining('variant-drift') });
            const run = await runSensors({ cwd: tmpDir, all: true });
            expect(run.overall).toBe('not_certified');
            expect(run.sensors).toEqual([expect.objectContaining({ name: 'lint', status: 'inconclusive', skipReason: expect.stringContaining('variant-drift') })]);
        } finally {
            if (previousHome === undefined) delete process.env.AWM_HOME;
            else process.env.AWM_HOME = previousHome;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
