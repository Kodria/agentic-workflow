import fs from 'fs';
import path from 'path';
import os from 'os';

describe('resyncInstalledHooks', () => {
    let tmpHome: string;
    let tmpRegistry: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    function writeRegistry(sessionStartContent: string) {
        const regHooks = path.join(tmpRegistry, 'hooks');
        const regSkill = path.join(tmpRegistry, 'skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), sessionStartContent, { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
    }

    function writeSettingsWithAwmEntry(scriptsDir: string) {
        const settingsPath = path.join(tmpHome, '.claude/settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|clear|compact',
                    hooks: [{ type: 'command', command: `${path.join(scriptsDir, 'run-hook.cmd')} session-start`, async: false }]
                }]
            }
        }, null, 2));
    }

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-resync-'));
        tmpRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-resync-registry-'));
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

    it('refreshes stale COPIED hook scripts when the settings entry is present', () => {
        writeRegistry('#!/usr/bin/env bash\necho "NEW VERSION"');
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD VERSION"', { mode: 0o755 });
        fs.writeFileSync(path.join(scriptsDir, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'resynced' }]);
        const synced = fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8');
        expect(synced).toContain('NEW VERSION');
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(false);
        expect(() => fs.accessSync(path.join(scriptsDir, 'session-start'), fs.constants.X_OK)).not.toThrow();
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(true);
    });

    it('does NOT touch anything when the hook was never installed (no settings entry)', () => {
        writeRegistry('#!/usr/bin/env bash\necho "NEW VERSION"');

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'not-installed' }]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/hooks/session-start'))).toBe(false);
    });

    it('preserves symlink install method', () => {
        writeRegistry('#!/usr/bin/env bash\necho "V2"');
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.symlinkSync(path.join(tmpRegistry, 'hooks/session-start'), path.join(scriptsDir, 'session-start'));
        fs.symlinkSync(path.join(tmpRegistry, 'hooks/run-hook.cmd'), path.join(scriptsDir, 'run-hook.cmd'));
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'resynced' }]);
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(true);
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(true);
    });

    it('skips with registry-missing when the registry has no hooks dir', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'registry-missing' }]);
        expect(fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8')).toContain('OLD');
    });

    it('re-creates session-start as copy when scriptsDir exists but session-start is missing', () => {
        writeRegistry('#!/usr/bin/env bash\necho "FRESH"');
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        // session-start intentionally absent — only run-hook.cmd exists
        fs.writeFileSync(path.join(scriptsDir, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'resynced' }]);
        expect(fs.existsSync(path.join(scriptsDir, 'session-start'))).toBe(true);
        // detectInstallMethod fell back to copy since lstatSync threw
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(false);
    });

    it('returns registry-missing when run-hook.cmd is absent from registry', () => {
        // Partial registry: only session-start present, run-hook.cmd absent
        const regHooks = path.join(tmpRegistry, 'hooks');
        const regSkill = path.join(tmpRegistry, 'skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), '#!/usr/bin/env bash\necho "V2"', { mode: 0o755 });
        // run-hook.cmd intentionally NOT written
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---');

        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([{ agent: 'claude-code', action: 'registry-missing' }]);
        // old script left intact — never leave user without hook
        expect(fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8')).toContain('OLD');
    });
});
