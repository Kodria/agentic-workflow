import fs from 'fs';
import path from 'path';
import os from 'os';

describe('resolveBaseRemote', () => {
    let tmpHome: string;
    const origHome = process.env.HOME;
    const origAwmHome = process.env.AWM_HOME;
    const origEnvRemote = process.env.AWM_BASE_REMOTE;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-remote-'));
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        delete process.env.AWM_BASE_REMOTE;
        jest.resetModules();
    });

    afterEach(() => {
        process.env.HOME = origHome;
        if (origAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = origAwmHome;
        if (origEnvRemote === undefined) delete process.env.AWM_BASE_REMOTE;
        else process.env.AWM_BASE_REMOTE = origEnvRemote;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('falls back to DEFAULT_REMOTE when no env and no prefs', () => {
        const { resolveBaseRemote, DEFAULT_REMOTE } = require('../../src/core/registry');
        expect(resolveBaseRemote()).toBe(DEFAULT_REMOTE);
    });

    it('prefers preferences.json baseRemote over the default', () => {
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude-code', installMethod: 'symlink', defaultScope: 'local', baseRemote: 'git@team:content.git' })
        );
        const { resolveBaseRemote } = require('../../src/core/registry');
        expect(resolveBaseRemote()).toBe('git@team:content.git');
    });

    it('env AWM_BASE_REMOTE wins over prefs and default', () => {
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude-code', installMethod: 'symlink', defaultScope: 'local', baseRemote: 'git@team:content.git' })
        );
        process.env.AWM_BASE_REMOTE = 'git@env:wins.git';
        jest.resetModules();
        const { resolveBaseRemote } = require('../../src/core/registry');
        expect(resolveBaseRemote()).toBe('git@env:wins.git');
    });

    it('resolveBaseRemoteInfo reports where the remote came from', () => {
        const { resolveBaseRemoteInfo, DEFAULT_REMOTE } = require('../../src/core/registry');
        // default
        expect(resolveBaseRemoteInfo()).toEqual({ remote: DEFAULT_REMOTE, source: 'default' });
        // prefs
        const awmDir = path.join(tmpHome, '.awm');
        fs.mkdirSync(awmDir, { recursive: true });
        fs.writeFileSync(
            path.join(awmDir, 'preferences.json'),
            JSON.stringify({ defaultAgent: 'claude-code', installMethod: 'symlink', defaultScope: 'local', baseRemote: 'git@prefs:content.git' })
        );
        jest.resetModules();
        const m2 = require('../../src/core/registry');
        expect(m2.resolveBaseRemoteInfo()).toEqual({ remote: 'git@prefs:content.git', source: 'prefs' });
        // env wins over prefs
        process.env.AWM_BASE_REMOTE = 'git@env:x.git';
        jest.resetModules();
        const m3 = require('../../src/core/registry');
        expect(m3.resolveBaseRemoteInfo()).toEqual({ remote: 'git@env:x.git', source: 'env' });
    });
});
