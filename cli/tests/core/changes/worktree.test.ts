import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess, { execFileSync } from 'child_process';
import { REASON_GIT_FAILED, REASON_NOT_REPO, RUNTIME_STATE_EXCLUDES, gitState } from '../../../src/core/changes/worktree';

const ENV_KEYS = ['HOME', 'AWM_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'];
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let saved: Record<string, string | undefined> = {};
let root: string; let home: string;
// Jest's sandboxed `process.env` is a copy that children do not see, so the child's environment is passed explicitly.
const gitEnv = () => ({ ...process.env, HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_NOSYSTEM: '1' });
const g = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env: gitEnv() }).trim();
const real = childProcess.execFileSync;
let spy: jest.SpyInstance | undefined;

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
    Object.assign(process.env, { HOME: home, AWM_HOME: path.join(home, '.awm'), GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' });
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wt-')));
    g('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    g('add', '.'); g('commit', '-q', '-m', 'feat: a');
});
afterEach(() => {
    spy?.mockRestore(); spy = undefined;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
});

afterAll(() => {
    // The environment the suite started with is back, so nothing leaks into the next test file.
    for (const k of ENV_KEYS) expect(process.env[k]).toBe(ORIGINAL[k]);
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
    test('R2.x isolation: HOME and AWM_HOME point at a throwaway directory, never the real ones', () => {
        expect(process.env.HOME).toBe(home);
        expect(process.env.HOME).not.toBe(ORIGINAL.HOME);
        expect(process.env.AWM_HOME).toBe(path.join(home, '.awm'));
        expect(process.env.AWM_HOME).not.toBe(ORIGINAL.AWM_HOME);
        expect(process.env.GIT_CONFIG_GLOBAL).toBe(os.devNull);
        expect(process.env.GIT_CONFIG_NOSYSTEM).toBe('1');
    });
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
    test('extra exclusions hide changes under them, on top of the runtime-state ones', () => {
        fs.mkdirSync(path.join(root, 'docs/changes'), { recursive: true });
        fs.writeFileSync(path.join(root, 'docs/changes/r.md'), 'r');
        const without = gitState(root, true); const withExtra = gitState(root, true, ['docs/changes']);
        expect(without.kind === 'ok' && without.dirty).toBe(true);
        expect(withExtra.kind === 'ok' && withExtra.dirty).toBe(false);
        fs.writeFileSync(path.join(root, 'other.ts'), 'x');
        const stillDirty = gitState(root, true, ['docs/changes']);
        expect(stillDirty.kind === 'ok' && stillDirty.dirty).toBe(true);
    });
    test('extra exclusions keep the runtime-state exclusions', () => {
        fs.mkdirSync(path.join(root, '.awm/journal'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm/journal/j.json'), 'x');
        const state = gitState(root, true, ['docs/changes']);
        expect(state.kind === 'ok' && state.dirty).toBe(false);
    });
    test.each([['docs/changes'], [[7]], [['../out']], [['a\nb']], [['/abs']], [[' pad']], [Array.from({ length: 65 }, (_, i) => `d${i}`)]])('unsafe extra exclusions %j are a failure, never a throw', (extra) => {
        expect(gitState(root, true, extra as never)).toEqual({ kind: 'failed' });
    });
    test('GIT_*_PATHSPECS variables in the environment do not change the exclusions', () => {
        fs.mkdirSync(path.join(root, 'docs/changes'), { recursive: true });
        fs.writeFileSync(path.join(root, 'docs/changes/r.md'), 'r');
        fs.mkdirSync(path.join(root, '.awm/journal'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm/journal/j.json'), 'x');
        const saved = process.env.GIT_LITERAL_PATHSPECS;
        process.env.GIT_LITERAL_PATHSPECS = '1';
        try {
            const state = gitState(root, true, ['docs/changes']);
            expect(state.kind === 'ok' && state.dirty).toBe(false);
        } finally { if (saved === undefined) delete process.env.GIT_LITERAL_PATHSPECS; else process.env.GIT_LITERAL_PATHSPECS = saved; }
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
            execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty, env: gitEnv() });
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
