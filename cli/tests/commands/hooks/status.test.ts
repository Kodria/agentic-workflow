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
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.sessionStartScript.ok).toBe(false);
    });

    it('throws when agent target has no hooks config', () => {
        const { computeHookStatus } = require('../../../src/commands/hooks/status');
        expect(() => computeHookStatus('antigravity')).toThrow(/hooks not supported/i);
    });
});
