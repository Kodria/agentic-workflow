import { GIT_TIMEOUT_MS, gitChildEnv, gitSpawnOptions } from '../../../src/core/changes/git-env';
import { withEnv } from './helpers';

describe('gitSpawnOptions', () => {
    test('has the cwd, utf8, the shared timeout, stderr piped by default and a scrubbed environment', () => {
        withEnv({ GIT_LITERAL_PATHSPECS: '1', GIT_AUTHOR_NAME: 'a' }, () => {
            const opts = gitSpawnOptions('/some/dir');
            expect(opts).toMatchObject({ cwd: '/some/dir', encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
            expect(opts.env.GIT_LITERAL_PATHSPECS).toBeUndefined();
            expect(opts.env.GIT_AUTHOR_NAME).toBe('a');
        });
    });
    test('takes the stderr handling and the output buffer from explicit parameters', () => {
        const opts = gitSpawnOptions('/d', { stderr: 'ignore', maxBuffer: 64 * 1024 * 1024 });
        expect(opts.stdio).toEqual(['ignore', 'pipe', 'ignore']);
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
    test('does not modify process.env', () => {
        withEnv({ GIT_LITERAL_PATHSPECS: '1' }, () => {
            gitChildEnv();
            expect(process.env.GIT_LITERAL_PATHSPECS).toBe('1');
        });
    });
});
