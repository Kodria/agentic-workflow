import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: any[]) => mockRunCommand(...args),
}));

const mockChangedFiles = jest.fn();
jest.mock('../../../src/commands/sensors/changed', () => {
    const actual = jest.requireActual('../../../src/commands/sensors/changed');
    return { ...actual, changedFiles: (...args: any[]) => mockChangedFiles(...args) };
});

const { ok } = require('./exec-fixtures');

function project(sensors: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-changed-run-'));
    fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.awm', 'sensors.json'), JSON.stringify({ pack: 'js-ts', sensors }));
    return dir;
}

/** The two sensors that matter: one that opted into scoping, one that cannot. */
const LINT = { fast: true, cmd: 'eslint --format json .', changedCmd: 'eslint --format json {files}' };
const TYPECHECK = { fast: true, cmd: 'tsc --noEmit' };

describe('runSensors --changed', () => {
    let dir: string;
    let prevAwmHome: string | undefined;
    let fakeAwmHome: string;

    beforeEach(() => {
        jest.resetModules();
        mockRunCommand.mockReset();
        mockChangedFiles.mockReset();
        mockRunCommand.mockResolvedValue(ok(''));
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
    const cmds = () => mockRunCommand.mock.calls.map(c => c[0]);

    it('scopes a sensor that opted in and leaves one that did not at full scope', async () => {
        // The core contract. tsc is whole-program: handed a subset it reports clean
        // while the change breaks a caller it was never shown. Scoping is opt-in
        // precisely so that sensor keeps measuring everything.
        dir = project({ lint: LINT, typecheck: TYPECHECK });
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });

        await load().runSensors({ cwd: dir, changed: true });

        expect(cmds()).toContain(`eslint --format json 'src/a.ts'`);
        expect(cmds()).toContain('tsc --noEmit');
    });

    it('marks the scoped result so a scoped pass is not read as a full one', async () => {
        dir = project({ lint: LINT, typecheck: TYPECHECK });
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });

        const out = await load().runSensors({ cwd: dir, changed: true });

        expect(out.sensors.find((s: any) => s.name === 'lint').scope).toBe('changed');
        expect(out.sensors.find((s: any) => s.name === 'typecheck').scope).toBeUndefined();
        expect(out.changedScope).toEqual({ files: 1 });
    });

    it('falls back to the full command when the scope cannot be resolved', async () => {
        // Not a git repo, git absent, bad ref. Running everything is slow; guessing at
        // a narrower set would certify files nobody proved were the only ones touched.
        dir = project({ lint: LINT });
        mockChangedFiles.mockReturnValue({ files: [], error: 'not a git repository' });

        const out = await load().runSensors({ cwd: dir, changed: true });

        expect(cmds()).toContain('eslint --format json .');
        expect(out.sensors[0].scope).toBeUndefined();
        expect(out.changedScope).toEqual({ files: 0, error: 'not a git repository' });
    });

    it('skips an opted-in sensor when nothing changed, without touching the others', async () => {
        dir = project({ lint: LINT, typecheck: TYPECHECK });
        mockChangedFiles.mockReturnValue({ files: [] });

        const out = await load().runSensors({ cwd: dir, changed: true });

        const lint = out.sensors.find((s: any) => s.name === 'lint');
        expect(lint.status).toBe('skipped');
        expect(lint.skipReason).toBe('no changed files in scope');
        expect(cmds()).toEqual(['tsc --noEmit']);
    });

    it('hands the sensor only the extensions it declared it can take', async () => {
        // Without this, editing a README turns the lint gate red: eslint given a .md
        // fails rather than skipping it.
        dir = project({ lint: { ...LINT, changedExtensions: ['.ts', '.tsx'] } });
        mockChangedFiles.mockReturnValue({ files: ['README.md', 'logo.png', 'src/a.ts'] });

        await load().runSensors({ cwd: dir, changed: true });

        expect(cmds()).toEqual([`eslint --format json 'src/a.ts'`]);
    });

    it('skips the sensor when the filter empties the scope, rather than running repo-wide', async () => {
        // A docs-only commit means the lint sensor has nothing to say. Falling back to
        // the full command here would reintroduce exactly the cost --changed removes.
        dir = project({ lint: { ...LINT, changedExtensions: ['.ts'] }, typecheck: TYPECHECK });
        mockChangedFiles.mockReturnValue({ files: ['README.md'] });

        const out = await load().runSensors({ cwd: dir, changed: true });

        expect(out.sensors.find((s: any) => s.name === 'lint').status).toBe('skipped');
        expect(cmds()).toEqual(['tsc --noEmit']);
    });

    it('refuses a changedCmd without a {files} placeholder instead of running it repo-wide', async () => {
        // Running the template as-is would cover the whole repo while the result
        // claimed to be scoped. That is a mislabelled verdict, not a slow path.
        dir = project({ lint: { ...LINT, changedCmd: 'eslint --format json .' } });
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });

        const out = await load().runSensors({ cwd: dir, changed: true });

        expect(out.sensors[0].status).toBe('inconclusive');
        expect(out.overall).toBe('not_certified');
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('refuses to combine --changed with a baseline capture', async () => {
        // buildBaseline snapshots the run it is given, so baselining a scoped run
        // would write a baseline covering only the diff and silently drop every
        // accepted finding elsewhere — which then reports as NEW on the next full run.
        dir = project({ lint: LINT });
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });

        await expect(load().runSensors({ cwd: dir, changed: true, ignoreBaseline: true }))
            .rejects.toThrow(/cannot define the accepted set/);
    });

    it('runs everything at full scope when --changed is absent', async () => {
        dir = project({ lint: LINT, typecheck: TYPECHECK });

        const out = await load().runSensors({ cwd: dir });

        expect(cmds()).toEqual(['eslint --format json .', 'tsc --noEmit']);
        expect(mockChangedFiles).not.toHaveBeenCalled();
        expect(out.changedScope).toBeUndefined();
    });

    it('passes the requested base through to the scope resolver', async () => {
        dir = project({ lint: LINT });
        mockChangedFiles.mockReturnValue({ files: ['src/a.ts'] });

        await load().runSensors({ cwd: dir, changed: true, base: 'main' });

        expect(mockChangedFiles).toHaveBeenCalledWith(dir, 'main');
    });
});
