import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { collectMigrationFacts, reconcileTaskEvidence } from '../../../src/core/migration';

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
});
