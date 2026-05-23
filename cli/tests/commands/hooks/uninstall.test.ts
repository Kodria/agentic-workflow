import fs from 'fs';
import path from 'path';
import os from 'os';

describe('uninstallHook', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-uninstall-'));
        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    function writeSettings(content: any) {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(content, null, 2));
    }

    function readSettings(): any {
        return JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf-8'));
    }

    it('removes only the AWM entry, preserves other SessionStart entries', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        writeSettings({
            theme: 'dark',
            hooks: {
                SessionStart: [
                    { matcher: 'startup', hooks: [{ type: 'command', command: '/other/plugin' }] },
                    { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: `${scriptsDir}/run-hook.cmd session-start`, async: false }] }
                ]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.status).toBe('uninstalled');

        const settings = readSettings();
        expect(settings.theme).toBe('dark');
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('/other/plugin');
    });

    it('removes the SessionStart key entirely if AWM was the only entry', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        writeSettings({
            hooks: {
                SessionStart: [
                    { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: `${scriptsDir}/run-hook.cmd session-start`, async: false }] }
                ]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        uninstallHook({ agent: 'claude-code' });

        const settings = readSettings();
        expect(settings.hooks?.SessionStart).toBeUndefined();
    });

    it('is a no-op when no AWM entry exists', () => {
        writeSettings({
            hooks: {
                SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '/other/plugin' }] }]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.status).toBe('not-installed');

        const settings = readSettings();
        expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('is a no-op when settings.json does not exist', () => {
        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.status).toBe('not-installed');
    });

    it('creates a backup before modifying', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        writeSettings({
            hooks: {
                SessionStart: [
                    { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: `${scriptsDir}/run-hook.cmd session-start`, async: false }] }
                ]
            }
        });

        const { uninstallHook } = require('../../../src/commands/hooks/uninstall');
        const result = uninstallHook({ agent: 'claude-code' });
        expect(result.backupPath).not.toBeNull();
        expect(fs.existsSync(result.backupPath!)).toBe(true);
    });
});
