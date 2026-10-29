import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    buildRegistryGitEnv,
    createRegistryGit,
    formatIgnoredGitEnvNotice,
    listIgnoredGuardedGitEnvNames,
    resetIgnoredGitEnvNoticeForTests,
    warnIgnoredGitEnvOnce,
} from '../../src/core/registry-git';
import { classifyRegistryGitError } from '../../src/core/registry-git-errors';

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

describe('registry-git ignored-env notice (#238 S2 / SG-5)', () => {
    afterEach(() => {
        resetIgnoredGitEnvNoticeForTests();
    });

    it('listIgnoredGuardedGitEnvNames returns GIT_SSL_CAINFO only (never the value)', () => {
        const parent: NodeJS.ProcessEnv = {
            PATH: '/usr/bin',
            GIT_SSL_CAINFO: '/secret/ca.pem',
            GIT_TERMINAL_PROMPT: '0',
        };
        expect(listIgnoredGuardedGitEnvNames(parent)).toEqual(['GIT_SSL_CAINFO']);
        const notice = formatIgnoredGitEnvNotice(['GIT_SSL_CAINFO']);
        expect(notice).toContain('GIT_SSL_CAINFO');
        expect(notice).not.toContain('/secret/ca.pem');
        expect(notice).toMatch(/git config|http\.sslCAInfo|file-based|credential\.helper|core\.sshCommand/i);
    });

    it('warnIgnoredGitEnvOnce emits once per process and never prints values', () => {
        const lines: string[] = [];
        const parent: NodeJS.ProcessEnv = {
            GIT_ASKPASS: '/secret/askpass',
            GIT_SSL_CAINFO: '/secret/ca.pem',
            GIT_TERMINAL_PROMPT: '1',
        };
        warnIgnoredGitEnvOnce((m) => lines.push(m), parent);
        warnIgnoredGitEnvOnce((m) => lines.push(m), parent);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('GIT_ASKPASS');
        expect(lines[0]).toContain('GIT_SSL_CAINFO');
        expect(lines[0]).not.toContain('/secret/');
        expect(lines[0]).not.toMatch(/GIT_TERMINAL_PROMPT/);
    });
});

describe('classifyRegistryGitError (#238 S2 / SG-6)', () => {
    it('maps terminal prompts disabled → authentication with credential.helper remedy', () => {
        const c = classifyRegistryGitError(new Error('fatal: could not read Username for \'https://example.com\': terminal prompts disabled'));
        expect(c.class).toBe('authentication');
        expect(c.fatalLine).toMatch(/terminal prompts disabled/i);
        expect(c.remedy).toMatch(/credential\.helper/);
    });

    it('maps TLS / certificate wording → tls', () => {
        const c = classifyRegistryGitError(new Error('fatal: unable to access \'https://x/\': SSL certificate problem: unable to get local issuer certificate'));
        expect(c.class).toBe('tls');
        expect(c.remedy).toMatch(/http\.sslCAInfo|http\.sslCAPath/);
    });

    it('maps Could not resolve host → network', () => {
        const c = classifyRegistryGitError(new Error('fatal: unable to access \'https://no.such.host/\': Could not resolve host: no.such.host'));
        expect(c.class).toBe('network');
    });

    it('maps timeout plugin message → timeout', () => {
        const c = classifyRegistryGitError(new Error('block timeout reached (60000ms) — killing process'));
        expect(c.class).toBe('timeout');
    });

    it('maps SSH host key failures → ssh with core.sshCommand remedy', () => {
        const c = classifyRegistryGitError(new Error('fatal: Host key verification failed.'));
        expect(c.class).toBe('ssh');
        expect(c.remedy).toMatch(/core\.sshCommand|~\/\.ssh\/config/);
    });

    it('maps repository not found → not-found', () => {
        const c = classifyRegistryGitError(new Error('remote: Repository not found.\nfatal: repository \'https://github.com/x/y.git\' not found'));
        expect(c.class).toBe('not-found');
        expect(c.fatalLine).toMatch(/not found/i);
    });
});
