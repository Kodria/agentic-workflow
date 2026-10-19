import fs from 'fs';
import path from 'path';
import { bad, branchOff, cloneRepo, makeRepo, nonRepoDir, spyOnGit, type TestRepo } from './helpers';
import { failed } from '../../../src/core/changes/command';
import { DEFAULT_BASES } from '../../../src/core/changes/git';
import { BASE_OPTION_HELP, HEAD_MOVED, headMovedFailure, recordDirProblem, resolveBaseRef, resolveRange } from '../../../src/core/changes/range';
import type { RecordDir } from '../../../src/core/changes/record-io';

let repo: TestRepo;
/** A repository for the groups that need one (the pure recordDirProblem tests need none). */
function withRepo(): void {
    let template: TestRepo;
    beforeAll(() => { template = makeRepo(); });
    afterAll(() => template.cleanup());
    beforeEach(() => { repo = cloneRepo(template); });
    afterEach(() => repo.cleanup());
}

describe('resolveRange', () => {
    withRepo();
    test('returns the pinned HEAD and the merge base of the default base', () => {
        const main = branchOff(repo);
        const head = repo.commit({ 'a.ts': '1' }, 'feat: a');
        expect(resolveRange(repo.root, undefined)).toEqual({ ok: true, head, mergeBase: main });
    });
    test('an explicit base is honoured', () => {
        const main = branchOff(repo);
        repo.commit({ 'a.ts': '1' }, 'feat: a');
        repo.git('branch', 'other', main);
        expect(resolveRange(repo.root, 'other')).toMatchObject({ ok: true, mergeBase: main });
    });
    test('an unsafe base is invalid-input, and the value is escaped', () => {
        const r = resolveRange(repo.root, '--x\u001b[0m');
        expect(r).toMatchObject({ ok: false, failure: { code: 'invalid-input' } });
        expect(JSON.stringify(r)).not.toContain('\u001b');
    });
    test('an unknown base is base-unresolved with the remedy', () => {
        expect(resolveRange(repo.root, 'nope')).toEqual({ ok: false, failure: { code: 'base-unresolved', message: 'could not resolve a base branch', remedy: 'pass --base <ref>' } });
    });
    test('histories without a common ancestor are base-unresolved (no merge base)', () => {
        repo.git('checkout', '-q', '--orphan', 'island');
        repo.git('rm', '-rfq', '.');
        repo.commit({ 'island.ts': '1' }, 'feat: island');
        expect(resolveRange(repo.root, 'main')).toMatchObject({ ok: false, failure: { code: 'base-unresolved', remedy: 'pass --base <ref>' } });
        expect((resolveRange(repo.root, 'main') as { failure: { message: string } }).failure.message).toContain('no merge base');
    });
    /** A commit on its own branch from main, made shallow (no parents as far as git can tell): it shares no merge base with feat/x. */
    function shallowCommit(): string {
        repo.git('checkout', '-q', '-b', 'up', 'main');
        const up = repo.commit({ 'up.ts': '1' }, 'feat: upstream');
        repo.git('checkout', '-q', 'feat/x');
        repo.git('branch', '-D', 'up');
        fs.writeFileSync(path.join(repo.root, '.git', 'shallow'), `${up}\n`);
        return up;
    }
    test('R3.1 (Q7) without --base, a shallow origin/main with no merge base gives way to a connected local main', () => {
        const main = branchOff(repo);
        const head = repo.commit({ 'a.ts': '1' }, 'feat: a');
        const up = shallowCommit();
        repo.git('update-ref', 'refs/remotes/origin/main', up);
        expect(resolveRange(repo.root, undefined)).toEqual({ ok: true, head, mergeBase: main });
        // `changes list` needs no merge base: it keeps the first candidate that names a commit.
        expect(resolveBaseRef(repo.root, undefined)).toEqual({ ok: true, base: 'refs/remotes/origin/main', sha: up });
    });
    test('R3.1 (Q7) an explicit --base without a merge base is base-unresolved: no fallback to the defaults', () => {
        branchOff(repo);
        repo.commit({ 'a.ts': '1' }, 'feat: a');
        repo.git('branch', 'shallow', shallowCommit());
        expect(resolveRange(repo.root, 'shallow')).toEqual({ ok: false, failure: { code: 'base-unresolved', message: 'no merge base between "shallow" and HEAD', remedy: 'pass --base <ref>' } });
    });
    test('R3.1 (Q7) without --base, when no default that names a commit has a merge base, the failure names the first of them', () => {
        branchOff(repo);
        repo.commit({ 'a.ts': '1' }, 'feat: a');
        const up = shallowCommit();
        repo.git('update-ref', 'refs/remotes/origin/main', up);
        repo.git('update-ref', 'refs/heads/main', up);
        expect(resolveRange(repo.root, undefined)).toEqual({ ok: false, failure: { code: 'base-unresolved', message: 'no merge base between "refs/remotes/origin/main" and HEAD', remedy: 'pass --base <ref>' } });
    });
    test('R3.1 without --base, a tag literally named refs/heads/main is not taken for the absent branch main', () => {
        branchOff(repo);
        const head = repo.commit({ 'a.ts': '1' }, 'feat: a');
        const master = repo.git('rev-parse', 'main');
        repo.git('branch', '-m', 'main', 'master');
        repo.git('tag', 'refs/heads/main', head);
        expect(resolveRange(repo.root, undefined)).toEqual({ ok: true, head, mergeBase: master });
    });
    test('R3.1 (Q9) the merge base comes from the commit id the base resolved to, not from the base name read again', () => {
        const main = branchOff(repo);
        const head = repo.commit({ 'a.ts': '1' }, 'feat: a');
        const elsewhere = shallowCommit();
        let moved = false;
        const git = spyOnGit((args) => {
            if (!moved && args[0] === 'merge-base') { moved = true; repo.git('update-ref', 'refs/heads/main', elsewhere); }
        });
        try {
            expect(resolveRange(repo.root, undefined)).toEqual({ ok: true, head, mergeBase: main });
        } finally { git.restore(); }
        expect(moved).toBe(true);
    });
    test('an unreadable HEAD is git-failed', () => {
        expect(resolveRange(nonRepoDir(repo), undefined)).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
        expect(resolveRange(bad(undefined), undefined)).toMatchObject({ ok: false, failure: { code: 'git-failed' } });
    });
});

describe('BASE_OPTION_HELP (R3.1, Q6)', () => {
    test('names the default candidates in order', () => {
        expect(BASE_OPTION_HELP).toBe('base branch (default: origin/HEAD, origin/main, origin/master, main, master)');
    });
    test('is built from the candidate list, not written by hand', () => {
        jest.isolateModules(() => {
            jest.doMock('../../../src/core/changes/git', () => ({
                ...jest.requireActual('../../../src/core/changes/git'),
                DEFAULT_BASES: [{ ref: 'refs/remotes/origin/trunk', name: 'refs/remotes/origin/trunk' }, { ref: 'refs/heads/dev', name: 'dev' }],
            }));
            expect(require('../../../src/core/changes/range').BASE_OPTION_HELP).toBe('base branch (default: origin/trunk, dev)');
        });
        jest.dontMock('../../../src/core/changes/git');
    });
    test('the default candidates are the remote ones, then the local branches as full refs that report their short name', () => {
        expect(DEFAULT_BASES).toEqual([
            { ref: 'refs/remotes/origin/HEAD', name: 'refs/remotes/origin/HEAD' },
            { ref: 'refs/remotes/origin/main', name: 'refs/remotes/origin/main' },
            { ref: 'refs/remotes/origin/master', name: 'refs/remotes/origin/master' },
            { ref: 'refs/heads/main', name: 'main' },
            { ref: 'refs/heads/master', name: 'master' },
        ]);
    });
});

describe('headMovedFailure', () => {
    withRepo();
    test('HEAD moving has its own code, and it is an operational failure (exit 2) like the others', () => {
        expect(HEAD_MOVED.code).toBe('head-moved');
        expect(failed(HEAD_MOVED)).toMatchObject({ code: 2, stdout: '' });
        expect(failed(HEAD_MOVED).stderr).toMatch(/^head-moved: HEAD moved during derivation\n$/);
    });
    test('is null while HEAD is the pinned commit and HEAD_MOVED once it moved', () => {
        branchOff(repo);
        const head = repo.commit({ 'a.ts': '1' }, 'feat: a');
        expect(headMovedFailure(repo.root, head)).toBeNull();
        repo.commit({ 'b.ts': '1' }, 'feat: b');
        expect(headMovedFailure(repo.root, head)).toEqual(HEAD_MOVED);
    });
    test('an unreadable HEAD counts as moved', () => {
        expect(headMovedFailure(nonRepoDir(repo), 'a'.repeat(40))).toEqual(HEAD_MOVED);
    });
});

describe('recordDirProblem', () => {
    const nonOk = (kind: 'absent' | 'unsafe' | 'error') => ({ kind }) as Exclude<RecordDir, { kind: 'ok' }>;
    const dir = (kind: RecordDir['kind']): RecordDir => (kind === 'ok' ? { kind, dir: '/x' } : { kind } as RecordDir);
    test('a usable or absent directory is no problem for reading and writing', () => {
        for (const purpose of ['read', 'write'] as const) {
            expect(recordDirProblem(dir('ok'), purpose)).toBeNull();
            expect(recordDirProblem(dir('absent'), purpose)).toBeNull();
        }
    });
    test('a link or a non-directory is unsafe-path, worded for the purpose', () => {
        expect(recordDirProblem(dir('unsafe'), 'read')).toEqual({ code: 'unsafe-path', message: 'docs/changes or its parent is a symlink or not a directory; refusing to read' });
        expect(recordDirProblem(dir('unsafe'), 'write')).toEqual({ code: 'unsafe-path', message: 'docs/changes or its parent is a symlink or not a directory; refusing to write' });
        expect(recordDirProblem(nonOk('unsafe'), 'create')).toMatchObject({ code: 'unsafe-path' });
    });
    test('an unreadable directory is io-failed', () => {
        expect(recordDirProblem(dir('error'), 'read')).toEqual({ code: 'io-failed', message: 'could not inspect docs/changes' });
        expect(recordDirProblem(nonOk('error'), 'create')).toEqual({ code: 'io-failed', message: 'could not create docs/changes' });
    });
    test.each([[null], [undefined], ['ok'], [7], [[]], [{}], [{ kind: 'weird' }], [{ kind: 7 }]])('a value that is not a directory state (%p) is invalid-input, never a throw', (value) => {
        for (const purpose of ['read', 'write', 'create'] as const) {
            expect(recordDirProblem(bad(value), purpose as 'read')).toEqual({ code: 'invalid-input', message: 'the record directory state is not valid' });
        }
    });
    test('after a create attempt an absent directory is io-failed too', () => {
        expect(recordDirProblem(nonOk('absent'), 'create')).toEqual({ code: 'io-failed', message: 'could not create docs/changes' });
    });
});
