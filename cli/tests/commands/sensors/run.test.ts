import fs from 'fs';
import os from 'os';
import path from 'path';
import { runSensors } from '../../../src/commands/sensors/run';

function mkTmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-sensors-'));
}

// Define stable mock before jest.mock hoisting
const mockExecSyncFn = jest.fn();

jest.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSyncFn(...args),
}));

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
        mockExecSyncFn.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../src/commands/sensors/run');

    it('returns not_certified output when manifest does not exist', () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        try {
            const { runSensors } = load();
            const result = runSensors({ fast: true, cwd: emptyDir });
            expect(result.overall).toBe('not_certified');
            expect(result.sensors).toHaveLength(0);
        } finally { fs.rmSync(emptyDir, { recursive: true }); }
    });

    it('runs only fast sensors with --fast flag', () => {
        mockExecSyncFn.mockReturnValue('' as any);
        const { runSensors } = load();
        const result = runSensors({ fast: true, cwd: tmpDir });
        expect(mockExecSyncFn).toHaveBeenCalledTimes(2); // typecheck + lint (security disabled, mutation disabled)
        expect(result.sensors.some((s: any) => s.name === 'security')).toBe(false);
        expect(result.overall).toBe('pass');
    });

    it('returns fail when a fast sensor has errors', () => {
        mockExecSyncFn
            .mockImplementationOnce(() => { throw Object.assign(new Error(), { stdout: "src/a.ts(1,1): error TS0001: Bad type.", stderr: '', status: 1 }); })
            .mockReturnValueOnce('' as any);
        const { runSensors } = load();
        const result = runSensors({ fast: true, cwd: tmpDir });
        expect(result.overall).toBe('fail');
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('fail');
        expect(tc!.errors[0].message).toMatch('SENSOR[typecheck]');
    });

    it('marks sensor as skipped on timeout', () => {
        mockExecSyncFn.mockImplementationOnce(() => { throw Object.assign(new Error('killed'), { code: 'ETIMEDOUT' }); });
        mockExecSyncFn.mockReturnValueOnce('' as any);
        const { runSensors } = load();
        const result = runSensors({ fast: true, cwd: tmpDir });
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('skipped');
        expect(tc!.skipReason).toMatch('timeout');
    });

    it('skips disabled sensors', () => {
        mockExecSyncFn.mockReturnValue('' as any);
        const { runSensors } = load();
        const result = runSensors({ all: true, cwd: tmpDir });
        const sec = result.sensors.find((s: any) => s.name === 'security');
        expect(sec!.status).toBe('skipped');
        expect(sec!.skipReason).toBe('disabled');
    });

    const tcError = () => { throw Object.assign(new Error(), { stdout: 'src/a.ts(1,1): error TS0001: Bad type.', stderr: '', status: 1 }); };

    it('baseline suppresses accepted findings — sensor passes on no NEW findings', () => {
        const { runSensors } = load();
        const { buildBaseline, writeBaseline } = require('../../../src/commands/sensors/baseline');

        // Run 1 (no baseline): typecheck reports a TS error → fail.
        mockExecSyncFn.mockImplementationOnce(tcError).mockReturnValueOnce('' as any);
        const first = runSensors({ fast: true, cwd: tmpDir });
        expect(first.overall).toBe('fail');

        // Accept the current findings as baseline.
        writeBaseline(tmpDir, buildBaseline(first.sensors.map((s: any) => ({ name: s.name, errors: s.errors }))));

        // Run 2 (same finding): baseline-suppressed → pass.
        mockExecSyncFn.mockImplementationOnce(tcError).mockReturnValueOnce('' as any);
        const second = runSensors({ fast: true, cwd: tmpDir });
        const tc = second.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('pass');
        expect(tc!.baselineCount).toBe(1);
        expect(second.overall).toBe('pass');
    });

    it('baseline lets NEW findings through (still fails)', () => {
        const { runSensors } = load();
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        writeBaseline(tmpDir, { typecheck: ['some-unrelated-fingerprint'] });

        mockExecSyncFn.mockImplementationOnce(tcError).mockReturnValueOnce('' as any);
        const result = runSensors({ fast: true, cwd: tmpDir });
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('fail');
        expect(result.overall).toBe('fail');
    });

    it('--ignore-baseline reports all findings even when a baseline exists', () => {
        const { runSensors } = load();
        const { buildBaseline, writeBaseline } = require('../../../src/commands/sensors/baseline');
        // First capture + accept the finding.
        mockExecSyncFn.mockImplementationOnce(tcError).mockReturnValueOnce('' as any);
        const first = runSensors({ fast: true, cwd: tmpDir });
        writeBaseline(tmpDir, buildBaseline(first.sensors.map((s: any) => ({ name: s.name, errors: s.errors }))));

        // With ignoreBaseline, the accepted finding still counts → fail.
        mockExecSyncFn.mockImplementationOnce(tcError).mockReturnValueOnce('' as any);
        const result = runSensors({ fast: true, cwd: tmpDir, ignoreBaseline: true });
        expect(result.overall).toBe('fail');
    });
});

describe('runSensors — missing tool is a fail, not a skip', () => {
    let root: string;

    afterEach(() => {
        if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    beforeEach(() => {
        mockExecSyncFn.mockReset();
        // Simulate shell exit 127 "command not found" — matches what Node's execSync
        // captures in err.stderr when the binary does not exist on PATH.
        mockExecSyncFn.mockImplementation(() => {
            throw Object.assign(new Error('Command failed: awm-nonexistent-binary-xyz --check'), {
                stdout: '',
                stderr: '/bin/sh: awm-nonexistent-binary-xyz: command not found\n',
                status: 127,
            });
        });
    });

    it('marks a sensor whose binary is missing as fail', () => {
        root = mkTmp();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(
            path.join(root, '.awm', 'sensors.json'),
            JSON.stringify({
                pack: 'test',
                sensors: { ghost: { cmd: 'awm-nonexistent-binary-xyz --check', fast: true } },
            }),
        );
        const out = runSensors({ cwd: root });
        const ghost = out.sensors.find((s) => s.name === 'ghost');
        expect(ghost?.status).toBe('fail');
        expect(out.overall).toBe('fail');
    });
});

describe('runSensors — not_certified + auto-discovery', () => {
    let tmpDir: string | undefined;

    beforeEach(() => {
        mockExecSyncFn.mockReset();
        mockExecSyncFn.mockReturnValue('' as any);
    });

    afterEach(() => {
        if (tmpDir) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            tmpDir = undefined;
        }
    });

    it('returns not_certified when no manifest exists anywhere up the tree', () => {
        tmpDir = mkTmp();
        const out = runSensors({ cwd: tmpDir });
        expect(out.overall).toBe('not_certified');
        expect(out.sensors).toEqual([]);
    });

    it('discovers .awm/sensors.json in a parent directory (walk-up)', () => {
        tmpDir = mkTmp();
        fs.mkdirSync(path.join(tmpDir, '.awm'));
        fs.writeFileSync(
            path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'test', sensors: { noop: { cmd: 'echo ok', fast: true } } }),
        );
        const nested = path.join(tmpDir, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        const out = runSensors({ cwd: nested });
        expect(out.overall).toBe('pass');
        expect(out.sensors.length).toBe(1);
    });
});

describe('reconcilePack', () => {
    const REPO_REGISTRY = path.resolve(__dirname, '../../../../registry');

    function tmpProject(pack: string, withPackageJson: boolean): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reconcile-'));
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

    it('upgrades generic→js-ts when package.json is present', () => {
        const { reconcilePack } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('generic', true);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = reconcilePack(dir, manifest, REPO_REGISTRY);
            expect(res.manifest.pack).toBe('js-ts');
            expect(res.upgradedFrom).toBe('generic');
            expect(Object.keys(res.manifest.sensors)).toContain('typecheck');
            // custom sensor cmd preserved through merge
            expect(res.manifest.sensors.security?.cmd).toBe('semgrep .');
            // persisted to disk
            const onDisk = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            expect(onDisk.pack).toBe('js-ts');
        } finally { fs.rmSync(dir, { recursive: true }); }
    });

    it('is a no-op when pack is already real (idempotent)', () => {
        const { reconcilePack } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('js-ts', true);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = reconcilePack(dir, manifest, REPO_REGISTRY);
            expect(res.manifest.pack).toBe('js-ts');
            expect(res.upgradedFrom).toBeUndefined();
        } finally { fs.rmSync(dir, { recursive: true }); }
    });

    it('does not upgrade a truly generic project (no indicators)', () => {
        const { reconcilePack } = require('../../../src/commands/sensors/run');
        const dir = tmpProject('generic', false);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));
            const res = reconcilePack(dir, manifest, REPO_REGISTRY);
            expect(res.manifest.pack).toBe('generic');
            expect(res.upgradedFrom).toBeUndefined();
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
        mockExecSyncFn.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../src/commands/sensors/run');

    it('test sensor: passing run (exit 0 with output) is pass, not fail', () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockExecSyncFn.mockReturnValue('Tests: 6 passed, 6 total\n'); // runner prints on success
        const { runSensors } = load();
        const result = runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('pass');
    });

    it('test sensor: failing run (non-zero exit) is fail, not skipped', () => {
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'js-ts', sensors: { test: { cmd: 'npm test', fast: false } } }));
        mockExecSyncFn.mockImplementation(() => {
            const err: any = new Error('jest failed');
            err.status = 1;
            err.stdout = 'Tests: 1 failed, 5 passed\n';
            err.stderr = '';
            throw err;
        });
        const { runSensors } = load();
        const result = runSensors({ all: true, cwd: tmpDir });
        const test = result.sensors.find((s: any) => s.name === 'test');
        expect(test.status).toBe('fail');
        expect(result.overall).toBe('fail');
    });
});

describe('runSensors — honest floor (not_certified over real stack)', () => {
    const path = require('path');
    const os = require('os');

    beforeEach(() => {
        mockExecSyncFn.mockReset();
        mockExecSyncFn.mockReturnValue('' as any);
    });

    it('returns not_certified (not skipped) for a generic manifest over a real stack', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-floor-'));
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'generic', sensors: { security: { cmd: 'semgrep .', fast: false } } }));
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
        const prevHome = process.env.AWM_HOME;
        const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-nohome-'));
        process.env.AWM_HOME = fakeHome; // no cli-source → no upgrade
        try {
            jest.resetModules();
            const { runSensors } = require('../../../src/commands/sensors/run');
            const result = runSensors({ fast: true, cwd: dir }); // --fast filters the fast:false security sensor → empty
            expect(result.overall).toBe('not_certified');
        } finally {
            process.env.AWM_HOME = prevHome;
            fs.rmSync(dir, { recursive: true });
            fs.rmSync(fakeHome, { recursive: true, force: true });
        }
    });
});
