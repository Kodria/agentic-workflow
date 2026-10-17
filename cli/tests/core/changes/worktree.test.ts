import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess, { execFileSync } from 'child_process';
import { REASON_GIT_FAILED, REASON_NOT_REPO, RUNTIME_STATE_EXCLUDES, gitState } from '../../../src/core/changes/worktree';

let root: string; let home: string;
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' };
const g = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: GIT_ENV }).trim();
const real = childProcess.execFileSync;
let spy: jest.SpyInstance | undefined;

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wt-')));
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    g('add', '.'); g('commit', '-q', '-m', 'feat: a');
});
afterEach(() => {
    spy?.mockRestore(); spy = undefined;
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

/** Intercepts git invocations whose first argument is `first`; every other call reaches the real git. */
const intercept = (first: string, handler: (opts: Record<string, unknown>, args: string[]) => string | never) => {
    spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>) => {
        if (cmd === 'git' && args[0] === first) return handler(opts, args);
        return (real as (...a: unknown[]) => unknown)(cmd, args, opts);
    }) as never);
};
const fail = (code: string) => (): never => { throw Object.assign(new Error(`spawnSync git ${code}`), { code }); };

describe('worktree state', () => {
    test('the runtime-state exclusion list is exactly the local state paths', () => {
        expect([...RUNTIME_STATE_EXCLUDES]).toEqual(['.awm/sensors/runs', '.awm/journal', '.awm/ledger', '.awm/evidence', '.awm/track.json']);
    });
    test('a clean repository reports its root, HEAD and a clean tree', () => {
        const state = gitState(root, true);
        expect(state.kind).toBe('ok');
        if (state.kind === 'ok') {
            expect(fs.realpathSync.native(state.root)).toBe(fs.realpathSync.native(root));
            expect(state.commit).toBe(g('rev-parse', 'HEAD'));
            expect(state.dirty).toBe(false);
        }
    });
    test('the root is normalized with native separators', () => {
        intercept('rev-parse', (opts, args) => (args[1] === '--show-toplevel' ? `${root}${path.sep}.${path.sep}\n` : (real as (...a: unknown[]) => string)('git', args, opts)));
        const state = gitState(root, true);
        expect(state.kind === 'ok' && state.root).toBe(path.resolve(root));
    });
    test('an untracked file is dirty for the pre-run measure and clean for the post-run recheck', () => {
        fs.writeFileSync(path.join(root, 'new.ts'), 'x');
        const pre = gitState(root, true); const post = gitState(root, false);
        expect(pre.kind === 'ok' && pre.dirty).toBe(true);
        expect(post.kind === 'ok' && post.dirty).toBe(false);
    });
    test('the pre-run measure sees untracked files even when status.showUntrackedFiles is no', () => {
        g('config', 'status.showUntrackedFiles', 'no');
        fs.writeFileSync(path.join(root, 'new.ts'), 'x');
        const pre = gitState(root, true);
        expect(pre.kind === 'ok' && pre.dirty).toBe(true);
    });
    test('a tracked change is dirty for both measures', () => {
        fs.writeFileSync(path.join(root, 'a.txt'), 'changed');
        const pre = gitState(root, true); const post = gitState(root, false);
        expect(pre.kind === 'ok' && pre.dirty).toBe(true);
        expect(post.kind === 'ok' && post.dirty).toBe(true);
    });
    test.each(RUNTIME_STATE_EXCLUDES.map((p) => [p]))('an untracked file at %s is not a change', (rel) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), 'x');
        const pre = gitState(root, true);
        expect(pre.kind === 'ok' && pre.dirty).toBe(false);
    });
    test('a non-string or empty cwd is a failure, never a throw', () => {
        expect(gitState(undefined as never, true)).toEqual({ kind: 'failed' });
        expect(gitState('', true)).toEqual({ kind: 'failed' });
    });
    test('a directory outside git is not-repo', () => {
        const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plain-'));
        try { expect(gitState(plain, true)).toEqual({ kind: 'not-repo' }); }
        finally { fs.rmSync(plain, { recursive: true, force: true }); }
    });
    test('a repository without a commit is not-repo', () => {
        const empty = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-')));
        try {
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
            expect(gitState(empty, true)).toEqual({ kind: 'not-repo' });
        } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    });
    test.each([['ENOBUFS'], ['ETIMEDOUT']])('a %s from git status is a failure, not a missing repository', (code) => {
        intercept('status', fail(code));
        expect(gitState(root, true)).toEqual({ kind: 'failed' });
    });
    test('git missing from PATH is a failure', () => {
        intercept('rev-parse', fail('ENOENT'));
        expect(gitState(root, true)).toEqual({ kind: 'failed' });
    });
    test('git status gets a 64 MiB buffer', () => {
        let seen: unknown;
        intercept('status', (opts) => { seen = opts.maxBuffer; throw Object.assign(new Error('stop'), { code: 'ENOBUFS' }); });
        gitState(root, true);
        expect(seen).toBeGreaterThanOrEqual(64 * 1024 * 1024);
    });
    test('the reasons are the stable user-facing strings', () => {
        expect(REASON_NOT_REPO).toBe('not inside a git repository with a commit');
        expect(REASON_GIT_FAILED).toBe('git command failed or timed out');
    });
});
