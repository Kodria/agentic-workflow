import fs from 'fs';
import path from 'path';
import os from 'os';

describe('computeHookStatus', () => {
    let tmpHome: string;
    let originalHome: string | undefined;
    let originalAwmHome: string | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
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

    function setupInstalledHook(scriptContent = '#!/usr/bin/env bash\necho "{}"') {
        const hooksDir = path.join(tmpHome, '.awm/hooks');
        fs.mkdirSync(hooksDir, { recursive: true });
        fs.writeFileSync(path.join(hooksDir, 'session-start'), scriptContent, { mode: 0o755 });
        fs.writeFileSync(path.join(hooksDir, 'run-hook.cmd'), '#!/usr/bin/env bash\nexec bash "$1"', { mode: 0o755 });
        fs.writeFileSync(path.join(hooksDir, 'using-awm.md'), '# using-awm\nMUST invoke skills.\n');

        const claudeDir = path.join(tmpHome, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({
            hooks: {
                SessionStart: [{
                    matcher: 'startup|clear|compact',
                    hooks: [{ type: 'command', command: `${hooksDir}/run-hook.cmd session-start`, async: false }]
                }]
            }
        }, null, 2));
    }

    it('reports HEALTHY when everything is in place', () => {
        setupInstalledHook();
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('claude-code');
        expect(result.overall).toBe('HEALTHY');
        expect(result.checks.bootstrapSkill.ok).toBe(true);
        expect(result.checks.sessionStartScript.ok).toBe(true);
        expect(result.checks.runHookWrapper.ok).toBe(true);
        expect(result.checks.settingsEntry.ok).toBe(true);
    });

    it('reports DEGRADED when bootstrap skill is missing', () => {
        setupInstalledHook();
        fs.unlinkSync(path.join(tmpHome, '.awm/hooks/using-awm.md'));
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('claude-code');
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.bootstrapSkill.ok).toBe(false);
    });

    it('reports NOT_INSTALLED when settings.json has no AWM entry', () => {
        setupInstalledHook();
        const claudeDir = path.join(tmpHome, '.claude');
        fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({}, null, 2));
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('claude-code');
        expect(result.overall).toBe('NOT_INSTALLED');
        expect(result.checks.settingsEntry.ok).toBe(false);
    });

    it('reports DEGRADED when script is missing executable bit', () => {
        setupInstalledHook();
        fs.chmodSync(path.join(tmpHome, '.awm/hooks/session-start'), 0o644);
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('claude-code');
        if (process.platform === 'win32') {
            // Windows has no POSIX executable-bit concept at all, and this isn't a
            // gap in computeHookStatus's checkExecutable() — it's Node's own
            // documented behavior: fs.accessSync(file, X_OK) "has no effect on
            // Windows (will behave like fs.constants.F_OK)" (Node fs docs). So
            // chmod(0o644) here only clears write bits, which Windows collapses
            // into "still not read-only" either way — there was never a distinct
            // exec permission to remove, and the script remains just as runnable
            // (via its interpreter/file association) as before the chmod. HEALTHY
            // is the factually correct report here, not a gap to paper over.
            expect(result.overall).toBe('HEALTHY');
            expect(result.checks.sessionStartScript.ok).toBe(true);
        } else {
            expect(result.overall).toBe('DEGRADED');
            expect(result.checks.sessionStartScript.ok).toBe(false);
        }
    });

    it('throws when agent target has no hooks config', () => {
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        expect(() => computeHookStatus('antigravity')).toThrow(/hooks not supported/i);
    });

    it('dispatches Codex targets to the Codex status checks (not the Claude ones)', () => {
        // No Codex hook installed in this tmpHome — should report NOT/DEGRADED
        // via the Codex-specific checks (sessionStartScript, settingsEntry),
        // never touching Claude's settings.json path.
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        const result = computeHookStatus('codex');
        // Separator-agnostic: the detail embeds a real OS path (`path.join`
        // under the hood), so it's `\` on windows-latest and `/` elsewhere —
        // assert the two path segments independently rather than one
        // POSIX-shaped fragment.
        expect(result.checks.settingsEntry.detail).toContain('.codex');
        expect(result.checks.settingsEntry.detail).toContain('hooks.json');
        expect(result.checks.bootstrapSkill).toBeUndefined();
        expect(result.checks.runHookWrapper).toBeUndefined();
    });
});
