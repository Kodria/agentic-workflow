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

    it('reports a sensor whose output was truncated as inconclusive', () => {  // verifies R3
        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(() => { throw Object.assign(new Error('too big'), { code: 'ENOBUFS' }); });

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/exceeded/);
        expect(out.overall).toBe('not_certified');
    });

    it('reports an uninterpretable non-zero exit as inconclusive', () => {  // verifies R4
        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(() => {
                // semgrep formatter yields no findings for non-JSON output, the
                // tool is present (exit 2, not 127), and `security` is not an
                // exit-code sensor — the residual "I don't know" case.
                throw Object.assign(new Error('failed'), {
                    stdout: '', stderr: 'internal error: rule engine crashed\n', status: 2,
                });
            });

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/exit 2/);
        expect(out.overall).toBe('not_certified');
    });

    it('reports an enabled sensor with no cmd as inconclusive', () => {  // verifies R5
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                depcheck: { fast: false },   // enabled, but nothing to run
            },
        }));
        mockExecSyncFn.mockReturnValueOnce('' as any);   // typecheck: clean

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const depcheck = out.sensors.find((s: any) => s.name === 'depcheck');
        expect(depcheck.status).toBe('inconclusive');
        expect(depcheck.skipReason).toBe('no cmd configured');
        expect(out.overall).toBe('not_certified');
    });

    it('reports fail, not not_certified, when something is broken and something could not run', () => {  // verifies R9
        mockExecSyncFn
            .mockImplementationOnce(() => {   // typecheck: real findings
                throw Object.assign(new Error(), {
                    stdout: 'src/a.ts(1,1): error TS0001: Bad type.', stderr: '', status: 1,
                });
            })
            .mockImplementationOnce(timeoutError);   // security: times out

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('fail');
        expect(out.sensors.find((s: any) => s.name === 'security').status).toBe('inconclusive');
        expect(out.overall).toBe('fail');
    });

    it('never emits an overall value outside the published domain', () => {  // verifies R11
        // `inconclusive` is a per-sensor status only. External consumers (the
        // registry skills) read `overall`, whose domain must not grow — this
        // pins that invariant at runtime on a three-sensor pass+fail+inconclusive
        // mix, a combination neither R8 (pass+inconclusive) nor R9
        // (fail+inconclusive) exercises. R9's own assertion already catches a
        // fail/inconclusive precedence regression specifically; what this test
        // adds is runtime coverage of the domain claim itself, on a fixture
        // neither of those covers — not independent detection of every
        // aggregation mutation.
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                lint: { cmd: 'npx eslint . --format json', fast: true },
                security: { cmd: 'semgrep .', fast: false },
            },
        }));
        const DOMAIN = ['pass', 'fail', 'skipped', 'not_certified'];

        mockExecSyncFn
            .mockImplementationOnce(() => {              // typecheck: real findings → fail
                throw Object.assign(new Error(), {
                    stdout: 'src/a.ts(1,1): error TS0001: Bad type.', stderr: '', status: 1,
                });
            })
            .mockReturnValueOnce('' as any)               // lint: clean → pass
            .mockImplementationOnce(timeoutError);         // security: times out → inconclusive

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(DOMAIN).toContain(out.overall);
        expect(out.overall).not.toBe('inconclusive');
    });

    it('keeps a deliberately disabled sensor apart from one that could not certify', () => {  // verifies R1, R6
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                security: { cmd: 'semgrep .', fast: false },
                mutation: { cmd: 'npx stryker run', enabled: false },
            },
        }));
        mockExecSyncFn.mockImplementationOnce(timeoutError);   // security: times out
                                                                // mutation: never invoked

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        // Same run, two different meanings — the whole point of the split.
        expect(out.sensors.find((s: any) => s.name === 'mutation').status).toBe('skipped');
        expect(out.sensors.find((s: any) => s.name === 'mutation').skipReason).toBe('disabled');
        expect(out.sensors.find((s: any) => s.name === 'security').status).toBe('inconclusive');
    });

    it('does not degrade the verdict for a disabled sensor alongside healthy ones', () => {  // verifies R6
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                mutation: { cmd: 'npx stryker run', enabled: false },
            },
        }));
        mockExecSyncFn.mockReturnValueOnce('' as any);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.overall).toBe('pass');
    });

    it('still refuses to certify a tree whose sensors are all disabled', () => {  // verifies R10
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', enabled: false },
                security: { cmd: 'semgrep .', enabled: false },
            },
        }));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');   // real stack indicator

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.sensors.every((s: any) => s.status === 'skipped')).toBe(true);
        expect(out.overall).toBe('not_certified');
        expect(mockExecSyncFn).not.toHaveBeenCalled();
    });

    it('leaves an inconclusive result untouched when a baseline is applied', () => {  // verifies R14
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        writeBaseline(root, { security: ['some-accepted-fingerprint'] });

        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(timeoutError);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.baselineCount).toBeUndefined();
        expect(out.overall).toBe('not_certified');
    });
});
