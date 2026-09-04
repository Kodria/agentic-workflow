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

        expect(results).toEqual([
            { agent: 'claude-code', action: 'resynced' },
            { agent: 'codex', action: 'not-installed' },
        ]);
        const synced = fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8');
        expect(synced).toContain('NEW VERSION');
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(false);
        expect(() => fs.accessSync(path.join(scriptsDir, 'session-start'), fs.constants.X_OK)).not.toThrow();
        // Task 6: using-awm.md is materialized (buildContext's output), not a symlink to the
        // raw SKILL.md — resync must not regress the install path back to a raw symlink.
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(path.join(scriptsDir, 'using-awm.md'), 'utf-8')).toContain('MUST invoke skills.');
    });

    it('does NOT touch anything when the hook was never installed (no settings entry)', () => {
        writeRegistry('#!/usr/bin/env bash\necho "NEW VERSION"');

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([
            { agent: 'claude-code', action: 'not-installed' },
            { agent: 'codex', action: 'not-installed' },
        ]);
        expect(fs.existsSync(path.join(tmpHome, '.awm/hooks/session-start'))).toBe(false);
    });

    // Task 6, Step 5 regression guard: the exact staleness the plan calls "el hallazgo mas
    // importante" — if resyncClaudeHookFiles ever regressed back to symlinking the raw
    // SKILL.md (instead of writing buildContext's materialized output, same as
    // installClaudeHook), `awm update` would silently strip declared orchestrators back
    // out of Claude Code's context on the very next resync after a correct install.
    it('re-materializes using-awm.md with declared orchestrators on resync, not a raw-SKILL.md symlink', () => {
        const { writeRegistriesConfig, registryContentRoot } = require('../../../src/core/registries');
        writeRegistriesConfig([{ name: 'declaring-resync-test', remote: 'unused' }]);
        const registryRoot = registryContentRoot('declaring-resync-test');
        const regHooks = path.join(registryRoot, 'hooks');
        const regSkill = path.join(registryRoot, 'skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), '#!/usr/bin/env bash\necho "{}"', { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
        fs.mkdirSync(path.join(registryRoot, 'skills', 'mi-proceso'), { recursive: true });
        fs.writeFileSync(path.join(registryRoot, 'skills', 'mi-proceso', 'SKILL.md'), '---\nname: mi-proceso\n---\n');
        fs.writeFileSync(
            path.join(registryRoot, 'awm-registry.json'),
            JSON.stringify({ orchestrator: { name: 'mi-proceso', appliesWhen: 'al arrancar', terminatesTo: 'development-process' } }),
        );

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot, installMethod: 'symlink' });

        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        const skillDest = path.join(scriptsDir, 'using-awm.md');
        expect(fs.readFileSync(skillDest, 'utf-8')).toContain('mi-proceso');

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(registryRoot);

        expect(results).toEqual([
            { agent: 'claude-code', action: 'resynced' },
            { agent: 'codex', action: 'not-installed' },
        ]);
        expect(fs.lstatSync(skillDest).isSymbolicLink()).toBe(false);
        const content = fs.readFileSync(skillDest, 'utf-8');
        expect(content).toContain('mi-proceso');
        expect(content).toContain('MUST invoke skills.');
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

        expect(results).toEqual([
            { agent: 'claude-code', action: 'resynced' },
            { agent: 'codex', action: 'not-installed' },
        ]);
        expect(fs.lstatSync(path.join(scriptsDir, 'session-start')).isSymbolicLink()).toBe(true);
        // Task 6: using-awm.md is materialized regardless of the scripts' install method —
        // it was never governed by `method` in the first place, before or after this change.
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(false);
    });

    it('skips with registry-missing when the registry has no hooks dir', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        fs.writeFileSync(path.join(scriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD"', { mode: 0o755 });
        writeSettingsWithAwmEntry(scriptsDir);

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([
            { agent: 'claude-code', action: 'registry-missing' },
            { agent: 'codex', action: 'not-installed' },
        ]);
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

        expect(results).toEqual([
            { agent: 'claude-code', action: 'resynced' },
            { agent: 'codex', action: 'not-installed' },
        ]);
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

        expect(results).toEqual([
            { agent: 'claude-code', action: 'registry-missing' },
            { agent: 'codex', action: 'not-installed' },
        ]);
        // old script left intact — never leave user without hook
        expect(fs.readFileSync(path.join(scriptsDir, 'session-start'), 'utf-8')).toContain('OLD');
    });

    it('refreshes an installed Codex hook script and skips the untouched Claude target', () => {
        const codexScriptsDir = path.join(tmpHome, '.awm/hooks/codex');
        fs.mkdirSync(codexScriptsDir, { recursive: true });
        fs.writeFileSync(path.join(codexScriptsDir, 'session-start'), '#!/usr/bin/env bash\necho "OLD CODEX"', { mode: 0o755 });

        const codexHooksPath = path.join(tmpHome, '.codex/hooks.json');
        fs.mkdirSync(path.dirname(codexHooksPath), { recursive: true });
        fs.writeFileSync(codexHooksPath, JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|resume|clear|compact',
                    hooks: [{
                        type: 'command',
                        command: path.join(codexScriptsDir, 'session-start'),
                        statusMessage: 'Loading AWM session state',
                    }],
                }],
            },
        }, null, 2));

        const regHooks = path.join(tmpRegistry, 'hooks');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'codex-session-start'), '#!/usr/bin/env bash\necho "NEW CODEX"', { mode: 0o755 });

        const { resyncInstalledHooks } = require('../../../src/commands/hooks/resync');
        const results = resyncInstalledHooks(tmpRegistry);

        expect(results).toEqual([
            { agent: 'claude-code', action: 'not-installed' },
            { agent: 'codex', action: 'resynced' },
        ]);
        expect(fs.readFileSync(path.join(codexScriptsDir, 'session-start'), 'utf-8')).toContain('NEW CODEX');
    });
});
