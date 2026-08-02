import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { changedPaths, gitCheckTrackId, mergeBase } from '../../../src/core/tracks/git';

describe('git adapter', () => {
    let repo: string;
    afterEach(() => { if (repo) fs.rmSync(repo, { recursive: true, force: true }); });

    test('changedPaths usa commits y conserva ambos lados de rename (R5.2, R5.4)', () => {
        repo = initRepo();
        const base = commitFile(repo, 'old.ts', 'one');
        fs.renameSync(path.join(repo, 'old.ts'), path.join(repo, 'new.ts'));
        execFileSync('git', ['add', '-A'], { cwd: repo });
        execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-m', 'rename'], { cwd: repo });
        expect(changedPaths(repo, base, 'HEAD')).toEqual([
            { status: 'R100', oldPath: 'old.ts', path: 'new.ts' },
        ]);
    });

    test('changedPaths reporta modificaciones simples con status M', () => {
        repo = initRepo();
        const base = commitFile(repo, 'a.ts', 'one');
        commitFile(repo, 'a.ts', 'two');
        expect(changedPaths(repo, base, 'HEAD')).toEqual([{ status: 'M', path: 'a.ts' }]);
    });

    test('changedPaths ignora el worktree sucio: solo compara commits (R5.2)', () => {
        repo = initRepo();
        const base = commitFile(repo, 'a.ts', 'one');
        commitFile(repo, 'a.ts', 'two');
        fs.writeFileSync(path.join(repo, 'a.ts'), 'dirty, uncommitted');
        expect(changedPaths(repo, base, 'HEAD')).toEqual([{ status: 'M', path: 'a.ts' }]);
    });

    test('mergeBase encuentra el ancestro común de dos ramas', () => {
        repo = initRepo();
        const base = commitFile(repo, 'a.ts', 'one');
        execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'branch', 'side'], { cwd: repo });
        commitFile(repo, 'b.ts', 'two');
        execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'checkout', '-q', 'side'], { cwd: repo });
        commitFile(repo, 'c.ts', 'three');
        expect(mergeBase(repo, 'main', 'side')).toBe(base);
    });

    test.each(['valid-track', '..', '-x', 'a/b'])('git check-ref-format participa para %p (R1.3)', (id) => {
        expect(gitCheckTrackId(id)).toBe(id === 'valid-track');
    });
});
