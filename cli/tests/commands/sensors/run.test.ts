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

describe('runSensors — not_certified + auto-discovery', () => {
    beforeEach(() => {
        mockExecSyncFn.mockReset();
        mockExecSyncFn.mockReturnValue('' as any);
    });

    it('returns not_certified when no manifest exists anywhere up the tree', () => {
        const dir = mkTmp();
        const out = runSensors({ cwd: dir });
        expect(out.overall).toBe('not_certified');
        expect(out.sensors).toEqual([]);
    });

    it('discovers .awm/sensors.json in a parent directory (walk-up)', () => {
        const root = mkTmp();
        fs.mkdirSync(path.join(root, '.awm'));
        // Manifest con un sensor trivial que siempre pasa (echo no produce errores parseables).
        fs.writeFileSync(
            path.join(root, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'test', sensors: { noop: { cmd: 'echo ok', fast: true } } }),
        );
        const nested = path.join(root, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        const out = runSensors({ cwd: nested });
        expect(out.overall).toBe('pass');
        expect(out.sensors.length).toBe(1);
    });
});
