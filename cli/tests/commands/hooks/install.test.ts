import fs from 'fs';
import path from 'path';
import os from 'os';

describe('installHook (happy path + merge)', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-install-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-registry-'));

        // Mock registry layout
        const regHooks = path.join(tmpRegistry, 'registry/hooks');
        const regSkill = path.join(tmpRegistry, 'registry/skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), '#!/usr/bin/env bash\necho "{}"', { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');

        originalHome = process.env.HOME;
        originalAwmHome = process.env.AWM_HOME;
        process.env.HOME = tmpHome;
        process.env.AWM_HOME = path.join(tmpHome, '.awm');
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpRegistry, { recursive: true, force: true });
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = originalAwmHome;
    });

    it('installs on a clean system, creating settings.json with the AWM entry', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({
            agent: 'claude-code',
            registryRoot: tmpRegistry,
            installMethod: 'symlink'
        });

        expect(result.status).toBe('installed');

        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        expect(fs.existsSync(path.join(scriptsDir, 'session-start'))).toBe(true);
        expect(fs.existsSync(path.join(scriptsDir, 'run-hook.cmd'))).toBe(true);
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(true);

        const settings = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].matcher).toBe('startup|clear|compact');
        expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('run-hook.cmd');

        expect(result.backupPath).toBeNull();
    });

    it('merges with pre-existing SessionStart entry from another plugin', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const preExisting = {
            theme: 'dark',
            hooks: {
                SessionStart: [{
                    matcher: 'startup',
                    hooks: [{ type: 'command', command: '/some/other/plugin/hook' }]
                }]
            }
        };
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(preExisting, null, 2));

        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({
            agent: 'claude-code',
            registryRoot: tmpRegistry,
            installMethod: 'symlink'
        });

        expect(result.status).toBe('installed');
        expect(result.backupPath).not.toBeNull();
        expect(fs.existsSync(result.backupPath!)).toBe(true);

        const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
        expect(settings.theme).toBe('dark');
        expect(settings.hooks.SessionStart).toHaveLength(2);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('/some/other/plugin/hook');
        expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('run-hook.cmd');
    });

    it('is idempotent — second install does not duplicate', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });
        const result2 = installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });

        expect(result2.status).toBe('already-up-to-date');

        const settings = JSON.parse(fs.readFileSync(path.join(tmpHome, '.claude/settings.json'), 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('replaces a stale AWM entry when paths change', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|clear|compact',
                    hooks: [{ type: 'command', command: `${scriptsDir}/old-script session-start`, async: true }]
                }]
            }
        }, null, 2));

        const { installHook } = require('../../../src/commands/hooks/install');
        const result = installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });

        expect(result.status).toBe('installed');
        const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('run-hook.cmd');
        expect(settings.hooks.SessionStart[0].hooks[0].async).toBe(false);
    });

    it('aborts and backs up when settings.json is invalid JSON', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{ this is not json');

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/not valid JSON/);

        // Original file untouched
        expect(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8')).toBe('{ this is not json');
        // Backup created
        const backups = fs.readdirSync(path.join(tmpHome, '.awm/backups'));
        expect(backups.length).toBeGreaterThan(0);
    });

    it('fails fast when registry is missing', () => {
        fs.rmSync(path.join(tmpRegistry, 'registry'), { recursive: true });

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/registry not found/);

        // Did not create settings.json
        expect(fs.existsSync(path.join(tmpHome, '.claude/settings.json'))).toBe(false);
    });

    it('symlinks using-awm.md even when installMethod is copy (UX choice)', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'copy' });
        const skillPath = path.join(tmpHome, '.awm/hooks/using-awm.md');
        expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(true);
    });

    it('throws for unsupported agent target', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'antigravity', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/not supported/);
    });
});
