import { gitChildEnv } from '../../../src/core/changes/git-env';
import { withEnv } from './helpers';

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
