import fs from 'fs';

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

    it('returns skipped output when manifest does not exist', () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        try {
            const { runSensors } = load();
            const result = runSensors({ fast: true, cwd: emptyDir });
            expect(result.overall).toBe('skipped');
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
});
