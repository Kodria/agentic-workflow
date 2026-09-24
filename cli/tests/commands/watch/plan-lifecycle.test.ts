import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { initWatch, rebindWatchPlan } from '../../../src/commands/watch/init';
import { readJournal, writeJournal } from '../../../src/core/journal/store';
import { journalDir, requestsDir, statePath, supervisorLockPath } from '../../../src/core/journal/paths';
import { validatePlanFile } from '../../../src/core/plan/validate';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { beginGeneration } from '../../../src/commands/watch/generations';
import { emitRequest } from '../../../src/core/journal/requests';
import { requestJob } from '../../../src/commands/job/request';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import { Supervisor, DEFAULT_SUPERVISOR_CONFIG } from '../../../src/commands/watch/supervisor';
import { runExecWrapper } from '../../../src/commands/job/exec-wrapper';
import { acquireLock, releaseLock } from '../../../src/commands/watch/lock';
import { archiveUnusedWatch } from '../../../src/commands/watch/archive-unused';
import * as adapterModule from '../../../src/core/journal/adapter';

jest.setTimeout(30000);

function valid(repo: string) {
    const report = validatePlanFile('docs/plan.md', repo);
    if (report.state !== 'valid') throw new Error(JSON.stringify(report));
    return report;
}

function cli(repo: string, ...args: string[]) {
    return spawnSync(process.execPath, [path.resolve(__dirname, '../../../dist/src/index.js'), ...args], {
        cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: repo, AWM_HOME: path.join(repo, 'awm-home'), AWM_NO_UPDATE_CHECK: '1' },
    });
}

describe('compact lifecycle proof and unused bootstrap archival', () => {
    let repo: string;
    beforeEach(() => {
        repo = initRepo();
        commitFile(repo, 'source.md', '## Canonical source\nfixture source\n');
        fs.mkdirSync(path.join(repo, 'docs'));
        fs.mkdirSync(path.join(repo, '.awm'));
        fs.writeFileSync(path.join(repo, '.awm/sensors.json'), '{}');
        fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }));
        fs.writeFileSync(path.join(repo, 'docs/plan.md'), `${fs.readFileSync(path.join(__dirname, '../../core/plan/fixtures/compact-slices-v1/valid.md'), 'utf8')}\n- [ ] Reviewed task.\n`);
        initWatch(repo, 'main', { path: 'docs/plan.md', report: valid(repo) });
    });
    afterEach(() => { jest.restoreAllMocks(); fs.rmSync(repo, { recursive: true, force: true }); });

    test('durable journal retains hash commitments only, never the validated plan source body', () => {
        const contents = (directory: string): string => fs.readdirSync(directory, { withFileTypes: true }).map(entry =>
            entry.isDirectory() ? contents(path.join(directory, entry.name)) : fs.readFileSync(path.join(directory, entry.name), 'utf8')).join('\n');
        expect(contents(journalDir(repo, 'main'))).not.toContain('Reviewed task.');
        expect(readJournal(repo, 'main').state!.planBinding).toMatchObject({ executionIdentitySchema: 'awm-plan-execution/v1', executionDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    });

    test.each(['malformed', 'oversized', 'deep'])('CLI init rejects %s verifier inputs before mutating gitignore or journal', (kind) => {
        const fresh = initRepo();
        try {
            commitFile(fresh, 'source.md', '## Canonical source\nfixture source\n');
            fs.mkdirSync(path.join(fresh, 'docs'));
            fs.copyFileSync(path.join(repo, 'docs/plan.md'), path.join(fresh, 'docs/plan.md'));
            fs.writeFileSync(path.join(fresh, '.gitignore'), 'user-owned-ignore\n');
            if (kind === 'malformed') fs.writeFileSync(path.join(fresh, 'package.json'), '{invalid package');
            if (kind === 'oversized') fs.writeFileSync(path.join(fresh, 'package.json'), JSON.stringify({ padding: 'x'.repeat(256 * 1024) }));
            if (kind === 'deep') {
                let cursor = fresh;
                for (let i = 0; i < 65; i++) { cursor = path.join(cursor, 'p'); fs.mkdirSync(cursor); }
            }
            const before = fs.readFileSync(path.join(fresh, '.gitignore'), 'utf8');
            const rejected = cli(fresh, 'watch', '--init', '--plan', 'docs/plan.md');
            expect(rejected.status).not.toBe(0);
            expect(rejected.stderr).toMatch(/verifier scan/);
            expect(fs.readFileSync(path.join(fresh, '.gitignore'), 'utf8')).toBe(before);
            expect(fs.existsSync(statePath(fresh, 'main'))).toBe(false);
            expect(JSON.parse(cli(fresh, 'watch', 'journal-status', '--json').stdout).state).toBe('missing');
        } finally { fs.rmSync(fresh, { recursive: true, force: true }); }
    });

    test('CLI init rejects an existing linked journal segment before mutating gitignore', () => {
        const fresh = initRepo();
        try {
            commitFile(fresh, 'source.md', '## Canonical source\nfixture source\n');
            fs.mkdirSync(path.join(fresh, 'docs'));
            fs.copyFileSync(path.join(repo, 'docs/plan.md'), path.join(fresh, 'docs/plan.md'));
            fs.writeFileSync(path.join(fresh, '.gitignore'), 'user-owned-ignore\n');
            fs.mkdirSync(journalDir(fresh, 'main'), { recursive: true });
            fs.symlinkSync(path.join(fresh, 'docs'), requestsDir(fresh, 'main'), 'junction');
            const before = fs.readFileSync(path.join(fresh, '.gitignore'), 'utf8');
            const rejected = cli(fresh, 'watch', '--init', '--plan', 'docs/plan.md');
            expect(rejected.status).not.toBe(0);
            expect(rejected.stderr).toMatch(/symlink/);
            expect(fs.readFileSync(path.join(fresh, '.gitignore'), 'utf8')).toBe(before);
            expect(fs.existsSync(statePath(fresh, 'main'))).toBe(false);
        } finally { fs.rmSync(fresh, { recursive: true, force: true }); }
    });

    test('CLI reconciles proved progress while IN_PROGRESS without fabricating completion', () => {
        fs.writeFileSync(path.join(repo, 'docs/plan.md'), fs.readFileSync(path.join(repo, 'docs/plan.md'), 'utf8')
            .replace('- [ ] Reviewed task.', '- [x] Reviewed task.')
            .replace('#### Evidence', '<!-- awm-qa-complete: 2026-09-16 -->\n#### Evidence'));
        const result = cli(repo, 'watch', 'rebind', '--plan', 'docs/plan.md');
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        const state = readJournal(repo, 'main').state!;
        expect(state.cycle.status).toBe('IN_PROGRESS');
        expect(state.cycle.completedAt).toBeUndefined();
        expect(state.planBinding!.digest).toBe(valid(repo).planDigest);
        expect(state.planBindingHistory).toHaveLength(1);
        expect(state.tasks).toEqual([]);
        expect(state.verdicts).toEqual([]);
    });

    test.each([
        ['source-scoped evidence', ['source.md'], 'complete'],
        ['plan-inclusive evidence', [], 'custody'],
    ])('real execution after CLI rebind: %s (%s) reaches %s without a COMPLETE fixture', async (_label, paths, expectedOutcome) => {
        const generation = beginGeneration(repo, 'main');
        const supervisor = new Supervisor(repo, 'main', { ...DEFAULT_SUPERVISOR_CONFIG, tickMs: 10 }, (job, nonce, logsRoot, repoRoot) => {
            // The external controller is the test itself; actual verification
            // jobs still execute through the real wrapper and durable results.
            if (job.argv[0] === 'codex') return;
            void runExecWrapper({ logsRoot, jobId: job.id, nonce, argv: job.argv, cwd: job.cwd, repoRoot });
        }, undefined, async () => ({ state: 'admitted', planState: 'valid', executionMode: 'desatendido', journal: 'current', currentness: 'current', sensors: 'pass', diagnostics: [] }));
        const emit = (id: string, payload: Record<string, unknown>) => emitRequest(repo, 'main', { kind: 'register-entity', generationToken: generation.token, idempotencyKey: id, payload });
        emit('task', { entity: 'task', taskId: 'T1', title: 'Actual verification', verificationPlan: [{ id: 'tests', kind: 'test' }, { id: 'sensors', kind: 'sensors' }], reviewObligations: [{ id: 'spec', kind: 'spec' }, { id: 'quality', kind: 'quality' }] });
        emit('cycle', { entity: 'cycle-plan', items: [{ id: 'qa', kind: 'qa' }, { id: 'interlock', kind: 'interlock' }] });
        for (const id of ['tests', 'sensors']) requestJob(repo, 'main', generation.token, [process.execPath, '-e', 'process.exit(0)'], paths as string[], '.', { satisfies: id });
        for (const obligationId of ['spec', 'quality']) {
            const argv = ['awm-review', obligationId];
            emitRequest(repo, 'main', { kind: 'verdict', generationToken: generation.token, idempotencyKey: obligationId, payload: {
                verdictId: obligationId, obligationId, result: 'pass', detail: 'Real controller observation',
                fingerprint: computeFingerprint(repo, argv, ['source.md'], '.').fingerprint, argv, paths: ['source.md'], cwd: '.',
            } });
        }
        // This fixture acts as the external controller. Give it an adopted
        // identity before expecting the supervisor to dispatch verification
        // jobs; launch intent alone is deliberately insufficient.
        expect(await supervisor.tick()).toBe('continue');
        const launched = readJournal(repo, 'main').state!;
        const gen = launched.generations.find(entry => entry.token === generation.token)!;
        gen.processRef = { pid: process.pid, processGroup: process.pid, startTime: 'fixture',
            spawnNonce: gen.spawnNonce!, argvDigest: gen.launchArgvDigest!, psArgsDigest: 'b'.repeat(64) };
        writeJournal(repo, 'main', launched);
        const adapter = adapterModule.adapterFor('codex');
        jest.spyOn(adapterModule, 'adapterFor').mockReturnValue({ ...adapter,
            activity: () => ({ cpuTime: '0', groupSize: 1 }), safeToReplace: () => 'indeterminate' });
        for (let i = 0; i < 100; i++) {
            expect(await supervisor.tick()).toBe('continue');
            if (Object.values(readJournal(repo, 'main').state!.jobs).some(job => job.verdict === 'pass')) break;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(Object.values(readJournal(repo, 'main').state!.jobs).every(job => job.executionState === 'exited' && job.verdict === 'pass')).toBe(true);
        fs.writeFileSync(path.join(repo, 'docs/plan.md'), fs.readFileSync(path.join(repo, 'docs/plan.md'), 'utf8')
            .replace('- [ ] Reviewed task.', '- [x] Reviewed task.')
            .replace('#### Evidence', '<!-- awm-qa-complete: 2026-09-16 -->\n<!-- awm-docs-complete: 2026-09-16 -->\n<!-- awm-retro-complete: 2026-09-16 -->\n#### Evidence'));
        const rebound = cli(repo, 'watch', 'rebind', '--plan', 'docs/plan.md');
        expect(rebound.stderr).toBe('');
        expect(rebound.status).toBe(0);
        if (expectedOutcome === 'custody') expect(rebound.stdout).toMatch(/stale-fingerprint.*job request/);
        for (const id of ['qa', 'interlock']) requestJob(repo, 'main', generation.token, [process.execPath, '-e', 'process.exit(0)'], ['source.md'], '.', { satisfies: id });
        emit('done', { entity: 'task-status', taskId: 'T1', status: 'done' });
        let outcome = 'continue';
        for (let i = 0; i < 100 && outcome === 'continue'; i++) {
            outcome = await supervisor.tick();
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(outcome).toBe(expectedOutcome);
        const final = readJournal(repo, 'main').state!;
        expect(final.cycle.status).toBe(expectedOutcome === 'complete' ? 'COMPLETE' : 'BLOCKED');
        if (expectedOutcome === 'complete') expect(final.cycle.completedAt).toEqual(expect.any(String));
        else {
            expect(final.cycle.completedAt).toBeUndefined();
            expect(final.cycle.blockedReason).toMatch(/stale-fingerprint.*job request/);
        }
        expect(final.tasks[0].status).toBe('done');
        expect(final.verdicts).toHaveLength(2);
        expect(Object.values(final.jobs).every(job => job.executionState === 'exited' && job.verdict === 'pass')).toBe(true);
    });

    test('public current-branch status distinguishes missing, corrupt and unused without exporting bodies', () => {
        const present = cli(repo, 'watch', 'journal-status', '--json');
        expect(present.status).toBe(0);
        expect(JSON.parse(present.stdout)).toMatchObject({ state: 'present', cycleState: 'IN_PROGRESS', bootstrapUnused: true });
        expect(present.stdout).not.toContain('Reviewed task.');
        const state = statePath(repo, 'main');
        const before = fs.readFileSync(state, 'utf8');
        fs.writeFileSync(state, '{corrupt');
        expect(JSON.parse(cli(repo, 'watch', 'journal-status', '--json').stdout)).toEqual({ state: 'corrupt', bootstrapUnused: false });
        fs.writeFileSync(state, before);
        expect(cli(repo, 'watch', 'archive-unused', '--plan', 'docs/plan.md').status).toBe(0);
        expect(JSON.parse(cli(repo, 'watch', 'journal-status', '--json').stdout)).toEqual({ state: 'missing', bootstrapUnused: false });
    });

    test.each([
        ['requirements', (text: string) => text.replace(/RF-1\.3/g, 'RF-1.4')],
        ['argv', (text: string) => text.replace('"test"', '"build"')],
        ['source fact', (text: string) => text.replace('intentionally small and stable', 'changed fact')],
        ['prose', (text: string) => text.replace('only surfaces', 'changed surfaces')],
        ['mode', (text: string) => text.replace('desatendido', 'interactivo')],
    ])('rejects %s change and preserves the entire prior journal', (_label, edit) => {
        fs.writeFileSync(path.join(repo, 'docs/plan.md'), edit(fs.readFileSync(path.join(repo, 'docs/plan.md'), 'utf8')));
        const before = readJournal(repo, 'main').raw;
        expect(() => rebindWatchPlan(repo, 'main', { path: 'docs/plan.md', report: valid(repo) })).toThrow();
        expect(readJournal(repo, 'main').raw).toBe(before);
    });

    test('archives unused bootstrap recoverably via CLI without COMPLETE or cycle evidence', () => {
        const before = readJournal(repo, 'main').raw!;
        const result = cli(repo, 'watch', 'archive-unused', '--plan', 'docs/plan.md');
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        const archived = JSON.parse(result.stdout).archived as string;
        expect(fs.readFileSync(path.join(repo, archived, 'state.json'), 'utf8')).toBe(before);
        expect(JSON.parse(before).cycle.status).toBe('IN_PROGRESS');
        expect(fs.existsSync(statePath(repo, 'main'))).toBe(false);
        expect(fs.existsSync(path.join(repo, '.awm/evidence'))).toBe(false);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
    });

    test('archive refuses one durable task and leaves source journal intact', () => {
        const state = readJournal(repo, 'main').state!;
        state.tasks.push({ id: 'T1', title: 'Actual work', status: 'pending', attempts: 0, verificationPlan: [], reviewObligations: [] });
        writeJournal(repo, 'main', state);
        const before = readJournal(repo, 'main').raw;
        const result = cli(repo, 'watch', 'archive-unused', '--plan', 'docs/plan.md');
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/unused|bootstrap|utilizado/i);
        expect(readJournal(repo, 'main').raw).toBe(before);
    });

    test('archive refuses a pending request or a symlink artifact', () => {
        fs.writeFileSync(path.join(requestsDir(repo, 'main'), 'pending.json'), '{}');
        const before = readJournal(repo, 'main').raw;
        const result = cli(repo, 'watch', 'archive-unused', '--plan', 'docs/plan.md');
        expect(result.status).not.toBe(0);
        expect(readJournal(repo, 'main').raw).toBe(before);
        fs.rmSync(path.join(requestsDir(repo, 'main'), 'pending.json'));
        fs.symlinkSync(path.join(repo, 'source.md'), path.join(journalDir(repo, 'main'), 'outside'));
        const linked = cli(repo, 'watch', 'archive-unused', '--plan', 'docs/plan.md');
        expect(linked.status).not.toBe(0);
        expect(readJournal(repo, 'main').raw).toBe(before);
    });

    test('archive obeys the real supervisor lock and rejects unknown optional runtime state', () => {
        const before = readJournal(repo, 'main').raw;
        const lock = acquireLock(repo);
        try { expect(() => archiveUnusedWatch(repo, 'main', 'docs/plan.md')).toThrow(/supervisor activo/i); }
        finally { releaseLock(repo, lock); }
        expect(readJournal(repo, 'main').raw).toBe(before);
        const state = readJournal(repo, 'main').state!;
        state.controllerHeartbeatAt = new Date().toISOString();
        writeJournal(repo, 'main', state);
        expect(() => archiveUnusedWatch(repo, 'main', 'docs/plan.md')).toThrow(/no reconocido|unused/i);
    });

    test('a rename failure preserves active journal and releases its lock', () => {
        const before = readJournal(repo, 'main').raw;
        const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('injected rename failure'); });
        try { expect(() => archiveUnusedWatch(repo, 'main', 'docs/plan.md')).toThrow('injected rename failure'); }
        finally { rename.mockRestore(); }
        expect(readJournal(repo, 'main').raw).toBe(before);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
    });
});
