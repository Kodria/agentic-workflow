import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: any[]) => mockRunCommand(...args),
}));

const { ok, exited, timedOut, overflowed } = require('./exec-fixtures');

/** Sensors run in manifest insertion order, so mocks are queued in that order. */
const MANIFEST = {
    pack: 'js-ts',
    sensors: {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        security: { cmd: 'semgrep .', fast: false },
    },
};

const timeoutError = () => timedOut();

describe('runSensors — inconclusive: a sensor that could not certify is never green', () => {
    let root: string;
    let fakeAwmHome: string;
    let prevAwmHome: string | undefined;

    beforeEach(() => {
        jest.resetModules();
        mockRunCommand.mockReset();
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

    it('reports a timed-out sensor as inconclusive, keeping its reason', async () => {  // verifies R2, R7
        mockRunCommand
            .mockResolvedValueOnce(ok())          // typecheck: clean
            .mockResolvedValueOnce(timeoutError());   // security: times out

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/timeout/);
    });

    it('does not let a healthy sensor carry the run to pass while another could not certify', async () => {  // verifies R8
        mockRunCommand
            .mockResolvedValueOnce(ok())
            .mockResolvedValueOnce(timeoutError());

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('pass');
        expect(out.overall).toBe('not_certified');
    });

    it('reports a sensor whose output was truncated as inconclusive', async () => {  // verifies R3
        mockRunCommand
            .mockResolvedValueOnce(ok())
            .mockResolvedValueOnce(overflowed());

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/exceeded/);
        expect(out.overall).toBe('not_certified');
    });

    it('reports an uninterpretable non-zero exit as inconclusive', async () => {  // verifies R4
        mockRunCommand
            .mockResolvedValueOnce(ok())
            // semgrep formatter yields no findings for non-JSON output, the
            // tool is present (exit 2, not 127), and `security` is not an
            // exit-code sensor — the residual "I don't know" case.
            .mockResolvedValueOnce(exited(2, '', 'internal error: rule engine crashed\n'));

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/exit 2/);
        expect(out.overall).toBe('not_certified');
    });

    it('reports an enabled sensor with no cmd as inconclusive', async () => {  // verifies R5
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                depcheck: { fast: false },   // enabled, but nothing to run
            },
        }));
        mockRunCommand.mockResolvedValueOnce(ok());   // typecheck: clean

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        const depcheck = out.sensors.find((s: any) => s.name === 'depcheck');
        expect(depcheck.status).toBe('inconclusive');
        expect(depcheck.skipReason).toBe('no cmd configured');
        expect(out.overall).toBe('not_certified');
    });

    it('reports fail, not not_certified, when something is broken and something could not run', async () => {  // verifies R9
        mockRunCommand
            .mockResolvedValueOnce(exited(1, 'src/a.ts(1,1): error TS0001: Bad type.'))   // typecheck: real findings
            .mockResolvedValueOnce(timeoutError());   // security: times out

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('fail');
        expect(out.sensors.find((s: any) => s.name === 'security').status).toBe('inconclusive');
        expect(out.overall).toBe('fail');
    });

    it('never emits an overall value outside the published domain', async () => {  // verifies R11
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

        mockRunCommand
            .mockResolvedValueOnce(exited(1, 'src/a.ts(1,1): error TS0001: Bad type.'))  // typecheck: real findings → fail
            .mockResolvedValueOnce(ok())               // lint: clean → pass
            .mockResolvedValueOnce(timeoutError());         // security: times out → inconclusive

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        expect(DOMAIN).toContain(out.overall);
        expect(out.overall).not.toBe('inconclusive');
    });

    it('keeps a deliberately disabled sensor apart from one that could not certify', async () => {  // verifies R1, R6
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                security: { cmd: 'semgrep .', fast: false },
                mutation: { cmd: 'npx stryker run', enabled: false },
            },
        }));
        mockRunCommand.mockResolvedValueOnce(timeoutError());   // security: times out
                                                                // mutation: never invoked

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        // Same run, two different meanings — the whole point of the split.
        expect(out.sensors.find((s: any) => s.name === 'mutation').status).toBe('skipped');
        expect(out.sensors.find((s: any) => s.name === 'mutation').skipReason).toBe('disabled');
        expect(out.sensors.find((s: any) => s.name === 'security').status).toBe('inconclusive');
        expect(out.overall).toBe('not_certified');
    });

    it('does not let healthy legacy commands certify a run when another sensor is disabled', async () => {  // verifies R6 + R3 legacy contract
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                mutation: { cmd: 'npx stryker run', enabled: false },
            },
        }));
        mockRunCommand.mockResolvedValueOnce(ok());

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        // `enabled: false` is informational; the non-certification comes solely
        // from this pre-R3 (schema-less) manifest.  Legacy commands remain
        // operational, but their shell-backed, unversioned contract cannot issue
        // a certified `pass` verdict (R3 design R1.4 / R7.2).
        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('pass');
        expect(out.sensors.find((s: any) => s.name === 'mutation').status).toBe('skipped');
        expect(out.sensors.find((s: any) => s.name === 'mutation').skipReason).toBe('disabled');
        expect(out.overall).toBe('not_certified');
    });

    it('still refuses to certify a tree whose sensors are all disabled', async () => {  // verifies R10
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', enabled: false },
                security: { cmd: 'semgrep .', enabled: false },
            },
        }));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');   // real stack indicator

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        expect(out.sensors.every((s: any) => s.status === 'skipped')).toBe(true);
        expect(out.overall).toBe('not_certified');
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('leaves an inconclusive result untouched when a baseline is applied', async () => {  // verifies R14
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        writeBaseline(root, { security: ['some-accepted-fingerprint'] });

        mockRunCommand
            .mockResolvedValueOnce(ok())
            .mockResolvedValueOnce(timeoutError());

        const { runSensors } = load();
        const out = await runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.baselineCount).toBeUndefined();
        expect(out.overall).toBe('not_certified');
    });

    it('applyBaseline leaves an inconclusive result untouched even if it somehow carried findings', async () => {  // verifies R14 (discriminating unit test)
        // Every current `inconclusive` producer sets `errors: []`, so a test built
        // on the public `runSensors()` API can't tell "the explicit guard fired"
        // apart from "fell through to partition() and incidentally suppressed 0
        // findings." This unit-tests applyBaseline directly, with a hand-built
        // result that has `errors` populated, to prove the guard itself — not an
        // accidental empty-array interaction — is what keeps inconclusive inert.
        const { applyBaseline } = load();
        const { buildBaseline } = require('../../../src/commands/sensors/baseline');

        const result = {
            name: 'security',
            status: 'inconclusive' as const,
            errors: [{ message: 'hypothetical finding that should never be ratcheted', rule: 'some-rule', file: 'src/x.ts' }],
            skipReason: 'timeout after 10000ms',
        };

        // Build a baseline that partition() WOULD genuinely match/suppress for
        // this exact finding, so the old code (without the inconclusive guard)
        // would have mutated the result — proving the new guard, not an
        // incidental "suppressed === 0", is what keeps it untouched.
        const accepted = buildBaseline([{ name: result.name, errors: result.errors }])[result.name];

        const out = applyBaseline(result, accepted);

        expect(out).toBe(result);
        expect(out.status).toBe('inconclusive');
        expect(out.baselineCount).toBeUndefined();
    });
});
