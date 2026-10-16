import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: any[]) => mockRunCommand(...args),
}));

const { ok } = require('./exec-fixtures');

describe('runSensors read-only observation (admission)', () => {
    const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
    const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
    let root: string;
    let project: string;

    beforeEach(() => {
        jest.resetModules();
        mockRunCommand.mockReset();
        mockRunCommand.mockResolvedValue(ok(''));
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-readonly-'));
        for (const key of ENV_KEYS) saved[key] = process.env[key];
        const home = path.join(root, 'home');
        fs.mkdirSync(home, { recursive: true });
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
        const globalConfig = path.join(home, 'gitconfig');
        fs.writeFileSync(globalConfig, '[user]\n\temail = test@example.test\n\tname = test\n');
        process.env.GIT_CONFIG_GLOBAL = globalConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        process.env.GIT_CEILING_DIRECTORIES = root;
        project = path.join(root, 'project');
        write('.awm/sensors.json', JSON.stringify({ pack: 'js-ts', sensors: { lint: { fast: true, cmd: 'eslint --format json .' } } }));
    });

    afterEach(() => {
        jest.dontMock('../../../src/commands/sensors/read-only-observation');
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    function write(relative: string, content = 'x'): void {
        const file = path.join(project, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    const git = (args: string[]): string => execFileSync('git', args, { cwd: project, env: { ...process.env }, stdio: 'pipe', encoding: 'utf8' });
    function commitProject(gitignore: string): void {
        write('.gitignore', gitignore);
        git(['init', '-q', '-b', 'main']);
        git(['add', '.']);
        git(['commit', '-qm', 'initial']);
    }
    const load = () => require('../../../src/commands/sensors/run');

    it('skips ignored default directories, including one a sensor creates, and reports them', async () => {
        commitProject('node_modules/\ncoverage/\n');
        write('node_modules/pkg/index.js', 'installed');
        mockRunCommand.mockImplementation(async () => {
            write('coverage/lcov.info', 'sensor output');
            write('node_modules/pkg/index.js', 'rebuilt');
            return ok('');
        });

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out.reason).not.toBe('read-only-mutation-detected');
        expect(out.reason).not.toBe('read-only-observation-unavailable');
        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: ['coverage', 'node_modules'], rejected: [] });
    });

    it('still detects a mutation inside a matching directory that is not ignored', async () => {
        commitProject('');
        write('node_modules/pkg/index.js', 'installed');
        mockRunCommand.mockImplementation(async () => {
            write('node_modules/pkg/index.js', 'rebuilt');
            return ok('');
        });

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out).toMatchObject({ overall: 'not_certified', reason: 'read-only-mutation-detected' });
        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: [], rejected: [{ path: 'node_modules', reason: 'not-ignored' }] });
    });

    it('observes everything and says so when the project is not a git worktree', async () => {
        write('node_modules/pkg/index.js', 'installed');

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: [], rejected: [{ path: 'node_modules', reason: 'git-unavailable' }] });
    });

    it('blocks a read-only run on an invalid admission file before running sensors', async () => {
        write('.awm/admission.json', JSON.stringify({ schemaVersion: 2 }));

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out).toMatchObject({
            overall: 'not_certified', mode: 'invalid', reason: 'admission-config-invalid',
            remedy: 'repair .awm/admission.json: schemaVersion must be 1',
        });
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    it('never reads the admission file outside read-only runs', async () => {
        write('.awm/admission.json', JSON.stringify({ schemaVersion: 2 }));

        const out = await load().runSensors({ cwd: project });

        expect(out.reason).not.toBe('admission-config-invalid');
        expect(out.readOnlyObservation).toBeUndefined();
        expect(mockRunCommand).toHaveBeenCalled();
    });

    it('returns an actionable remedy with evidence when the snapshot exceeds a limit', async () => {
        jest.doMock('../../../src/commands/sensors/read-only-observation', () => {
            const actual = jest.requireActual('../../../src/commands/sensors/read-only-observation');
            return { ...actual, filesystemSnapshot: () => ({ ok: false, failure: 'limit-bytes' }) };
        });

        const out = await load().runSensors({ cwd: project, readOnly: true });

        expect(out).toMatchObject({ overall: 'not_certified', reason: 'read-only-observation-unavailable' });
        expect(out.remedy).toMatch(/1 GiB/);
        expect(out.remedy).toContain('.awm/admission.json');
        expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: [], rejected: [] });
        expect(mockRunCommand).not.toHaveBeenCalled();
    });

    describe('the post-run snapshot', () => {
        const DIGEST = 'a'.repeat(64);
        const stubSnapshot = (second: object) => {
            const calls = jest.fn()
                .mockReturnValueOnce({ ok: true, digest: DIGEST })
                .mockReturnValueOnce(second);
            jest.doMock('../../../src/commands/sensors/read-only-observation', () => {
                const actual = jest.requireActual('../../../src/commands/sensors/read-only-observation');
                return { ...actual, filesystemSnapshot: (...args: any[]) => calls(...args) };
            });
            return calls;
        };

        it('never certifies a run whose worktree cannot be observed after the sensors ran', async () => {
            const snapshot = stubSnapshot({ ok: false, failure: 'unreadable' });

            const out = await load().runSensors({ cwd: project, readOnly: true });

            expect(out).toMatchObject({
                overall: 'not_certified', reason: 'read-only-mutation-detected',
                remedy: 'sensor execution changed the worktree; repair it before using this evidence for admission',
            });
            expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: expect.any(Array), rejected: expect.any(Array) });
            expect(snapshot).toHaveBeenCalledTimes(2);
            expect(mockRunCommand).toHaveBeenCalledTimes(1);
        });

        it('keeps the verdict when the post-run snapshot matches the first one', async () => {
            const snapshot = stubSnapshot({ ok: true, digest: DIGEST });

            const out = await load().runSensors({ cwd: project, readOnly: true });

            expect(out.reason).not.toBe('read-only-mutation-detected');
            expect(out.readOnlyObservation).toEqual({ defaults: true, excluded: expect.any(Array), rejected: expect.any(Array) });
            expect(snapshot).toHaveBeenCalledTimes(2);
            expect(mockRunCommand).toHaveBeenCalledTimes(1);
        });
    });
});
