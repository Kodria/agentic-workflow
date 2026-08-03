import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import {
    addOwnedWorktree, changedPaths, foreignPathExists, gitCheckTrackId,
    mergeBase, ownedWorktreeExists, removeOwnedBranch, removeOwnedWorktree,
} from '../../../src/core/tracks/git';
import type { TrackRef } from '../../../src/core/journal/types';

function trackRef(worktreePath: string, branch: string): TrackRef {
    return {
        trackId: 'x', worktreePath, branch,
        ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: 'f'.repeat(32), phase: 'PREPARE_INTENT', readinessNonce: 'r'.repeat(32),
    };
}

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

    describe('ownedWorktreeExists / removeOwnedBranch (Task 9, R4.2/R4.6/C11)', () => {
        let worktreePath: string;

        beforeEach(() => {
            worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-git-owned-wt-'));
            fs.rmdirSync(worktreePath);
        });

        afterEach(() => {
            fs.rmSync(worktreePath, { recursive: true, force: true });
        });

        test('false cuando el destino no existe (nada que reconocer como propio todavía)', () => {
            repo = initRepo();
            commitFile(repo, 'a.txt', 'x');
            expect(ownedWorktreeExists(repo, worktreePath, 'awm-track/x')).toBe(false);
        });

        test('false cuando el destino existe pero es genuinamente ajeno (R4.6 fail-closed)', () => {
            repo = initRepo();
            commitFile(repo, 'a.txt', 'x');
            fs.mkdirSync(worktreePath, { recursive: true });
            fs.writeFileSync(path.join(worktreePath, 'foreign.txt'), 'ajeno');
            expect(ownedWorktreeExists(repo, worktreePath, 'awm-track/x')).toBe(false);
            expect(foreignPathExists(worktreePath)).toBe(true);
        });

        test('true cuando el destino YA es un worktree real registrado en la branch exacta (crash tras un `addWorktree` que sí corrió)', () => {
            repo = initRepo();
            const baseSha = commitFile(repo, 'a.txt', 'x');
            const ref = trackRef(worktreePath, 'awm-track/x');
            addOwnedWorktree(repo, ref, baseSha);

            expect(ownedWorktreeExists(repo, worktreePath, 'awm-track/x')).toBe(true);
            // Una branch distinta al mismo path, o el mismo path con otra
            // branch, nunca cuentan como "nuestro" (identidad completa: path
            // Y branch deterministas, no solo uno de los dos).
            expect(ownedWorktreeExists(repo, worktreePath, 'awm-track/other')).toBe(false);
        });

        test('removeOwnedBranch borra la branch tras remover su worktree, y es idempotente si ya no existe', () => {
            repo = initRepo();
            const baseSha = commitFile(repo, 'a.txt', 'x');
            const ref = trackRef(worktreePath, 'awm-track/x');
            addOwnedWorktree(repo, ref, baseSha);
            removeOwnedWorktree(repo, worktreePath);

            expect(() => removeOwnedBranch(repo, 'awm-track/x')).not.toThrow();
            const branches = execFileSync('git', ['branch', '--list', 'awm-track/x'], { cwd: repo, encoding: 'utf8' });
            expect(branches.trim()).toBe('');

            // Idempotente: ya no existe, un segundo llamado (retry tras crash) no lanza.
            expect(() => removeOwnedBranch(repo, 'awm-track/x')).not.toThrow();
        });
    });
});
