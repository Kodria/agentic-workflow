import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { collectMigrationFacts } from '../../../src/core/migration';

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
            expect(report.facts.every(fact => /\/issues\/126$/.test(fact.issue))).toBe(true);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects material facts without the durable #126 link', () => {
        expect(() => collectMigrationFacts('x.md', process.cwd(), ['https://github.com/Kodria/agentic-workflow/issues/148'])).toThrow('issue #126');
    });
});
