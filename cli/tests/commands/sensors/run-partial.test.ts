import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: any[]) => mockRunCommand(...args),
}));

const { ok, timedOut, overflowed } = require('./exec-fixtures');

const TS_FINDING = 'src/a.ts(1,1): error TS0001: Bad type.';

function project(sensors: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-partial-'));
    fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'), JSON.stringify({ pack: 'js-ts', sensors }));
    return dir;
}

describe('runSensors — a cut-short run keeps the findings it did produce', () => {
    let dir: string;
    let prevAwmHome: string | undefined;
    let fakeAwmHome: string;

    beforeEach(() => {
        jest.resetModules();
        mockRunCommand.mockReset();
        // CLAUDE.md: no test may reach the real ~/.awm.
        fakeAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        prevAwmHome = process.env.AWM_HOME;
        process.env.AWM_HOME = fakeAwmHome;
    });

    afterEach(() => {
        process.env.AWM_HOME = prevAwmHome;
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(fakeAwmHome, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    it('reports findings from partial output as fail instead of discarding them', async () => {
        // The regression this guards: the old runner threw away everything a
        // timed-out sensor had printed, so a 60s lint run that had already found
        // real errors reported zero — and the caller re-ran it by hand to learn
        // what it had just paid for.
        dir = project({ typecheck: { cmd: 'npx tsc --noEmit', fast: true } });
        mockRunCommand.mockResolvedValueOnce(timedOut(TS_FINDING));

        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        const tc = out.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc.status).toBe('fail');
        expect(tc.errors).toHaveLength(1);
        expect(tc.errors[0].message).toMatch(/Bad type/);
        expect(out.overall).toBe('fail');
    });

    it('marks the partial fail as incomplete so absence of findings is not read as coverage', async () => {
        dir = project({ typecheck: { cmd: 'npx tsc --noEmit', fast: true, timeout: 30000 } });
        mockRunCommand.mockResolvedValueOnce(timedOut(TS_FINDING));

        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        const tc = out.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc.incomplete).toMatch(/timeout after 30000ms/);
        expect(tc.incomplete).toMatch(/did not finish/);
    });

    it('still refuses to certify when the partial output is clean', async () => {
        // A clean partial proves nothing — the findings could all be in the part
        // that never ran. This must stay inconclusive, never pass.
        dir = project({ typecheck: { cmd: 'npx tsc --noEmit', fast: true } });
        mockRunCommand.mockResolvedValueOnce(timedOut('Checking 400 files...\n'));

        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        const tc = out.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc.status).toBe('inconclusive');
        expect(tc.skipReason).toMatch(/timeout/);
        expect(tc.incomplete).toBeUndefined();
        expect(out.overall).toBe('not_certified');
    });

    it('applies the same rule to output-cap overflow', async () => {
        dir = project({ typecheck: { cmd: 'npx tsc --noEmit', fast: true } });
        mockRunCommand.mockResolvedValueOnce(overflowed(TS_FINDING));

        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        const tc = out.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc.status).toBe('fail');
        expect(tc.incomplete).toMatch(/exceeded/);
    });

    it('fails the sensor when the shell could not be started', async () => {
        const { spawnFailed } = require('./exec-fixtures');
        dir = project({ typecheck: { cmd: 'npx tsc --noEmit', fast: true } });
        mockRunCommand.mockResolvedValueOnce(spawnFailed('spawn /bin/sh ENOENT'));

        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        const tc = out.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc.status).toBe('fail');
        expect(tc.errors[0].message).toMatch(/could not be started/);
        expect(out.overall).toBe('fail');
    });

    it('lets the baseline suppress a finding that came from partial output', async () => {
        dir = project({ typecheck: { cmd: 'npx tsc --noEmit', fast: true } });
        const { buildBaseline, writeBaseline } = require('../../../src/commands/sensors/baseline');
        const { parseTscOutput } = require('../../../src/commands/sensors/formatters/tsc');
        writeBaseline(dir, buildBaseline([{ name: 'typecheck', errors: parseTscOutput(TS_FINDING) }]));

        mockRunCommand.mockResolvedValueOnce(timedOut(TS_FINDING));
        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        const tc = out.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc.status).toBe('pass');
        expect(tc.baselineCount).toBe(1);
    });
});

describe('runSensors — sensors run concurrently', () => {
    let dir: string;
    let prevAwmHome: string | undefined;
    let prevConcurrency: string | undefined;
    let fakeAwmHome: string;

    beforeEach(() => {
        jest.resetModules();
        mockRunCommand.mockReset();
        fakeAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        prevAwmHome = process.env.AWM_HOME;
        prevConcurrency = process.env.AWM_SENSORS_CONCURRENCY;
        process.env.AWM_HOME = fakeAwmHome;
    });

    afterEach(() => {
        process.env.AWM_HOME = prevAwmHome;
        if (prevConcurrency === undefined) delete process.env.AWM_SENSORS_CONCURRENCY;
        else process.env.AWM_SENSORS_CONCURRENCY = prevConcurrency;
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(fakeAwmHome, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    /** Resolves after `ms`, recording when it started and finished. */
    const timed = (log: Array<[string, number]>, label: string, ms: number) => () =>
        new Promise((resolve) => {
            log.push([`${label}:start`, Date.now()]);
            setTimeout(() => { log.push([`${label}:end`, Date.now()]); resolve(ok()); }, ms);
        });

    const THREE = {
        typecheck: { cmd: 'a', fast: true },
        lint: { cmd: 'b', fast: true },
        security: { cmd: 'c', fast: true },
    };

    it('starts every sensor before the first one finishes', async () => {
        process.env.AWM_SENSORS_CONCURRENCY = '3';
        dir = project(THREE);
        const log: Array<[string, number]> = [];
        mockRunCommand
            .mockImplementationOnce(timed(log, 'typecheck', 120))
            .mockImplementationOnce(timed(log, 'lint', 120))
            .mockImplementationOnce(timed(log, 'security', 120));

        const { runSensors } = load();
        await runSensors({ cwd: dir });

        const order = log.map(([label]) => label);
        // All three starts precede the first end — that is what serial execution
        // could not do, and the reason wall clock stops being the sum.
        expect(order.slice(0, 3)).toEqual(['typecheck:start', 'lint:start', 'security:start']);
        expect(order[3]).toMatch(/:end$/);
    });

    it('honours a concurrency of 1 by running them strictly one at a time', async () => {
        process.env.AWM_SENSORS_CONCURRENCY = '1';
        dir = project(THREE);
        const log: Array<[string, number]> = [];
        mockRunCommand
            .mockImplementationOnce(timed(log, 'typecheck', 30))
            .mockImplementationOnce(timed(log, 'lint', 30))
            .mockImplementationOnce(timed(log, 'security', 30));

        const { runSensors } = load();
        await runSensors({ cwd: dir });

        expect(log.map(([label]) => label)).toEqual([
            'typecheck:start', 'typecheck:end',
            'lint:start', 'lint:end',
            'security:start', 'security:end',
        ]);
    });

    it('reports results in manifest order regardless of which sensor finishes first', async () => {
        process.env.AWM_SENSORS_CONCURRENCY = '3';
        dir = project(THREE);
        const log: Array<[string, number]> = [];
        // Deliberately inverted durations: security finishes first, typecheck last.
        mockRunCommand
            .mockImplementationOnce(timed(log, 'typecheck', 90))
            .mockImplementationOnce(timed(log, 'lint', 50))
            .mockImplementationOnce(timed(log, 'security', 10));

        const { runSensors } = load();
        const out = await runSensors({ cwd: dir });

        expect(out.sensors.map((s: any) => s.name)).toEqual(['typecheck', 'lint', 'security']);
    });
});

describe('resolveConcurrency', () => {
    const load = () => require('../../../src/commands/sensors/run');
    let prev: string | undefined;

    beforeEach(() => { jest.resetModules(); prev = process.env.AWM_SENSORS_CONCURRENCY; });
    afterEach(() => {
        if (prev === undefined) delete process.env.AWM_SENSORS_CONCURRENCY;
        else process.env.AWM_SENSORS_CONCURRENCY = prev;
    });

    it('never exceeds the number of sensors to run', () => {
        delete process.env.AWM_SENSORS_CONCURRENCY;
        const { resolveConcurrency } = load();
        expect(resolveConcurrency({ pack: 'js-ts', sensors: {} }, 1)).toBe(1);
    });

    it('caps at 4 even on a large box', () => {
        delete process.env.AWM_SENSORS_CONCURRENCY;
        const { resolveConcurrency } = load();
        expect(resolveConcurrency({ pack: 'js-ts', sensors: {} }, 32)).toBeLessThanOrEqual(4);
    });

    it('lets the manifest pin it', () => {
        delete process.env.AWM_SENSORS_CONCURRENCY;
        const { resolveConcurrency } = load();
        expect(resolveConcurrency({ pack: 'js-ts', sensors: {}, concurrency: 2 }, 8)).toBe(2);
    });

    it('lets the environment override the manifest', () => {
        process.env.AWM_SENSORS_CONCURRENCY = '1';
        const { resolveConcurrency } = load();
        expect(resolveConcurrency({ pack: 'js-ts', sensors: {}, concurrency: 4 }, 8)).toBe(1);
    });

    it('ignores nonsense and falls back to the derived cap', () => {
        process.env.AWM_SENSORS_CONCURRENCY = 'banana';
        const { resolveConcurrency } = load();
        expect(resolveConcurrency({ pack: 'js-ts', sensors: {} }, 8)).toBeGreaterThanOrEqual(1);
    });
});
