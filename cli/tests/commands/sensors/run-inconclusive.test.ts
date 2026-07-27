import fs from 'fs';
import os from 'os';
import path from 'path';

const mockExecSyncFn = jest.fn();
jest.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSyncFn(...args),
}));

/** Sensors run in manifest insertion order, so mocks are queued in that order. */
const MANIFEST = {
    pack: 'js-ts',
    sensors: {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        security: { cmd: 'semgrep .', fast: false },
    },
};

const timeoutError = () => { throw Object.assign(new Error('killed'), { code: 'ETIMEDOUT' }); };

describe('runSensors — inconclusive: a sensor that could not certify is never green', () => {
    let root: string;
    let fakeAwmHome: string;
    let prevAwmHome: string | undefined;

    beforeEach(() => {
        jest.resetModules();
        mockExecSyncFn.mockReset();
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-inconclusive-'));
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify(MANIFEST));
        // CLAUDE.md: no test may reach the real ~/.awm.
        fakeAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        prevAwmHome = process.env.AWM_HOME;
        process.env.AWM_HOME = fakeAwmHome;
    });

    afterEach(() => {
        process.env.AWM_HOME = prevAwmHome;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(fakeAwmHome, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    it('reports a timed-out sensor as inconclusive, keeping its reason', () => {  // verifies R2, R7
        mockExecSyncFn
            .mockReturnValueOnce('' as any)          // typecheck: clean
            .mockImplementationOnce(timeoutError);   // security: times out

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/timeout/);
    });

    it('does not let a healthy sensor carry the run to pass while another could not certify', () => {  // verifies R8
        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(timeoutError);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('pass');
        expect(out.overall).toBe('not_certified');
    });
});
