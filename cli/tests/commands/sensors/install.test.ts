import fs from 'fs';
import path from 'path';
import os from 'os';

describe('sensor hook install/uninstall', () => {
    let tmpDir: string;
    let settingsPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-install-'));
        settingsPath = path.join(tmpDir, 'settings.json');
        jest.resetModules();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../src/commands/sensors/install');

    it('installs PostToolUse hook into fresh settings.json', () => {
        const { installSensorHook } = load();
        const result = installSensorHook(settingsPath);
        expect(result.status).toBe('installed');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks.PostToolUse).toHaveLength(1);
        expect(settings.hooks.PostToolUse[0].matcher).toBe('Write|Edit|MultiEdit');
        expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('awm sensors run --fast');
    });

    it('merges with existing hooks — SessionStart entries preserved', () => {
        const existing = { hooks: { SessionStart: [{ matcher: 'startup', hooks: [] }] } };
        fs.writeFileSync(settingsPath, JSON.stringify(existing));
        const { installSensorHook } = load();
        installSensorHook(settingsPath);
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.PostToolUse).toHaveLength(1);
    });

    it('is idempotent — second install returns already-installed', () => {
        const { installSensorHook } = load();
        installSensorHook(settingsPath);
        const result2 = installSensorHook(settingsPath);
        expect(result2.status).toBe('already-installed');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks.PostToolUse).toHaveLength(1);
    });

    it('creates a backup before modifying settings.json', () => {
        fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));
        const { installSensorHook } = load();
        const result = installSensorHook(settingsPath);
        expect(result.backupPath).toBeDefined();
        expect(fs.existsSync(result.backupPath!)).toBe(true);
    });

    it('uninstall removes only the AWM sensor PostToolUse entry', () => {
        const { installSensorHook, uninstallSensorHook } = load();
        installSensorHook(settingsPath);
        const result = uninstallSensorHook(settingsPath);
        expect(result.status).toBe('removed');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks?.PostToolUse ?? []).toHaveLength(0);
    });
});
