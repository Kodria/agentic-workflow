import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { collectIssue148HistoricalFacts, collectMigrationFacts } from '../../../src/core/migration';
import { initBoundJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';

describe('collectMigrationFacts', () => {
    it.each([
        ['https://sentinel-user:sentinel-password@github.com/Kodria/agentic-workflow/issues/126'],
        ['https://github.com:443/Kodria/agentic-workflow/issues/126'],
        ['https://github.com/Kodria/agentic-workflow/issues/126?secret=sentinel'],
        ['https://github.com/Kodria/agentic-workflow/issues/126#sentinel'],
        ['https://github.com/Kodria/agentic-workflow/issues/126\n'],
        ['https://github.com/Kodria/agentic-workflow/issues/126', `https://github.com/Kodria/agentic-workflow/issues/${'1'.repeat(4096)}`],
        Array(129).fill('https://github.com/Kodria/agentic-workflow/issues/126'),
        ['https://github.com/Kodria/agentic-workflow/issues/126', 'https://github.com/Kodria/agentic-workflow/issues/148', 'https://sentinel:secret@github.com/Kodria/agentic-workflow/issues/149'],
    ])('rejects unsafe or unbounded issue links before reading either collector root (%#)', (...links) => {
        expect(() => collectMigrationFacts('x.md', '/nonexistent-migration-root', links)).toThrow(/issue #126/);
        expect(() => collectIssue148HistoricalFacts('/nonexistent-migration-root', links)).toThrow(/issue #126/);
    });

    test('does not export a record-injection completion API', () => {
        // The only public entrypoint derives evidence from the local journal.
        expect(require('../../../src/core/migration').reconcileTaskEvidence).toBeUndefined();
    });

    it('does not certify a task from a Git commit without durable test and review evidence', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-'));
        try {
            fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), '### Task 1: historical\n');
            execFileSync('git', ['init'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
            execFileSync('git', ['add', '.'], { cwd: root });
            execFileSync('git', ['commit', '-m', 'historical task'], { cwd: root });
            const report = collectMigrationFacts('docs/plans/old.md', root, ['https://github.com/Kodria/agentic-workflow/issues/126']);
            expect(report.state).toBe('planning-required');
            expect(report.tasks).toEqual([{ id: '1', state: 'unstarted', missing: [] }]);
            expect(report.facts.every(fact => /\/issues\/126$/.test(fact.issue126))).toBe(true);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects a task commit that omits a declared Files entry', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-files-'));
        try {
            fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(root, 'first.txt'), 'first');
            fs.writeFileSync(path.join(root, 'second.txt'), 'second');
            execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: root });
            execFileSync('git', ['config', 'user.email', 't@e.invalid'], { cwd: root });
            execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
            execFileSync('git', ['add', '.'], { cwd: root });
            execFileSync('git', ['commit', '-qm', 'first'], { cwd: root });
            fs.writeFileSync(path.join(root, 'second.txt'), 'second changed');
            execFileSync('git', ['add', 'second.txt'], { cwd: root });
            execFileSync('git', ['commit', '-qm', 'second'], { cwd: root });
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: historical\nCommit: ${sha}\n**Files:**\n- Modify: \`first.txt\`\n- Modify: \`second.txt\`\n\n### Task 2: later\n`);
            const planPath = 'docs/plans/old.md';
            const digest = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, planPath), 'utf8')).digest('hex');
            initBoundJournal(root, 'master', { path: planPath, digest, schema: 'compact-slices/v1', executionMode: 'desatendido', boundAt: '2026-09-15T00:00:00.000Z' });
            const state = readJournal(root, 'master').state!;
            state.tasks = [{ id: '1', title: 't', status: 'done', attempts: 1, verificationPlan: [{ id: 'test:1', kind: 'test' }, { id: 'sensor:1', kind: 'sensors' }], reviewObligations: [{ id: 'spec:1', taskId: '1', kind: 'spec', verdictId: 'v1' }, { id: 'quality:1', taskId: '1', kind: 'quality', verdictId: 'v2' }] }];
            const job = (id: string) => ({ id, fingerprint: 'f', commandDigest: 'd', argv: ['node'], cwd: '.', paths: ['second.txt'], expandedPaths: ['second.txt'], executionState: 'exited' as const, observationState: 'progressing' as const, verdict: 'pass' as const, phaseTimestamps: {}, satisfies: [id] });
            state.jobs = { test: job('test:1'), sensor: job('sensor:1') };
            state.verdicts = [{ id: 'v1', obligationId: 'spec:1', result: 'pass', detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: 'f', argv: [], paths: [], cwd: '.' }, { id: 'v2', obligationId: 'quality:1', result: 'pass', detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: 'f', argv: [], paths: [], cwd: '.' }];
            writeJournal(root, 'master', state);
            expect(collectMigrationFacts(planPath, root, ['https://github.com/Kodria/agentic-workflow/issues/126']).tasks[0]).toMatchObject({ state: 'pending', missing: expect.arrayContaining(['commit']) });
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects material facts without the durable #126 link', () => {
        expect(() => collectMigrationFacts('x.md', process.cwd(), ['https://github.com/Kodria/agentic-workflow/issues/148'])).toThrow('issue #126');
    });

    it('rejects a plan reached through a parent symlink', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-link-')); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-outside-'));
        try { fs.writeFileSync(path.join(outside, 'plan.md'), '### Task 1: x\n'); fs.symlinkSync(outside, path.join(root, 'docs')); expect(() => collectMigrationFacts('docs/plan.md', root, ['https://github.com/Kodria/agentic-workflow/issues/126'])).toThrow(/contained bounded regular file/); } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
    });

    it.each(['current', 'combined-job', 'semantic-kind', 'spoofed-kind', 'content', 'deleted', 'index', 'head', 'argv', 'cwd', 'paths', 'binding', 'review-argv', 'empty-expansion', 'live-job'])('requires current schema-2 evidence (%s)', (change) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-journal-'));
        try {
            fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: historical\nCommit: ${'a'.repeat(40)}\n`);
            fs.writeFileSync(path.join(root, 'task.txt'), 'verified source');
            execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: root }); execFileSync('git', ['config', 'user.email', 't@e.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'T'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 't'], { cwd: root });
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: historical\nCommit: ${sha}\nFiles:\n- task.txt\n`);
            initBoundJournal(root, 'master', { path: 'docs/plans/old.md', digest: require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/plans/old.md'), 'utf8')).digest('hex'), schema: 'compact-slices/v1', executionMode: 'desatendido', boundAt: '2026-09-15T00:00:00.000Z' });
            const state = readJournal(root, 'master').state!; state.tasks = [{ id: '1', title: 't', status: 'done', attempts: 1, verificationPlan: [{ id: 'test:1', kind: 'test' }, { id: 'sensor:1', kind: 'sensors' }], reviewObligations: [{ id: 'spec:1', taskId: '1', kind: 'spec', verdictId: 'v1' }, { id: 'quality:1', taskId: '1', kind: 'quality', verdictId: 'v2' }] }];
            const argv = [process.execPath, '-e', 'process.exit(0)'];
            const paths = ['task.txt'];
            const observed = computeFingerprint(root, argv, paths, '.');
            const job = (id: string, satisfies: string[]) => ({ id, ...observed, argv: [...argv], cwd: '.', paths: [...paths], executionState: 'exited' as const, observationState: 'progressing' as const, verdict: 'pass' as const, phaseTimestamps: {}, satisfies });
            state.jobs = { t: job('t', ['test:1']), s: job('s', ['sensor:1']) };
            if (change === 'combined-job') state.jobs = { t: job('t', ['test:1', 'sensor:1']) };
            if (change === 'semantic-kind') {
                state.tasks[0].verificationPlan[0].id = 'unit';
                state.tasks[0].verificationPlan[1].id = 'quality-gate';
                state.jobs.t.satisfies = ['unit']; state.jobs.s.satisfies = ['quality-gate'];
            }
            if (change === 'spoofed-kind') for (const item of state.tasks[0].verificationPlan) item.kind = 'lint';
            state.verdicts = ['v1', 'v2'].map((id, index) => ({ id, obligationId: index === 0 ? 'spec:1' : 'quality:1', result: 'pass', detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: observed.fingerprint, argv: [...argv], paths: [...paths], cwd: '.' }));
            if (change === 'content') fs.writeFileSync(path.join(root, 'task.txt'), 'changed source');
            if (change === 'deleted') fs.unlinkSync(path.join(root, 'task.txt'));
            if (change === 'index') {
                fs.writeFileSync(path.join(root, 'task.txt'), 'staged change');
                execFileSync('git', ['add', 'task.txt'], { cwd: root });
                fs.writeFileSync(path.join(root, 'task.txt'), 'verified source');
            }
            if (change === 'head') execFileSync('git', ['commit', '--allow-empty', '-qm', 'unrelated HEAD'], { cwd: root });
            if (change === 'argv') state.jobs.t.argv.push('--changed');
            if (change === 'cwd') { fs.mkdirSync(path.join(root, 'subdir')); state.jobs.t.cwd = 'subdir'; }
            if (change === 'paths') state.jobs.t.paths = ['missing.txt'];
            if (change === 'binding') state.planBinding!.digest = '0'.repeat(64);
            if (change === 'review-argv') state.verdicts[1].argv.push('--changed');
            if (change === 'empty-expansion') {
                const empty = computeFingerprint(root, argv, ['missing.txt'], '.');
                for (const entry of Object.values(state.jobs)) Object.assign(entry, empty, { paths: ['missing.txt'] });
                for (const entry of state.verdicts) Object.assign(entry, { fingerprint: empty.fingerprint, paths: ['missing.txt'] });
            }
            if (change === 'live-job') state.jobs.t.executionState = 'running';
            writeJournal(root, 'master', state);
            const report = collectMigrationFacts('docs/plans/old.md', root, ['https://github.com/Kodria/agentic-workflow/issues/126']);
            if (['current', 'combined-job', 'semantic-kind'].includes(change)) {
                expect(report).toMatchObject({ state: 'supported-completion' });
                expect(report.tasks[0]).toMatchObject({ state: 'completed' });
            } else {
                expect(report.state).not.toBe('supported-completion');
                expect(report.tasks[0]?.state).not.toBe('completed');
            }
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('does not let Task 2 borrow a shared verifier identifier from Task 1', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-foreign-task-'));
        try {
            fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), '### Task 1: first\nFiles:\n- docs/plans/old.md\n\n### Task 2: second\nFiles:\n- task-2.txt\n');
            execFileSync('git', ['init'], { cwd: root }); execFileSync('git', ['config', 'user.email', 't@e.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
            execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'task 1'], { cwd: root });
            const taskOneCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
            fs.writeFileSync(path.join(root, 'task-2.txt'), 'task 2'); execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'task 2'], { cwd: root });
            const taskTwoCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: first\nCommit: ${taskOneCommit}\nFiles:\n- docs/plans/old.md\n\n### Task 2: second\nCommit: ${taskTwoCommit}\nFiles:\n- task-2.txt\n`);
            execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'record obligations'], { cwd: root });
            const planPath = 'docs/plans/old.md'; const digest = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, planPath), 'utf8')).digest('hex');
            initBoundJournal(root, 'master', { path: planPath, digest, schema: 'compact-slices/v1', executionMode: 'desatendido', boundAt: '2026-09-15T00:00:00.000Z' });
            const state = readJournal(root, 'master').state!;
            const task = (id: string) => ({ id, title: id, status: 'done' as const, attempts: 1, verificationPlan: [{ id: 'test:shared', kind: 'test' as const }, { id: 'sensor:shared', kind: 'sensors' as const }], reviewObligations: [{ id: `spec:${id}`, taskId: id, kind: 'spec' as const, verdictId: `v-spec-${id}` }, { id: `quality:${id}`, taskId: id, kind: 'quality' as const, verdictId: `v-quality-${id}` }] });
            state.tasks = [task('1'), task('2')];
            const argv = ['node']; const paths = ['docs/plans/old.md', 'task-2.txt'];
            const observed = computeFingerprint(root, argv, paths, '.');
            const job = (id: string, satisfies: string[]) => ({ id, ...observed, argv: [...argv], cwd: '.', paths: [...paths], executionState: 'exited' as const, observationState: 'progressing' as const, verdict: 'pass' as const, phaseTimestamps: {}, satisfies });
            state.jobs = { test: job('test', ['test:shared']), sensor: job('sensor', ['sensor:shared']) };
            state.verdicts = state.tasks.flatMap(taskState => taskState.reviewObligations.map(obligation => ({ id: obligation.verdictId!, obligationId: obligation.id, result: 'pass' as const, detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: observed.fingerprint, argv: [...argv], paths: [...paths], cwd: '.' })));
            writeJournal(root, 'master', state);
            const report = collectMigrationFacts(planPath, root, ['https://github.com/Kodria/agentic-workflow/issues/126']);
            expect(report.tasks.find(taskState => taskState.id === '1')).toMatchObject({ state: 'pending' });
            expect(report.tasks.find(taskState => taskState.id === '2')).toMatchObject({ state: 'pending' });
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects a job that satisfies otherwise exclusive verifiers from two tasks', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-multi-satisfies-'));
        try {
            fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), '### Task 1: first\nFiles:\n- docs/plans/old.md\n\n### Task 2: second\nFiles:\n- task-2.txt\n');
            execFileSync('git', ['init'], { cwd: root }); execFileSync('git', ['config', 'user.email', 't@e.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
            execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'task 1'], { cwd: root });
            const taskOneCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
            fs.writeFileSync(path.join(root, 'task-2.txt'), 'task 2'); execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'task 2'], { cwd: root });
            const taskTwoCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: first\nCommit: ${taskOneCommit}\nFiles:\n- docs/plans/old.md\n\n### Task 2: second\nCommit: ${taskTwoCommit}\nFiles:\n- task-2.txt\n`);
            execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 'record obligations'], { cwd: root });
            const planPath = 'docs/plans/old.md'; const digest = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, planPath), 'utf8')).digest('hex');
            initBoundJournal(root, 'master', { path: planPath, digest, schema: 'compact-slices/v1', executionMode: 'desatendido', boundAt: '2026-09-15T00:00:00.000Z' });
            const state = readJournal(root, 'master').state!;
            const task = (id: string) => ({ id, title: id, status: 'done' as const, attempts: 1, verificationPlan: [{ id: `test:${id}`, kind: 'test' as const }, { id: `sensor:${id}`, kind: 'sensors' as const }], reviewObligations: [{ id: `spec:${id}`, taskId: id, kind: 'spec' as const, verdictId: `v-spec-${id}` }, { id: `quality:${id}`, taskId: id, kind: 'quality' as const, verdictId: `v-quality-${id}` }] });
            state.tasks = [task('1'), task('2')];
            const argv = ['node']; const paths = ['docs/plans/old.md', 'task-2.txt'];
            const observed = computeFingerprint(root, argv, paths, '.');
            const job = (id: string, satisfies: string[]) => ({ id, ...observed, argv: [...argv], cwd: '.', paths: [...paths], executionState: 'exited' as const, observationState: 'progressing' as const, verdict: 'pass' as const, phaseTimestamps: {}, satisfies });
            state.jobs = { multi: job('multi', ['test:1', 'test:2']), sensorOne: job('sensorOne', ['sensor:1']), sensorTwo: job('sensorTwo', ['sensor:2']) };
            state.verdicts = state.tasks.flatMap(taskState => taskState.reviewObligations.map(obligation => ({ id: obligation.verdictId!, obligationId: obligation.id, result: 'pass' as const, detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: observed.fingerprint, argv: [...argv], paths: [...paths], cwd: '.' })));
            writeJournal(root, 'master', state);
            const report = collectMigrationFacts(planPath, root, ['https://github.com/Kodria/agentic-workflow/issues/126']);
            expect(report.tasks).toEqual([
                { id: '1', state: 'pending', missing: ['tests'] },
                { id: '2', state: 'pending', missing: ['tests'] },
            ]);
            expect(report.facts.filter(fact => fact.jobId === 'multi')).toEqual([]);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});

describe('collectIssue148HistoricalFacts', () => {
    it('requires the admitted sibling, canonical branch, and rejects incomplete digest/ledger provenance', () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-historical-parent-'));
        const current = path.join(parent, 'codex-issue-126-compact-only');
        const historical = path.join(parent, 'codex-issue-148-awm-facts');
        const cwd = jest.spyOn(process, 'cwd').mockReturnValue(current);
        try {
            fs.mkdirSync(current); fs.mkdirSync(path.join(historical, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(historical, 'docs', 'plans', '2026-09-14-awm-facts-plan.md'), `### Task 1: facts\n- [x] reviewed\n\n### Task 2: quality\n${Array.from({ length: 12 }, (_, index) => `\n### Task ${index + 3}: unstarted\n`).join('')}`);
            execFileSync('git', ['init', '-q', '-b', 'codex/issue-148-awm-facts'], { cwd: historical });
            execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'add', '.'], { cwd: historical });
            execFileSync('git', ['-c', 'user.email=t@e.invalid', '-c', 'user.name=T', 'commit', '-qm', 'fixture'], { cwd: historical });
            expect(() => collectIssue148HistoricalFacts(current, ['https://github.com/Kodria/agentic-workflow/issues/126', 'https://github.com/Kodria/agentic-workflow/issues/148'])).toThrow(/admitted issue-148 sibling/);
            const report = collectIssue148HistoricalFacts(historical, ['https://github.com/Kodria/agentic-workflow/issues/126', 'https://github.com/Kodria/agentic-workflow/issues/148']);
            expect(report).toMatchObject({ state: 'blocked', diagnostics: ['issue-148 historical provenance is incomplete or inconsistent'] });
            expect(report.tasks).toEqual([
                { id: '1', state: 'pending', missing: ['historical-completion-provenance'] },
                { id: '2', state: 'pending', missing: ['quality-review'] },
                ...Array.from({ length: 12 }, (_, index) => ({ id: String(index + 3), state: 'unstarted' as const, missing: [] })),
            ]);
            fs.writeFileSync(path.join(historical, 'docs', 'plans', '2026-09-14-awm-facts-plan.md'), '### Task 1: unchecked\n\n### Task 2: later\n- [x] unrelated check\n');
            expect(collectIssue148HistoricalFacts(historical, ['https://github.com/Kodria/agentic-workflow/issues/126', 'https://github.com/Kodria/agentic-workflow/issues/148']).tasks[0])
                .toEqual({ id: '1', state: 'unstarted', missing: [] });
        } finally { cwd.mockRestore(); fs.rmSync(parent, { recursive: true, force: true }); }
    });
});
