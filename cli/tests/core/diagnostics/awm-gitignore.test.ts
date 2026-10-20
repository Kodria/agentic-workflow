import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { evaluateAwmGitignorePolicy, upsertAwmGitignore } from '../../../src/core/awm-gitignore';

function git(cwd: string, args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
}

describe('evaluateAwmGitignorePolicy + doctor project check', () => {
    let repo: string;

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-gi-doc-'));
        git(repo, ['init']);
        git(repo, ['config', 'user.email', 't@t']);
        git(repo, ['config', 'user.name', 't']);
    });
    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
    });

    it('fails when local runtime is tracked and proposes git rm --cached', () => {
        fs.mkdirSync(path.join(repo, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'journal', 'x.json'), '{}');
        fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n');
        git(repo, ['add', '-A']);
        git(repo, ['commit', '-m', 'track journal']);
        const result = evaluateAwmGitignorePolicy(repo);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.detail).toMatch(/tracked local runtime/i);
        expect(result.remedy).toMatch(/git rm --cached/);
        expect(result.remedy).toMatch(/awm sensors init|awm watch init/);
    });

    it('fails when sensors.json exists but is ignored by bare .awm/', () => {
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
        fs.writeFileSync(path.join(repo, '.gitignore'), '.awm/\n');
        const result = evaluateAwmGitignorePolicy(repo);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.detail).toMatch(/versioned config ignored|managed.*block missing/i);
        expect(result.remedy).toMatch(/awm sensors init|awm watch init/);
    });

    it('passes when the managed block is installed', () => {
        fs.mkdirSync(path.join(repo, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'sensors.json'), '{}');
        upsertAwmGitignore(repo);
        git(repo, ['add', '.gitignore', '.awm/sensors.json']);
        git(repo, ['commit', '-m', 'ok']);
        expect(evaluateAwmGitignorePolicy(repo)).toMatchObject({ ok: true });
    });
});
