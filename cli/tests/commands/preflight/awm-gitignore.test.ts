import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { preflight, type PreflightCheck } from '../../../src/commands/preflight/checks';
import { upsertAwmGitignore } from '../../../src/core/awm-gitignore';

function git(cwd: string, args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
}

describe('preflight awm-gitignore check (GI-6/GI-7)', () => {
    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-gi-pf-'));
        git(repo, ['init']);
        git(repo, ['config', 'user.email', 't@t']);
        git(repo, ['config', 'user.name', 't']);
    });
    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('degrades when versioned sensors.json is ignored', async () => {
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3, mode: 'opt-out', reason: 'test',
        }));
        fs.writeFileSync(path.join(repo, '.gitignore'), '.awm/\n');
        const report = await preflight(repo);
        const check = report.checks.find((c: PreflightCheck) => c.id === 'awm-gitignore');
        expect(check).toBeDefined();
        expect(check!.ok).toBe(false);
        expect(check!.advisory).not.toBe(true);
        expect(check!.remedy).toMatch(/awm sensors init|awm watch init/);
        expect(report.status).not.toBe('ready');
    });

    it('includes a passing awm-gitignore check when managed block is present for opt-out manifest', async () => {
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3, mode: 'opt-out', reason: 'test',
        }));
        upsertAwmGitignore(repo);
        git(repo, ['add', '-A']);
        git(repo, ['commit', '-m', 'ok']);
        const report = await preflight(repo);
        const check = report.checks.find((c: PreflightCheck) => c.id === 'awm-gitignore');
        expect(check).toMatchObject({ ok: true });
    });
});
