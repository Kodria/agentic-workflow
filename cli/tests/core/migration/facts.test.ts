import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { collectMigrationFacts, reconcileTaskEvidence } from '../../../src/core/migration';
import { initBoundJournal, readJournal, writeJournal } from '../../../src/core/journal/store';

describe('collectMigrationFacts', () => {
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

    it('rejects material facts without the durable #126 link', () => {
        expect(() => collectMigrationFacts('x.md', process.cwd(), ['https://github.com/Kodria/agentic-workflow/issues/148'])).toThrow('issue #126');
    });

    it('certifies only a complete evidence chain belonging to one task', () => {
        const issue126 = 'https://github.com/Kodria/agentic-workflow/issues/126';
        const records = [
            { taskId: '1', commitSha: 'a'.repeat(40), issue126 },
            { taskId: '1', verificationItemId: 'test:1', result: 'pass' as const, fingerprint: 'f', paths: ['x'], issue126 },
            { taskId: '1', verificationItemId: 'sensor:1', result: 'pass' as const, fingerprint: 'f', paths: ['x'], issue126 },
            { taskId: '1', role: 'spec' as const, result: 'pass' as const, verdictId: 'v1', obligationId: 'o1', at: '2026-09-15T00:00:00.000Z', issue126 },
            { taskId: '1', role: 'quality' as const, result: 'pass' as const, verdictId: 'v2', obligationId: 'o2', at: '2026-09-15T00:00:00.000Z', issue126 },
        ];
        expect(reconcileTaskEvidence('1', records)).toMatchObject({ state: 'completed' });
        expect(reconcileTaskEvidence('2', records)).toMatchObject({ state: 'pending' });
    });

    it.each([
        ['missing tests', [{ taskId: '1', commitSha: 'a'.repeat(40), issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }]],
        ['failed job', [{ taskId: '1', verificationItemId: 'test:1', result: 'fail' as const, issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }]],
        ['inconclusive review', [{ taskId: '1', role: 'quality' as const, result: 'inconclusive' as const, issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }]],
    ])('keeps adverse or incomplete %s pending', (_name, records) => {
        expect(reconcileTaskEvidence('1', records)).toMatchObject({ state: 'pending' });
    });

    it.each([
        ['checked-no-commit', []],
        ['commit-no-tests', [{ taskId: '1', commitSha: 'a'.repeat(40), issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }]],
        ['tests-no-review', [{ taskId: '1', commitSha: 'a'.repeat(40), issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }, { taskId: '1', verificationItemId: 'test:1', result: 'pass' as const, fingerprint: 'f', paths: ['x'], issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }, { taskId: '1', verificationItemId: 'sensor:1', result: 'pass' as const, fingerprint: 'f', paths: ['x'], issue126: 'https://github.com/Kodria/agentic-workflow/issues/126' }]],
    ])('keeps legacy %s pending', (_name, records) => expect(reconcileTaskEvidence('1', records)).toMatchObject({ state: 'pending' }));

    it('collects a schema-2 journal fixture without borrowing evidence across tasks', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migration-journal-'));
        try {
            fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
            fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: historical\nCommit: ${'a'.repeat(40)}\n`);
            execFileSync('git', ['init'], { cwd: root }); execFileSync('git', ['config', 'user.email', 't@e.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'T'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-m', 't'], { cwd: root });
            const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); fs.writeFileSync(path.join(root, 'docs', 'plans', 'old.md'), `### Task 1: historical\nCommit: ${sha}\n`);
            initBoundJournal(root, 'master', { path: 'docs/plans/old.md', digest: require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/plans/old.md'), 'utf8')).digest('hex'), schema: 'compact-slices/v1', executionMode: 'desatendido', boundAt: '2026-09-15T00:00:00.000Z' });
            const state = readJournal(root, 'master').state!; state.tasks = [{ id: '1', title: 't', status: 'done', attempts: 1, verificationPlan: [{ id: 'test:1', kind: 'test' }, { id: 'sensor:1', kind: 'sensors' }], reviewObligations: [{ id: 'spec:1', taskId: '1', kind: 'spec', verdictId: 'v1' }, { id: 'quality:1', taskId: '1', kind: 'quality', verdictId: 'v2' }] }];
            const job = (id: string, satisfies: string[]) => ({ id, fingerprint: 'f', commandDigest: 'd', argv: ['node'], cwd: '.', paths: ['x'], expandedPaths: ['x'], executionState: 'exited' as const, observationState: 'progressing' as const, verdict: 'pass' as const, phaseTimestamps: {}, satisfies });
            state.jobs = { t: job('t', ['test:1']), s: job('s', ['sensor:1']) };
            state.verdicts = [{ id: 'v1', obligationId: 'spec:1', result: 'pass', detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: 'f', argv: [], paths: [], cwd: '.' }, { id: 'v2', obligationId: 'quality:1', result: 'pass', detail: 'ok', receivedAt: '2026-09-15T01:00:00.000Z', fingerprint: 'f', argv: [], paths: [], cwd: '.' }]; writeJournal(root, 'master', state);
            const report = collectMigrationFacts('docs/plans/old.md', root, ['https://github.com/Kodria/agentic-workflow/issues/126']);
            expect(report).toMatchObject({ state: 'supported-completion' });
            expect(report.tasks[0]).toMatchObject({ state: 'completed' });
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
