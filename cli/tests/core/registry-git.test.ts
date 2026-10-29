import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    buildRegistryGitEnv,
    createRegistryGit,
    listIgnoredGuardedGitEnvNames,
} from '../../src/core/registry-git';

describe('registry-git factory (#238 S1)', () => {
    it('buildRegistryGitEnv drops guarded GIT_* keys, keeps PATH, forces GIT_TERMINAL_PROMPT=0', () => {
        const parent: NodeJS.ProcessEnv = {
            PATH: '/usr/bin',
            HOME: '/tmp/home',
            GIT_ASKPASS: '/secret/askpass',
            GIT_SSL_CAINFO: '/secret/ca.pem',
            GIT_TERMINAL_PROMPT: '1',
            EDITOR: 'vi',
            VISUAL: 'vim',
            PAGER: 'less',
            OTHER: 'ok',
        };
        const env = buildRegistryGitEnv(parent);
        expect(env.PATH).toBe('/usr/bin');
        expect(env.HOME).toBe('/tmp/home');
        expect(env.OTHER).toBe('ok');
        expect(env.GIT_ASKPASS).toBeUndefined();
        expect(env.GIT_SSL_CAINFO).toBeUndefined();
        expect(env.EDITOR).toBeUndefined();
        expect(env.VISUAL).toBeUndefined();
        expect(env.PAGER).toBeUndefined();
        expect(env.GIT_TERMINAL_PROMPT).toBe('0');
        expect(listIgnoredGuardedGitEnvNames(parent)).toEqual(['GIT_ASKPASS', 'GIT_SSL_CAINFO']);
    });

    it('createRegistryGit against a bad remote fails quickly without hanging', async () => {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-registry-git-'));
        const remote = 'https://127.0.0.1:1/awm-no-such-repo.git';
        const started = Date.now();
        await expect(createRegistryGit().clone(remote, path.join(dest, 'repo'))).rejects.toThrow(
            /terminal prompts disabled|Failed to connect|Could not resolve|timed out|Authentication|Connection refused|Unable to connect|Network is unreachable/i
        );
        expect(Date.now() - started).toBeLessThan(15_000);
        fs.rmSync(dest, { recursive: true, force: true });
    }, 20_000);
});
