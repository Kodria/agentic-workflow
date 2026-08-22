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

        // Mock registry layout (content root — no registry/ prefix)
        const regHooks = path.join(tmpRegistry, 'hooks');
        const regSkill = path.join(tmpRegistry, 'skills/using-awm');
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
        // Task 6: using-awm.md is now a materialized file (buildContext's output), not a
        // symlink to the raw SKILL.md — so declared orchestrators actually reach Claude Code.
        expect(fs.lstatSync(path.join(scriptsDir, 'using-awm.md')).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(path.join(scriptsDir, 'using-awm.md'), 'utf-8')).toContain('MUST invoke skills.');

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
        fs.rmSync(path.join(tmpRegistry, 'hooks'), { recursive: true });

        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/registry not found/);

        // Did not create settings.json
        expect(fs.existsSync(path.join(tmpHome, '.claude/settings.json'))).toBe(false);
    });

    // Task 6: using-awm.md is materialized (buildContext's composed output), never a
    // symlink, regardless of installMethod — superseding the pre-Task-6 "UX choice" of
    // always symlinking this one file even under installMethod 'copy'.
    it('materializes using-awm.md (never a symlink) even when installMethod is copy', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'copy' });
        const skillPath = path.join(tmpHome, '.awm/hooks/using-awm.md');
        expect(fs.lstatSync(skillPath).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(skillPath, 'utf-8')).toContain('MUST invoke skills.');
    });

    // Non-regression net (Task 5, Step 1): fixes the hook's observable
    // contract before Task 6 replaces the symlink with a materialized
    // file write in claude.ts. Verifies R6.1.
    it('el hook queda apuntando a un archivo legible con el contenido de using-awm', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });

        const skillDest = path.join(tmpHome, '.awm/hooks/using-awm.md');
        expect(fs.existsSync(skillDest)).toBe(true);
        const content = fs.readFileSync(skillDest, 'utf-8');
        expect(content).toContain('MUST invoke skills.');
    });

    // Task 6, Step 1: closes the bypass — everything buildContext composes (declared
    // orchestrators, Tasks 1-4) must actually reach Claude Code's using-awm.md, not just
    // the raw SKILL.md. Verifies R1.1.
    //
    // Investigation note: the plan's literal sample writes `awm-registry.json` straight
    // into `tmpRegistry` and expects `collectAndWarn()` to pick it up via `listRegistries()`
    // — but `listRegistries()` reads registries.json under AWM_HOME, and `tmpRegistry` here
    // is a bare mkdtemp dir, never registered there via `awm registry add`. Writing the
    // manifest into an unregistered dir would leave `declared` empty and this test green
    // for the wrong reason (or red for the wrong reason, pre-fix). Instead this test
    // registers a REAL listed registry via `writeRegistriesConfig` + `registryContentRoot`
    // (the same pattern `tests/core/context/orchestrator.test.ts` already uses for this
    // exact situation) and installs FROM that registry, so `options.registryRoot` and the
    // one entry `listRegistries()` returns are the same directory — exercising the real
    // collection path end to end.
    it('el hook recibe los orquestadores declarados, no el SKILL.md crudo', () => { // verifies R1.1
        const { installHook } = require('../../../src/commands/hooks/install');
        const { writeRegistriesConfig, registryContentRoot } = require('../../../src/core/registries');

        writeRegistriesConfig([{ name: 'declaring-test', remote: 'unused' }]);
        const registryRoot = registryContentRoot('declaring-test');
        const regHooks = path.join(registryRoot, 'hooks');
        const regSkill = path.join(registryRoot, 'skills/using-awm');
        fs.mkdirSync(regHooks, { recursive: true });
        fs.mkdirSync(regSkill, { recursive: true });
        fs.writeFileSync(path.join(regHooks, 'session-start'), '#!/usr/bin/env bash\necho "{}"', { mode: 0o755 });
        fs.writeFileSync(path.join(regHooks, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(regSkill, 'SKILL.md'), '---\nname: using-awm\n---\nMUST invoke skills.');
        fs.writeFileSync(
            path.join(registryRoot, 'awm-registry.json'),
            JSON.stringify({ orchestrator: { name: 'mi-proceso', appliesWhen: 'al arrancar', terminatesTo: 'development-process' } }),
        );

        installHook({ agent: 'claude-code', registryRoot, installMethod: 'symlink' });

        const content = fs.readFileSync(path.join(tmpHome, '.awm', 'hooks', 'using-awm.md'), 'utf-8');
        expect(content).toContain('mi-proceso');            // la composicion LLEGA a Claude Code
        expect(content).toContain('MUST invoke skills.');   // y el skill sigue entero
    });

    // Finding 2 (code quality review, Task 6): regression-locks what the reviewer verified
    // by hand — a pre-Task-6 install left using-awm.md as a REAL symlink to the registry's
    // raw SKILL.md. writeMaterializedSkill() must fs.unlinkSync() that symlink (removing
    // only the directory entry) before writing the materialized file, never dereference it
    // and clobber the registry's own SKILL.md.
    it('migrates a pre-Task-6 symlinked using-awm.md to a materialized file without touching the registry SKILL.md', () => {
        const scriptsDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(scriptsDir, { recursive: true });
        const skillDest = path.join(scriptsDir, 'using-awm.md');
        const registrySkillPath = path.join(tmpRegistry, 'skills/using-awm/SKILL.md');
        const originalSkillContent = fs.readFileSync(registrySkillPath, 'utf-8');
        fs.symlinkSync(registrySkillPath, skillDest, 'file');
        expect(fs.lstatSync(skillDest).isSymbolicLink()).toBe(true);

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'symlink' });

        expect(fs.lstatSync(skillDest).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(skillDest, 'utf-8')).toContain('MUST invoke skills.');
        // The registry's own SKILL.md must be untouched — proves unlinkSync removed only
        // the directory entry and never dereferenced/deleted the symlink's target.
        expect(fs.existsSync(registrySkillPath)).toBe(true);
        expect(fs.readFileSync(registrySkillPath, 'utf-8')).toBe(originalSkillContent);
    });

    it('throws for unsupported agent target', () => {
        const { installHook } = require('../../../src/commands/hooks/install');
        expect(() => installHook({ agent: 'antigravity', registryRoot: tmpRegistry, installMethod: 'symlink' }))
            .toThrow(/hooks not supported/);
    });

    // Characterization test (Task 7, Step 1): freezes the Claude adapter's
    // observable contract — matcher, ordering, and untouched unrelated
    // settings/hooks keys — before the Claude-specific logic moves into
    // claude.ts. Verifies R19.
    it('keeps the Claude SessionStart matcher and unrelated settings unchanged', () => {
        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const settingsPath = path.join(claudeDir, 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify({
            permissions: { allow: ['Read'] },
            hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] },
        }));

        const { installHook } = require('../../../src/commands/hooks/install');
        installHook({ agent: 'claude-code', registryRoot: tmpRegistry, installMethod: 'copy' });

        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        expect(settings.permissions).toEqual({ allow: ['Read'] });
        expect(settings.hooks.SessionEnd).toHaveLength(1);
        expect(settings.hooks.SessionStart[0].matcher).toBe('startup|clear|compact');
    });
});
