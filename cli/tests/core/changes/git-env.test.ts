import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';
import { GIT_TIMEOUT_MS, execGit, gitChildEnv, gitSpawnOptions } from '../../../src/core/changes/git-env';
import { headSha, runGit } from '../../../src/core/changes/git';
import { captureReceiptPrecondition } from '../../../src/core/changes/receipt';
import { runChangeValidate } from '../../../src/commands/change';
import { gitState } from '../../../src/core/changes/worktree';
import { makeRepo, withEnv } from './helpers';

describe('gitSpawnOptions', () => {
    test('has the cwd, utf8, the shared timeout and a scrubbed environment (stdio is spelled out by execGit)', () => {
        withEnv({ GIT_LITERAL_PATHSPECS: '1', GIT_AUTHOR_NAME: 'a' }, () => {
            const opts = gitSpawnOptions('/some/dir');
            expect(opts).toMatchObject({ cwd: '/some/dir', encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
            expect(opts.env.GIT_LITERAL_PATHSPECS).toBeUndefined();
            expect(opts.env.GIT_AUTHOR_NAME).toBe('a');
        });
    });
    test('every git child runs with lazy fetching off', () => {
        expect(gitSpawnOptions('/some/dir').env.GIT_NO_LAZY_FETCH).toBe('1');
    });
    test('takes the output buffer from an explicit parameter', () => {
        const opts = gitSpawnOptions('/d', { stderr: 'ignore', maxBuffer: 64 * 1024 * 1024 });
        expect(opts.maxBuffer).toBe(64 * 1024 * 1024);
    });
    test('leaves maxBuffer to the Node default when none is requested', () => {
        expect('maxBuffer' in gitSpawnOptions('/d')).toBe(false);
    });
});

describe('gitChildEnv', () => {
    test('removes the pathspec variables whatever their case, and keeps everything else', () => {
        withEnv({ GIT_LITERAL_PATHSPECS: '1', git_literal_pathspecs: '1', Git_Icase_Pathspecs: '1', GIT_GLOB_PATHSPECS: '1', git_noglob_pathspecs: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'a', AWM_KEEP_ME: 'k' }, () => {
            const env = gitChildEnv();
            expect(Object.keys(env).filter((k) => k.toUpperCase().endsWith('_PATHSPECS'))).toEqual([]);
            expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
            expect(env.GIT_AUTHOR_NAME).toBe('a');
            expect(env.AWM_KEEP_ME).toBe('k');
        });
    });
    test('turns lazy fetching off, whatever the caller has set, so that reading never fetches from a promisor remote', () => {
        for (const value of [undefined, '0', 'false', '']) {
            withEnv(value === undefined ? {} : { GIT_NO_LAZY_FETCH: value }, () => expect(gitChildEnv().GIT_NO_LAZY_FETCH).toBe('1'));
        }
    });
    test('turns lazy fetching off under any spelling of the name (environment names are case-insensitive on Windows)', () => {
        withEnv({ git_no_lazy_fetch: '0' }, () => {
            const env = gitChildEnv();
            expect(Object.keys(env).filter((k) => k.toUpperCase() === 'GIT_NO_LAZY_FETCH')).toEqual(['GIT_NO_LAZY_FETCH']);
            expect(env.GIT_NO_LAZY_FETCH).toBe('1');
        });
    });
    test.each(['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX'])(
        'removes the repository-location variable %s under any spelling, and keeps the rest of the environment', (name) => {
            withEnv({ [name]: '/hostile', [name.toLowerCase()]: '/hostile', GIT_AUTHOR_NAME: 'a' }, () => {
                const env = gitChildEnv();
                expect(Object.keys(env).filter((k) => k.toUpperCase() === name)).toEqual([]);
                expect(env.GIT_AUTHOR_NAME).toBe('a');
            });
        });
    test('does not modify process.env', () => {
        withEnv({ GIT_LITERAL_PATHSPECS: '1' }, () => {
            gitChildEnv();
            expect(process.env.GIT_LITERAL_PATHSPECS).toBe('1');
        });
    });
});

describe('the options every git child is really spawned with (stdio is explicit at the call)', () => {
    const optionsOfCalls = (fn: () => void): Record<string, unknown>[] => {
        const real = childProcess.execFileSync as (...a: unknown[]) => unknown;
        const seen: Record<string, unknown>[] = [];
        const spy = jest.spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args: string[], opts: Record<string, unknown>) => {
            seen.push(opts);
            return real(cmd, args, opts);
        }) as never);
        try { fn(); } finally { spy.mockRestore(); }
        return seen;
    };

    test('execGit returns stdout and passes stdin closed, stdout piped, stderr as asked', () => {
        const repo = makeRepo();
        try {
            const piped = optionsOfCalls(() => expect(execGit(repo.root, ['rev-parse', 'HEAD'])).toBe(repo.git('rev-parse', 'HEAD') + '\n'));
            expect(piped.map((o) => o.stdio)).toEqual([['ignore', 'pipe', 'pipe']]);
            const ignored = optionsOfCalls(() => { execGit(repo.root, ['rev-parse', 'HEAD'], { stderr: 'ignore' }); });
            expect(ignored.map((o) => o.stdio)).toEqual([['ignore', 'pipe', 'ignore']]);
        } finally { repo.cleanup(); }
    });

    test('runGit and gitState keep stdin closed and stdout piped on every child; gitState discards stderr', () => {
        const repo = makeRepo();
        try {
            const run = optionsOfCalls(() => { expect(runGit(repo.root, ['rev-parse', 'HEAD'])).not.toBeNull(); });
            expect(run).toHaveLength(1);
            expect(run[0]).toMatchObject({ cwd: repo.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS });
            const state = optionsOfCalls(() => { expect(gitState(repo.root, true).kind).toBe('ok'); });
            expect(state).toHaveLength(3);
            for (const o of state) expect(o).toMatchObject({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS });
        } finally { repo.cleanup(); }
    });
});

describe('an inherited GIT_DIR cannot redirect the change-record code to another repository', () => {
    test('runGit, headSha, gitState, the receipt precondition and `change validate` all describe the cwd repository', () => {
        const mine = makeRepo();
        const decoy = makeRepo();
        try {
            decoy.commit({ 'decoy.txt': 'x' }, 'feat: the decoy has a different history');
            const head = mine.git('rev-parse', 'HEAD');
            const decoyHead = decoy.git('rev-parse', 'HEAD');
            expect(decoyHead).not.toBe(head);
            const validate = () => runChangeValidate(mine.root, undefined, { json: true });
            const baseline = validate();
            const hostile = { GIT_DIR: path.join(decoy.root, '.git'), GIT_WORK_TREE: decoy.root, GIT_INDEX_FILE: path.join(decoy.root, '.git', 'index') };
            withEnv(hostile, () => {
                expect(runGit(mine.root, ['rev-parse', 'HEAD'])?.trim()).toBe(head);
                expect(headSha(mine.root)).toBe(head);
                const state = gitState(mine.root, true);
                expect(state.kind === 'ok' && state.commit).toBe(head);
                const pre = captureReceiptPrecondition(mine.root);
                expect(pre.eligible && pre.commit).toBe(head);
                expect(pre.eligible && fs.realpathSync.native(pre.root)).toBe(mine.root);
                expect(validate()).toEqual(baseline);
            });
        } finally { decoy.cleanup(); mine.cleanup(); }
    });
});
