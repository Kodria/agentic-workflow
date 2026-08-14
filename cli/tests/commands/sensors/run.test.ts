import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSensors } from '../../../src/commands/sensors/run';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensors-'));
}

// Define stable mock before jest.mock hoisting
const mockRunCommand = jest.fn();
const mockRunStructuredCommand = jest.fn();

jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: any[]) => mockRunCommand(...args),
    runStructuredCommand: (...args: any[]) => mockRunStructuredCommand(...args),
}));

const { ok, exited, timedOut } = require('./exec-fixtures');

const MANIFEST = {
    pack: 'js-ts',
    sensors: {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        lint:      { cmd: 'npx eslint . --format json', fast: true },
        security:  { cmd: 'semgrep .', fast: false, enabled: false },
        mutation:  { enabled: false }
    }
};

describe('runSensors', () => {
    let tmpDir: string;
    const path = require('path');
    const os = require('os');

    beforeEach(() => {
        jest.resetModules();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-test-'));
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(MANIFEST));
        mockRunCommand.mockReset();
        mockRunStructuredCommand.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../src/commands/sensors/run');

    it('returns not_certified output when manifest does not exist', async () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        try {
            const { runSensors } = load();
            const result = await runSensors({ fast: true, cwd: emptyDir });
            expect(result.overall).toBe('not_certified');
            expect(result.sensors).toHaveLength(0);
        } finally { fs.rmSync(emptyDir, { recursive: true }); }
    });

    it('runs only fast sensors with --fast flag', async () => {
        mockRunCommand.mockResolvedValue(ok());
        const { runSensors } = load();
        const result = await runSensors({ fast: true, cwd: tmpDir });
        expect(mockRunCommand).toHaveBeenCalledTimes(2); // typecheck + lint (security disabled, mutation disabled)
        expect(result.sensors.some((s: any) => s.name === 'security')).toBe(false);
        expect(result.overall).toBe('not_certified');
    });

    it('returns fail when a fast sensor has errors', async () => {
        mockRunCommand
            .mockResolvedValueOnce(exited(1, 'src/a.ts(1,1): error TS0001: Bad type.'))
            .mockResolvedValueOnce(ok());
        const { runSensors } = load();
        const result = await runSensors({ fast: true, cwd: tmpDir });
        expect(result.overall).toBe('fail');
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('fail');
        expect(tc!.errors[0].message).toMatch('SENSOR[typecheck]');
    });

    it('marks sensor as inconclusive on timeout', async () => {
        mockRunCommand.mockResolvedValueOnce(timedOut());
        mockRunCommand.mockResolvedValueOnce(ok());
        const { runSensors } = load();
        const result = await runSensors({ fast: true, cwd: tmpDir });
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('inconclusive');
        expect(tc!.skipReason).toMatch('timeout');
    });

    it('skips disabled sensors', async () => {
        mockRunCommand.mockResolvedValue(ok());
        const { runSensors } = load();
        const result = await runSensors({ all: true, cwd: tmpDir });
        const sec = result.sensors.find((s: any) => s.name === 'security');
        expect(sec!.status).toBe('skipped');
        expect(sec!.skipReason).toBe('disabled');
    });

    it('dispatches by the formatter field, not the sensor name — ruff on a `lint` sensor', async () => {
        // The whole point of the `formatter` field: a `lint` sensor is eslint for
        // js-ts but ruff for python. Old name-based dispatch (lint -> eslint parser)
        // would choke on ruff's flat JSON array (no `.messages` — TypeError) instead
        // of parsing it. Real captured `ruff --output-format json` shape.
        const pythonManifest = {
            pack: 'python',
            sensors: {
                lint: { cmd: 'ruff check . --output-format json', fast: true, formatter: 'ruff' },
            },
        };
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(pythonManifest));
        const ruffJson = JSON.stringify([{
            code: 'F401',
            filename: path.join(tmpDir, 'bad.py'),
            location: { row: 1, column: 8 },
            message: '`os` imported but unused',
        }]);
        mockRunCommand.mockResolvedValueOnce(exited(1, ruffJson));
        const { runSensors } = load();
        const result = await runSensors({ fast: true, cwd: tmpDir });
        const lint = result.sensors.find((s: any) => s.name === 'lint');
        expect(lint!.status).toBe('fail');
        expect(lint!.errors[0].rule).toBe('F401');
        expect(lint!.errors[0].message).toMatch('SENSOR[lint]');
        expect(lint!.errors[0].message).toMatch('imported but unused');
    });

    it('falls back to name-based dispatch when formatter is absent (pre-existing manifest)', async () => {
        // A manifest written before the `formatter` field existed must keep working
        // exactly as before: `lint` -> eslint parser, no `formatter` key anywhere.
        mockRunCommand
            .mockResolvedValueOnce(exited(1, 'src/a.ts(1,1): error TS0001: Bad type.'))
            .mockResolvedValueOnce(exited(1, JSON.stringify([{ filePath: '/x/a.js', messages: [{ ruleId: 'no-unused-vars', severity: 2, message: 'unused', line: 1, column: 1 }] }])));
        const { runSensors } = load();
        const result = await runSensors({ fast: true, cwd: tmpDir });
        const lint = result.sensors.find((s: any) => s.name === 'lint');
        expect(lint!.status).toBe('fail');
        expect(lint!.errors[0].rule).toBe('no-unused-vars');
    });

    it('degrades to the generic formatter (never a wrong-shape misparse) for an unrecognized formatter value', async () => {
        // Regression for Finding 5: `formatter: 'bandit'` is present but not one of the
        // 8 known values. The OLD behavior fell through to name-based dispatch — sensor
        // name 'security' -> parseSemgrepOutput — which would silently misparse
        // bandit's differently-shaped `results` entries (no `path`/`start`/`check_id`
        // keys) into garbage findings (`file: undefined, line: 0`). The fix must use
        // parseGenericOutput instead: an honest raw-wrap, never a wrong-shape guess.
        const banditManifest = {
            pack: 'python',
            sensors: {
                security: { cmd: 'bandit -r . -f json', fast: false, formatter: 'bandit' },
            },
        };
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(banditManifest));
        // Real bandit JSON shape (fields semgrep's parser does not know how to read).
        const banditJson = JSON.stringify({
            results: [
                { filename: 'app.py', line_number: 12, test_id: 'B105', issue_text: 'hardcoded password' },
            ],
        });
        mockRunCommand.mockResolvedValueOnce(exited(1, banditJson));
        const { runSensors } = load();
        const result = await runSensors({ all: true, cwd: tmpDir });
        const sec = result.sensors.find((s: any) => s.name === 'security');
        expect(sec!.status).toBe('fail');
        expect(sec!.errors).toHaveLength(1);
        // Never the semgrep-misparse shape (file: undefined, line: 0, rule: undefined).
        expect(sec!.errors[0].file).toBeUndefined();
        expect(sec!.errors[0].line).toBeUndefined();
        expect(sec!.errors[0].rule).toBeUndefined();
        // The honest generic raw-wrap: the raw JSON, verbatim, inside one message.
        expect(sec!.errors[0].message).toMatch('SENSOR[raw]');
        expect(sec!.errors[0].message).toContain('B105');
    });

    const tcError = () => exited(1, 'src/a.ts(1,1): error TS0001: Bad type.');

    it('baseline suppresses accepted findings — sensor passes on no NEW findings', async () => {
        const { runSensors } = load();
        const { buildBaseline, writeBaseline } = require('../../../src/commands/sensors/baseline');

        // Run 1 (no baseline): typecheck reports a TS error → fail.
        mockRunCommand.mockResolvedValueOnce(tcError()).mockResolvedValueOnce(ok());
        const first = await runSensors({ fast: true, cwd: tmpDir });
        expect(first.overall).toBe('fail');

        // Accept the current findings as baseline.
        writeBaseline(tmpDir, buildBaseline(first.sensors.map((s: any) => ({ name: s.name, errors: s.errors }))));

        // Run 2 (same finding): baseline-suppressed → pass.
        mockRunCommand.mockResolvedValueOnce(tcError()).mockResolvedValueOnce(ok());
        const second = await runSensors({ fast: true, cwd: tmpDir });
        const tc = second.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('pass');
        expect(tc!.baselineCount).toBe(1);
        expect(second.overall).toBe('not_certified');
    });

    it('baseline lets NEW findings through (still fails)', async () => {
        const { runSensors } = load();
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        writeBaseline(tmpDir, { typecheck: ['some-unrelated-fingerprint'] });

        mockRunCommand.mockResolvedValueOnce(tcError()).mockResolvedValueOnce(ok());
        const result = await runSensors({ fast: true, cwd: tmpDir });
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('fail');
        expect(result.overall).toBe('fail');
    });

    it('--ignore-baseline reports all findings even when a baseline exists', async () => {
        const { runSensors } = load();
        const { buildBaseline, writeBaseline } = require('../../../src/commands/sensors/baseline');
        // First capture + accept the finding.
        mockRunCommand.mockResolvedValueOnce(tcError()).mockResolvedValueOnce(ok());
        const first = await runSensors({ fast: true, cwd: tmpDir });
        writeBaseline(tmpDir, buildBaseline(first.sensors.map((s: any) => ({ name: s.name, errors: s.errors }))));

        // With ignoreBaseline, the accepted finding still counts → fail.
        mockRunCommand.mockResolvedValueOnce(tcError()).mockResolvedValueOnce(ok());
        const result = await runSensors({ fast: true, cwd: tmpDir, ignoreBaseline: true });
        expect(result.overall).toBe('fail');
    });
});

describe('runSensors v2 lifecycle contract', () => {
    let project: string;
    let home: string;
    const version = '10.0.0';

    beforeEach(() => {
        jest.resetModules();
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-v2-run-project-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-v2-run-home-'));
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
            coverage: { schemaVersion: 1, classes: { lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix', command: 'awm sensors init' } } } },
            sensors: { lint: { fast: true, applicability: { allFiles: ['package.json'] }, variants: [{
                id: 'eslint-10', priority: 1, certifiedRange: '>=10 <11',
                requirements: { tool: 'eslint', toolRange: '>=10 <11', runtime: 'node', runtimeRange: '>=0' },
                assets: ['eslint.config.awm.mjs'], formatter: 'generic', probe: { kind: 'package-script-present' },
                command: { executable: 'live-eslint', resolution: 'node-modules-bin', args: ['.'] },
            }] } },
        }));
        fs.mkdirSync(path.join(project, '.awm'));
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts', registryRoot: path.join(home, 'registries', 'baseline'), sensors: { lint: {
                enabled: true, fast: true, variantId: 'eslint-10',
                command: { executable: 'stale-eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'],
                initializedCompatibility: { state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10', toolVersion: version, runtimeVersion: process.versions.node, certifiedRange: '>=10 <11', evidence: [] },
            } },
        }));
        mockRunStructuredCommand.mockReset();
        mockRunStructuredCommand.mockResolvedValue(ok());
    });
    afterEach(() => {
        delete process.env.AWM_HOME;
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('runs the re-resolved command for an unchanged variant id, never the stale manifest command', async () => {
        const { resolveLiveCompatibility } = require('../../../src/commands/sensors/compatibility/live');
        await expect(resolveLiveCompatibility(project, 'js-ts', path.join(home, 'registries', 'baseline'))).resolves.toBeDefined();
        const { runSensors } = require('../../../src/commands/sensors/run');
        const result = await runSensors({ cwd: project, fast: true });
        expect(result).toEqual(expect.objectContaining({ overall: 'pass' }));
        expect(mockRunStructuredCommand).toHaveBeenCalledWith(expect.objectContaining({ executable: 'live-eslint' }), expect.any(Object));
    });

    it('honors disabled v2 sensors before dispatching them', async () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(project, '.awm', 'sensors.json'), 'utf8'));
        manifest.sensors.lint.enabled = false;
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify(manifest));
        const { runSensors } = require('../../../src/commands/sensors/run');
        const result = await runSensors({ cwd: project, fast: true });
        expect(result.sensors).toEqual([expect.objectContaining({ status: 'skipped', skipReason: 'disabled' })]);
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
    });
});

describe('runSensors — missing tool is a fail, not a skip', () => {
    let root: string;

    afterEach(() => {
        if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    beforeEach(() => {
        mockRunCommand.mockReset();
        // What Node's execSync actually throws when the binary is absent and `/bin/sh`
        // is dash (Debian/Ubuntu, hence most CI runners): status 127, `not found`
        // rather than bash's `command not found`, and no `code` — ENOENT is set only
        // when spawning the shell itself fails, not the command inside it.
        mockRunCommand.mockResolvedValue(
            exited(127, '', '/bin/sh: 1: awm-nonexistent-binary-xyz: not found\n'),
        );
    });

    // The sensor is named `security` so it uses the semgrep formatter, which returns
    // zero findings for unparseable shell noise and lets execution reach the
    // tool-missing branch. Under the generic formatter any stderr becomes a finding,
    // so a sensor named `ghost` would report `fail` without that branch ever running —
    // green for a reason unrelated to what this test claims to cover.
    it('marks a sensor whose binary is missing as fail', async () => {
        root = mkTmp();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(
            path.join(root, '.awm', 'sensors.json'),
            JSON.stringify({
                pack: 'js-ts',
                sensors: { security: { cmd: 'awm-nonexistent-binary-xyz .', fast: true } },
            }),
        );
        const out = await runSensors({ cwd: root });
        const security = out.sensors.find((s) => s.name === 'security');
        expect(security?.status).toBe('fail');
        expect(security?.errors[0].message).toMatch(/not available/i);
        expect(out.overall).toBe('fail');
    });
});

describe('runSensors — sensors: null in a hand-edited manifest', () => {
    // Regression for Finding 3: `checkManifest` (preflight) already guards
    // `manifest.sensors ?? {}` — runSensors' `Object.entries(activeManifest.sensors)`
    // needs the same guard, or a corrupted/hand-edited `.awm/sensors.json` with
    // `"sensors": null` crashes `Object.entries(null)`, taking down the whole run.
    it('degrades gracefully instead of throwing when sensors is null', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-null-sensors-'));
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'), JSON.stringify({ pack: 'python', sensors: null }));
        try {
            const result = await runSensors({ cwd: dir, all: true });
            expect(result.sensors).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true });
        }
    });
});

describe('runSensors — not_certified + auto-discovery', () => {
    let tmpDir: string | undefined;

    beforeEach(() => {
        mockRunCommand.mockReset();
        mockRunCommand.mockResolvedValue(ok());
    });

    afterEach(() => {
        if (tmpDir) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            tmpDir = undefined;
        }
    });

    it('returns not_certified when no manifest exists anywhere up the tree', async () => {
        tmpDir = mkTmp();
        const out = await runSensors({ cwd: tmpDir });
        expect(out.overall).toBe('not_certified');
        expect(out.sensors).toEqual([]);
    });

    it('discovers .awm/sensors.json in a parent directory (walk-up)', async () => {
        tmpDir = mkTmp();
        fs.mkdirSync(path.join(tmpDir, '.awm'));
        fs.writeFileSync(
            path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'test', sensors: { noop: { cmd: 'echo ok', fast: true } } }),
        );
        const nested = path.join(tmpDir, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        const out = await runSensors({ cwd: nested });
        expect(out.overall).toBe('not_certified');
        expect(out.sensors.length).toBe(1);
    });
});

describe('detectPackDrift', () => {
    // Pure detection: it reads the tree and reports. It does NOT rebuild the manifest
    // and does NOT consult a registry — see run-is-read-only.test.ts for why the
    // rebuild it used to do (`reconcilePack`) was removed.
    function tmpProject(pack: string, withPackageJson: boolean): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-drift-'));
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.awm', 'sensors.json'),
            JSON.stringify({ pack, sensors: pack === 'generic'
                ? { security: { cmd: 'semgrep .', fast: false } }
                : {} }),
        );
        if (withPackageJson) fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        return dir;
    }

    it('reports generic→js-ts drift when package.json is present', () => {
        const { detectPackDrift } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('generic', true);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = detectPackDrift(dir, manifest);
            expect(res.detection.pack).toBe('js-ts');
            expect(res.drift).toEqual({
                manifest: 'generic',
                detected: 'js-ts',
                remedy: expect.stringContaining('awm sensors init'),
            });
            // the manifest on disk is untouched — reporting is not healing
            const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            expect(onDisk.pack).toBe('generic');
        } finally { fs.rmSync(dir, { recursive: true }); }
    });

    it('reports no drift when the pack is already real', () => {
        const { detectPackDrift } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('js-ts', true);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            expect(detectPackDrift(dir, manifest).drift).toBeUndefined();
        } finally { fs.rmSync(dir, { recursive: true }); }
    });

    it('reports no drift on a truly generic project (no indicators)', () => {
        const { detectPackDrift } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('generic', false);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = detectPackDrift(dir, manifest);
            expect(res.detection.pack).toBe('generic');
            expect(res.drift).toBeUndefined();
        } finally { fs.rmSync(dir, { recursive: true }); }
    });
});

describe('runSensors — test sensor (exit-code)', () => {
    let tmpDir: string;
    const path = require('path');
    const os = require('os');

    beforeEach(() => {
        jest.resetModules();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-test-'));
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        mockRunCommand.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../src/commands/sensors/run');

    it('test sensor: passing run (exit 0 with output) is pass, not fail', async () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockRunCommand.mockResolvedValue(ok('Tests: 6 passed, 6 total\n')); // runner prints on success
        const { runSensors } = load();
        const result = await runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('pass');
    });

    it('test sensor: failing run (non-zero exit) is fail, not skipped', async () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockRunCommand.mockResolvedValue(exited(1, 'Tests: 1 failed, 5 passed\n'));
        const { runSensors } = load();
        const result = await runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('fail');
        expect(result.overall).toBe('fail');
    });

    it('test sensor: missing npm test script exits non-zero → fail, not skipped', async () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockRunCommand.mockResolvedValue(exited(1, 'npm error Missing script: test\n'));
        const { runSensors } = load();
        const result = await runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('fail');
        expect(result.overall).toBe('fail');
    });
});

describe('runSensors — honest floor (not_certified over real stack)', () => {
    const path = require('path');
    const os = require('os');

    beforeEach(() => {
        mockRunCommand.mockReset();
        mockRunCommand.mockResolvedValue(ok());
    });

    it('returns not_certified (not skipped) for a generic manifest over a real stack', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-floor-'));
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'generic', sensors: { security: { cmd: 'semgrep .', fast: false } } }));
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        const prevHome = process.env.AWM_HOME;
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-nohome-'));
        process.env.AWM_HOME = fakeHome; // no registry cache → no upgrade
        try {
            jest.resetModules();
            const { runSensors } = require('../../../src/commands/sensors/run');
            const result = await runSensors({ fast: true, cwd: dir }); // --fast filters the fast:false security sensor → empty
            expect(result.overall).toBe('not_certified');
        } finally {
            process.env.AWM_HOME = prevHome;
            fs.rmSync(dir, { recursive: true });
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });
});
